# OpenClaw 项目解读

OpenClaw 是一个很容易被误解的项目。表面上看，它是“把 AI 助手接到 WhatsApp、Telegram、Discord、Slack、QQ、飞书等消息平台上”；但从源码和文档看，它真正想做的是一个本地优先的个人 Agent 操作系统：Gateway 常驻本机，负责路由、鉴权、审批、插件加载和状态管理；Agent 负责推理与行动；Channel、Provider、Tool、Memory 等能力则通过插件持续扩展。

这篇文章基于当前源码、官方 README/VISION/SECURITY/docs，以及公开资料整理。重点不复述每个文件，而是回答几个架构问题：

1. 为什么 OpenClaw 把 Gateway 放在系统中心？
2. 多 Channel、多 Client、多 Agent 是如何被统一到一套 Session 机制里的？
3. 插件系统为什么很重，但又为什么必要？
4. Agent Runtime 如何处理工具执行、模型故障、上下文预算和长期记忆？
5. 这个项目的安全边界到底在哪里？

先给结论：OpenClaw 是一套 **Local-first Gateway + Plugin SDK + Multi-agent Routing + Budgeted Agent Runtime**，定位比“聊天机器人”更接近本地控制平面。它把个人 AI 助手拆成一个长期运行的本地服务，再把消息通道、模型、工具、记忆和客户端接进来。

---

## 一、定位：本地优先的个人 Agent，而不是云端 Bot

OpenClaw 官方 README 对它的定义很明确：这是运行在用户自己设备上的 personal AI assistant；Gateway 只是控制平面，真正的产品是 assistant 本身。[1]

这个定位决定了它和传统 Bot 框架的差异。

| 问题 | 传统做法 | OpenClaw 的做法 |
| --- | --- | --- |
| 多平台触达 | 每个平台独立写一个 Bot | 一个 Gateway 加载多个 Channel Plugin |
| 工具执行 | Bot 通常只负责收发消息 | Agent 可以读写文件、执行命令、调用工具 |
| 隐私与状态 | 会话和状态常落在云服务 | 配置、会话、记忆、媒体默认留在本地 |
| 安全控制 | 简单 token 或人工信任 | Gateway 鉴权、配对、审批、沙箱、插件约束多层组合 |

更准确地说，OpenClaw 不是“一个模型客户端”。模型只是其中一层。它真正维护的是：

```text
用户入口
  -> Channel / Client
  -> Gateway
  -> Agent 路由
  -> Runtime
  -> Provider / CLI Backend / ACP Backend
  -> Tool / Memory / Channel outbound
```

如果把 Claude Code、Codex CLI、OpenCode 这类工具理解为“围绕代码工作区的 Agent”，那么 OpenClaw 更像“围绕个人消息入口和本地设备的 Agent”。它关心的不只是一次对话，而是长期在线、跨平台触达、持久记忆、设备能力和安全审批。

---

## 二、Gateway：OpenClaw 的微内核

OpenClaw 架构里最关键的选择是把 Gateway 做成唯一长驻进程。官方架构文档写得很直接：一个 Gateway 拥有所有 messaging surfaces；控制客户端通过 WebSocket 连接默认 `127.0.0.1:18789`；Nodes 也通过同一个 WebSocket server 声明能力；Canvas host 也挂在同一个 Gateway HTTP 端口下。[2]

这使 Gateway 同时承担五个角色。

### 1. 唯一状态所有者

很多消息平台的 session 是强状态的。例如 WhatsApp Web、Telegram bot 连接、Slack app、Discord gateway 连接，都不适合多个进程随意抢占。OpenClaw 用一个长驻 Gateway 持有这些连接，避免同一账号被多个 agent/runtime 反复登录、扫码、断线重连。

这也是它和“每个 Bot 一个进程”的架构差异：OpenClaw 把所有通道收敛到同一条控制平面，避免为每个平台建立孤岛。

### 2. 消息总线

Gateway 不只转发消息，还承载统一的 RPC 和事件流：

```text
Client / Node / Channel
        |
        v
Gateway WS / HTTP
        |
        v
agent run, session, config, health, approval, presence, canvas, nodes
```

WebSocket 协议要求第一帧必须是 `connect`。握手成功后，客户端通过 `{type:"req", method, params}` 发请求，Gateway 通过 `{type:"res"}` 返回结果，并用 `{type:"event"}` 推送 agent stream、presence、tick、health 等事件。[2]

这个设计的收益是入口统一。TUI、Control UI、WebChat、macOS/iOS/Android 节点、自动化脚本不需要各自理解 Channel 细节，只要理解 Gateway 协议。

从源码看，这套 RPC 还有两个容易忽视的工程细节。

第一，副作用请求强制带 `idempotencyKey`。在 `packages/gateway-protocol/src/schema/agent.ts` 中，`AgentParamsSchema`、`SendParamsSchema`、`MessageActionParamsSchema`、`PollParamsSchema` 都要求 `idempotencyKey: NonEmptyString`。这不是表面字段，而是分布式系统里处理“请求已发出但客户端没收到响应”的基础设施：如果 TUI、ACP bridge、MCP bridge 或消息平台重试同一请求，Gateway 可以用幂等键识别重复提交，避免重复发消息、重复触发 agent run 或重复执行 channel action。

第二，Gateway 的协议 schema 和客户端类型是分离构建的。`packages/gateway-protocol` 定义 wire shape，`packages/gateway-client` 负责连接、challenge 处理、事件订阅和超时控制。这意味着协议不是 UI 组件内部的临时代码，而是一个可以被 CLI、SDK、WebChat、移动节点和外部自动化共享的稳定边界。

### 3. 认证和信任根

OpenClaw 的连接认证不是单纯“拿 token 就能用”。官方架构文档里提到，所有 WS client 和 node 在 `connect` 时都带 device identity；新设备需要 pairing approval；后续连接使用 device token；非本地连接仍需显式批准；`connect.challenge` 需要签名，并绑定 platform 与 deviceFamily。[2]

本地 loopback 可以为了体验做自动批准，但远程、LAN、tailnet 连接都不能直接等同于本机信任。Gateway 因此不仅是消息路由器，也是设备身份与操作权限的根。

### 4. 多 Agent 的物理边界

OpenClaw 的多 Agent 不是简单“多个 prompt”。官方 multi-agent 文档把 agent 定义为完整作用域：workspace、`AGENTS.md`/`SOUL.md`/`USER.md`、auth profiles、model registry、session store 都属于某个 agent。[3]

默认情况下只有 `main`：

```text
~/.openclaw/workspace
~/.openclaw/agents/main/agent
~/.openclaw/agents/main/sessions
```

启用多 Agent 后，可以有：

```text
~/.openclaw/workspace-coding
~/.openclaw/agents/coding/agent
~/.openclaw/agents/coding/sessions

~/.openclaw/workspace-social
~/.openclaw/agents/social/agent
~/.openclaw/agents/social/sessions
```

这很重要。因为 OpenClaw 的长期记忆、工具权限、模型凭证都不是无状态资源。如果把多个用户或多个角色塞进同一个 agent，session 可以隔离，但记忆和操作权限仍可能串扰。正确做法是用 Gateway 的 routing/bindings 把不同 channel、账号、peer、group 绑定到不同 agent。

### 5. 嵌入式 HTTP Host

Gateway 还提供同端口 HTTP 表面，例如 OpenAI-compatible endpoints、Control UI、Canvas、A2UI 等。README 也提到 OpenClaw 提供 `/v1/models`、`/v1/chat/completions`、`/v1/responses` 等兼容接口，并且 Gateway 是这些 HTTP 接口的统一承载点。[1]

这让 OpenClaw 可以被其他工具当成后端调用，而不是只能通过聊天平台使用。

### 6. 配置热重载不是简单 watch 文件

Gateway runbook 里提到默认 reload 模式是 `hybrid`：能热应用的配置直接替换运行时快照，需要重启的变更才触发重启。[9] 这点和本地优先架构关系很大。OpenClaw 的配置不是一次性启动参数，而是控制平面状态的一部分：

```text
~/.openclaw/openclaw.json
  -> Gateway 监听配置文件
  -> 成功解析后原子替换 in-memory config snapshot
  -> Channel 根据 reload.configPrefixes 决定是否局部重启
  -> 需要服务级变更时交给 supervisor / gateway restart 路径
```

这避免了两个极端：一端是“所有配置都要重启 Gateway”，另一端是“不管什么配置都热改导致状态不一致”。OpenClaw 把 reloadability 变成插件和核心共同声明的能力。

---

## 三、Session Key：把“谁在说话”和“从哪里来”统一起来

OpenClaw 的 Channel 和 Client 是两类正交概念：

- Client 是操作端，例如 TUI、Control UI、移动端节点、WebChat、自动化程序。
- Channel 是消息线路，例如 Telegram、Discord、Slack、QQ Bot、飞书、WhatsApp。

两者最终都落到 Session Key 上。Session Key 的直觉格式是：

```text
agent:{agentId}:{scope}
```

常见例子：

```text
agent:main:main
agent:main:telegram:bot1:direct:user456
agent:support:discord:acc1:group:123456789
agent:main:qqbot:default:direct:207A5B83...
```

这个设计解决了一个实际问题：同一个用户可以在 Telegram 里开始一段对话，然后在 WebChat 或 TUI 中看到并接管它；也可以让来自不同频道、不同账号、不同群组的消息落到不同 agent。

多 Agent 路由的本质是对 Session Key 前半部分做决策：这条消息应该进入 `agent:main:*`，还是 `agent:support:*`，还是 `agent:dev:*`。

官方 multi-agent 文档强调 bindings 是确定性的，且最具体匹配优先。peer、parentPeer、guild、team、account、channel 等维度都可以成为路由条件。[3]

这使 OpenClaw 能支持几类复杂场景：

| 场景 | 设计方式 |
| --- | --- |
| 一个 Gateway 管多个角色 | 每个角色一个 agent workspace |
| 一个 WhatsApp 账号服务多个人 | 按 peer 绑定到不同 agent |
| 工作群和私人 DM 风格不同 | group/peer 绑定不同 agent |
| 同一 agent 多端操作 | 不同 Client 连接同一 Gateway 并访问同一 session |

这里的关键判断是：Session Key 是路由控制，不是安全边界。OpenClaw 的 SECURITY 文档明确说明 session identifiers 是 routing controls，不是 per-user authorization boundaries。[4] 所以真正需要强隔离时，应该用不同 gateway、不同 OS user、不同 host，至少也要拆 agent/workspace/credential。

从实现角度看，Session Key 至少承担三层语义：

| 层 | 作用 | 例子 |
| --- | --- | --- |
| Agent 前缀 | 决定进入哪个 agent 的 workspace/session store | `agent:dev:*` |
| Channel scope | 记录消息来自哪个平台和账号 | `telegram:bot1`、`discord:acc1` |
| Conversation scope | 私聊、群、线程、父会话继承 | `direct:user456:thread:msg789` |

这也是为什么 Channel Plugin 需要 `messaging.resolveSessionConversation(...)` 之类的 hook。不同 IM 平台的“线程”并不是同一种东西：Telegram forum topic、Slack thread_ts、Discord channel/thread、飞书群聊和 QQ 私聊都需要先归一化，Gateway 才能做统一路由。

---

## 四、插件系统：为什么 Channel Plugin 不是简单 send/recv

OpenClaw 的 VISION 文档说，核心应该保持 lean，能力通常应作为 plugins 扩展；如果有能力不能用插件实现，优先扩展 Plugin API，而不是把一次性逻辑塞进 core。[5]

这解释了为什么 OpenClaw 的插件系统很重。它不是只为了“发消息”，而是为了把多个维度都交给插件声明：

- Channel：Telegram、Discord、Slack、QQ Bot、飞书、WhatsApp 等消息接入。
- Provider：OpenAI、Anthropic、Google、DeepSeek、Ollama、Bedrock 等模型提供商。
- Tool：Browser、搜索、文件、Canvas、节点能力、外部 API。
- Memory：memory-core、memory-lancedb、QMD 等记忆后端。
- Infra：诊断、Prometheus、OpenTelemetry、策略、迁移、插件管理。

Channel Plugin 尤其能体现这种复杂度。官方 Channel Plugin 文档明确指出，新插件不需要自己暴露 send/edit/react 工具；OpenClaw core 保留一个共享 message tool，而插件负责配置、DM 安全、pairing、session grammar、outbound、threading、typing 等平台差异。[6]

这和简单 Bot SDK 很不一样。一个成熟 Channel Plugin 至少要回答：

1. 怎么配置和登录？
2. 谁可以 DM 这个 bot？
3. 群聊、私聊、线程如何映射成 Session Key？
4. 平台原生如何发送 text、media、poll、reaction？
5. LLM 流式输出在这个平台怎么呈现？
6. Exec approval 是否能在这个 channel 原生展示？
7. 热重载时哪些配置变更需要重启 channel？

以流式输出为例，Telegram 可以反复 edit 同一条消息，Discord 有 interaction/follow-up 语义，Slack 有 block/message 更新，QQ/飞书又有自己的限制。OpenClaw 把这些差异交给 Channel 适配器，而不是让 Agent Runtime 到处写 if/else。

插件系统的代价是可信计算基变大。SECURITY 文档也说得很清楚：plugins/extensions 是 Gateway 的 trusted computing base，安装或启用插件就等同于授予本地代码在 Gateway host 上运行的信任。[4] 所以插件生态越强，插件分发、签名、扫描、allowlist、doctor 检查就越重要。

### ChannelPlugin 的真实接口密度

源码 `src/channels/plugins/types.plugin.ts` 里的 `ChannelPlugin` 契约能说明 OpenClaw 为什么不是轻量 Bot wrapper。一个插件除了必选的 `id`、`meta`、`capabilities`、`config`，还可以声明：

| 适配器 | 解决的问题 |
| --- | --- |
| `setupWizard` / `setup` / `configSchema` | 安装、配置 UI、环境变量和校验 |
| `pairing` / `security` / `allowlist` | DM pairing、allowlist、触发授权 |
| `outbound` / `message` / `streaming` | 文本、媒体、投票、live preview、平台流式呈现 |
| `messaging` / `threading` / `mentions` | 会话 grammar、线程、mention 解析 |
| `gateway` / `gatewayMethodDescriptors` | 插件向 Gateway 暴露 RPC 方法及 scope |
| `approvalCapability` / `elevated` | 原生审批、提权能力和审批 UI |
| `agentTools` / `actions` / `directory` | Channel 反向给 Agent 提供工具和组织目录能力 |
| `reload` / `doctor` / `status` | 精细热重载、自诊断和运行状态 |

这里的架构边界很清楚：core 不应该知道“Slack 怎么 pin message”或“Telegram 怎么 edit preview”，它只知道插件声明了哪些 message/action/approval 能力。相反，插件也不应该自己重新实现一套 agent loop，它只把平台语义映射到 OpenClaw 的统一 contract。

---

## 五、Agent Runtime：编排、容错和预算

OpenClaw 的 Agent Runtime 不应该理解成“一个 while 循环调模型”。它的核心职责更像生产系统里的执行编排：

```text
调度：这个 turn 走哪个 agent、哪个 lane、哪个 backend
容错：provider/profile/model 失败后怎么恢复
预算：上下文、工具输出、启动文件、循环次数怎么限额
安全：工具调用前后如何审批、截断、审计
```

### 1. 多 backend：模型 API、CLI、ACP 都可以成为执行后端

OpenClaw README 提到支持多模型、多 provider，也有 CLI backend、ACP、MCP 等集成路径。[1] 从源码结构看，Agent 执行可以走几类后端：

- Embedded Provider：直接调用模型 provider SDK/API。
- CLI Provider：把 Claude Code、Codex CLI、Gemini CLI 等本地 CLI 当作执行 backend。
- ACP Provider：通过 ACP 协议把外部 Agent harness 当作模型/agent 后端。

这个设计很现实。很多用户已经登录了 Claude Code 或 Codex CLI，订阅额度、OAuth、工具链都在那里。OpenClaw 不强迫用户把所有能力迁移到自己的模型调用层，而是可以把这些 CLI 当作 backend 驱动。

反过来，OpenClaw 也可以作为别人的 backend：通过 MCP server 暴露消息、审批、附件、事件等待等工具；通过 ACP server 暴露整个 Agent；通过 Gateway HTTP API 暴露底层系统能力。

这就是 OpenClaw 的一个重要工程取舍：它不追求“所有协议都标准化后再接入”，而是用适配层吃掉不同生态的 stdout/json/jsonl/ACP/MCP 差异。

### 一次 agent turn 的执行链路

把一次普通消息展开，大致是：

```text
Channel inbound / Client req:agent
  -> Gateway 校验 connect/auth/scope/idempotency
  -> resolve route 得到 agentId + sessionKey
  -> 进入 command lane + session lane
  -> 加载 session transcript 和 workspace bootstrap
  -> 构建 system prompt / tools / memory recall
  -> runEmbeddedAttempt 或 CLI/ACP backend
  -> LLM stream
  -> beforeToolCall: 审批、allowlist、sandbox/host 决策
  -> tool 执行
  -> afterToolCall: 截断、日志、transcript 写回
  -> assistant final payload
  -> outbound pipeline 分块、格式化、投递回 Channel
```

这条链路里有两个“锁”特别关键：全局 command lane 控制不同任务来源的并发，session lane 保证同一会话的 turn 不会同时写 transcript 和 workspace 状态。OpenClaw 不是把所有请求都并行跑满；它更像数据库事务那样，按状态冲突粒度串行化。

### 2. Auth Profile 先于 Model Fallback

模型调用失败时，OpenClaw 不是简单 retry。官方 model failover 文档说明，它分两阶段处理：先在当前 provider 内做 auth profile rotation，再按 configured fallback 切换模型。[7]

Auth profile 不只是 API key 数组，而是带状态的凭证对象。它记录 OAuth/API key、lastUsed、cooldown、disabled、错误计数等。选择顺序大致是：

```text
显式 auth.order
  -> configured profiles
  -> stored profiles
  -> OAuth 优先于 API key
  -> 同类型按 lastUsed 轮转
  -> cooldown/disabled 排后
```

这带来一个很实际的效果：如果某个账号 rate limit，OpenClaw 可以把它临时冷却，切到下一个 profile；如果同模型所有 profile 都不可用，才进入 model fallback。

它也保留了用户显式选择的语义。如果用户手动 `/model` 指定某个 provider/model，这通常被视为严格选择，失败时不应该悄悄换成完全不同的模型回答。

源码层面，失败不是普通字符串，而是结构化 `FailoverError`。`src/agents/failover-error.ts` 里定义了 `reason`、`provider`、`model`、`profileId`、`status`、`code`、`sessionId`、`lane` 等字段。`resolveFailoverStatus()` 把 `billing` 映射到 402、`rate_limit` 到 429、`overloaded` 到 503、`auth` 到 401、`auth_permanent` 到 403、`timeout` 到 408、`model_not_found` 到 404、`session_expired` 到 410。

这个结构化错误是 Runtime 和 fallback layer 的契约。它的价值是：上层不需要猜“这段错误文本是不是限流”，而是根据闭合 reason 决定是换 profile、冷却账号、刷新 OAuth、切模型，还是直接向用户暴露错误。

### 3. 上下文压缩不是一个按钮，而是多级预算系统

OpenClaw 对预算的处理比很多 Agent 框架细。它不仅关心 context window，还关心启动文件、工具结果、循环次数、压缩尝试次数、凭证 cooldown、lane 并发、subagent 深度等资源。

典型的上下文预算包括：

- 运行前主动 compaction。
- 首 token 超时且 prompt 占比过高时触发压缩。
- provider 返回 context overflow 后再尝试压缩或截断。
- 单次工具输出做软限和硬限，避免一个工具结果吞掉全部上下文。
- Bootstrap 文件按单文件和总字符预算裁剪，并把裁剪警告注入 prompt，让 Agent 知道自己看到的上下文可能不完整。

这类设计的核心不是“节省 token”，而是让失败路径可证明。每个预算超限都对应明确降级动作，而不是等模型报错后让 LLM 自己猜该怎么办。

更具体一点，`src/agents/embedded-agent-runner/run/preemptive-compaction.ts` 的 pre-prompt 检查会先算出：

```text
contextTokenBudget = floor(model.contextWindow)
requestedReserveTokens = max(0, reserveTokens)
minPromptBudget = min(8000, contextTokenBudget * 0.5)
effectiveReserveTokens = min(requestedReserveTokens, contextTokenBudget - minPromptBudget)
promptBudgetBeforeReserve = contextTokenBudget - effectiveReserveTokens
overflowTokens = estimatedPromptTokens - promptBudgetBeforeReserve
```

这个公式防止一个错误配置把 output reserve 设得太大，导致 prompt 完全没有空间。无论 reserve 配得多激进，prompt 至少保留 `min(8000 tokens, 50% context)`。

接着它不是只返回“是否压缩”，而是返回四种 route：

| route | 触发条件 | 动作含义 |
| --- | --- | --- |
| `fits` | 估算 prompt 能放下 | 不压缩 |
| `compact_only` | 溢出且没有可裁剪工具结果 | 压缩历史 |
| `truncate_tool_results_only` | 工具结果可裁量足够覆盖溢出 | 只裁工具输出 |
| `compact_then_truncate` | 两者都需要 | 先压缩，再裁工具输出 |

另一个细节是 token 估算的安全边际。`src/agents/compaction-planning.ts` 里 `SAFETY_MARGIN = 1.2`，也就是估算 token 会乘 20% buffer。原因很简单：静态估算通常不是精确 tokenizer，代码、CJK、多字节字符和特殊 token 都可能导致低估。低估一次就可能让 provider 报 context overflow。

工具输出也有单独的硬约束。`src/agents/embedded-agent-runner/tool-result-truncation.ts` 中：

- 单个 tool result 不应超过 context window 的 30%。
- 默认 live tool result 上限是 16,000 字符。
- 大 context 模型可提升到 32,000 或 64,000 字符。
- 截断时至少保留开头 2,000 字符。
- 如果尾部含 `error`、`exception`、`traceback`、`panic`、`summary`、JSON 结束结构等信号，则采用 head + tail 保留，避免把真正有用的错误栈裁掉。

这类细节决定了 Agent 是否能稳定跑生产任务。很多 Agent 出问题不是模型不会推理，而是一个 `npm test` 输出 100K 字符后把上下文冲爆，或者把最后的错误栈截没了。

### 4. Lane：避免 Cron、子 Agent 和用户对话互相拖死

OpenClaw 把不同来源的任务放到不同 lane：普通对话、nested、subagent、cron 等。这样 cron 任务堆积不会阻塞用户实时对话；子 Agent 的并发也不会直接抢占主会话。

对个人 Agent 来说，这一点很关键。一个真正常驻的助手会同时做很多事：收消息、执行计划任务、等待审批、跑记忆整理、响应用户即时提问。如果所有任务只进一个全局队列，系统很快就会在某个长任务上卡住。

`src/process/lanes.ts` 里目前的基础 lane 是：

```ts
Main = "main"
Cron = "cron"
CronNested = "cron-nested"
Subagent = "subagent"
Nested = "nested"
```

`src/gateway/server-lanes.ts` 会根据配置设置 `Cron`、`CronNested`、`Main`、`Subagent` 的并发。Cron isolated agent 内部的 LLM work 会映射到 `CronNested`，避免 cron 任务自己递归占满普通 nested 执行槽。这是一个很工程化的设计：不是泛泛说“支持并发”，而是把不同来源的任务预算分开。

### 5. Bootstrap Budget：让 Agent 知道自己没看全

OpenClaw 的 workspace bootstrap 不是无脑把所有 Markdown 都塞进 system prompt。`bootstrap-budget.ts` 会分析哪些文件接近限制、哪些被截断，并通过 `appendBootstrapPromptWarning()` 把警告注入 prompt：

```text
[Bootstrap truncation warning]
Some workspace bootstrap files were truncated before injection.
Treat Project Context as partial and read the relevant files directly if details seem missing.
```

这个设计很关键。截断不可怕，可怕的是模型不知道自己看到的是截断版。OpenClaw 把“上下文不完整”变成模型可见事实，促使 Agent 在需要精确信息时主动读取原文件，而不是基于半截 `AGENTS.md` 或 `MEMORY.md` 做判断。

---

## 六、记忆系统：从静态文件到 Dreaming

OpenClaw 的记忆设计可以分成三层。

第一层是 workspace 静态文件：

```text
SOUL.md
USER.md
MEMORY.md
AGENTS.md
TOOLS.md
IDENTITY.md
```

这些文件在启动或构建 prompt 时进入 Agent 上下文，用来定义人格、用户画像、项目约定和长期记忆。

第二层是 daily memory / recall layer：

```text
workspace/memory/YYYY-MM-DD.md
workspace/memory/YYYY-MM-DD-something.md
```

这些文件更像原始日记或短期笔记，通常不应该每轮全量注入，而是通过 memory search、active recall 或工具调用按需拉取。

第三层是 Dreaming。官方 dreaming 文档说明，Dreaming 是 `memory-core` 的后台记忆整合系统，默认关闭，需要 opt-in。它有 Light、REM、Deep 三个协作阶段：Light 负责整理短期材料，REM 负责提取主题和反思信号，Deep 负责评分并把可靠候选晋升到 `MEMORY.md`。[8]

这套机制最值得关注的是“晋升门槛”。Dreaming 不是看到一句话就写入长期记忆，而是根据频率、相关性、query 多样性、时间新鲜度、多天复现、概念丰富度等信号加权，且 Deep 阶段才是唯一写 `MEMORY.md` 的路径。

这解决了长期记忆系统最危险的问题：记得太多和记错一样糟糕。`MEMORY.md` 是每轮可见的静态层，一旦被错误写入，就会污染后续所有对话。所以 Dreaming 默认关闭，是一个合理的工程取舍。

不过这里仍然要强调边界：OpenClaw 的记忆按 Agent 隔离，而不是按每个消息发送者隔离。同一 Agent 下多个用户共享 memory/workspace。这和 SECURITY 文档中的 one-user trust model 是一致的。[4] 如果是多用户或不同信任域，应该拆 agent，甚至拆 gateway/host。

### Dreaming 的评分不是玄学

`extensions/memory-core/src/short-term-promotion.ts` 里，Deep 阶段的默认晋升门槛非常具体：

```text
minScore = 0.75
minRecallCount = 3
minUniqueQueries = 2
```

评分由六个基础信号组成：

```text
score =
  0.24 * frequency
+ 0.30 * relevance
+ 0.15 * diversity
+ 0.15 * recency
+ 0.10 * consolidation
+ 0.06 * conceptual
+ phase boosts
```

其中 `frequency` 是出现次数，`relevance` 是召回质量，`diversity` 是不同 query/day 触发，`recency` 是时间衰减，`consolidation` 是多天复现强度，`conceptual` 是概念标签密度。Light 和 REM 阶段还会写 `memory/.dreams/phase-signals.json`，Deep 排名时再加小幅 boost：Light 最高 +0.06，REM 最高 +0.09。

这个设计比“用户说记住就永久写入”更保守。它要求同一条信息被不同上下文重复召回，并且近期仍有价值，才有资格进入每轮可见的 `MEMORY.md`。这也解释了为什么 Dreaming 默认关闭：长期记忆是高杠杆状态，错误晋升会污染之后的所有 turn。

---

## 七、安全模型：强默认值，但不是多租户沙箱

OpenClaw 的安全设计容易被两边误读。

一种误读是“它本地运行，所以天然安全”。这不对。OpenClaw 能执行命令、读写文件、操作浏览器、调用消息平台，它的能力越强，风险面越大。

另一种误读是“它有审批和沙箱，所以适合多人共享”。这也不对。SECURITY 文档反复强调，OpenClaw 是 trusted-operator personal assistant，不把一个 Gateway 视为多个互不信任用户之间的强隔离边界。[4]

更准确的理解是：

| 机制 | 解决什么 | 不解决什么 |
| --- | --- | --- |
| loopback 默认绑定 | 减少意外公网暴露 | 不能替代远程访问鉴权 |
| device pairing | 管理 Client/Node 身份 | 不把同一 Gateway 内用户变成互不信任租户 |
| shared-secret / trusted-proxy | 保护 Gateway 接口 | token 持有者仍是 trusted operator |
| exec approval | 降低危险命令误执行 | 不是完整解释器语义模型 |
| sandbox mode | 限制非 main session 工具能力 | 默认 main 仍偏 host-first |
| plugin allowlist/doctor | 降低插件供应链风险 | 已安装可信插件仍是 TCB |

README 中也明确提醒：OpenClaw 连接真实消息面，入站 DM 应视为 untrusted input；公开 inbound DM 需要显式 opt-in；运行 `openclaw doctor` 可以检查风险配置。[1]

所以 OpenClaw 的安全哲学不是“完全禁止能力”，而是把高风险路径变成显式选择：默认 loopback、默认 pairing、默认审批、可配置 sandbox、插件可审计、doctor 可修复。

这和 VISION 中那句设计原则一致：强默认值，但不杀死能力。[5]

---

## 八、和 Hermes、Claude Code、OpenCode 的差异

为了更清楚地看 OpenClaw，可以把它和几类相邻项目对比。

| 项目类型 | 核心场景 | OpenClaw 的差异 |
| --- | --- | --- |
| Claude Code / Codex CLI | 编程工作区内的 coding agent | OpenClaw 面向长期个人助手和多消息通道，也能把 CLI 当 backend |
| OpenCode | C/S 分离的开源 coding agent | OpenClaw 的中心是 Gateway 和 Channel，而不是项目目录 |
| Hermes 这类单体 Agent | 单 Agent + 工具循环 | OpenClaw 更强调 Gateway、多 Agent 路由、插件契约、设备节点和安全控制面 |
| 普通聊天 Bot | 平台消息收发 | OpenClaw 把 Bot 通道变成 Agent 的触达层，而非产品本体 |

OpenClaw 最有价值的不是某个单点功能，而是这些能力被放在同一个控制平面里：

- 一个 Gateway 管多个 Channel。
- 一个 Gateway 管多个 Agent。
- 一个 Agent 有自己的 workspace、sessions、auth profiles、memory。
- Channel 既是收发线路，也能反向给 LLM 提供平台工具。
- CLI、MCP、ACP、HTTP API 让 OpenClaw 既能调用别人，也能被别人调用。

这就是它的架构野心：不是替代所有工具，而是成为个人 Agent 的本地编排层。

---

## 九、我对这个项目的判断

OpenClaw 的优势很明确：

1. **边界清晰**：Gateway 做控制面，插件做能力面，Agent Runtime 做执行编排。
2. **本地优先**：状态、配置、会话、记忆默认在本机，符合个人助手的隐私直觉。
3. **集成现实主义**：不要求所有外部工具迁移到统一标准，可以直接适配 CLI、MCP、ACP、HTTP。
4. **安全意识强**：文档中对 trusted operator、plugin TCB、prompt injection 非边界等问题讲得很清楚。
5. **长期记忆有工程约束**：Dreaming 默认关闭、Deep 阶段才写入长期记忆，避免“什么都记”的污染。

它的代价也同样明显：

1. **复杂度高**：Gateway、Channel、Plugin SDK、Runtime、Memory、Security 全部展开后，学习曲线很陡。
2. **插件信任压力大**：能力越插件化，供应链和本地执行风险越需要治理。
3. **不是 SaaS 多租户模型**：如果想做公共 Bot 服务，不能把“多用户发消息”误认为“多用户安全隔离”。
4. **运行时状态多**：`~/.openclaw` 下配置、workspace、agentDir、sessions、auth profiles、memory 都要理解清楚。

所以我会把 OpenClaw 看成一个“个人 AI 助手基础设施”，而不是普通应用。它适合愿意掌控本地环境、理解权限风险、想把多个消息入口和自动化工具接到同一个 Agent 上的人。它不适合直接拿来当多人共享的无边界公网 Bot。

如果只记住一句话：**OpenClaw 的核心不是让 LLM 说话，而是给 LLM 一个本地、可路由、可审计、可扩展的行动平面。**

---

## 参考资料

[1] OpenClaw README: https://github.com/openclaw/openclaw/blob/main/README.md

[2] OpenClaw Gateway architecture: https://github.com/openclaw/openclaw/blob/main/docs/concepts/architecture.md

[3] OpenClaw Multi-agent routing: https://github.com/openclaw/openclaw/blob/main/docs/concepts/multi-agent.md

[4] OpenClaw Security Policy: https://github.com/openclaw/openclaw/blob/main/SECURITY.md

[5] OpenClaw Vision: https://github.com/openclaw/openclaw/blob/main/VISION.md

[6] OpenClaw Channel Plugin docs: https://github.com/openclaw/openclaw/blob/main/docs/plugins/sdk-channel-plugins.md

[7] OpenClaw Model failover: https://github.com/openclaw/openclaw/blob/main/docs/concepts/model-failover.md

[8] OpenClaw Dreaming: https://github.com/openclaw/openclaw/blob/main/docs/concepts/dreaming.md

[9] OpenClaw Gateway runbook: https://github.com/openclaw/openclaw/blob/main/docs/gateway/index.md

[10] TechRadar, What is OpenClaw: https://www.techradar.com/pro/what-is-openclaw
