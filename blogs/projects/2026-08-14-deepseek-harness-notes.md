# DeepSeek Harness 解读：Harness 的真正分歧，是“什么能被改”

harness 项目越来越多，功能清单却越长越像：多模型支持、工具调用、上下文压缩、权限审批、技能系统……把几个主流项目的 README 摆在一起，很难看出本质差别。

我想换一个问法：**在不改源码的前提下，一个 harness 里有哪些东西是你能换掉的？**

这个问法会引出本文使用的概念：**可修改边界**。每个 harness 都有这样一条边界——边界之内随便改（配置、插件、技能），边界之外动不了，想动只能 fork 源码。harness 之间的区别不在功能多少，而在于这条边界画在哪里，以及它是谁画的——是官方恩赐的扩展点，还是架构本身允许的替换。（本文基于 dsh developer preview 源码与文档的阅读整理。）

把“能改多深”排成一条线：

```text
prompt / skills / 长期记忆
  → 工具注册
  → LLM 配置与模型适配
  → agent loop（调度、轮次控制、压缩策略、skills 触发）
```

越往下，允许你碰的 harness 越少。全文就是沿这条线走一遍：主流 harness 都停在 loop 之前，而 DeepSeek Harness（`dsh`）用一个叫 Cordis 的插件框架把边界推到了最右边——这恰好为自进化 agent 打开了目前无人触碰的那一层。

---

## 一、先有一张零件图：harness 由哪些层组成

在[《从模型到 Agent 服务：Harness 解决了哪些问题》](category.html?category=tech&post=2026-07-20-agent-harness)里，我把 harness 整理成模型的控制层：模型负责在不确定信息中推理，harness 负责状态、校验、上下文、执行与安全边界，把智能约束成一个可以长期运行的服务。这里不再展开，直接给出本文使用的零件图：

| 层 | 管什么 |
| --- | --- |
| UI / 入口 | Web、CLI、API 等入口形态 |
| agent loop | 调度、轮次控制、上下文压缩策略、skills 触发 |
| 工具注册与执行管线 | 工具定义、权限闸门、执行分发与结果处理 |
| 模型适配 | LLM 配置、provider、消息与流协议 |
| 会话状态与持久化 | 会话事件日志与落地存储 |
| 安全 / 沙箱 / 审批 | 文件与进程边界、权限预设、人工审批 |

后面所有讨论都以这张表为坐标系，问题只有一个：每一层，哪些 harness 允许你改？

---

## 二、主流 harness 的边界：都停在 loop 之前

以本地仓库为样本，逐个核对各项目的 README 与文档，得到这张总表（“边界停在哪”一列使用第一节的分层）：

| Harness | 可改面 | 边界停在哪 | 边界谁画的 |
| --- | --- | --- | --- |
| Claude Code | hooks、MCP、skills、slash commands、plugins、output styles、自定义 agents | agent loop 之前 | 官方 |
| Codex | hooks（11 种生命周期事件）、插件市场、skills、slash commands、AGENTS.md、MCP、配置 | agent loop 之前 | 官方 |
| OpenClaw | 约 150 个 extensions、插件 hooks、skills、MCP、channels | agent loop 之前 | 官方 |
| Hermes Agent | plugins（生命周期 hooks / 工具 / middleware）、skills、providers | agent loop 之前 | 官方（明文禁止插件改核心文件） |

逐个说几句。

Claude Code 的扩展点是最齐全的：hooks 覆盖 PreToolUse、PostToolUse、UserPromptSubmit、SessionStart、PreCompact、Stop 等生命周期，可以拦截工具调用、影响控制流；MCP、skills、slash commands 是标配；此外还有 plugins（带市场）、output styles、自定义 agent 定义。但 loop 本体是封闭的——所有扩展点都挂在生命周期的缝隙上，每一个都是官方开好的门。

Codex 是最反直觉的样本。它由近百个 crate 组成 workspace，并非想象中的“Rust 单体”；扩展面也早已超出 MCP 和配置：hooks 系统带 11 种事件 schema（permission-request、pre-tool-use、pre-compact、session-start、stop 等），插件 manifest 可以把 skills、MCP servers、apps、hooks 打包在一起分发，另有 AGENTS.md、threads、官方 SDK。这恰好印证了本文的论点：**扩展点可以很多，loop 的边界依然固定**。而且 `requirements.toml` 里一行 `allow_managed_hooks_only = true`，管理员就能关掉所有非受管 hooks。

OpenClaw 的 extensions 目录挂着约 150 个包：模型 provider、消息渠道、能力组件；插件 SDK 提供 `before_model_resolve`、`before_prompt_build`、`before_agent_reply`、`before/after_compaction`、`before/after_tool_call` 等 hooks。loop 本身是固定流水线：intake、context assembly、model inference、tool execution、streaming、persistence——hooks 可以在流水线各站等候，但流水线本身没得商量。

Hermes Agent 给自己的定位是一句话：“The core is a narrow waist; capability lives at the edges.”（核心是窄腰，能力长在边缘。）插件可以注册生命周期 hooks、工具和 CLI 子命令；它的 middleware 机制还能改写 LLM 请求参数、包裹工具执行——这已经是所有样本里最接近 loop 的官方口子。但项目规则同样写得很明白：plugins MUST NOT modify core files。loop 是开源的，却在制度上固定。

横向看，模式高度一致：**固定内核 + 官方恩赐的扩展点**。hooks 能挂在哪些站、插件能注册什么，都有固定槽位。扩展面可以很宽——Codex 证明了——但面宽和边界移动是两回事。想越过边界（改压缩策略、改工具管线、改 loop 的行为），路只有一条：fork。

现在看 dsh。它的 README 自称 “everything is a plugin”。口号谁都会喊，凭什么它做得到？

---

## 三、Cordis：让“一切可换”成为可能的四个问题

Cordis 是 dsh 内置（vendored）的插件框架。一句话总体类比：**Cordis 把整个 harness 变成一块插线板，每个零件都是电器，插上就能用，拔掉不留痕**。

不堆概念，换个问法：如果你想让每个零件都可替换，框架必须解决哪些问题？每个问题对应 Cordis 的一个机制。

**问题 1：零件之间怎么互相找到对方？**

如果 A 直接 import B 的实现，B 就永远换不掉了——依赖在编译期被钉死。Cordis 的做法：每个能力在 context（上下文，即服务仓库）上注册一个稳定的名字，如 `ctx.tools`、`ctx.llm`、`ctx.sessions`；使用者只认名字，不认实现。primer 原话：“other plugins find services via key instead of importing a concrete implementation.”

一句话：**按名字找服务，是“可替换”三个字的根源。**

**问题 2：零件这么多，谁先启动谁后启动？**

手写启动顺序，一定会随插件增多而崩溃。Cordis 的做法：插件用 `inject` 声明“我需要什么”，框架等依赖就绪才让它启动。启动顺序来自依赖声明，不来自人的安排。

一句话：**顺序来自依赖声明，不来自人的安排。**

**问题 3：零件之间怎么协作？想在中间插一手怎么办？**

Cordis 的做法：类型化事件，四种派发模式各司其职——`emit`（只旁观）、`parallel`（并发通知）、`serial`（串行接力）、`waterfall`（层层包裹）。其中 waterfall 就是环绕中间件（around-middleware）：监听器收到 `(...args, next)`，调用 `next()` 把（可能被改写过的）结果交给下一个监听器，不调用直接返回就是短路。

在 dsh 里，`agent/pre-step`、`agent/request`、`llm/stream`、`tools/pre-execute` 等关键事件都是 waterfall。也就是说，拦截一次模型请求、改写一次工具调用、拒绝一次执行，都是标准姿势，不需要官方专门开口子。官方 cookbook 里的权限闸门示例：

```ts
export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}
```

不调 `next()` 直接返回就是短路拒绝。这不是权限场景的专用 API，而是任何插件在任何 waterfall 事件上的通用姿势。

一句话：**插一手不需要官方开口子，事件系统本身就是口子。**

**问题 4：零件拔掉后，怎么做到像没来过？**

插件装过的东西——prompt 段、工具 schema、监听器——如果卸载后残留，换插件就是灾难。Cordis 的做法：所有注册都是可逆 effect（可回卷的副作用），通过 `ctx.effect()` 或 `ctx.on()` 安装，插件卸载时自动回卷。architecture.md 原话：“registrations are effects that unwind when their plugin unloads.”

一句话：**这是“行驶中换零件”的前提。**

这四个答案合起来，恰好就是 README 里那篇论文的标题所说的——“spatiotemporal composability”（时空可组合性）：空间上，任意插件并排挂载；时间上，随时装卸、可预测回滚。而 dsh 最关键的事实是：**它没有自己的内核**。你看到的 dsh，就是这个框架组合出来的一个实例。

机制讲完了，看实物——dsh 到底有没有偷偷藏一个特权内核？

---

## 四、实物检查：dsh 里真的没有特权内核

对照第一节的零件图逐层验证，引文来自 architecture.md 与各包配置。

**agent loop**。核心包表里 `core/agent-loop` 一行的描述是 “The default driver implementing that interface”——agent loop 只是 `Agent` 接口的一个默认实现，注册名 `ctx.agentLoop`。在 base bundle 的配置里，它就是一行普通配置：

```yaml
- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  config:
    agents: []
```

而 `dsh --profile web --dump-config` 会打印出所有这样的行，文档原话：“Any row it prints can be replaced by a patch of your own.”

**工具注册、模型适配、system prompt、会话日志**。全部是插件，各有 ctx 名字与包名：`@deepseek-ai/dsh-tools`（`ctx.tools`）、`@deepseek-ai/dsh-llm`（`ctx.llm`，其下 dsh-llm-deepseek 等 adapter 也是插件）、`@deepseek-ai/dsh-system-prompt`（`ctx.systemPrompt`）、`@deepseek-ai/dsh-session`（`ctx.sessions`）。

**压缩**。`dsh-compaction-basic` 与 `dsh-compaction-tool-result-pruner` 是独立插件。文档还特意说明，压缩是 “one optional capability, not part of the agent-loop spine”——它甚至不是 loop 的一部分。

**UI / 入口**。`dsh-web-app` 是一个四百多行配置行的 bundle，每个 UI 组件一行，注释里直接写着 “Remove this entry to turn the surface off”。官方 headless profile 就是 `dsh-base` + `dsh-headless`，即“整个去掉 web-app”；树外 TUI 插件 turtle-ui 则用 `dsh plugin` 一条命令安装。

**安全 / 沙箱 / 审批**。`approval`、`permission`、`sandbox`、`sandbox-policy` 全是 base bundle 里可 patch 的配置行；read-only / workspace-write / danger-full-access 三档权限预设，只是这些行的不同组合。repo 里还有一个 E2B 示例：一份配置 overlay 禁用本地 subprocess 与文件系统 provider，换上 E2B 远端沙箱的行，Bash、PTY、LSP 整体跟着走。这就是 capability seam（能力接缝）机制，architecture.md 原话：“Seams are why one provider swap changes the whole product. Filesystem and subprocess providers share one execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP with them, with no provider forks.”

**会话持久化**。持久化后端是一个 capability seam（`ctx.sessionPersistence`），JSONL 与 SQLite 两个后端可互换，“apps choose a backend at composition time”。但注意：append-only 的会话事件日志本身（`ctx.sessions`）是固定核心，没有替代实现。

组合方式是三层：**profile**（命名组合）叠 **bundle**（分发格式），再用 **patch** 逐行覆盖；应用顺序是 profile 列出的各 bundle、profile 的 `cordis.patch.yml`、home 级 patch、`--patch` overlay。`--dump-config` 打出的每一行，都能被你的 patch 替换。

### 边界没有消失，只是被往后推了一层

说到这里，应该回答那个最尖锐的问题：所谓“一切皆插件”的边界，不也是 Cordis 作者画的吗？

是的。ctx 键的命名、四种派发模式、可逆 effect 的语义，都由框架决定，想改这层得 fork Cordis。而且 dsh 故意钉死了几条不可换的安全不变量：会话事件日志 append-only；工具 guard 单调只拒——文档原话 “no guard can force-allow a call another guard denied”，任何插件可以拒绝，但没有插件能解除别的插件的拒绝；沙箱 fail-closed，静默放行永不合法。

所以准确的表述是：**边界没有被消灭，而是被推到了一层薄而稳定的框架层和几条安全不变量上**，在这之上的一切可换。这正是它与“官方恩赐的扩展点”的区别：后者的边界是一份随时可以增减的产品决策；前者的边界是架构决策，边界之上，官方与第三方站在同一起跑线。

所有可换的零件里，有一个的分量远超其他所有：agent loop。

---

## 五、loop 可换，对自进化意味着什么

先声明：前四节是事实核对，这一节是个人推论。

回到开头的 spectrum，换个视角：这条“可修改边界”，恰好也是自进化 agent 的**进化边界**——边界允许改到哪一层，进化就能走到哪一层。

现状可以分三层（延伸[《Hermes Agent 自进化机制解读》](category.html?category=projects&post=2026-06-20-hermes-agent-self-evolution)里的认知资产框架）：

- **第一层：认知资产**。多数自进化 agent 停在这里：system prompt、skills、长期记忆。Hermes 把任务经验反写进 MEMORY.md / USER.md 和 skills；nanobot 的 Dream 在后台周期性固化记忆与技能（见[《nanobot 源码解读》](category.html?category=projects&post=2026-06-07-nanobot-notes)）。改写都落在外部文件上，可审计、可回滚。
- **第二层：工具注册表与 LLM 配置**。能碰的很少，偶尔能碰，也多是产品预设的切换，而不是 agent 自己的决定。
- **第三层：agent loop**。压缩算法、窗口控制、工具调用方式、skills 触发——几乎没人碰。原因很简单：在固定内核架构里，进化到这一层等于 fork 自己；而 fork 出来的进化结果无法以配置形式回到原生态，审计与回滚都无从谈起。

dsh 的位置是：这一层全是插件。自进化理论上可以从“改写认知资产”，升级到“以 patch 配置或挂载插件的方式改写自己的行为机制”——换一个压缩策略是一行 patch，换一种工具触发方式是替换一个插件。而且这种改写天然是配置级的（patch 文件即改动本身）、可审计的（session log 记录发生的事）、可回滚的（effect unwind 是框架保证）。

但也要把推论的边界说清楚：**插件化只是拆掉了架构障碍**。什么时候换、谁来决定、换完如何验证更好、如何防止把自己改坏，dsh 都没有回答。它提供的是进化可以触及 loop 层的可能性，不是已实现的进化机制。这是可能性，不是事实。

把可能性说清楚之后，也要把代价说清楚。

---

## 六、代价

dsh 的代价写在 README 里：

- **Developer preview**。README 大写警告：“THERE WILL BE COMPATIBILITY-BREAKING CHANGES.” 本文引用的细节可能几个月后就过时。
- **概念门槛**。服务、inject、四种派发模式、可逆 effect、profile / bundle / patch——写第一个插件之前，你得先接受这一整套词汇。
- **调试责任转移**。“一切可组合”的另一面是：出了问题，配置树就是你的调试对象。框架语义有人保证，你的组合语义只有你自己保证。

---

## 结语

回到开场的问题。harness 的根本区别不在功能多少，而在两件事：**可修改边界画在哪里，以及边界是谁画的**。

主流 harness 是“产品 + 扩展点”：内核固定，官方挖好护城河，扩展面再宽也在护城河以内。dsh 是“组合平台”：内核被溶解进框架，框架之上的一切都是配置行，官方与第三方同场竞技。打个比方：前者是带插件系统的应用，后者更接近一切皆服务的微内核。

留一个开放问题：如果有一天 loop 也能进化，agent 开始改写自己的行为机制，那么 harness 之间比的，可能就不再是功能清单，而是谁的进化闭环更安全——谁来验证，谁来审批，谁来回滚。那是下一个问题了。

---

## 参考资料

1. DeepSeek Harness（developer preview）：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，本文引自 README.md、docs/architecture.md、docs/cordis-primer.md、docs/cookbook/extension-cookbook.md 及各 bundle 配置
2. Cordis 论文：[A Programming Paradigm for Spatiotemporal Composability](https://github.com/cordiverse/paper)
3. Cordis：[cordiverse/cordis](https://github.com/cordiverse/cordis)
4. OpenAI Codex：[openai/codex](https://github.com/openai/codex)，引自 docs/config.md、codex-rs/hooks、codex-rs/plugin
5. nanobot：[HKUDS/nanobot](https://github.com/HKUDS/nanobot)
6. Claude Code：Anthropic 官方文档（hooks、plugins、output styles、自定义 agents）
7. OpenClaw、Hermes Agent、Superpowers：各自仓库 README 与文档
8. [《从模型到 Agent 服务：Harness 解决了哪些问题》](category.html?category=tech&post=2026-07-20-agent-harness)
9. [《Hermes Agent 自进化机制解读：它到底在“自己改写”什么》](category.html?category=projects&post=2026-06-20-hermes-agent-self-evolution)
10. [《nanobot 源码解读：Dream 记忆引擎与自治 Agent 的设计》](category.html?category=projects&post=2026-06-07-nanobot-notes)

*本文基于 DeepSeek Harness developer preview 源码（2026-08-13）与公开文档阅读整理，未实际运行 dsh；其他项目的描述基于其公开文档与仓库源码。*
