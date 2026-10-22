# 经典论文解读（二十二）｜强化学习与对齐：Group Sequence Policy Optimization

旧策略生成一条回答，更新几次参数后，再让当前策略给同一条回答计算概率。这是 PPO、GRPO 复用采样数据的常见做法。对 MoE 模型，即使输入 token 和前缀完全相同，更新后的路由也可能选中不同专家，逐 token 概率比随之剧烈波动。

2025 年，Qwen 团队提出 **Group Sequence Policy Optimization（GSPO）**，把长度归一化的序列概率比用于策略更新，并在整条回答上裁剪。本文依据原论文 v2，讨论这一改动的公式、梯度与实验边界。

先澄清一个容易混淆的地方：结果监督下，GRPO 已经让整条回答共享同一个组内 advantage。GSPO 的核心变化在于**重要性比率及裁剪粒度**。其中，几何平均作用于 token 概率比，不是用来平均奖励。

## 一、MoE 的路由变化为什么会影响训练？

设问题为 `x`，旧策略生成回答 `y_i`，长度为 `T_i`。更新参数后，用当前策略在固定回答上重新计算 log-prob：第 `t` 个位置仍输入原来的前缀，计算原来那个 token 的条件概率，并不重新采样一条回答。

但“相同文本”不意味着“相同激活网络”。路由器和中间表示发生变化后，同一位置可能改用其他专家。作者在 48 层的 Qwen3-30B-A3B-Base 上观察到，每次 RL 梯度更新后，对同一个 rollout 样本，新旧策略激活的专家约有 10% 不同，并报告这会加剧 token 概率比的波动。

路由变化是波动来源之一。只要新旧条件概率有定义、旧概率非零，比率仍然可以计算；不能把“路由不同”直接说成“概率比在数学上失效”。论文对 GRPO 重要性权重的批评，涉及其在整个代理目标中的使用方式，以及作者观察到的训练噪声和坍塌。

同样，“每个前缀只采到一个 token”本身并不能证明重要性采样恒等式错误。更值得追问的是：这里用什么比率、估计什么目标，以及裁剪后留下了哪些梯度？

## 二、GRPO：奖励共享，权重与裁剪仍按 token 计算

同题生成 `G` 条回答，奖励为 `R_i`，组内优势为：

```math
\hat A_i=\frac{R_i-\bar R}{\sigma_R},
\qquad \hat A_{i,t}=\hat A_i.
```

零方差组没有相对优劣信号，实现时应让优势为零，避免除零。当前策略与旧策略的 token 概率比为：

```math
\rho_{i,t}(\theta)=
\frac{\pi_\theta(y_{i,t}\mid x,y_{i,<t})}
{\pi_{\mathrm{old}}(y_{i,t}\mid x,y_{i,<t})}.
```

为集中比较策略项，和 GSPO 论文一样暂略 KL 正则。GRPO 最大化：

```math
\mathcal J_{\mathrm{GRPO}}=
\mathbb E\left[\frac1G\sum_{i=1}^{G}\frac1{T_i}
\sum_{t=1}^{T_i}\min\left(
\rho_{i,t}\hat A_i,
\operatorname{clip}(\rho_{i,t},1-\epsilon,1+\epsilon)\hat A_i
\right)\right].
```

期望来自问题采样与旧策略生成的回答组；优化当前批次时，把回答、旧概率和优势视为固定量。同一条回答虽然共享优势，每个 token 的比率却不同，因此有各自的梯度权重和裁剪条件。

上一篇 DAPO 讨论的 token-level loss 改的是**聚合方式**：所有有效 token 统一平均，替代先在回答内部平均、再对回答平均。GSPO 改的是进入损失的比率与裁剪单位。两处“粒度”不能混为一谈。

## 三、从概率乘积到几何平均

自回归模型的回答概率等于各位置条件概率的乘积，因此完整序列概率比为：

```math
\frac{\pi_\theta(y_i\mid x)}{\pi_{\mathrm{old}}(y_i\mid x)}
=\prod_{t=1}^{T_i}\rho_{i,t}.
```

直接相乘对长度很敏感。假设每个位置的比率都是 `1.01`，100 个 token 的乘积约为 `2.70`，1000 个则约为 `20,959`。相同的平均局部变化，得到完全不同的序列尺度。

GSPO 对序列比率取 `T_i` 次方根：

```math
s_i(\theta)=
\left(\frac{\pi_\theta(y_i\mid x)}
{\pi_{\mathrm{old}}(y_i\mid x)}\right)^{1/T_i}
=\exp\left(\frac1{T_i}\sum_{t=1}^{T_i}\log\rho_{i,t}\right).
```

这就是 token 概率比的几何平均。上面的两个长度都会得到 `1.01`，因而可以在更统一的尺度上设裁剪阈值。实现时求 log-ratio 的均值，再取指数，也避免直接连乘大量小概率。

下面是解释性例子，不是论文实验：

| 四个 token 的概率比 | 完整序列比率 | GSPO 的 `s_i` |
| --- | --- | --- |
| `1, 1, 1, 1` | 1 | 1 |
| `4, 0.25, 1, 1` | 1 | 1 |
| `4, 1, 1, 1` | 4 | 约 1.4142 |

第二行的局部变化在 log 空间抵消，整条回答的指标仍为 1；第三行则说明，单点波动仍会影响序列指标，只是经过长度归一化。GSPO 没有要求所有 token 概率都接近旧策略，也不保证局部变化总能抵消。

还需区分理论对象：在通常的支持集条件下，完整轨迹概率比可用于轨迹分布的重要性采样校正；取长度次方根后，权重已改变。**长度归一化和裁剪属于代理目标设计，不能宣称这是严格无偏的完整轨迹重要性采样估计。**

这种聚合还改变了模型可以怎样分配概率变化。在第二行例子中，GSPO 看到的整体比率与第一行一致，但模型内部已经明显改变了两个位置的条件概率。因此，序列指标接近一不能用来证明每个位置都稳定；如果关心局部行为，还需要另行记录 token 比率分布。序列裁剪适合控制回答级代理目标，却没有提供逐位置的硬约束。

## 四、整条回答一起 Clip，梯度怎样变化？

GSPO 最大化的目标是：

```math
\mathcal J_{\mathrm{GSPO}}=
\mathbb E\left[\frac1G\sum_{i=1}^{G}
\min\left(s_i\hat A_i,
\operatorname{clip}(s_i,1-\epsilon_{\mathrm{low}},
1+\epsilon_{\mathrm{high}})\hat A_i\right)\right].
```

这里把上下裁剪范围分开写，以对应实验配置。优势仍来自同题组内比较，每条回答贡献一个代理目标项。

先看未进入裁剪平坦区的部分，省略期望与外层 `1/G`，两种方法对回答 `i` 的梯度分别为：

```math
\nabla_\theta J_i^{\mathrm{GRPO}}
=\frac{\hat A_i}{T_i}\sum_t
\rho_{i,t}\nabla_\theta\log\pi_\theta(y_{i,t}\mid x,y_{i,<t}),
```

```math
\nabla_\theta J_i^{\mathrm{GSPO}}
=\frac{s_i\hat A_i}{T_i}\sum_t
\nabla_\theta\log\pi_\theta(y_{i,t}\mid x,y_{i,<t}).
```

GRPO 按各自的 `ρ` 加权；GSPO 让同条回答中的 token 共享序列系数 `s_i`。共享系数不代表参数梯度相同：各位置的条件分布、激活专家及 log-prob 导数仍然不同。

裁剪要结合优势符号理解：

| 优势 | 进入平坦区的条件 | 该回答代理项停止提供的激励 |
| --- | --- | --- |
| 正优势 | `s_i > 1 + ε_high` | 继续提高回答的归一化概率比 |
| 负优势 | `s_i < 1 − ε_low` | 继续降低回答的归一化概率比 |

正优势回答落到下界以下，或负优势回答超过上界时，该项仍可提供梯度，把更新推向有利方向。Clip 并非“只要越界就删样本”，也不把实际概率比硬锁在区间里。其他回答的梯度和参数共享仍可能使它继续变化。

这使 GSPO 的裁剪决策在同条回答内保持一致，避免一条回答中有些位置因局部比率停止更新，另一些却以悬殊权重继续更新。代价也很直接：一旦该回答项进入平坦区，它的所有位置都不再从这个策略项获得梯度，不能单独保留其中某个 token。

在新旧策略完全相同、所有比率都为一时，两者的未裁剪策略梯度相同。这说明差异主要在复用数据、当前策略逐渐离开采样策略后显现。即便开始时目标值因组内优势均值为零而等于零，也不意味着梯度为零：不同回答的 log-prob 导数通常不同，正负优势仍会推动参数朝不同方向更新。只有组内优势本身全为零时，这一策略项才没有学习信号。

## 五、MoE 实验支持到了哪里？

作者此前用 **Routing Replay** 稳定 GRPO：缓存旧策略激活的专家，当前策略计算概率比时重放这些路由，让新旧概率在相同的专家选择下计算。这需要额外存储和通信，也限制了更新时自由选择专家的空间。

GSPO 实验取消了 Routing Replay，按当前模型正常路由，仍能稳定优化。按公式理解，局部 log-ratio 先平均再参与加权与裁剪，削弱了部分孤立波动对更新权重的影响。这为实验现象提供了一种解释，但几何平均无法保证消除相关误差：如果许多位置的 log-ratio 同向偏移，均值也会偏移。

论文的主要对照设置如下：

| 项目 | 设置 |
| --- | --- |
| 起点 | 从 Qwen3-30B-A3B-Base 微调得到的冷启动模型 |
| 更新方式 | 每批 rollout 分成四个 mini-batch 更新 |
| GSPO 裁剪 | 下范围 `3e-4`，上范围 `4e-4` |
| GRPO 裁剪 | 下范围 `0.2`，上范围 `0.27`，启用 Routing Replay |
| 评估 | AIME 2024、LiveCodeBench、CodeForces |

AIME 报告 32 次采样平均的 Pass@1；LiveCodeBench 使用 202410—202502 子集，报告 8 次采样平均的 Pass@1；CodeForces 使用 Elo。这里重复采样后的平均 Pass@1，不等于多次中至少一次成功的 pass@k。

作者报告，在相同训练计算与已消耗问题数的对照下，GSPO 的训练准确率和基准表现更好；增加训练投入、更新题集和延长生成长度后，仍可持续改进。由于两种比率的数值尺度不同，不能直接沿用 GRPO 的裁剪范围，也不能仅凭 GSPO 的范围很小就判断它“约束更强”。

论文还观察到，两者被裁剪 token 的比例相差约两个数量级，GSPO 裁剪更多却仍更高效。这说明保留更多 token 梯度不必然更有效，尚不足以把所有差异唯一归因于路由波动，也不能证明 GSPO 在任意 MoE、数据与训练预算下都更好。

训练与推理引擎的精度差异是另一个相关问题。实践中常用训练引擎重新计算旧策略 log-prob，以降低口径差异。论文提出，序列聚合可能更能容忍这些差异，从而有机会直接使用推理引擎返回的概率，省掉重算。这里应保留“潜力”的限定：系统性偏差不会因求平均自动消失，实际省略重算仍需验证。

## 六、一段教学实现

下面只实现 GSPO 策略损失，输入形状为 `[B, G, T]`，奖励为 `[B, G]`。假设每题都有完整的 `G` 条非空回答，log-prob 已按自回归预测位置正确对齐，mask 只包含有效回答 token，排除 prompt 和 padding。

```python
import torch


def gspo_loss(logp, old_logp, rewards, response_mask,
              eps_low=3e-4, eps_high=4e-4):
    mask = response_mask.bool()
    lengths = mask.sum(dim=-1)
    if (lengths == 0).any():
        raise ValueError("Every response must contain valid tokens")

    # 固定旧概率与组内优势；此处使用总体标准差。
    with torch.no_grad():
        r = rewards.float()
        centered = r - r.mean(dim=-1, keepdim=True)
        std = r.std(dim=-1, keepdim=True, correction=0)
        advantage = centered / std.clamp_min(1e-8)

    # 用 where 排除无效位置；当前 logp 保留计算图。
    delta = torch.where(
        mask, logp.float() - old_logp.detach().float(), 0.0
    )
    log_ratio = delta.sum(dim=-1) / lengths
    ratio = log_ratio.exp()
    clipped = ratio.clamp(1 - eps_low, 1 + eps_high)
    objective = torch.minimum(
        ratio * advantage, clipped * advantage
    )
    return -objective.mean()
```

同一批数据复用时，`old_logp` 必须保持固定；只对它和优势停止梯度，不能对当前 `logp` 或 `ratio` 做 detach。最后按回答平均，长度只参与序列 log-ratio 的计算，没有再按所有 token 统一平均。零奖励方差组的中心化奖励为零，因此优势与策略梯度也为零。

还可以直接检查反向传播：未裁剪时，同条回答每个有效位置的 log-prob 梯度应为负的 `s_i × advantage / (B × G × T_i)`，无效位置为零；进入裁剪平坦区后，该回答的这些梯度都应为零。这里检查的是对输入 log-prob 的导数，继续传回模型参数后，各位置的贡献仍会因网络计算而不同。

这是教学代码，未覆盖分布式聚合、截断策略、奖励验证和异常 log-prob 监控。真实系统还需保证记录的旧概率与行为策略口径一致；如果所有位置都有系统性偏差，GSPO 不能替代这项检查。

论文另给出 GSPO-token，用停止梯度技巧保留相同的序列比率数值，同时让各位置可配置不同优势，适用于多轮交互等需要更细信号的场景。所有位置优势相同时，它与 GSPO 的目标值、裁剪条件和理论梯度相同；它并未恢复 GRPO 各位置独立的旧新概率比。

读到这里，可以把 GSPO 的改动定位得很具体：组内优势继续评价整条回答，token 的 log-ratio 汇成一个长度归一化序列指标，再由它决定整条回答的加权与裁剪。是否值得采用，要看这种共享权重能否改善实际训练噪声，以及相应的稳定性收益能否在自己的设置中复现。

## 参考资料

1. Chujie Zheng et al., [Group Sequence Policy Optimization，arXiv v2](https://arxiv.org/html/2507.18071v2), 2025。公式与梯度见第 4 节，实验及 MoE、基础设施讨论见第 5 节。
2. Qwen Team, [GSPO: Towards Scalable Reinforcement Learning for Language Models](https://qwenlm.github.io/blog/gspo/), 2025。官方算法说明与训练观察。
3. Zhihong Shao et al., [DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models](https://arxiv.org/abs/2402.03300), 2024。GRPO 的组内优势与原始目标。
4. John Schulman et al., [Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347), 2017。裁剪代理目标。
5. 本站前文：[DeepSeekMath](category.html?category=papers&post=2026-10-21-deepseekmath-paper-notes)、[DAPO](category.html?category=papers&post=2026-10-22-dapo-paper-notes)。
