# 经典论文解读（四）：Training Compute-Optimal Large Language Models

2022 年，DeepMind 发表了 **《Training Compute-Optimal Large Language Models》**。这篇论文通常被称为 **Chinchilla 论文**，因为它训练了一个 70B 参数的模型 Chinchilla，并用它验证了一条新的大模型训练规律。

如果上一篇 Kaplan et al. 2020 的 **《Scaling Laws for Neural Language Models》** 告诉大家“模型、数据、计算之间存在可预测的缩放规律”，那么 Chinchilla 论文要回答的是一个更具体的问题：

> 在固定训练算力下，模型参数量和训练 token 数到底应该怎么分配？

它的结论很直接，也很有冲击力：

> 许多当时的大语言模型并不是太小，而是训练数据太少。为了 compute-optimal，模型参数量和训练 token 数应该大致等比例增长。

这篇论文把大模型训练策略从“尽量堆参数”推进到“参数和数据要平衡”。它也是后来很多开源大模型重视 token 数、数据质量和训练配比的重要原因。

本文按四个问题展开：

1. 为什么 Kaplan scaling law 之后还需要 Chinchilla？
2. Chinchilla 论文如何重新估计 compute-optimal 配比？
3. 70B Chinchilla 为什么能超过更大的 Gopher 和 GPT-3？
4. 这篇论文对后来的大模型训练有什么影响？

---

## 一、研究背景：Scaling law 之后的问题

Kaplan et al. 2020 给出了第一代语言模型 scaling law。它的核心判断是：语言模型 loss 会随着参数量、数据量和计算量呈现平滑幂律下降；在固定计算预算下，更大的模型通常更样本高效，因此可以训练一个很大的模型，并在远未收敛时提前停止。

这条结论非常重要。它解释了 GPT-3 这类超大模型为什么值得训练，也把大模型研发从经验试错推向了可预测工程。

但它也带来一个副作用：很多模型训练策略开始明显偏向 **更大参数量**。

### 1. 当时的大模型更像“参数优先”

Chinchilla 论文写作时，代表性大模型包括：

| 模型 | 参数量 | 训练 token 数量级 | 典型特征 |
| --- | --- | --- | --- |
| GPT-3 | 175B | 约 300B tokens | 参数巨大，few-shot 能力强 |
| Gopher | 280B | 约 300B tokens | DeepMind 的大规模 LM |
| Jurassic-1 | 178B | 数百 B tokens | 大参数量生成模型 |
| MT-NLG | 530B | 数百 B tokens | 更大参数量 |

这些模型共同体现了当时的倾向：参数量增长很快，但训练 token 数没有以同样速度增长。

这就引出 Chinchilla 论文的核心怀疑：

> 如果固定训练算力，继续堆参数真的是最优的吗？还是应该用更小模型看更多数据？

### 2. Compute-optimal 不是“最大模型”

这里要区分两个概念：

- **最大模型**：参数量尽可能大。
- **compute-optimal 模型**：在给定训练计算量下，最终 loss 最低。

两者不一定相同。一个 280B 参数模型如果只看了相对较少 token，可能还没有充分训练；一个 70B 参数模型如果看了更多 token，反而可能在同样训练算力下效果更好。

Chinchilla 论文要做的就是重新回答这个资源分配问题：

```text
固定训练 FLOPs
  |
  |-- 参数量 N 应该多大？
  |-- 训练 token 数 D 应该多少？
  |
  -> 哪种组合的 loss 最低？
```

---

## 二、实验设计：重新拟合参数与数据的比例

Chinchilla 的实验仍然属于 scaling law 研究，但它比 Kaplan 论文更聚焦于 **固定计算预算下的最优 `N:D` 配比**。

论文训练了 400 多个 Transformer 语言模型，参数量从 70M 到 16B+，训练数据从 5B 到 500B tokens。然后用多种方式拟合 loss、参数量、数据量、计算量之间的关系。

```mermaid
flowchart LR
    Budget["固定训练计算量 C"] --> Choice["选择 N 和 D"]
    Choice --> Models["训练 400+ 个 LM"]
    Models --> Loss["测量验证 loss"]
    Loss --> Fit["拟合 compute-optimal frontier"]
    Fit --> Rule["N 和 D 应大致等比例增长"]
```

### 1. 三种估计方式

论文不是只用一种拟合方法，而是从多个角度估计 compute-optimal 配比：

| 方法 | 思路 | 目的 |
| --- | --- | --- |
| 固定模型大小 | 看不同 token 数下的 loss 曲线 | 判断某个模型训练多久最合适 |
| 固定计算预算 | 在同一 FLOPs 下比较不同 `N/D` 组合 | 找 compute-optimal 点 |
| 参数化 loss 函数 | 直接拟合 `L(N, D)` | 外推更大预算下的最优比例 |

这很关键。Scaling law 的风险在于拟合方式不同可能得到不同结论。Chinchilla 用多种方法互相校验，增强了结论可信度。

### 2. 关注训练 token，而不是只看数据集大小

Chinchilla 论文里的 `D` 主要指训练 token 数。它关心的不是“磁盘上有多少文本”，而是模型实际看了多少 token。

这点非常重要。大模型训练里，同一个数据集可以训练多轮，也可以只看一部分；去重、过滤和采样策略也会影响有效 token。对于 compute-optimal 训练来说，真正起作用的是模型在训练中获得了多少有效学习信号。

### 3. 训练计算量约束

自回归 Transformer 的训练计算量可以粗略近似为：

```text
C ≈ 6 * N * D
```

其中 `N` 是非嵌入参数量，`D` 是训练 token 数。这个近似告诉我们：固定 `C` 时，`N` 和 `D` 是互相竞争的。

如果模型更大，就只能看更少 token；如果看更多 token，就要用更小模型。Chinchilla 的目标就是找到这条权衡曲线上的最佳点。

---

## 三、核心结论：参数和 token 要一起长

Chinchilla 论文最著名的结论是：

> 为了 compute-optimal，模型参数量和训练 token 数应该近似等比例增长。

也就是说：

```text
模型参数量翻倍 -> 训练 token 数也应大致翻倍
```

这个结论和 Kaplan 2020 的倾向不同。Kaplan 的最优分配更偏向快速增加参数量，数据增长较慢；Chinchilla 则认为很多模型参数太大、训练 token 太少。

### 1. 很多大模型是 undertrained

论文指出，近期大语言模型显著 undertrained。这里的 undertrained 不是说训练没跑完，而是说：

> 在同样训练算力下，它们选择了过大的参数量，导致每个参数获得的训练 token 不够。

直观上，一个 280B 参数模型如果只看 300B tokens，相当于每个参数平均只对应约 1 个 token 量级的训练信号。Chinchilla 的观点是，这样的配比不是 compute-optimal。

后来业界常用一个更粗略的经验说法：每个参数大约需要 20 个训练 token。这个数字来自对 Chinchilla 结论的简化理解，不应该被当作永恒常数，但它很好地表达了这篇论文的方向：**token 数不能太少**。

### 2. 更小模型 + 更多数据，可以赢过更大模型

Chinchilla 的验证实验非常直接。研究者在与 Gopher 相近的训练计算预算下，训练了一个新模型：

| 模型 | 参数量 | 训练数据 | 训练计算 |
| --- | --- | --- | --- |
| Gopher | 280B | 约 300B tokens | 作为对照 |
| Chinchilla | 70B | 约 1.4T tokens | 与 Gopher 相近 |

Chinchilla 的参数量只有 Gopher 的四分之一，但训练 token 约为 Gopher 的四倍。

结果是，Chinchilla 在大量下游任务上显著超过 Gopher，同时也超过 GPT-3、Jurassic-1 和 Megatron-Turing NLG 等更大模型。

这个结果让“参数越大越好”的朴素理解受到了很强挑战。真正重要的不是参数量单点，而是：

```text
模型大小 × 训练 token × 训练计算量
```

三者是否配平。

### 3. 推理和微调成本也更低

Chinchilla 还有一个工程优势：它只有 70B 参数。

相比 175B、280B、530B 这类模型，70B 模型在推理和微调时更便宜：

- 显存需求更低。
- 推理延迟更低。
- 部署门槛更低。
- 下游微调成本更低。

这意味着 compute-optimal 不只是训练阶段的概念。一个用同样训练算力获得更好效果、同时参数更小的模型，在整个生命周期里也更实用。

---

## 四、和 Kaplan Scaling Law 的关系

Chinchilla 不是否定 scaling law，而是 scaling law 方法的继续。

两篇论文的关系可以这样理解：

| 论文 | 贡献 | 训练策略倾向 |
| --- | --- | --- |
| Kaplan et al. 2020 | 证明 loss 与 `N/D/C` 存在平滑幂律 | 更大模型、相对较少数据、提前停止 |
| Hoffmann et al. 2022 | 重新估计 compute-optimal `N:D` 配比 | 参数量和 token 数大致等比例增长 |

Kaplan 论文解决的是“规模是否可预测”。Chinchilla 论文解决的是“在规模可预测之后，资源该怎么分配更优”。

### 1. 为什么会得到不同结论？

原因主要有三个。

第一，实验设计不同。Kaplan 更强调跨多个数量级观察 loss 与模型、数据、计算的关系；Chinchilla 更集中在固定计算预算下寻找最优 `N/D`。

第二，训练 token 范围不同。Chinchilla 更系统地扫描了更长训练 token 对 loss 的影响，因此更容易看到“大模型训练不够”的问题。

第三，外推目标不同。Kaplan 的结论很好地解释了 GPT-3 式超大模型路线；Chinchilla 则更关心在同等 FLOPs 下拿到最低 loss 和更好下游效果。

### 2. 方法论是一致的

两篇论文共享同一个思想：

> 不靠直觉猜大模型训练策略，而是用小到中等规模实验拟合规律，再外推到更大规模。

所以正确理解不是：

```text
Kaplan 错了，Chinchilla 对了
```

而是：

```text
Kaplan 建立了 scaling law 范式；
Chinchilla 在这个范式里修正了 compute-optimal 配比。
```

---

## 五、影响：从堆参数到重视 token

Chinchilla 论文之后，业界训练大模型时明显更重视训练 token 数和数据配比。

### 1. 开源模型更重视“训练充分”

很多后来的模型并不一味追求最大参数量，而是选择相对可部署的参数规模，配合更多训练 token。

这也是为什么一些 7B、13B、30B、70B 级模型可以表现出很强能力。它们不一定参数最大，但可能训练得更充分、数据更干净、配比更合理。

### 2. 数据工程变得更重要

如果训练 token 数要随参数量增长，那么数据问题会被放大：

- 数据从哪里来？
- 如何去重？
- 如何过滤低质量网页？
- 不同语种、代码、数学、问答数据如何配比？
- 重复训练数据会不会带来记忆和污染？

Chinchilla 之后，数据不再只是“越多越好”，而是和参数量、计算量一起成为训练设计的核心变量。

### 3. Compute-optimal 不等于能力最强

还要注意一个边界：compute-optimal 指的是给定训练计算量下尽量降低 loss。它不一定等价于所有场景下的最佳模型。

例如：

- 如果推理算力非常便宜，可能愿意训练更大模型。
- 如果部署成本敏感，可能偏向较小但训练充分的模型。
- 如果目标是特定任务，数据配比和后训练可能比预训练 loss 更重要。
- 如果有更多推理时计算，模型大小和测试时搜索也会改变权衡。

所以 Chinchilla 给的是一条强经验法则，不是所有系统设计的唯一答案。

---

## 六、局限：新的定律也不是终点

Chinchilla 论文影响很大，但仍然是经验研究。

### 1. 依赖模型族和数据分布

Chinchilla 的结论来自特定 Transformer 架构、特定数据混合和特定训练设置。换成不同 tokenizer、数据质量、上下文长度、优化器或架构，最优比例可能变化。

因此，“每个参数 20 个 token”适合当作工程起点，不适合当作物理常数。

### 2. 它主要关注预训练 compute

论文讨论的是训练阶段的 compute-optimal。现代大模型系统还包括：

- 指令微调。
- RLHF 或偏好优化。
- 长上下文扩展。
- 工具使用。
- 检索增强。
- 推理时计算。

这些阶段都会改变最终能力和成本结构。预训练 scaling law 是基础，但不是完整答案。

### 3. 更高质量数据可能改变 token 需求

如果数据质量更高，同样 token 数可能带来更多有效学习信号。如果数据高度重复或噪声很大，即使 token 数很多，也可能不等价于真正有用的数据量。

所以 Chinchilla 的“更多 token”不能理解成无脑抓更多网页，而应该理解成：在模型参数增长时，必须给模型足够多、足够有效的训练信号。

---

## 七、总结：Chinchilla 修正了大模型训练的重心

如果用一句话概括 Chinchilla 论文：

> 它说明在固定训练算力下，最优策略不是单纯训练更大的模型，而是让模型参数量和训练 token 数保持更合理的平衡。

它和 Kaplan scaling law 的关系非常紧密：

- Kaplan 2020 证明了 scaling law 是可用的大模型训练方法论。
- Chinchilla 2022 修正了 compute-optimal 的资源分配结论。
- 前者让大家相信扩大规模有规律，后者提醒大家不要只扩大参数而忽视数据。

这也是大模型工程从 GPT-3 阶段走向后续模型阶段的重要转折：竞争不再只是“谁的参数更多”，而是“谁能在给定算力下，把参数、数据、训练策略和部署成本配得更好”。

---

## 参考资料

- Hoffmann, J., Borgeaud, S., Mensch, A., et al. (2022). [Training Compute-Optimal Large Language Models](https://arxiv.org/abs/2203.15556).
- Kaplan, J., McCandlish, S., Henighan, T., et al. (2020). [Scaling Laws for Neural Language Models](https://arxiv.org/abs/2001.08361).
- Rae, J. W., Borgeaud, S., Cai, T., et al. (2021). [Scaling Language Models: Methods, Analysis & Insights from Training Gopher](https://arxiv.org/abs/2112.11446).
- Brown, T. B., Mann, B., Ryder, N., et al. (2020). [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165).
