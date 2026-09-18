# 企业 Agent 推理优化：先识别任务形状，再选择优化方法

企业里讨论 Agent 性能时，最常听到的是：“27B Dense 和 35B-A3B 到底谁更快？”“要不要上量化？”“Serving 框架该选哪一个？”

这些问题都合理，只是通常问早了。一个“模型很慢”的任务，可能是 10000 个输入 token 只需要生成一个 JSON，也可能是 200 个输入 token 却要连续生成几千个 reasoning token；还可能是模型本身每次只花 500ms，但中间串了六次工具调用，最后端到端等了十几秒。

它们都叫 Agent，却不是同一种 workload。

我更愿意先看任务的形状，再判断瓶颈。一个够用的第一版描述是：

```text
(输入 token 数，输出 token 数，前缀复用率，并发度)
```

如果任务还包含工具和多轮循环，还要加上：

```text
(工具步数，串行依赖，工具耗时，重试率)
```

下面先拆开一次请求的时延，再看几种常见 workload，最后把优化手段落到两个层面：Agent harness 负责上下文和工作流，推理服务负责缓存、量化、调度和 Kernel。很多收益来自两层配合，单独罗列技术名词很难看出优先级。

## 一、先把“模型很慢”拆开

一次请求的端到端耗时可以粗略写成：

$$
T_{e2e}=T_{queue}+T_{tokenize}+T_{prefill}+T_{decode}+T_{tool}+T_{workflow}+T_{network}
$$

不一定每个系统都能单独观测到这些项，但这个拆分很有用。它提醒我们：GPU 上的模型推理只是链路的一部分。

对于单次模型调用，最值得先理解的是两个阶段：**Prefill** 和 **Decode**。

### 1. Prefill：把输入读进去

假设一次请求有 7000 个输入 token。Prefill 会把这一整段输入送入 Transformer，计算每层的中间结果，并建立后续生成要用的 KV Cache。这个阶段完成后，模型才有可能生成第一个 token。

因此，用户看到第一个 token 所需的时间通常用 TTFT（Time to First Token）描述。严格来说，它还包含生成和传回首 token 的少量开销：

$$
TTFT\approx T_{queue}+T_{tokenize}+T_{prefill}+T_{first\ token}
$$

Prefill 可以同时处理一批输入 token，通常更容易把 GPU 的矩阵计算能力用起来。长输入会增加需要处理的 token 数，也会增加注意力计算和显存访问。

标准 full attention 的计算量随序列长度近似按平方增长；朴素实现还会显式存放同样按平方增长的注意力中间矩阵。FlashAttention 没有把 full attention 的计算复杂度改成线性，而是通过分块避免反复读写和完整物化中间矩阵，减少 HBM 与片上 SRAM 之间的数据搬运。它优化的是硬件执行方式，数学结果仍是精确 attention。[FlashAttention 论文](https://arxiv.org/abs/2205.14135)对这件事有完整推导。

### 2. Decode：一个 token 接一个 token 生成

第一个 token 之后，模型进入 Decode：

```text
生成 token 1
  -> 生成 token 2
    -> 生成 token 3
      -> ...
```

自回归模型不能在不知道前一个 token 的情况下直接生成后一个 token。于是，生成 N 个 token，至少要经历 N 次按顺序推进的 Decode step。

这里不能简单说成“每次都重新计算整个上下文”。更准确的说法是：每生成一个 token，都要进行一次新的模型前向计算；历史 token 的 Key/Value 通常已经放在 KV Cache 中，不再重复计算，但模型仍然需要读取权重，并访问与当前序列相关的 KV Cache。

输出阶段常见两个相近但不完全相同的指标。TPOT（Time Per Output Token）通常指除首 token 外的平均生成时间；ITL（Inter-Token Latency）记录相邻 token 之间的间隔，可以继续观察 p50、p95 和抖动。如果输出 token 数为 $N_{out}$，端到端模型时间可以粗略写成：

$$
T_{model}\approx TTFT+(N_{out}-1)\times TPOT
$$

Decode 经常受到显存带宽、KV Cache 访问和小 batch 下 GPU 利用率的影响，所以在很多场景中会表现出“带宽和数据搬运比纯计算更容易成为瓶颈”的倾向。但这不是永远成立的定律，模型架构、batch、Kernel 和硬件都会改变结果。

### 3. Agent 还有一层 Workflow Latency

真实 Agent 通常不是一次模型调用：

```text
LLM
  -> Tool A
  -> LLM
  -> Tool B
  -> LLM
  -> 最终回复
```

于是总耗时更接近：

$$
T_{agent}=\sum T_{LLM}+\sum T_{tool}+T_{workflow}+T_{network}
$$

假设三次模型调用分别耗时 500ms、800ms、1200ms，两个工具分别耗时 1000ms 和 300ms，那么总时间大约是：

```text
500 + 1000 + 800 + 300 + 1200 = 3800ms
```

即使把第二次模型调用从 800ms 优化到 600ms，端到端也只减少了约 5%。如果工具之间没有依赖、原本却被串行执行，改成并行可能比换一个 Kernel 更有效。

所以 Agent 至少要同时观测：

```text
模型调用次数
每次调用的输入/输出 token
TTFT 与 TPOT
工具耗时和网络耗时
串行步数、并行分支数和重试次数
Prefix Cache 命中率
```

## 二、用任务形状判断第一瓶颈

可以先用输入输出的比例建立直觉：

$$
R=\frac{N_{out}}{N_{in}}
$$

当 $R$ 很小，任务更可能偏 Prefill；当 $R$ 很大，任务更可能偏 Decode。但 ratio 只能用来帮助判断，不能替代绝对长度。例如 `100 -> 10` 和 `10000 -> 1000` 的比例相同，系统压力却完全不同。

更实用的做法是先用下面三类任务入门，再把它们看成连续空间中的典型区域。

| 任务形状 | 典型输入/输出 | 系统语言 | 常见任务 |
| --- | --- | --- | --- |
| 长输入、短输出 | 2000～10000 → 几十～几百 | Prefill-heavy | 分类、抽取、路由、结构化判断 |
| 短输入、长输出 | 几百 → 数百～数千 | Decode-heavy | 推理、代码生成、长文本生成 |
| 多轮 Tool Agent | 输入和输出都会增长 | Prefill + Decode + Workflow | 查询、执行、规划、研究和业务自动化 |

这三个类别不是互斥的。一个 Tool Agent 可能同时属于“长输入、短输出”，也可能属于“长输入、长输出”。Agent 是工作流形状，Prefill/Decode 是单次模型调用的执行形状，两套分类应该分开使用。

### 任务一：长输入、短输出

例如：

```text
系统提示词、业务规则、历史材料：7000 token
输出：100 token JSON
```

这类任务的主要成本通常在输入侧：

```text
Prefill  ███████████████████
Decode   ██
```

典型任务包括字段抽取、意图识别、分类、路由、合规判断和工具选择。它们的输出空间有限，很多时候并不需要一个长链路 reasoning 模型。

这里最重要的指标是 TTFT 和 prefill 吞吐，而不是把主要精力放在生成 100 个 token 的 TPOT 上。

### 任务二：短输入、长输出

例如：

```text
用户问题：200 token
推理和回答：3000 token
```

它更接近 Decode-bound：

```text
Prefill  ██
Decode   ██████████████████████████
```

这时把固定 prompt 从 7000 token 压到 3000 token，通常不是最优先的动作。更值得看的是输出到底为什么这么长、每个 token 的生成速度是多少、能否用 speculative decoding 减少目标模型的串行推进次数。

还有一个常被忽略的变量：reasoning budget。如果简单问题也被允许生成 4000 个思考 token，那么减少无效输出可能比减少几百个输入 token 更有价值。可以考虑按任务难度路由模型、设置最大 reasoning token、提前终止，或者先用小模型判断是否真的需要长推理。

### 任务三：多轮 Tool Agent

典型链路是：

```text
第 1 轮：理解请求，选择工具
第 2 轮：读取工具结果，继续判断
第 3 轮：调用另一个工具
第 4 轮：汇总并回复
```

每一轮都会带来新的输入和输出，历史上下文通常也会变长。它会同时受到几种因素影响：

```text
Prefill：每轮要重新处理多少新增或重复上下文
Decode：每轮生成多少 reasoning 和 tool call
KV Cache：前缀能否复用、缓存是否被挤出 GPU
Workflow：工具调用有多少串行等待和失败重试
```

这种任务不能只用 TTFT 或 TPOT 判断。最终应该看一次业务任务的 E2E latency、成功率、工具调用次数和成本。

## 三、模型参数量为什么不能直接换算成速度

在企业选型中，最容易被拿来比较的是模型参数量，例如 27B Dense 和 35B-A3B MoE。但参数量只是 checkpoint 的规模，不是一次请求真正的执行成本。

### 1. Dense：每个 token 都走同一套大矩阵

Dense 模型的每一层大致是：

```text
当前 token 的 hidden state
        |
        v
Attention -> FFN / MLP -> 下一层
```

所有 token 都使用同一组 FFN 权重。模型有 27B 参数，并不意味着每个矩阵乘法都要完整读取 27B 参数，但它的计算图规则、稳定，容易用大矩阵乘法把 GPU 填满。小 batch 或单请求时，规则性是 Dense 的优势；模型变大后，计算量和权重读写也会持续上升。

### 2. MoE：先路由，再只执行部分专家

MoE 会把 FFN 部分拆成多个 expert，再用 Router 决定当前 token 去哪些 expert：

```text
当前 token
    |
    v
 Router：给各个 expert 打分
    |
    +--> Expert 12
    +--> Expert 57
    +--> Expert 103
    |
    v
把结果 gather 回原来的 token 顺序
```

因此需要同时看两个数字：

```text
Total Parameters：所有 expert 加起来的参数量
Active Parameters：每个 token 实际激活的参数量
```

DeepSeek-V3 的技术报告给出的规模是 671B 总参数、每个 token 激活 37B 参数，并采用 MLA 和 MoE 结构。[DeepSeek-V3 Technical Report](https://arxiv.org/abs/2412.19437)

这解释了为什么不能只用模型总参数量排序速度：35B-A3B 的 active compute 可能低于 27B Dense。但 MoE 也增加了 Dense 没有的工作：

```text
Router 计算
Token dispatch：把 token 发给对应 expert
跨 GPU 的 All-to-All 通信
Expert 输出 gather
负载不均衡和小矩阵效率损失
```

如果 expert 分布在多张卡上，token dispatch 和 gather 还会受到 GPU 互联带宽、通信拓扑和负载均衡的影响。batch 很小、expert kernel 不够成熟，或者通信占比很高时，active parameters 少并不保证真实 latency 低。

比较 Dense 和 MoE 时，至少要测：

| 指标 | 说明 |
| --- | --- |
| TTFT | 长输入时 Prefill 是否更快 |
| TPOT | 单 token Decode 是否更快 |
| Expert 利用率 | 是否存在少数 expert 过载 |
| All-to-All 时间 | MoE 路由和通信占了多少时间 |
| 显存占用 | 权重、KV 和 workspace 是否能放下 |
| 质量与成本 | 是否需要用更多 token 或更多重试弥补能力差异 |

### 3. GQA、MLA 与 KV Cache 大小

长上下文和 Decode 里，KV Cache 的大小也很关键。每个历史 token 都要保存各层的 Key 和 Value。忽略对齐、分页和框架元数据后，KV Cache 显存占用可以粗略估成：

```text
batch/session 数 × 层数 × KV head 数 × head dimension
× 2（K 和 V）× token 数 × 数据类型字节数
```

[GQA（Grouped-Query Attention）](https://arxiv.org/abs/2305.13245)让多个 Query head 共享较少的 KV head，从而减少 KV Cache。MLA（Multi-head Latent Attention）进一步压缩需要缓存的 latent 表征。两者都在模型架构层面改变了“每个历史 token 要保存多少状态”。

KV Cache 越小，带来的不只是单请求省显存：同一张 GPU 可以容纳更多 session，Prefix Cache 更不容易被淘汰，并发时也更不容易因为 KV 不够而排队。因此在长上下文 Agent 里，模型架构和 runtime 的 KV 管理要一起看。

## 四、把一次请求画成时间线

只看平均 latency 很难判断瓶颈。更有用的是把一次请求按时间展开。

### 1. 单轮请求

```text
排队       Tokenize       Prefill              Decode
|----------|--------------|--------------------|------------------|
                         ^                    ^
                         TTFT                 第一个 token
                                              <--- 每个 token --->
```

如果输入是 8000 token、输出是 80 token，Prefill 可能占据绝大部分模型时间；如果输入是 200 token、输出是 3000 token，Decode 会成为主要部分。这里的比例只是解释形状的示意，不应该当成跨硬件、跨模型的固定百分比。

可以用两个简化模型帮助估算：

```text
长输入短输出：T_model ≈ TTFT(输入长度) + 79 × TPOT
短输入长输出：T_model ≈ TTFT(输入长度) + 2999 × TPOT
```

假设某个系统的 prefill 为 800ms、TPOT 为 25ms：

```text
8000 -> 80：   800 + 79 × 25 = 2775ms
200  -> 3000：  20 + 2999 × 25 = 74995ms
```

这不是性能承诺，而是说明为什么两类任务的优化顺序会相反。第一个例子里，把 TPOT 从 25ms 降到 20ms，只节省 400ms；把输入压缩一半，可能更值得。第二个例子里，把输入减少 100 token 几乎看不出变化，任何能降低 TPOT 或输出 token 数的手段都会被放大。

### 2. 多轮 Agent 请求

Agent 的时间线通常是多个单轮请求和外部等待拼在一起：

```text
模型 #1：理解请求、选择工具
        -> 网络往返
工具 A：查询数据库
        -> 模型 #2：读取工具结果、继续规划
        -> 网络往返
工具 B：调用业务 API
        -> 模型 #3：生成最终结果
```

如果三次模型调用分别是 600ms、900ms、700ms，工具 A/B 分别是 1200ms 和 400ms，串行总耗时就是：

```text
600 + 1200 + 900 + 400 + 700 = 3800ms
```

如果 profile 发现工具 B 实际不依赖 A 的结果，说明第二次规划调用可以前移或合并，让 A、B 同时发起。工具部分便可能从 `1200 + 400` 变成接近 `max(1200, 400)`。相比之下，把第二次模型调用加速 20% 只减少 180ms；若这次规划调用可以被确定性调度替代，则能直接省下约 900ms。

因此 Agent 优化不能只拿模型服务的单请求 benchmark 做结论，必须同时画出 workflow trace。

### 3. 指标应该怎样对应

| 现象 | 优先看什么 | 通常先查什么 |
| --- | --- | --- |
| 第一个 token 很晚 | TTFT、Prefill time | 输入长度、Prefix Cache、排队和 prefill Kernel |
| 第一个 token 很快，后续很慢 | TPOT、ITL | 输出长度、权重带宽、KV 访问和 Decode Kernel |
| 模型每轮不慢，任务仍然慢 | E2E、tool span、workflow span | 工具串行、网络、重试和模型调用次数 |
| 平均延迟可以，偶发请求很慢 | p95/p99、尾延迟 | 长上下文、batch 冲突、KV 淘汰和长工具调用 |
| 并发上升后所有请求变慢 | 吞吐、排队时间、batch | scheduler、KV 容量、continuous batching |

## 五、Harness 层：改变请求形状和工作流

Harness 可以理解为包在模型外面的控制层：它负责状态、上下文、工具执行、校验、重试和调度。它不改变底层模型的计算方式，却经常能通过改变请求形状获得最大的端到端收益。

### 1. 先删掉不该进入上下文的内容

最直接的例子是工具结果。数据库可能返回 200 个字段，但当前任务只需要其中 8 个；网页抓取可能得到整篇文章，Agent 只需要包含目标关键词的几个段落；测试命令可能生成几万行日志，真正需要的是错误位置和前后几行上下文。

推荐的数据流是：

```text
Tool 原始结果
  -> 代码过滤、投影、排序、去重
  -> 小型结构化结果
  -> 模型上下文
```

不要把“原始数据交给模型，让模型自己筛选”当成默认方案。确定性代码在做字段投影、权限过滤和简单聚合时通常更快、更便宜，也更容易审计。

这也是上下文工程和 prompt engineering 的区别之一。Prompt engineering 更关注“怎么写指令”；上下文工程还要关注“哪些信息进入请求、以什么结构进入、何时退出”。

### 2. 四种输入缩减方法，成本差异很大

“把 prompt 变短”至少有四种不同做法，成本和风险也不同：

| 方法 | 具体动作 | 主要收益 | 主要风险 |
| --- | --- | --- | --- |
| 规则化压缩 | 删除重复说明、合并规则、缩短措辞 | 立刻减少输入 token | 可能删掉边界条件 |
| 结构化上下文 | 把长段文本改成字段、表格或枚举 | 更稳定、更易过滤 | 需要重新设计 prompt 协议 |
| 运行时摘要 | 对旧对话、旧工具结果做摘要 | 控制上下文持续增长 | 摘要可能丢失细节或改变事实 |
| SFT/蒸馏 | 把稳定示例和固定规则训练进模型 | 长期减少常驻 prompt | 需要数据、训练和回归验证 |

规则化压缩和结构化改写通常是低风险的第一步；运行时摘要要保留原始记录和恢复指针；SFT 适合那些长期稳定、跨请求重复、可以明确标注的数据。

例如，7000 token 的抽取 prompt 中可能有 4000 token 是固定的业务规则，2000 token 是反复出现的示例，1000 token 才是动态输入。可以先把示例改成少量代表性样例，把规则改成结构化约束，再测 Prefix Cache。如果固定规则已经被缓存，继续做 SFT 的纯延迟收益可能不如预期；如果请求分布变化很快，训练也可能比运行时压缩更难维护。

摘要还要区分“给模型看的上下文”和“系统保留的完整历史”。不要为了省 token 直接删除审计数据。比较稳妥的结构是：模型收到摘要和必要片段，系统保存原始 tool result、消息和版本号，摘要中保留可回溯的引用。

### 3. 尽量保持 append-only，给 Prefix Cache 创造命中条件

假设 Agent 每轮都把完整历史追加在末尾：

```text
第 1 轮：[系统提示词][用户请求]
第 2 轮：[系统提示词][用户请求][工具结果 A]
第 3 轮：[系统提示词][用户请求][工具结果 A][工具结果 B]
```

后续请求天然拥有共同前缀。如果 serving 层缓存了这个前缀，下一轮就不需要再次计算已经处理过的 token。vLLM 的 Automatic Prefix Caching 和 SGLang 的 Radix Cache 都在解决这类问题：把已经计算过的 KV Cache 按块或树状前缀保存，并在后续请求中复用。[vLLM Automatic Prefix Caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/)、[SGLang Session-Aware Radix Cache](https://docs.sglang.io/docs/advanced_features/session_radix_cache)

但缓存不是“打开开关就必然有效”。以下变化都可能破坏前缀：

```text
每轮重写 system prompt
动态插入时间戳、随机 ID 或用户状态
工具 schema 顺序不稳定
JSON 序列化顺序变化
把新内容插入历史中间，而不是追加到末尾
```

因此 Agent runtime 最好让稳定内容排在前面，动态内容排在后面，历史采用尽可能稳定的追加结构。Prefix Cache 的收益需要看真实 hit rate，不能只看理论上的重复 token 数。

### 4. 用结构化输出减少废话、解析失败和重试

如果下游只需要 JSON，不要只在 prompt 里反复写“必须返回合法 JSON，不能有 Markdown，不能补充解释”。应该在推理服务中使用 JSON Schema、regex 或 grammar 等约束机制。SGLang 的[结构化输出文档](https://docs.sglang.io/docs/advanced_features/structured_outputs)列出了 JSON Schema、Regex 和 EBNF 等方式。

Structured Decoding 的直接目标是格式约束，不是让每个 Decode step 都变快。它可能增加约束处理成本，但通常可以减少三类浪费：

```text
少生成无关解释
少做一次 JSON 修复请求
少因解析失败触发重试
```

所以应该用 E2E latency、成功率和重试率评价它，而不是只看 TPOT。

约束发生在生成过程中，而不是生成后的 JSON parser 检查。grammar backend 会根据当前前缀维护状态机，计算下一步哪些 token 仍然合法，再屏蔽不合法 token。比如 JSON Schema 要求下一个字符只能是 `}`、`,` 或某个字段值的开头，解码器就不会走向语法上不可能的路径。

这解释了两件事：

1. 它能显著降低“生成一大段文本，最后才发现格式错了”的重试浪费。
2. schema 越复杂，约束状态和 token mask 的管理也可能越贵；首次使用某个 schema 还可能有 grammar 编译成本。

因此结构化输出的 benchmark 要包含 schema 首次编译、schema 复用、短输出和长输出几种情况。只测单次请求的 token 速度，很可能看不到它在业务链路上的真实收益。

### 5. 优先减少 Agent 步数和串行等待

如果两个工具之间没有数据依赖，不要写成：

```text
调用 A -> 等待 -> 调用 B -> 等待 -> 调用 C
```

可以改成：

```text
同时调用 A、B、C -> 汇总结果
```

在没有依赖关系时，端到端耗时从各工具耗时之和，变成更接近最慢分支的耗时。这里要注意并行会增加并发压力，也可能让模型汇总阶段的上下文变大，所以仍然需要实际测量。

重试也应该纳入性能预算。一个格式校验失败后重新调用模型，可能比一次结构化输出约束贵得多；一个工具超时后无条件重试三次，可能让原本 2 秒的任务变成 8 秒。重试策略要区分可重试错误、参数错误和业务拒绝，并设置上限。

## 六、Serving 层：让每个 token 更便宜

当上下文和工作流已经合理，或者 profile 明确显示模型阶段占据主要时间，再进入 serving 优化。

### 1. Prefix Cache：重复前缀只算一次

Prefix Cache 的基本思想很简单：如果多个请求共享一段完全相同的前缀，就把前缀对应的 KV Cache 保存下来，后续请求从缓存接着算。

```text
请求 A：[5000 token 固定前缀][A 的输入]
请求 B：[5000 token 固定前缀][B 的输入]
请求 C：[5000 token 固定前缀][C 的输入]

缓存：[5000 token 固定前缀]
```

它对长输入短输出和多轮 Agent 尤其有价值，因为这些任务经常反复携带 system prompt、工具 schema、会话历史或公共文档。它的直接收益是减少重复 prefill，命中率足够高时也能释放计算资源、提高吞吐。代价是缓存块会继续占用 KV 容量；保留太多冷前缀，反而可能挤压活跃请求。

需要区分两个概念：Prefix Cache 命中减少的是“已经算过的前缀”，不是让动态后缀免费；缓存也受 GPU 显存容量和淘汰策略影响。长生命周期 session 可以考虑 session-aware cache 或分层 KV Cache，把热点 KV 放在 GPU，把较冷的 KV 放到 CPU 内存或其他存储层，但数据搬运成本必须纳入测量。

从实现上看，Prefix Cache 通常不是按“一个请求”保存，而是按 token block 或 radix tree 节点保存。每个节点代表一段已经计算过的 token 和对应 KV；新请求进来后，从根节点开始逐段匹配，匹配到的部分直接复用，第一次不同的位置开始做新的 Prefill。

对单个请求，可以先定义“前缀复用比例”：

$$
R_{prefix}=\frac{N_{cached\ input}}{N_{input}}
$$

它不等于 latency 降幅，也不能单独代表整个服务的 cache hit rate。缓存命中后仍然要处理动态后缀，还要支付 cache lookup、KV block 管理和可能的显存搬运成本。线上应同时记录：

```text
输入 token 命中率
TTFT 降幅
GPU KV 占用
缓存淘汰次数
命中请求与未命中请求的 p95
```

一个常见反例是：固定前缀短于一个完整 cache block，或者每轮 prompt 都在固定前缀中插入变化的时间戳。理论上存在公共前缀，实际却匹配不到可复用的完整 block。缓存布局和 prompt 序列化方式需要一起设计。

### 2. Weight Quantization 和 KV Quantization 影响不同瓶颈

量化常被笼统地描述成“把 BF16 换成 FP8/INT4，让模型变小”。更实用的理解是：低精度减少了需要存储和搬运的数据量，但不同量化对象带来的收益不同。

**Weight Quantization** 量化模型权重。Decode 时每生成一个 token，都要反复使用这些权重；在带宽容易成为瓶颈的场景，减少权重读写可能带来明显收益。代价是精度损失、反量化开销以及不同 Kernel 对量化格式的支持差异。

权重量化还可以分成几种常被混在一起的路径：

```text
权重离线量化：加载前就把 checkpoint 转成 FP8/INT8/INT4
权重在线反量化：矩阵乘前把低精度权重恢复到更高精度
融合量化 Kernel：在矩阵计算内部直接处理低精度权重
```

融合量化 Kernel 通常更有机会把带宽收益兑现出来。如果低精度权重每次都先单独反量化成 BF16，再调用普通矩阵乘，额外的数据转换可能吞掉收益。不同格式还会影响 scale 的存储和读取方式，不能只比较“每个参数占几 bit”。

**KV Quantization** 量化上下文对应的 Key/Value。它的主要价值是让同样的 GPU 显存容纳更多历史 token，从而提高长上下文并发或缓存保留率。SGLang 的[量化 KV Cache 文档](https://docs.sglang.io/docs/advanced_features/quantized_kv_cache)也提醒了一个重要条件：如果 attention Kernel 没有直接高效处理低精度 KV，量化后的转换成本可能抵消收益。

两类量化也可以组合，但它们的验证方式不同：

```text
权重量化：重点看 TPOT、吞吐、模型质量和反量化开销
KV 量化：重点看最大上下文、并发数、cache hit 保留时间和长上下文质量
```

例如，假设某个 Agent 服务的单请求 Decode 并不慢，但 GPU 只能同时保留 20 个长 session，剩余请求都在等待 KV 空间。此时 KV FP8 的主要收益可能是提高可驻留 session 数，单请求 TPOT 未必会明显下降。

评估量化时需要回答：

```text
权重读写减少了吗？
KV Cache 能容纳更多 token 了吗？
Kernel 是否原生支持这种格式？
精度和业务成功率是否还能接受？
```

### 3. Speculative Decoding：小模型先猜，大模型批量验

Decode 的困难在于生成过程是串行的。Speculative Decoding 引入一个更快的 draft model：它先连续猜一小段 token，target model 再一次性验证这段猜测。猜中的 token 可以一起提交，猜错的位置从那里继续。

```text
Draft model：猜 token 1、2、3、4、5
Target model：一次验证这 5 个 token
结果：如果大部分被接受，就少做几次串行 target step
```

原始研究表明，这种方法可以在不改变目标模型输出分布的前提下加速生成；但真实收益取决于接受长度、draft model 的成本、batch、采样设置和实现方式。[Leviathan 等人的 ICML 论文](https://proceedings.mlr.press/v202/leviathan23a.html)给出了基本算法。

可以把一次 speculative iteration 拆成三步：

```text
1. Draft model 自回归生成 k 个候选 token
2. Target model 用一次更适合批量计算的 forward 检查候选
3. 接受连续通过的 token，遇到不通过的位置重新采样或继续生成
```

它的核心收益来自一个不对称：target model 做一次并行验证，可能比连续做 k 次单 token Decode 更划算。但如果 draft model 猜得不准，平均接受长度很短，或者 draft model 本身占掉了大量资源，收益就会消失。

因此 benchmark 至少要记录：

```text
每轮 draft token 数 k
平均接受 token 数
接受率 / acceptance length
target forward 次数
启用前后的 TPOT 和 GPU 利用率
```

MTP（Multi-Token Prediction）和 EAGLE 等方法可以看作不同的候选 draft/预测机制，是否有效取决于目标模型是否提供对应训练结构、runtime 是否支持以及 workload 的生成分布。不能把“支持 speculative decoding”直接等同于“一定加速”。

它更适合短输入长输出和需要生成大量 reasoning token 的任务。对于只输出几十个 token 的结构化抽取，能优化的 Decode 步数有限，通常不应排在 prompt 压缩和 Prefix Cache 前面。

### 4. Continuous Batching、Paged KV 和 Chunked Prefill

Serving 系统要同时服务许多不同长度的请求。传统静态 batch 往往要等一批请求都结束，才能换下一批；continuous batching 会在请求完成或新请求到来时动态调整 batch，让 GPU 更持续地工作。

Paged KV Cache 把每个请求的 KV Cache 切成固定大小的块，像操作系统分页一样管理显存。它减少了按最大长度预留连续空间造成的浪费，也使共享 KV block 和请求调度更容易实现。具体设计来自 vLLM 的 [PagedAttention 论文](https://arxiv.org/abs/2309.06180)，实现细节可参考 [vLLM 文档](https://docs.vllm.ai/en/latest/design/paged_attention/)。

在早期或较简单的连续内存方案中，一个请求往往要按最大长度预留连续 KV 空间，而请求最终会生成多长在开始时并不知道。这会形成内部碎片，扩容和搬迁也不便宜。Paged KV 把逻辑上的连续序列映射到物理上不连续的 block：

```text
逻辑序列：[0][1][2][3][4][5]
物理显存：[A][D][B][F][C][E]
页表：    0->A, 1->D, 2->B, 3->F, 4->C, 5->E
```

这样可以更灵活地回收、共享和淘汰 KV。代价是 attention Kernel 需要根据 block table 找到正确的 Key/Value。block 越小，内部碎片和共享粒度通常更好，但索引与 Kernel 访问更零散；block 越大，更容易发挥并行访存效率，却会增加尾块浪费，并降低前缀共享的粒度。PagedAttention 论文也把 block size 视为吞吐、碎片与共享概率之间的取舍，而不是固定的最优值。

Chunked Prefill 解决的是长输入对在线 Decode 的干扰。一个 20000 token 的请求如果一次性 Prefill，可能长时间占用 GPU，导致其他请求的输出 token 停顿。把 Prefill 切成若干块，穿插已有请求的 Decode，可以改善其他请求的 ITL 和尾延迟。

```text
长请求：Prefill 2k -> Prefill 2k -> Prefill 2k -> ...
在线请求：      Decode -> Decode -> Decode -> ...
```

Chunked Prefill 的目标不一定是让这个长请求本身更快，而是降低它对其他在线请求的干扰。这就是为什么吞吐、单请求延迟和尾延迟必须分开看。

调度器实际上在做一个取舍：

```text
优先跑长 Prefill：长请求可能更快，但在线 Decode 被打断
优先跑 Decode：在线用户更平滑，但长请求 TTFT 变长
切成小块交错：兼顾两者，但增加调度和 Kernel 边界开销
```

所以 chunk size 不是越大越好，也不是越小越好。它要结合在线流量的 SLA、Prefill 长度、Decode batch 和 GPU 利用率调参。评价时应同时看长请求自己的 TTFT，以及其他请求的 p95/p99 ITL。

### 5. Kernel 和 Attention Backend：同一个模型不一定跑出同样的结果

FlashAttention、FlashInfer、FlashMLA、Fused MoE、CUDA Graph 等名字背后，解决的是不同的硬件执行问题：减少显存搬运、融合多个小操作、优化 MoE 的 token dispatch、降低 Kernel launch 开销，或让 GPU 更稳定地执行重复形状的计算。

不同模型和不同阶段也可能需要不同 backend。MHA、MLA、GDN 等注意力结构的内存访问方式不同；Prefill 和 Decode 的 batch 形状也不同。SGLang 的[Attention Backend 文档](https://docs.sglang.io/docs/advanced_features/attention_backend)提供了这种“按模型与 workload 选择 backend”的例子。

因此不要只因为某个项目的 benchmark 里某个 Kernel 更快，就默认它适合自己的生产流量。要使用真实模型、真实输入长度、真实并发和真实采样参数测试。

### 6. P/D Disaggregation：规模上来以后再拆 Prefill 和 Decode

Prefill 更偏计算密集，Decode 更偏 KV Cache 和内存访问。SGLang 的[Prefill-Decode Disaggregation 文档](https://docs.sglang.io/docs/advanced_features/pd_disaggregation)把它们描述成两类不同的资源需求，并允许把 Prefill 和 Decode 放到不同 GPU 池中。

```text
Prefill GPU Pool
        -> KV 传输
Decode GPU Pool
```

这样可以分别调节两边的 batch、并行度和资源规模，减少长 Prefill 对在线 Decode 的干扰。但它会引入 KV 传输、路由、故障处理和部署复杂度。小规模部署通常应该先把 prompt、缓存、batch 和 Kernel 做好；只有当流量规模和 SLA 证明统一调度已经成为瓶颈时，P/D 分离才值得进入架构选项。

### 7. 哪些优化需要 Harness 与 Serving 配合

有些手段可以由一层独立完成，有些则必须跨层配合：

| 优化 | Harness 要做什么 | Serving 要提供什么 | 主要观察指标 |
| --- | --- | --- | --- |
| Prompt/tool result 压缩 | 过滤、投影、摘要 | 无硬依赖 | 输入 token、TTFT、质量 |
| Prefix Cache | 固定公共前缀、稳定序列化、历史追加 | KV 前缀索引、复用和淘汰 | cached token、TTFT、KV 占用 |
| Structured Decoding | 提供稳定 schema、处理业务校验 | grammar 编译和 constrained decoding | 重试率、E2E、TPOT |
| Reasoning budget | 路由难度、设置输出预算 | 支持对应模型和停止条件 | 输出 token、成功率、E2E |
| Weight/KV 量化 | 做质量回归和容量规划 | 量化格式与融合 Kernel | TPOT、并发、显存、质量 |
| 工具并行 | 构建依赖图、处理超时和取消 | 无模型侧硬依赖 | tool span、E2E、错误率 |

这张表也说明了为什么只改 prompt 或只换 serving backend 都可能拿不到预期收益。例如 Serving 已经打开 Prefix Cache，但 Harness 每轮重排工具 schema，缓存仍然无法命中；反过来，Harness 保持了稳定前缀，Serving 没有复用 KV，也只是在重复发送相同 token。

## 七、三类任务的优化优先级

下面给的是排查起点。实际顺序要由 profile 或 benchmark 决定；如果第一步已经证明瓶颈在别处，就直接跳到对应项。

### 长输入、短输出：先处理 Prefill 和输入结构

推荐顺序：

```text
1. 删除不必要的 prompt、tool result 和重复规则
2. 稳定固定前缀，测 Prefix Cache 命中率
3. 用结构化输出减少废话和重试
4. 选择合适的小模型或低 active compute 模型
5. 优化 prefill Kernel、量化和调度
6. 最后才考虑 speculative decoding
```

一个实际例子是合同字段抽取：系统提示词、抽取规则和示例共 7000 token，最终只需要输出 20 个字段。如果能把固定规则从 7000 压到 3000，TTFT 会直接受益；如果其中 2500 token 在不同请求间完全相同，Prefix Cache 可能带来更稳定的收益；如果输出格式经常导致解析失败，JSON Schema 约束可能比继续压缩几十个输入 token 更值得。

这类任务不应默认使用长 reasoning 模型。小型 Dense、低 active parameter 的 MoE 都可以进入候选，但要用真实模型和硬件测量。MoE 的路由、跨卡通信和小矩阵 Kernel 可能让理论计算量低的模型在某些环境里反而更慢。

### 短输入、长输出：先处理 Decode 和输出预算

推荐顺序：

```text
1. 限制无效 reasoning，设置合理输出预算
2. 评估 speculative decoding、MTP 或 draft model
3. 比较 active compute、weight quantization 和 Decode Kernel
4. 调整 continuous batching 与并发策略
5. 最后再处理很短的输入 prompt
```

这里最贵的变量通常是“生成了多少 token”。如果一个简单问题总是生成 4000 个 reasoning token，先把它路由到短思考路径，可能比把输入从 300 token 压到 200 token 更有用。

低 active parameter 的 MoE 可能适合长生成，因为每个输出 token 都会重复经过模型。但“active 参数少”只是计算量的一个代理，真实速度还取决于 expert dispatch、通信、显存、Kernel 和 batch。最终必须看 TPOT、吞吐、质量和成本。

Speculative Decoding 也不是免费加速：draft model 要占用资源，猜错太多时接受率低，batch 变大后验证收益也可能变化。应该用目标业务的真实输出分布测 acceptance length，而不是直接套用论文或厂商示例中的倍数。

### 多轮 Tool Agent：先处理上下文生命周期和工作流

推荐顺序：

```text
1. 减少工具调用次数，识别可以并行的分支
2. 在工具侧过滤、投影和摘要结果
3. 让会话上下文稳定追加，测 Prefix Cache 命中率
4. 对旧历史、KV 和大工具结果做分层管理
5. 再分别优化每轮的 Prefill、Decode 和输出预算
6. 规模足够大时再考虑 P/D Disaggregation
```

例如一个数据库 Agent：

```text
系统提示词：3000 token
历史对话：4000 token
工具结果 A：10000 token
工具结果 B：15000 token
当前请求：1000 token
```

如果下一轮继续把所有原始结果完整带回模型，输入会很快膨胀。更合理的流程是让数据库工具直接返回需要的字段和聚合结果，把完整查询结果保存到可追溯的外部存储，只把当前步骤需要的摘要或指针交给模型。

Agent 的 Prefix Cache 也有一个工程前提：不要每轮重新拼接和重排整个 prompt。稳定的 system prompt、工具 schema 和历史前缀应该尽量保持不变，新增工具结果追加在尾部。否则理论上高度重复的 session，实际 cache hit rate 可能很低。

## 八、两个完整例子：从 profile 走到优化顺序

### 例子一：合同字段抽取（示意数据）

假设业务要求从一份合同和一组公司规则中抽取 20 个字段并返回 JSON，一次压测得到下面这组示意数据：

```text
输入：p50 6800 token，p95 12000 token
输出：p50 90 token
单次模型调用：1 次
TTFT：p50 1.8s，p95 4.2s
首 token 后的生成：平均 89 × 18ms ≈ 1.60s
JSON 重试率：7%
```

这个任务有两个问题。第一，输入很长，TTFT 的 p95 可能被长合同和排队放大；第二，输出虽然不长，但 7% 的重试会把一部分请求变成两次甚至三次模型调用。

可以按下面的顺序处理：

```text
1. 让代码先裁剪合同，只把相关章节和字段候选交给模型
2. 把 200 个示例收缩成少量代表性示例
3. 固定 system prompt、字段 schema 和示例顺序，测 Prefix Cache
4. 打开 JSON Schema 约束，观察重试率和 grammar overhead
5. 再比较更小 Dense 或低 active MoE 的 TTFT 和准确率
```

假设裁剪后输入从 6800 降到 3200 token，固定前缀有 2200 token，cache hit rate 达到 80%，此时比“直接把模型换成更大的推理模型”更值得先验证的是：

```text
缓存命中请求的 TTFT
缓存未命中请求的 TTFT
长合同 p95 的尾延迟
schema 约束前后的重试率
字段准确率和漏字段率
```

如果 JSON 重试率从 7% 降到 1%，业务 E2E latency 的改善可能比单纯优化 90 个输出 token 的 TPOT 更明显。

### 例子二：数据库查询 Agent（示意数据）

再假设一个自然语言查询数据库的 Agent，可以调用 schema 查询、SQL 执行和结果解释工具。一次成功任务包含四轮模型调用：

```text
第 1 轮：理解问题，选择 schema 工具       400ms
工具 A：读取表结构                        250ms
第 2 轮：生成 SQL                          800ms
工具 B：执行 SQL                           1.4s
第 3 轮：检查结果并决定是否补查             900ms
工具 C：补查                                700ms
第 4 轮：生成最终解释                       1.1s
```

单次任务加起来超过 5 秒，其中模型调用约 3.2 秒，工具和网络约 2.35 秒。进一步 profile 发现每一轮都把完整 SQL 结果带回模型，最后一轮的输入已经超过 18000 token，其中只有 12 列真正用于回答。

这个任务的第一批改动应该是：

```text
工具 A 返回结构化 schema 摘要，而不是整张表定义
工具 B 在数据库侧做列投影、行数限制和聚合
工具结果保存完整查询 ID，模型只接收摘要和必要行
schema、工具定义和历史采用稳定的 append-only 结构
无依赖的 schema 查询和权限检查并行执行
```

之后再看 serving 层：

```text
固定工具前缀的 Prefix Cache 命中率
每轮新增 token 与重复 token
长 session 的 KV 淘汰次数
第 3 轮是否真的需要完整 Decode
```

如果工具 B 的查询必须等待权限检查，不能为了追求并行而破坏权限边界；如果第 3 轮的补查决策可以由确定性规则判断，也不必再调用一次模型。Agent 优化的重点不是把每一轮模型都变快，而是减少不必要的模型工作和上下文搬运。

## 九、把优化过程变成一个可复用的诊断流程

面对一个新任务，可以按下面的顺序开始。

### 第一步：记录真实请求形状

不要只记录平均 token 数，至少分开看 p50、p95 和 p99：

| 维度 | 要记录什么 |
| --- | --- |
| 输入 | prompt token、tool result token、上下文总长 |
| 输出 | 总输出 token、reasoning token、tool call token |
| 复用 | Prefix Cache 命中 token、命中率、缓存淘汰 |
| 工作流 | 模型调用次数、串行步数、并行分支、重试次数 |
| 时间 | TTFT、TPOT、单次 E2E、工具和网络耗时 |
| 系统 | 并发、batch、GPU 利用率、显存和 KV 占用 |

### 第二步：判断主瓶颈

```text
TTFT 占比高，输入长       -> 查 Prefill、prompt、Prefix Cache
TPOT 高，输出长            -> 查 Decode、权重带宽、量化、Spec Decode
工具等待占比高             -> 查并行、超时、重试和外部服务
上下文增长快               -> 查 tool result、摘要、KV 生命周期
吞吐下降但单请求还好       -> 查 batch、调度、显存和尾延迟
```

如果一次 Agent 任务包含多轮模型调用，不要只看最后一轮的 latency。应该把每个 span 串起来，确认慢在哪个阶段、哪个工具和哪一轮上下文。

### 第三步：先做低成本、可逆的改动

通常先尝试：

```text
过滤工具输出
减少无效历史
让独立工具并行
稳定 prompt 前缀
限制输出预算
约束结构化输出
```

这些改动不需要更换模型，也不一定需要改 GPU 部署。它们还能让后续 serving benchmark 更接近真实的目标 workload。

### 第四步：再做 serving benchmark

每次只改变一个主要变量，并同时看：

```text
质量 / 成功率
TTFT / TPOT / E2E
吞吐和尾延迟
GPU 显存与 KV 占用
单请求成本
```

不要只用随机 token 长度的 benchmark 代表生产流量。至少要准备三组数据：缓存命中请求、缓存未命中请求，以及真实 Agent session trace。SGLang 的[Serving Benchmark 指南](https://docs.sglang.io/docs/developer_guide/bench_serving)提供了控制输入输出长度、清空缓存和采集 profile 的基本方式。

## 十、按观测结果决定下一步

| 观察到的形状或瓶颈 | 第一批排查项 | 第二批排查项 | 暂时不要优先做什么 |
| --- | --- | --- | --- |
| 长输入、短输出，TTFT 高 | prompt/tool result、Prefix Cache | prefill Kernel、量化、模型大小 | Speculative Decoding |
| 短输入、长输出，TPOT 高 | 输出预算、reasoning 路由 | Spec Decode、active compute、weight quantization | 只做 prompt 压缩 |
| 多轮上下文不断增长 | tool result 投影、摘要、append-only | 分层 KV、session cache、chunked prefill | 直接把所有历史塞回模型 |
| 工具耗时占大头 | 并行、超时、重试、批量 API | 外部服务和网络优化 | 先换模型或 Kernel |
| JSON 失败和重试多 | Structured Decoding、schema 校验 | 业务校验和错误恢复 | 只在 prompt 里重复格式要求 |
| 高并发下尾延迟上升 | continuous batching、Paged KV、调度 | P/D 分离、资源池拆分 | 只看平均 latency |

这张表用来决定第一轮测什么，不能替代 benchmark。实际落地时按下面的顺序循环：

```text
记录请求形状
  -> 找到主瓶颈
    -> 选择对应层的低成本优化
      -> 用相同流量复测
        -> 检查质量、延迟、吞吐和成本
```

## 参考资料

1. Tri Dao 等，[“FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness”](https://arxiv.org/abs/2205.14135)。
2. DeepSeek，[“DeepSeek-V3 Technical Report”](https://arxiv.org/abs/2412.19437)。文中用于说明 MoE 的总参数与激活参数，以及 MLA/MoE 对推理效率的设计取向；不把论文中的模型数字直接当成通用 latency 结论。
3. Joshua Ainslie 等，[“GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints”](https://arxiv.org/abs/2305.13245)。
4. Yaniv Leviathan 等，[“Fast Inference from Transformers via Speculative Decoding”](https://proceedings.mlr.press/v202/leviathan23a.html)。
5. Woosuk Kwon 等，[“Efficient Memory Management for Large Language Model Serving with PagedAttention”](https://arxiv.org/abs/2309.06180)。
6. Lianmin Zheng 等，[“SGLang: Efficient Execution of Structured Language Model Programs”](https://arxiv.org/abs/2312.07104)。
7. vLLM，[Automatic Prefix Caching](https://docs.vllm.ai/en/latest/features/automatic_prefix_caching/) 和 [PagedAttention](https://docs.vllm.ai/en/latest/design/paged_attention/)。
8. SGLang，[Session-Aware Radix Cache](https://docs.sglang.io/docs/advanced_features/session_radix_cache)、[Structured Outputs](https://docs.sglang.io/docs/advanced_features/structured_outputs)、[Quantized KV Cache](https://docs.sglang.io/docs/advanced_features/quantized_kv_cache)、[Attention Backend](https://docs.sglang.io/docs/advanced_features/attention_backend)、[P/D Disaggregation](https://docs.sglang.io/docs/advanced_features/pd_disaggregation) 和 [Serving Benchmark](https://docs.sglang.io/docs/developer_guide/bench_serving)。
