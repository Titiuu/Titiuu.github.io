# Jev、Structured Output 与 Decision Model：从生成到决策的 Agent 架构演进

## 1. Jev 和 Structured Output 有什么区别？

表面上两者都能给程序返回结构化结果，但本质不同。

### Structured Output

Structured Output 仍然是生成式 LLM：

```text
输入
↓
Transformer
↓
LM Head
↓
next-token probability
↓
受 JSON Schema / Grammar / Mask 约束
↓
逐 token 生成合法结构
```

例如：

```json
{
  "intent": "billing",
  "priority": "high"
}
```

模型本质上还是在逐 token 生成：

```text
{
→ "intent"
→ :
→ "billing"
→ ...
```

Structured Output 解决的核心问题是：

> 如何让生成结果稳定符合程序可解析的结构。

它并没有改变“生成”这一计算范式。

---

### Jev / Decision Model

Jev 这类模型更接近：

```text
输入状态
↓
预定义候选空间
↓
直接给候选打分 / 做决策
↓
choice / probability
```

例如：

```text
intent:
  billing:   0.91
  refund:    0.07
  card_lost: 0.02
```

它关注的是：

> 在一个有限候选空间里，哪个答案最合适？

因此可以简单理解为：

- Structured Output：**受约束地生成**
- Decision Model：**直接决策，不生成文本**

---

## 2. Jev 底层还是 LLM 吗？

目前不应猜测具体实现。

更重要的是从范式看：

- 它显然需要强语言理解能力；
- 但不一定采用传统 autoregressive LLM 的输出方式；
- 即使内部用了 Transformer 或语言预训练 backbone，也不意味着它必须逐 token decode。

可以把“语言能力”和“生成接口”拆开：

```text
通用语义表示
   ↓
├── LM Head → 文本生成
├── Decision Head → 分类 / 决策
└── Embedding Head → 向量表示
```

所以真正值得关注的是：

> 语言理解不等于必须通过 next-token generation 输出结果。

---

# 3. 已知候选空间时，如何优化现有 LLM？

如果答案空间已经是：

```text
{A, B, C, D}
```

标准 LLM 做的是：

\[
P(y|x)=\prod_t P(y_t|x,y_{<t})
\]

但真正关心的是：

\[
P(c|x), \quad c \in \{A,B,C,D\}
\]

也就是：

> 从“生成序列”变成“给候选打分”。

可以分成几个层次。

---

## 3.1 不改模型，只改 Decoding

这是最轻量方案，本质上就是 Structured Output / Constrained Decoding。

例如候选：

```text
fraud
refund
duplicate_charge
other
```

解码时只允许合法 token：

```text
全部词表 logits
↓
mask 非法 token
↓
只保留候选路径
↓
正常 autoregressive decode
```

优点：

- 不改模型；
- 工程成本低；
- 输出稳定；
- 很适合已有 LLM 系统快速落地。

缺点：

> 仍然是在逐 token 生成。

---

## 3.2 Candidate Sequence Scoring

不再让模型“搜索答案”，而是把所有答案提前给出来，然后计算每个答案的序列概率。

例如：

```text
A = fraud
B = duplicate_charge
C = refund
```

计算：

\[
score(c_i)=\log P(c_i|x)
\]

如果：

```text
duplicate_charge
→ [duplicate, _, charge]
```

那么：

\[
score =
\log P(duplicate|x)
+\log P(\_|x,duplicate)
+\log P(charge|x,duplicate,\_)
\]

最终：

```text
fraud             -8.2
duplicate_charge  -1.3
refund             -5.7
```

取分数最大的候选。

它和 Speculative Decoding 有一点相似：

> 都利用了“候选 token 已知”。

但目的不同：

```text
Speculative Decoding
= 草稿 token 已知
→ 加速生成

Candidate Scoring
= 所有可能答案已知
→ 不生成，只比较答案
```

---

## 3.3 Decision Head

如果最终只关心分类结果，就没必要再经过 LM Head。

普通 LLM：

```text
Transformer
↓
hidden state
↓
LM Head
↓
100k vocab logits
```

Decision Model：

```text
Transformer
↓
hidden state
↓
Decision Head
↓
class logits / score
```

例如二分类：

```text
Transformer
↓
hidden state
↓
Linear(d, 1)
↓
sigmoid
↓
True / False
```

这特别适合：

- true / false；
- 安全 / 不安全；
- 是否调用工具；
- 是否人工升级；
- 是否需要检索。

固定 N 分类也可以：

```text
Transformer
↓
Linear(d, N)
↓
N 个 class logits
```

---

# 4. “候选不是固定 ID，而是自然语言”是什么意思？

传统分类器的类别通常是固定 ID：

```text
0 → fraud
1 → duplicate_charge
2 → refund
```

模型最后一层可能是：

```text
Linear(4096 → 3)
```

新增一个类别：

```text
card_stolen
```

就要改成：

```text
Linear(4096 → 4)
```

通常还需要重新训练。

---

而 LLM 的优势是理解自然语言。

所以可以把候选直接写成描述：

```text
候选 A：
fraud
含义：存在未经用户授权的交易

候选 B：
duplicate_charge
含义：同一笔消费被重复扣款

候选 C：
refund
含义：用户要求退还一笔正常发生的交易
```

模型要做的是：

\[
score(x, candidate\ description)
\]

而不是：

\[
score(x, class\ ID)
\]

这样新增候选时，可以直接加入：

```text
card_stolen:
用户明确表示实体银行卡被盗或遗失
```

理论上无需修改分类头结构。

这就是“动态候选”的价值。

---

# 5. 三种典型模型结构

## 5.1 固定 Classification Head

适合固定类别。

```text
用户输入
↓
Transformer
↓
hidden state
↓
Linear(d, N)
↓
N 个 class logits
```

优点：

- 最快；
- 一次 forward；
- 非常适合固定二分类 / 多分类。

缺点：

- 类别是训练时固定的；
- 新增类别通常需要重新训练。

---

## 5.2 Bi-Encoder

用户文本和候选分别编码：

```text
用户请求
↓
Encoder
↓
vector_x
```

候选：

```text
候选描述
↓
Encoder
↓
vector_c
```

然后：

\[
score(x,c)=h_x^\top h_c
\]

本质上就是：

> Embedding + 向量相似度。

适合：

- 上千 / 上万个 tools；
- 大量 skills；
- 大规模意图库；
- 动态候选集合。

候选 embedding 可以提前算好。

---

## 5.3 Cross-Encoder

把用户输入和候选放在一起：

```text
用户请求
+
候选描述
↓
Transformer
↓
Decision Head
↓
score
```

例如：

```text
用户：
信用卡同一笔钱被扣了两次

候选：
同一笔交易重复扣款
```

输出：

```text
score = 0.95
```

优点：

- 用户 token 和候选 token 可以充分 cross-attention；
- 判断更精细。

缺点：

- 每个候选都要跑一次模型；
- 候选很多时比较贵。

---

## 5.4 Bi-Encoder + Cross-Encoder

这是最常见也最合理的组合：

```text
10000 candidates
↓
Bi-Encoder
↓
Top K
↓
Cross-Encoder
↓
Top 1
```

和搜索 / RAG 中：

```text
Retriever
↓
Reranker
```

本质相同。

因此：

- 固定少量分类：Classification Head
- 动态少量候选：直接 Cross-Encoder
- 动态大量候选：Bi-Encoder Top K + Cross-Encoder

---

# 6. Decision Head 的收益只是省 LM Head 计算吗？

不是。

省 LM Head FLOPs 只是最表层收益。

真正重要的是：

> 从 Generation Task 变成 Decision Task。

---

## 6.1 Structured Output 没有取消 autoregressive decode

Structured Output：

```text
Transformer
↓
LM Head
↓
生成 token
↓
Transformer
↓
LM Head
↓
生成下一个 token
↓
...
```

Decision Model：

```text
整个输入
↓
Transformer
↓
Decision Head
↓
一个 score
```

真正省掉的是：

> 整个 autoregressive decode loop。

---

## 6.2 但短输出场景收益未必很大

例如：

```text
7000 input tokens
1 output token
```

主要时间其实花在：

```text
7000-token Prefill
```

如果只是生成一个：

```text
true
```

那么 Structured Output / Mask Decoding 已经非常高效。

因此：

> 长输入 + 单 token 分类场景，Decision Head 不一定带来数量级性能提升。

---

## 6.3 训练目标更匹配业务目标

生成式训练优化：

\[
P("duplicate\_charge"|x)
\]

本质是学习如何把这个字符串生成出来。

但业务真正关心：

\[
score(duplicate\_charge)
>
score(fraud)
\]

Decision training 可以直接优化：

\[
L=-\log
\frac{e^{s_{correct}}}
{\sum_i e^{s_i}}
\]

这样可以直接训练：

> 正确候选比错误候选分数更高。

还可以加入 hard negative：

```text
positive:
duplicate_charge

hard negatives:
fraud
refund
payment_failed
```

比随机负样本更有价值。

---

## 6.4 避免 Verbalizer Problem

生成模型的候选名称会影响概率：

```text
yes / no
A / B
fraud / duplicate_charge
LABEL_001 / LABEL_002
```

因为不同字符串：

- token 数不同；
- tokenizer 切分不同；
- 出现频率不同；
- 有不同语言先验。

Decision Head 直接输出 class score：

```text
class 0 → 1.2
class 1 → 5.8
class 2 → -0.3
```

类别名字本身不再影响输出概率。

---

## 6.5 概率和置信度更自然

例如：

```text
duplicate_charge  0.51
fraud             0.47
refund            0.02
```

可以直接定义：

```text
top1 - top2 < 0.1
→ 人工审核
```

或者：

```text
max_prob < 0.7
→ abstain
```

适合：

- 风控；
- Tool routing；
- Policy Engine；
- Agent gate；
- 人工升级。

---

## 6.6 可以一次完成多个决策

假设一次请求需要判断：

```text
intent
risk
need_tool
need_human
```

可以共享同一个 Transformer：

```text
                   ┌→ Intent Head
                   │
Input → Transformer├→ Risk Head
                   │
                   ├→ Tool Head
                   │
                   └→ Human Head
```

这样最贵的“理解输入”只做一次。

---

# 7. Structured Output 与 Decision Model 的关系

可以看成一个连续演进：

```text
普通生成
↓
Structured Output
↓
Candidate Sequence Scoring
↓
Decision Head
↓
Dedicated Decision Model
```

分别对应：

```text
普通生成：
模型自己搜索答案

Structured Output：
限制能走哪些生成路径

Candidate Scoring：
答案都给你，只比较序列概率

Decision Head：
连 token 概率都不要，直接输出 class score

Dedicated Decision Model：
整个训练目标和架构都针对有限候选决策优化
```

所以最核心的区别是：

> Structured Output = 约束生成

> Decision Head = 取消生成

---

# 8. Decoder-only LLM 应该拿哪个 hidden state 做决策？

Decoder-only 模型经过 Transformer 后：

```text
h1, h2, h3, ..., hn
```

Decision Head 只需要一个向量：

\[
h \rightarrow DecisionHead
\]

常见有三种方案。

---

## 8.1 最后一个 token

Decoder-only 使用 causal attention，因此最后一个 token 的 hidden state：

\[
h_n
\]

已经能看到全部前文。

所以可以：

```text
输入
↓
Transformer
↓
h1 h2 ... hn
           ↓
      取 hn
           ↓
    Decision Head
```

优点：

- 改动最小；
- 无需新增 token；
- 与 LLM 原来的 next-token 预测逻辑天然兼容。

缺点：

> 最后一个普通 token 本身并不是专门为“全局决策”设计的。

---

## 8.2 `<DECISION>` Token

在输入末尾加：

```text
用户输入 ... <DECISION>
```

由于它在最后：

```text
前面所有 token
↓
<DECISION>
```

它可以 attention 到全部前文。

训练时专门让：

```text
h_decision
↓
Decision Head
```

去承担分类 loss。

可以理解为：

> 专门安排一个 token，在读完整个输入后负责做总结和决策。

它很像 BERT 的 `[CLS]`，但区别是：

- BERT `[CLS]` 可以放前面，因为是双向 attention；
- Decoder-only 的 `<DECISION>` 更适合放最后，因为是 causal attention。

---

## 8.3 Pooling

也可以：

\[
h_{pool}
=
\frac{1}{n}\sum_i h_i
\]

或者：

\[
h_{pool}
=
\sum_i \alpha_i h_i
\]

即对所有 token hidden state 做平均或加权汇总。

但 decoder-only 有个问题：

- 前面的 token 看不到后面的 token；
- 所以前面 hidden state 的上下文是不完整的。

因此在 decoder-only 里：

```text
last token
或
<DECISION> token
```

通常比简单 mean pooling 更自然。

简单经验：

```text
现有 LLM 最小改造
→ last token

专门训练 Decision Model
→ <DECISION> token

Encoder / Embedding 模型
→ pooling 更常见
```

---

# 9. Jev 这类模型对 Agent 架构意味着什么？

最大的影响不是“又多了一种模型”，而是：

> Agent 的模型调用会开始分层。

过去：

```text
用户请求
→ LLM 判断意图
→ LLM 选工具
→ LLM 判断风险
→ LLM 判断结果
→ LLM 生成最终回复
```

未来更可能变成：

```text
用户请求
↓
Decision Model
├── 路由
├── 风险判断
├── 是否调用工具
├── Tool Selection
├── 是否升级人工
└── Policy / Gate
↓
Generative / Reasoning LLM
├── 复杂推理
└── 最终自然语言生成
```

主要收益：

1. **更快**  
   很多 decision task 不需要 autoregressive decode。

2. **更稳 / 更准**  
   有限候选任务直接优化“选哪个”，而不是绕一圈生成 JSON。

3. **更便宜**  
   routing、gate、judge 等任务可以由更小、更专门的模型处理。

因此 Agent 架构可能从：

```text
一个通用 LLM 承担所有工作
```

走向：

```text
Decision Model
+
Reasoning Model
+
Generation Model
```

也就是：

> 不只是“快模型 / 慢模型路由”，而是开始按照不同计算范式对模型调用分层。
