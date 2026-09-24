# 当 Agent 不再需要生成：从 Jev 看结构化输出之后的决策模型

一个 Agent 要在网页搜索、数据库查询、文件读取和人工询问四个工具中选择下一步。程序最终只需要一个枚举值，但我们通常会把几千个 token 的上下文交给大语言模型，再让它逐 token 写出一段 JSON。

这套做法已经比自由文本可靠得多。JSON Schema、Grammar 和 Constrained Decoding 可以保证括号闭合、字段存在、枚举合法。然而，从计算任务来看，它仍然有些绕：业务需要的是四选一，模型做的却是一次受约束的文本续写。

2026 年 9 月，TypeSafe AI 发布了 Jev，把这种错位摆到了台面上。它不生成字符串，而是接收状态和预定义问题，直接返回 Choice、Score 或 Noul，以及相应的概率。TypeSafe 把它称为 System One Model，口号是“Decisions, not strings”。

Jev 刚刚发布，内部架构和独立评测都还很有限。现在就断言它会取代 LLM，证据显然不够。不过它提出了一个很值得验证的工程判断：Agent 并非每一步都需要生成。当一个子任务的输出很短、结构固定，而且答案空间能够提前定义时，我们也许应该停止优化“下一个 token 怎么写”，转而直接优化“有限候选中选哪个”。

这篇文章就从这类任务出发，讨论 Structured Output 与 Decision Model 的区别、决策模型可能采用的实现路线、它的收益究竟来自哪里，以及在 Agent 系统中应该如何选择。

---

## 一、先看一个只有四个答案的 Agent 任务

假设一个数据分析 Agent 收到请求：

```text
帮我查看上个月各区域的退款率，并解释华东区异常上升的原因。
```

Agent 当前可用的工具是：

```text
search_web      搜索公开资料
query_database 查询内部业务数据
read_file       读取指定文件
ask_human       请求人工补充信息
```

工具路由这一步的业务接口可能只是：

```json
{
  "tool": "query_database"
}
```

用普通 LLM 时，模型实际生成的是一串 token：

```text
{
→ "tool"
→ :
→ "query"
→ "_database"
→ }
```

即使解码器限制了所有非法路径，模型仍要沿着一条 token 路径向前走。业务代码真正关心的对象却是：

```text
search_web       0.03
query_database   0.94
read_file        0.02
ask_human        0.01
```

这两种表示最后都能得到 `query_database`，但它们优化的对象不同。

生成式模型关心某个输出序列的概率：

$$
P(y|x)=\prod_{t=1}^{T}P(y_t|x,y_{<t})
$$

而路由任务关心的是候选集合中的条件概率：

$$
P(c|x),\qquad c\in C
$$

其中 $C$ 就是当前允许调用的工具集合。工具名由几个 token 构成，对业务没有本质影响；哪一个候选最符合当前状态，才是需要优化的目标。

这类任务在 Agent 中并不少见：要不要调用工具、选择哪个工具、是否继续检索、结果是否足够、是否需要人工升级、动作有没有越权。它们有一个共同点：模型负责理解模糊的自然语言，但输出端并不开放。

这里仍然不能直接推出“Agent 的大部分任务都应该改成决策模型”。目前没有可靠统计告诉我们，这种子任务在不同 Agent 工作负载中究竟占多少。更稳妥的说法是：它构成了一个值得单独优化的任务族，而通用自回归生成未必是这个任务族最合适的输出方式。

## 二、Structured Output 解决的是格式，Decision Model 改写的是任务

Structured Output 经常被笼统地理解为“模型返回 JSON”。这个说法只描述了结果的外观，没有说明结果是怎么得到的。

### 1. 传统 Structured Output 仍然在生成

常见的 Structured Output 会把 JSON Schema、正则表达式或上下文无关文法编译为一个约束。在每个解码位置，系统根据当前状态计算哪些 token 仍可能组成合法结果，再把其他 token 的 logits 屏蔽掉：

```text
输入上下文
    ↓
Transformer
    ↓
全词表 logits
    ↓
Schema / Grammar 计算合法 token
    ↓
Mask 非法 token
    ↓
采样一个 token，进入下一轮
```

如果 schema 要求 `tool` 只能是四个枚举之一，模型就无法生成第五个工具名，也不能漏掉右花括号。它解决的是：

> 如何让自回归模型稳定生成一段符合语法和类型约束的文本。

这项能力非常有价值。[JSONSchemaBench](https://arxiv.org/abs/2501.10868)收集了约一万个真实 JSON Schema，用来评估 Guidance、Outlines、llama.cpp、XGrammar 等约束解码实现的覆盖范围、效率与生成质量。论文所研究的共同前提仍是“during generation”：约束改变了每一步能走的路径，却没有取消逐 token 的生成过程。

因此，Structured Output 不只是 prompt 中写一句“请返回 JSON”。真正的约束解码可以从机制上保证语法合法，而 prompt 只能请求模型自觉遵守格式。但两者都通常经过 LM Head，都需要把内部判断重新表达成 token 序列。

### 2. Jev 暴露的是 typed decision 接口

按照 TypeSafe 的[官方介绍](https://docs.typesafe.ai/introduction)，Jev 接收一份共享的 `state` 和若干 typed questions，返回三种原语：

| 问题类型 | 业务含义 | 返回结果 |
| --- | --- | --- |
| Choice | 从预定义选项中选择 | 选中项、各选项概率、confidence |
| Score | 按有序等级评分 | 加权分数、等级分布、confidence |
| Noul | 判断一个陈述成立的可能性 | 0～1 的 yes 概率 |

同一次请求中可以混合多个问题。例如 Agent 执行完一次数据库查询后，同时判断：

```text
tool_choice      下一步使用哪个工具？
result_sufficient 当前结果是否足够？
risk_level       当前动作风险多高？
need_human       是否需要人工介入？
```

这些问题共享 state，但按官方文档的说法会被彼此隔离并行评估。接口返回的是预先定义的值和分布，不是一段等待解析的自然语言。TypeSafe 还明确声称 Jev 不做文本生成，采用新的模型架构、parallel sampler，以及名为 RLCD（Reinforcement Learning for Calibrated Decisions）的训练方法。[发布文章](https://typesafe.ai/blog/introducing-system-one-models-and-jev)把它概括为“unstructured state in, typed probabilistic decisions out”。

两种系统都能让下游代码拿到结构化值，区别在于：

```text
Structured Output
  先定义合法字符串空间
  再在其中逐 token 生成

Decision Model
  先定义答案空间
  再直接对答案进行选择或评分
```

这也是为什么不能仅凭返回值是 JSON，就把两者视为同一技术。JSON 是传输格式，生成还是决策才是模型任务。

### 3. “类型永远合法”不等于“答案永远正确”

封闭答案空间可以保证模型不会返回 `delete_everything` 这种不存在的工具，也不会把布尔值写成一段解释。它不能保证模型一定选对。

TypeSafe 在宣传中使用了 “zero hallucinations” 和 “can’t hallucinate”。如果把 hallucination 理解为输出 schema 之外的字段或候选，这个说法可以成立；如果把它理解为事实和判断不会出错，就明显过头了。Jev 的[模型局限文档](https://docs.typesafe.ai/model-jaggedness/jev-1.13)同样列出了数学、精确计数、日期比较、多跳推理、无关长上下文和对抗性输入等弱项。

对自动化系统来说，类型正确只是最低门槛：

```text
类型正确 ≠ 语义正确
高 confidence ≠ 这一次必然正确
概率可用 ≠ 阈值可以不经验证直接上线
```

这个边界很重要。否则我们只是把“LLM 可能生成非法 JSON”的问题，换成了“程序稳定执行一个错误但类型合法的动作”。后者甚至更隐蔽。

## 三、答案空间已知时，现有 LLM 也有几种改法

从自由生成到 Jev 这样的专用模型，中间并不是一次跳跃。根据候选是否固定、候选数量和可用训练数据，可以选择不同层次的方案。

### 1. 只改 Decoding：约束模型走合法路径

最轻量的方案就是 Structured Output。模型权重、LM Head 和服务方式都不变，只在解码时屏蔽不可能组成合法答案的 token。

```text
全部词表 logits
      ↓
只保留四个工具名仍可到达的 token
      ↓
继续自回归解码
```

它的优势很现实：不需要训练新模型，可以直接接入已有推理服务，复杂 JSON 中还可以保留自由文本字段。对于下面这类输出，约束生成通常仍是自然选择：

```json
{
  "tool": "query_database",
  "arguments": {
    "metric": "refund_rate",
    "date_range": "last_month",
    "group_by": ["region"]
  },
  "reason": "需要查询内部退款数据"
}
```

这里的工具名是有限枚举，参数值和解释却可能开放。把整个对象压成分类任务，反而会损失表达能力。

局限也很清楚：输出越长，仍然需要越多串行 decode step；格式合法只说明字符串满足 schema，不代表字段之间符合业务约束。

### 2. Candidate Sequence Scoring：不搜索答案，只比较答案

如果候选已经完全给定，可以把每个候选序列都放到模型面前，计算它在当前输入下的条件对数概率：

$$
s(c_i)=\sum_{t=1}^{|c_i|}\log P(c_{i,t}|x,c_{i,<t})
$$

然后选择得分最高的候选：

```text
search_web       -7.2
query_database   -1.1
read_file        -5.8
ask_human        -8.0
```

它不再要求模型自己搜索一个开放答案，但仍然用 LM Head 衡量候选 token 序列。候选较少时，可以批量计算；候选很长或数量很大时，成本也会随候选增长。

这条路线还会遇到 verbalizer problem。业务类别相同，换一种字符串表示，模型给出的序列概率可能不同：

```text
query_database
database_query
tool_02
B
```

这些名字的 token 数、切分方式、训练频率和语言先验都不一样。[Verbalizer Manipulation 的研究](https://aclanthology.org/2024.findings-naacl.233/)表明，仅改变分类标签对应的输出词，就可能明显改变指令模型在分类任务上的表现。候选评分比自由生成更接近业务目标，但还没有完全摆脱“用字符串承载类别”的副作用。

### 3. 固定 Decision Head：直接输出 N 个 class logits

如果工具集合固定，可以在语义 backbone 上增加一个分类头：

```text
输入上下文
    ↓
Transformer / Encoder
    ↓
全局语义表示 h
    ↓
Linear(d, N)
    ↓
N 个候选 logits
```

训练目标可以直接写成：

$$
L=-\log\frac{e^{s_{correct}}}{\sum_i e^{s_i}}
$$

模型学习的是“正确工具的得分高于其他工具”，不需要先把判断翻译成工具名 token。训练时还可以加入容易混淆的 hard negatives，例如让 `query_database` 与 `read_file`、`search_web` 直接竞争。

固定分类头通常很快，一次 backbone 计算就能得到全部类别分数。代价是类别维度与模型参数绑定：从四个工具增加到五个，最后一层结构发生变化，通常还要补数据和重新训练。

对于 decoder-only backbone，可以取最后一个 token 的 hidden state，也可以在输入末尾增加专门的 `<DECISION>` token：

```text
用户请求 + Agent 状态 + <DECISION>
                         ↓
                  Decision Head
```

由于 causal attention 下末尾 token 能看到完整前文，它可以承担全局汇总。这里描述的是一种通用设计，不是 Jev 已公开的内部结构。

### 4. 动态候选：把候选描述也作为模型输入

真实 Agent 的工具集合可能随权限、租户和环境变化。固定的 `Linear(d, N)` 很难处理运行时新增的工具，这时可以对“输入状态”和“候选描述”的匹配程度打分：

$$
s_i=f(x, description(c_i))
$$

候选不再只是训练时固定的 ID，而是自然语言描述：

```text
query_database:
查询内部结构化数据，适用于指标统计、明细筛选和聚合分析。

search_web:
搜索公开互联网信息，不可访问企业内部业务数据。
```

实现上常见两条路线：

```text
Bi-Encoder
  输入和候选分别编码
  候选向量可以提前缓存
  适合从大量工具中召回 Top K

Cross-Encoder
  输入与候选放在一起编码
  交互更充分，但每个候选计算更贵
  适合对少量候选精排
```

当候选达到几千甚至几万时，可以先用 Bi-Encoder 召回，再用 Cross-Encoder 精排。这与搜索系统中的 retriever + reranker 很像。

动态候选解决了类别扩展问题，但也引入了新的变量：候选描述写得是否清楚、多个工具边界是否重叠、召回阶段会不会提前丢掉正确工具。Decision Model 不会替我们自动设计好答案空间。

### 5. Dedicated Decision Model：训练、采样和接口都围绕决策

再往前一步，模型不再只是“LLM backbone 加一个分类头”，而是从训练目标、采样方法到服务接口都围绕 typed decision 设计。Jev 对自己的定位就在这里。

公开信息能确认的是：TypeSafe 声称使用新架构、parallel sampler 和 RLCD，不做字符串生成；Choice 最多支持 255 个候选，高基数选择会采用“先独立评分、再显式选择”的两阶段方式。公开信息不能回答的则更多：

```text
backbone 是 encoder、decoder 还是其他结构？
是否存在显式的 decision head？
一次请求是否只进行一次 forward？
RLCD 的 reward、loss 和校准目标如何定义？
训练数据、参数规模和推理硬件是什么？
```

在官方发布论文或技术报告之前，把 Jev 画成某个确定的 classification head、Bi-Encoder 或 Cross-Encoder 都属于猜测。我们可以从外部接口讨论它改变了什么任务，却不能从产品行为反推出完整内部机制。

## 四、决策模型的收益不只是少算一次 LM Head

把词表大小从十万缩到十个类别，确实能减少最后一层的部分计算。但这不是最值得关注的收益。真正的变化是：系统不再通过一段字符串间接表达决策。

### 1. 取消串行输出路径

自回归模型生成 $T$ 个输出 token，至少要按顺序推进 $T$ 个 decode step。KV Cache 避免了重复计算全部历史 token，却不能让第 $t+1$ 个 token 在第 $t$ 个 token 之前确定。

原生决策接口可以一次返回候选分布，多个彼此独立的问题也有机会共享输入理解并并行处理：

```text
                    ┌─ tool_choice
                    ├─ result_sufficient
Agent State ────────┼─ risk_level
                    └─ need_human
```

TypeSafe 的[并行问题示例](https://docs.typesafe.ai/cookbooks/parallel_questions)展示了这种接口收益：同一个长 state 上的多个问题可以合并为一次调用，避免反复发送和处理相同上下文。不过，官方给出的批处理数字来自特定版本、特定输入和串行对照，不能直接当成所有生产环境的固定倍数。

### 2. 训练目标与业务指标更一致

工具路由最终通常按 Top-1 accuracy、召回率、误路由成本和人工升级率评估。生成式训练优化的是目标字符串的 token likelihood，这两者相关，却不完全相同。

决策训练可以直接优化候选之间的相对次序，也可以针对业务代价调整样本与 loss：

```text
把 query_database 错选成 read_file
  → 只是多一次无效调用

把 ask_human 错选成 delete_record
  → 可能是不可接受的高风险错误
```

封闭答案空间让 hard negative、类别权重、拒答和成本敏感训练更自然。系统也更容易报告混淆矩阵，而不是只看 JSON 是否解析成功。

### 3. 概率可以进入工作流

如果系统拿到完整候选分布，就可以把不确定性显式写入代码：

```text
max_probability < 0.70
  → ask_human

top1_probability - top2_probability < 0.10
  → 请求补充上下文

risk_probability > 0.85
  → 阻止自动执行
```

但概率和 confidence 不是一个概念。Jev 的 [confidence 文档](https://docs.typesafe.ai/confidence)说明，Choice 和 Score 的 confidence 是根据概率分布的集中程度得到的量；Noul 只返回 yes 的概率，没有独立 confidence 字段。一个分布很集中，只说明模型强烈偏向某个候选，不代表这个候选一定正确。

所谓 calibrated，应该在一组相似样本上理解：所有被模型报为约 80% 的判断，长期正确率也接近 80%。要证明这一点，需要可靠性曲线、ECE、Brier Score 等评测，以及与真实业务分布一致的标注集。TypeSafe 将 RLCD 和 calibrated decisions 作为核心主张，但目前没有公开足以独立复现训练或校准结论的技术细节。

因此，上线前仍要用自己的数据确定阈值：

```text
离线标注集
  → 测准确率与校准误差
  → 按错误成本选择阈值
  → 小流量影子运行
  → 观察分布漂移和人工升级率
```

### 4. 多个决策可以共享输入理解

Agent 的同一个状态经常需要产生多项判断。普通系统可能连续调用四次模型，每次重复处理几千个输入 token；也可能一次要求 LLM 生成一个包含四个字段的 JSON。

后者已经能减少重复 prefill，但字段之间会共享生成上下文：前一个字段的 token 可能影响后一个字段。原子问题的并行决策提供了另一种组合方式：每个问题独立读取同一 state，业务逻辑在代码中组合结果。

```text
模型负责：
  退款申请是否有异常迹象？
  用户证据是否充分？
  当前账户风险等级多高？

代码负责：
  if risk > 0.8 and evidence < 0.4:
      escalate_to_human()
```

权重和规则变化时，代码可以直接调整，无需让模型重新理解一大段混合政策。模型负责模糊语义，程序负责确定性组合，这种边界通常比“让一个 prompt 决定所有事情”更容易测试。

## 五、短输出不自动等于巨大加速

到这里很容易得到一个过于乐观的结论：只要输出短，Decision Model 就一定比 Structured Output 快很多。实际还要看输入成本。

一次模型调用可以粗略拆成：

$$
T_{model}\approx T_{prefill}+T_{decode}
$$

假设输入有 10000 个 token，输出只是单 token 的 `A`。主要时间可能花在读取输入、建立中间状态和完成 attention 计算，decode 只占很小一部分。把 LM Head 换成 Decision Head，不会让这 10000 个输入 token 自动消失。

相反，如果一次调用要生成几十个字段、每个字段还有概率和解释，或者同一份 state 要被重复发送给十几个独立判断，那么取消输出 token 和合并问题的收益会明显得多。

因此，判断收益时至少要记录：

```text
输入 token 数与 TTFT
输出 token 数与 decode 时间
同一 state 上的问题数量
候选数量与候选描述长度
是否重复 prefill
结构错误重试率
端到端网络和排队时间
```

我在[《企业 Agent 推理优化：先识别任务形状，再选择优化方法》](category.html?category=tech&post=2026-09-18-agent-inference-optimization)中详细讨论过 Prefill、Decode 和 Workflow Latency。这里沿用同一个原则：先测任务形状，再判断架构变化究竟省掉了哪一段工作。

Jev 官方宣称端到端延迟为 70～500ms，在 System One 形状的任务中可比同等智能水平的 LLM 快 40～200 倍，输入价格为每百万 token 0.042 美元，输出不计费。[发布文章](https://typesafe.ai/blog/introducing-system-one-models-and-jev)也主动给这些数字加了限制：演示使用短而密的输入，对 Jev 有利；测试从西海岸访问同样位于西海岸的服务；193.6 倍和 444.6 倍属于预期现实收益的高端。

它的 [workflow eval](https://evals.typesafe.ai/)在写作时展示了四个自建工作流。Jev 的平均结果约为 67.8%、0.0004 美元和 0.4 秒；对照的生成模型有更高或相近的得分，但成本和时间更高。这组数据适合说明“专门任务有可能形成新的成本—时延前沿”，不适合当作通用 benchmark：参考标签来自 GPT-6 Astra 与 Claude Fable 5.1 high-thinking 输出的平均，任务由 TypeSafe 团队构造，对照 LLM 还使用了它提供的 wrapper 来生成概率。

比营销倍数更可靠的做法，是把同一批生产 trace 分别送入现有 Structured Output 链路和候选决策链路，同时测：

```text
任务成功率
分类准确率与校准误差
p50 / p95 延迟
单次请求与单个业务任务成本
错误重试和人工升级率
```

没有这组数据，“取消自回归”仍然只是一个听起来合理的优化方向。

## 六、哪些 Agent 步骤适合改写成决策

“输出能写成 JSON”这个条件太宽。长篇报告也能塞进 JSON 字段，但它显然仍是生成任务。更有用的是同时检查输出空间、推理方式和业务接口。

### 1. 适合的任务形状

典型候选包括：

| Agent 步骤 | 可能的答案空间 | 适合原因 |
| --- | --- | --- |
| Tool Routing | 一组当前可用工具 | 候选可枚举，结果直接驱动代码 |
| Intent Classification | 固定业务意图 | 输出短，类别边界可通过数据评估 |
| Policy Gate | 允许、拒绝、人工审核 | 需要概率与阈值，而非自然语言 |
| Result Judge | 充分、不充分、冲突 | 可以决定继续执行还是停止 |
| Risk Scoring | 有序风险等级 | 适合输出分布并设置升级策略 |
| Model Routing | 小模型、大模型、专用模型 | 候选有限，错误成本可以量化 |

这些任务还应满足几个条件：

```text
候选之间能够定义清楚的边界
给定当前上下文后，不需要长链条开放推理
下游程序知道如何消费每一种结果
错误时存在拒答、回退或人工升级路径
有数据评估候选选择和概率阈值
```

### 2. 不适合强行决策化的任务

下面的工作仍然更接近生成：

```text
根据调查材料写一份事故复盘
为未知代码库设计修复方案
解释多份证据之间的矛盾
生成 SQL、程序代码或自然语言回复
在无法预先枚举的环境中提出新动作
```

有些任务输出很短，却需要复杂推理。例如一道数学题最终只返回一个数字，答案空间在形式上有限，但无法预先列出合理候选；一次合规判断只返回 `allow/deny`，中间却可能需要跨文档核对多个例外。短输出是一个信号，不是充分条件。

Jev 官方建议把问题写成“掌握上下文的专家几秒钟内可以做出的原子判断”，把复杂规则拆成多个问题，再由代码组合。这个边界同时暴露了它的定位：它更像智能 if 语句，而不是负责规划和证明的完整 Agent。

### 3. 候选空间设计本身就是产品工作

有限候选不会天然带来好任务。如果工具描述重叠：

```text
search_documents  搜索文档
find_information  查找信息
retrieve_context  获取相关上下文
```

模型再强也很难稳定区分。若真实情况经常落在候选之外，封闭输出只会迫使模型自信地选一个不合适的答案。

因此答案空间至少要处理：

```text
互斥性：多个候选是否同时成立？
完备性：是否需要 other / unknown / abstain？
粒度：类别过粗会丢信息，过细会增加混淆。
动态性：权限和环境变化后，候选是否仍然有效？
错误代价：哪些混淆可以自动恢复，哪些必须阻断？
```

Decision Model 把一部分难题从“如何写 prompt”移动到了“如何定义决策契约”。自动化系统原本就需要这层设计，只是通用生成接口暂时把它藏在了 prompt 和解析代码里。

## 七、Agent 会从单模型调用走向按任务形状分层

今天常见的 Agent 把多种工作都交给同一个生成模型：

```text
用户请求
  → 判断意图
  → 选择工具
  → 生成工具参数
  → 判断结果是否充分
  → 决定是否重试
  → 生成最终回复
```

这里混合了至少三类计算：

```text
Decision
  从有限候选中选择：意图、工具、是否重试、风险等级

Reasoning
  处理开放问题、规划多步动作、比较相互冲突的证据

Generation
  生成 SQL、代码、参数和面向用户的自然语言
```

未来更合理的形状可能是：

```text
                    ┌─ 规则与权限检查
用户状态 ── Harness ┼─ Decision Model：路由、gate、judge
                    ├─ Reasoning Model：复杂规划与推理
                    └─ Generation Model：代码、参数与回复
```

这里的分层不是要求每一类都部署一个完全独立的模型。一个生成模型也可以通过 constrained decoding 或 candidate scoring 承担 decision；一个共享 backbone 也可以挂不同的 head。关键是先在任务接口上分清楚：这一轮需要的是开放答案，还是有限候选中的判断。

工作流控制也不应该全部让模型接管。超时、权限、预算、重试次数、概率阈值和人工升级条件更适合留在代码中。模型提供对模糊语义的判断，harness 决定这个判断能触发什么动作。

这种拆分还有一个容易忽略的好处：每个决策点都可以单独评测。工具路由有工具路由的数据集，风险 gate 有风险 gate 的阈值，最终生成有最终生成的质量指标。Agent 失败时，我们能知道问题出在候选选择、开放推理还是执行层，而不是只得到一个模糊的端到端成功率。

## 八、在规则、结构化生成和决策模型之间怎么选

实际落地不应该从“要不要用 Jev”开始，而应该先描述任务。

| 条件 | 优先方案 | 原因 |
| --- | --- | --- |
| 条件可被精确枚举，几乎没有语义歧义 | 普通代码规则 | 最便宜、可解释、可验证 |
| 输出包含开放字段或较长参数 | Structured Output | 保留生成能力，同时保证格式合法 |
| 候选很少，已有 LLM 服务，不想训练 | Constrained Decoding / Candidate Scoring | 改造成本低，便于建立基线 |
| 类别固定、调用量大、训练数据充足 | 固定 Decision Head | 直接优化分类目标，推理简单 |
| 候选动态且数量较少 | Cross-Encoder / 通用 Decision Model | 可以理解候选描述并精细比较 |
| 候选动态且数量很大 | Bi-Encoder 召回 + Cross-Encoder 精排 | 避免逐个重算全部候选 |
| 需要开放推理、解释或新答案 | Generative / Reasoning Model | 答案空间无法可靠预定义 |

准备改写一个现有 Agent 步骤时，可以按下面的顺序检查。

### 第一步：确定输出契约

```text
答案能否在请求前列出？
是否允许多个答案同时成立？
是否需要 unknown / abstain？
下游代码对每个答案分别做什么？
```

如果候选无法稳定定义，就先不要做分类头。模糊的契约只会制造稳定的模糊输出。

### 第二步：保留最便宜的基线

先比较普通规则和现有 LLM 的 Structured Output。决策模型至少要在准确率、延迟、成本或校准中的某一项提供可测收益，否则没有迁移的必要。

### 第三步：建立业务标注集

数据不仅要有正确答案，还要覆盖：

```text
常见样本
相邻类别的 hard negatives
信息不足和候选外样本
高风险边界条件
prompt injection 与异常长输入
```

对于 Agent 路由，还要记录错误后的真实代价。Top-1 accuracy 相同的两个模型，可能因为错误分布不同而具有完全不同的上线风险。

### 第四步：校准阈值和回退策略

不要直接使用模型文档中的通用 confidence 阈值。应该根据自己的错误成本确定：

```text
什么概率可以自动执行？
什么区间需要补充上下文？
什么时候回退到更强的 reasoning model？
什么情况必须人工审核？
```

### 第五步：用完整工作流复测

单次模型延迟下降，不等于 Agent 端到端更快。决策模型如果带来更多误路由、重试或人工升级，总体成本可能反而上升。最终要观察业务任务成功率、工具调用次数、尾延迟和恢复成本。

## 九、Jev 真正值得关注的地方

Jev 目前最有价值的部分，不是某个尚未公开的内部结构，也不是厂商给出的百倍加速数字。它让一个长期被 JSON 包装遮住的问题变得清楚：机器学习系统究竟在优化什么任务？

如果业务需要一段开放文本，自回归生成提供了难以替代的灵活性。如果业务需要从四个工具中选一个，那么把判断编码成 JSON token、逐步生成、解析，再还原成枚举，只是沿用了现成的模型接口，并不代表这是最终形态。

因此，我更愿意把 Jev 看成一个强信号，而不是已经完成的证明：随着 Agent 进入真实工作流，越来越多模型调用会按照任务形状拆开。有限、原子、可评估的判断会由规则、候选评分或专用 Decision Model 承担；开放推理和表达继续交给生成模型；代码负责把概率、权限和业务规则组合起来。

真正需要改变的第一步甚至不是模型。下次看到一个只返回几行 JSON 的 Agent 调用时，可以先问：

> 这里需要模型生成一个答案，还是只需要它在已经定义好的答案空间里做一次选择？

这个问题回答清楚之后，Structured Output、Candidate Scoring、Decision Head 和 Jev 才各自有了正确的位置。

## 十、后记：一次 Laya 多语言模型的业务实验

写完这篇文章后，我又用一个开源决策模型做了实际验证。我通过 Ray Serve 部署了 `convaiinnovations/laya-multilingual`，然后把它接到一个真实的业务多标签分类任务上。数据集包含 302 条用例，每条用例都需要分别判断 8 个标签是否成立，同一条用例可以命中多个标签。这里的准确率按全部标签判断汇总，而不是 8 选 1 的 Top-1 accuracy。

结果与我最初的预期差距很大：

| 模型 | Prompt 形式 | 准确率 |
| --- | --- | --- |
| Laya Multilingual | 为适配其上下文预算改写后的短问法 | 15.5% |
| Qwen3.6-35B-A3B | 当前业务使用的完整 prompt | 接近 99.9% |

15.5% 的标签判断准确率在这个任务上显然还不可用。不过，这组数字不能当成严格受控的模型 benchmark。Qwen 使用的是经过业务验证的完整 prompt，里面包含较长的任务说明和标签判断边界；为了适配 Laya，我不得不把它改写成更短、更直接的问题。两边看到的输入契约并不完全相同。

问题恰恰出在这次改写上。原来的长 prompt 虽然最后只要求给出 8 个标签各自是否成立，但每项判断都带有业务规则和边界条件。压缩成短问法以后，许多约束只能删减或概括，模型得到的决策边界随之变得模糊。即使继续调整短 prompt，效果也没有明显改善；输入上下文稍长一些，分类质量还会进一步下降。

Laya 的[官方模型卡](https://huggingface.co/convaiinnovations/laya-multilingual)也给出了相近的边界：多语言版本默认使用 1024-token 限制，虽然可以提高到 8192，但长文准确率会出现明显波动；在 typed-decisions 的零样本评测中，它的结果接近随机水平，并且低于多数类基线，官方建议针对具体工作流微调。我的实验不是对这些公开结论的复现，但实际遇到的问题是一致的：模型能够一次性输出有限候选的概率，不代表它已经具备理解复杂业务规则所需的语义能力。

这次实验让我进一步收窄了前面的判断。一个任务具有“输出短、标签有限”这两个特征，只能说明它在形式上可以写成 Decision Task，不能说明一个小型通用决策模型可以零样本解决它。还要继续看：每个标签的边界是否需要长篇规则，判断是否依赖领域知识，以及关键证据能否放进模型有效使用的上下文中。

Ray Serve 部署本身没有成为障碍，真正的瓶颈是业务准确率。对这个任务，当前结果不支持直接用 Laya 替换 Qwen3.6-35B-A3B。若要继续尝试，更合理的方向是准备领域数据做微调或训练任务专用 head，并保留低置信度时回退到生成模型的路径，而不是继续压缩 prompt，期待零样本能力自动补上被删掉的业务规则。

## 参考资料

1. TypeSafe AI，[Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev)。用于 Jev 的公开定位、parallel sampler、RLCD、定价、延迟与官方评测限制。
2. TypeSafe AI，[Introduction](https://docs.typesafe.ai/introduction)。用于 Choice、Score、Noul 以及并行原子问题的接口说明。
3. TypeSafe AI，[Models](https://docs.typesafe.ai/models)。用于模型版本、上下文与服务规格。
4. TypeSafe AI，[Jev 1.13 Model Jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)。用于已知能力边界和不适用任务。
5. TypeSafe AI，[Confidence](https://docs.typesafe.ai/confidence)。用于区分概率、confidence 与业务阈值。
6. TypeSafe AI，[Parallel Questions](https://docs.typesafe.ai/cookbooks/parallel_questions)。用于共享 state 上批量问题的官方实验。
7. TypeSafe AI，[Workflow Evals](https://evals.typesafe.ai/)。用于官方自建工作流中的准确率、成本和时间比较；文中未将其视为独立 benchmark。
8. Saibo Geng 等，[Generating Structured Outputs from Language Models: Benchmark and Studies](https://arxiv.org/abs/2501.10868)。用于 constrained decoding 与 JSON Schema 结构化生成。
9. Shiyang Li 等，[Instruction-following Evaluation through Verbalizer Manipulation](https://aclanthology.org/2024.findings-naacl.233/)。用于说明标签字符串和模型先验可能影响分类结果。
10. Convai Innovations，[Laya Multilingual Model Card](https://huggingface.co/convaiinnovations/laya-multilingual)。用于 Laya 的公开架构、上下文限制和零样本能力边界。
