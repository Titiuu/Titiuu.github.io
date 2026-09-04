# nanobot 源码解读：Dream 记忆引擎与自治 Agent 的设计

nanobot 是一个 Python 实现的轻量级个人 AI 助手框架。源码读下来，它在几个关键设计上的选择值得仔细看——有些是它独特的贡献，有些是它对已有趋势的工程实现，但合在一起构成了一套自洽的 Agent 设计思路。

这篇文章聚焦四个技术点：

1. **Dream**（两阶段记忆管道 + Ephemeral Mode）：行业里文件记忆方案已经存在（Letta/MemGPT 2025 年基准甚至反超向量方案），但 Dream 独有的 Consolidator→Dream 两阶段管道、属性标签协议、以及 Ephemeral Mode 这套"无痕后台 agent turn"的机制，是其他框架里没见过的组合。
2. **Self Tool**（Agent 自省工具）：主流生产框架（Claude Code、LangChain、CrewAI）里，agent 通常不能主动查询自己跑在第几步、用了多少 token、当前 model 是什么。nanobot 暴露了一个带三层安全边界的 `my` 工具，这在生产框架里是罕见的设计。
3. **Always Skills**（自动注入上下文）：这个模式本身不新鲜——Claude Code 的 CLAUDE.md 也是永久注入。但 nanobot 把"永久注入"做成 skill 的一个 frontmatter 标记（`always: true`），复用同一套 skill 加载管线，工程上更统一。
4. **Sustained Goals**（跨 turn 目标生存）：2025 年 Anthropic、GCC、Amp 都在探索把目标从对话历史中移出去，nanobot 的做法是把 goal 塞进 session metadata 再由 Runtime Context 每次重建时注入，是这个趋势里的一个简洁实现。

最终指向同一个思路：**把 agent 当成一个需要长期自我维护的进程，而不是每次对话都从零开始的请求-响应函数**。Dream 是这套思路最彻底的体现。

---

## 一、定位：受 openclaw 启发的独立 Python 实现

nanobot 和 openclaw 的关系容易搞混。事实是：nanobot 在 skill 系统的格式和元数据约定上兼容 openclaw，设计理念上受其启发，但它是**完全独立的 Python 实现**——独立 git 历史、独立作者（Xubin Ren / HKUDS）、独立代码库、不同技术栈（Python vs TypeScript）。

两者的对比：

| 维度 | openclaw | nanobot |
|------|----------|---------|
| 技术栈 | TypeScript / Node.js | Python (≥3.11) |
| 定位 | 多通道 AI 网关 | 轻量级个人 AI 助手框架 |
| 记忆系统 | 多 Agent workspace 隔离 | Dream + 两阶段整合管道 |
| 包名 | `openclaw` | `nanobot-ai` |
| 协议 | Gateway RPC (WebSocket/HTTP) | Message Bus (asyncio.Queue) |

nanobot 的几个最独特设计，恰恰是 openclaw 没有的。

---

## 二、Dream：让 LLM 自己编辑自己记忆的自治系统

Dream 是 nanobot 最核心的记忆维护机制。它没有采用传统的 RAG 或向量搜索方案，而是**定期唤醒 LLM，提供受限的文件编辑工具，让它自行读写长期记忆文件**。

### 2.1 为什么不是向量搜索？

传统 Agent 记忆方案通常是把对话向量化，检索时做相似度匹配。这种做法有两个根本问题：第一，检索出的片段缺乏结构化组织，同一个事实可能在不同片段中互相矛盾；第二，记忆会无限膨胀，没有"清理"和"去重"的概念。

nanobot 的选择完全不同：**长期记忆就是 workspace 里的四个 Markdown 文件**（`SOUL.md`、`USER.md`、`memory/MEMORY.md`、`skills/<name>/SKILL.md`），Dream 定期用一个 LLM turn 去编辑它们。

```
raw messages (session jsonl)
    │
    ├── Consolidator (实时, token-budget 驱动)
    │   提取 SNIP 事实, 打标签, 追加到 history.jsonl
    │
    └── Dream (定期, cron 驱动, 默认每 2 小时)
        读取 history.jsonl 中未处理的条目
        → 构建 Dream prompt + 受限工具集
        → 启动 Ephemeral Agent Turn
        → LLM 自行编辑四个长期记忆文件
        → Git auto-commit (dulwich 纯 Python, 不依赖系统 git)
```

### 2.2 两阶段管道：Consolidator + Dream

**第一阶段——Consolidator（实时摘要器）**

当一段对话接近上下文预算上限时，Consolidator 被触发。它用 LLM 把最近的原始消息压缩成带标签的 SNIP 事实（Signal, Novel, Important, Persistent），追加到 `history.jsonl`。每个事实都会被贴上属性标签：

- `[permanent]`：永久保留，除非被显式修正（用户偏好、稳定身份信息）
- `[durable]`：持续有效但可被新证据更新
- `[ephemeral]`：仅在活跃或最近有用时保留
- `[correction]`：修正旧事实，替换而非追加
- `[skip]`：审计用途，不写入记忆文件

这些标签是 Consolidator 和 Dream 之间的**结构化交接协议**。Consolidator 负责"标记"，Dream 负责"执行"。

**第二阶段——Dream（定期编辑引擎）**

Dream 默认每 2 小时由 cron 触发一次。它的核心逻辑只有三步：

1. **读取增量**：通过 `.dream_cursor` 文件追踪处理进度，只读取 `history.jsonl` 中上次处理之后的新增条目
2. **构建受限 Agent**：Dream 获得一个完整的 Agent 实例，但工具被严格裁剪——只有 `read_file`、`edit_file`、`write_file`、`apply_patch`，且编辑范围被限定在四类文件
3. **Git 自动提交**：变更用 git commit 保存，commit message 包含 LLM 生成的变更摘要，支持 `/dream-restore` 回滚

### 2.3 Dream 的四个记忆文件与 MECE 规则

Dream 的 prompt 是一套精确的文件路由指令。它要求 LLM 将长期记忆分类写入 workspace 下的四个互斥且穷尽（MECE）的文件（默认 workspace 在 `~/.nanobot/workspace`）：

| 路径 | 作用 | 示例 |
|------|------|------|
| `SOUL.md` | Agent 行为规则、工具使用策略 | "Always verify claims against source code" |
| `USER.md` | 用户身份、偏好、沟通风格 | "User prefers concise replies" |
| `memory/MEMORY.md` | 项目上下文、架构决策 | "Project targets indie developers, ~10K stars" |
| `skills/<name>/SKILL.md` | 可复用的工作流模板 | "API base URL is https://api.example.com" |

注意四个文件的路径层级不同：`SOUL.md` 和 `USER.md` 在 workspace 根目录，`MEMORY.md` 在 `memory/` 子目录下，`SKILL.md` 在 `skills/<name>/` 子目录下（每个 skill 一个目录，skill 名即目录名）。Dream 维护的是一组 SKILL.md 文件，而不是单个。

Dream prompt 中有一整套具体的路由规则。例如，"Reply in Chinese" 属于 `USER.md`（语言偏好 = 沟通风格），但 "When searching, prefer grep over file listing" 属于 `SOUL.md`（工具使用策略）。又比如，"Spreadsheet tool requires --id flag" 不属于 `MEMORY.md`，而要迁移到 `SKILL.md`（操作细节不属于项目上下文）。

这套规则的关键，是给 LLM 明确、可执行的判别标准，避免让它自行猜测。

### 2.4 Dream 的工具限制：只给文件编辑能力

Dream 执行时，纳米机器人只给它一个经过严格裁剪的工具注册表：

```
read_file   → 可读整个 workspace
edit_file   → 只可编辑 MEMORY.md + SOUL.md + USER.md + skills/
apply_patch → 同上
write_file  → 只可写入 skills/ 目录
```

没有 shell 执行、没有网络请求、没有消息发送、不能 spawn 子 agent。Dream 是一个**纯粹的文件编辑 agent**，也只能是。

这个设计有一个重要的隐含好处：Dream 自动受益于 LLM 文件编辑能力的任何进步。不需要改 Dream 的代码——只要底层模型的文件编辑能力变强了，Dream 的记忆维护质量就会跟着提升。

### 2.5 Git 版本控制：可回滚的记忆

Dream 的每次变更都会通过 GitStore 自动提交到 workspace 的 git 仓库（基于 dulwich 纯 Python 实现，不依赖系统安装 git）。commit message 格式是：

```
dream: periodic memory consolidation

<LLM 生成的变更摘要>
```

这意味着：

- `/dream-log` 可以查看最近一次 Dream commit 的 diff
- `/dream-restore` 可以用 `git revert` 回滚最近的变更
- 记忆的每次修改都有完整的审计轨迹

把 LLM 的输出当做数据库写入来管理——用版本控制保证可回滚性——这是 Dream 设计中最务实的决策之一。

---

## 三、Ephemeral Mode：不留痕迹的 Agent Turn

Dream 的另一个关键依赖是一个叫 Ephemeral Mode 的机制。它的含义是：**运行一个完整的 Agent turn，但不留下任何会话痕迹**。

普通 turn 和 Ephemeral turn 的区别：

| 行为 | 普通 turn | Ephemeral turn |
|------|-----------|----------------|
| 历史持久化 | 写入 session jsonl | 跳过 |
| Consolidation 触发 | 正常触发 | 跳过 |
| Webhook 回调 | 正常发送 | 跳过 |
| 上下文注入 | 包含近期历史 | 不包含 |
| 文件副作用 | 有（受工具限制） | 有（受工具限制） |
| stop_reason | 正常语义 | 特殊标记 `_stop_reason: "completed"` |

Dream session 使用特殊的 key 前缀 `dream:`（如 `dream:20260607-143000`），而且只保留最近 10 个 dream session 文件。AutoCompact 的 session TTL 机制也显式排除了以 `dream:` 开头的 session，防止 Dream 的会话被当做普通空闲会话压缩掉。

Ephemeral Mode 本质上是给 Agent 运行时提供了一个"后台任务"的执行容器：可以修改文件，但不能污染用户可见的对话历史。

---

## 四、Always Skills：自动注入上下文的能力加载

nanobot 的 Skill 系统有一个独特的分级：不是所有 skill 都平等地暴露给模型。

### 4.1 三级加载机制

```
Level 1: Skill 索引（所有 skill）
    → 只注入 name + description + 可用性信息
    → Agent 判断是否需要某个 skill，需要时 read_file 加载

Level 2: 按需加载（Agent 主动请求）
    → Agent 调用 read_file 读取 SKILL.md 全文
    → 内容以完整的 tool result 形式进入上下文

Level 3: Always Skills（标记 always: true）
    → SKILL.md 正文自动注入系统 prompt 的 # Active Skills 区域
    → 每个 turn 都在，不需要 Agent 手动加载
```

实现上，`ContextBuilder.build_system_prompt()` 在构建系统消息时调用 `SkillsLoader.get_always_skills()`，扫描所有 skill 的 YAML frontmatter，找到 `always: true` 的 skill，将其正文注入 `# Active Skills` 区块。

### 4.2 两个内置 Always Skill

nanobot 默认带了两个 `always: true` 的 skill：

**memory skill**：教 Agent 理解两阶段记忆系统（Consolidator + Dream）、如何用 grep 搜索 `history.jsonl`、如何管理 Dream 的配置。没有这个 skill，Agent 根本不知道自己的记忆是怎么工作的。

**my skill**：教 Agent 如何用 Self Tool 检查和调整自己的运行时状态。这个 skill 的正文很短——只描述 my 工具的用法——但对 Agent 的自我感知能力至关重要。

### 4.3 为什么需要 Always Skills

普通的 skill 索引有一个根本问题：**Agent 不可能查找自己不知道存在的东西**。如果 Agent 不知道"有一种方式可以检查自己的运行时状态"，它就不会去加载 my skill。如果 Agent 不知道"有一个两阶段记忆系统可以用来搜索历史"，它就不会去加载 memory skill。

Always Skills 解决了这个元认知缺口——让 Agent 在每一步都"知道"这些能力的存在，而不需要在索引中主动发现。

---

## 五、Self Tool（my）：Agent 的自我感知

`my` 工具是 nanobot 最独特的内置工具之一。它让 Agent 可以检查和（在允许的情况下）修改自己的运行时状态。

### 5.1 能感知什么

Agent 通过 `my check` 可以看到：

- **模型和配置**：当前 model、max_iterations、context_window_tokens、workspace 路径
- **运行进度**：`_current_iteration`（当前在第几步，还剩多少步）
- **Token 用量**：`_last_usage`（最近一次 LLM 调用的 token 消耗）
- **子 Agent 状态**：当前有哪些 subagent 在跑，各自在什么阶段、用了什么工具
- **沙箱状态**：exec_config、web_config、workspace_sandbox
- **Scratchpad**：跨 turn 的临时键值存储

如果用户问"你现在用的是什么模型"、"还能跑多少步"、"刚才用了多少 token"，Agent 不需要去翻文档或猜——直接 `my check` 就能拿到精确答案。

### 5.2 三层安全边界

`my` 工具的修改能力不是全开放的。它有三层访问控制：

```
BLOCKED（完全拒绝）：
    bus, provider, _running, tools, runner, sessions,
    _mcp_servers, _pending_queues, _session_locks,
    api_key, secret, password, token, credential ...

READ_ONLY（可查不可改）：
    subagents, _current_iteration, exec_config,
    web_config, workspace_sandbox

RESTRICTED（可改但有限制）：
    max_iterations      → 范围 1-100
    context_window_tokens → 范围 4096-1,000,000
    model               → 任意字符串（最小 1 字符）
```

这套安全模型确保 Agent 可以调整自己的"工作参数"（多跑几步、换模型），但不可能碰到底层基础设施（消息总线、凭证、会话管理器）。

### 5.3 Scratchpad：跨 Turn 的临时记忆

`my set` 有一个特殊的目标叫 scratchpad——本质上是 `_runtime_vars` 这个 dict。Agent 可以把任意 JSON-safe 的值存进去，跨 turn 保持，但进程重启后丢失。上限 64 个 key，嵌套深度不超过 10 层。

Scratchpad 的设计很克制：它不是"长期记忆"（那是 Dream 的职责），而是"这次对话里临时需要记住的东西"。比如"用户刚才说要先处理 A 再处理 B，但中间被其他消息打断了"——这个信息不需要写进 MEMORY.md，但需要在本次对话中保持。

---

## 六、Sustained Goals：跨 Turn 的目标追踪

nanobot 的 `long_task` / `complete_goal` 工具对解决了一个关键问题：**Agent 如何在一个可能持续几十个 turn、中间被其他消息打断、上下文被压缩多次的长任务中，不丢失原本的目标？**

### 6.1 目标如何抵抗压缩

普通 Agent 的目标只存在于对话历史中。当上下文过长、Consolidator 把历史压缩成摘要时，目标描述就可能丢失或变形。

Sustained Goal 的做法完全不同：目标存储在 **session metadata**（会话元数据）中，而不是对话消息中。每个 turn 开始时，`goal_state_runtime_lines()` 从 session metadata 读取当前活跃的目标，注入到 Runtime Context 区块：

```
[Runtime Context]
...
Goal (active):
修复 data-pipeline 模块中的并发写入 bug，需要审查所有 async lock 的使用并补测试
```

因为 Runtime Context 是每个 turn 重新构建的（不经过 Consolidator），目标描述永远不会被压缩掉。

### 6.2 无限 Wall-Clock Timeout

当一个 session 有活跃的 sustained goal 时，LLM 调用的 wall-clock timeout 被设为 0（即无限等待）。这意味着 Agent 执行一个很慢的工具（比如一个跑了好几分钟的测试套件）时，不会因为超时而中断。

这在普通对话中是不安全的（用户可能发完消息就走了），但在 `long_task` 上下文中是合理的——用户已经声明了这是一个需要持续的长期任务。

### 6.3 Turn Continuation

与 Sustained Goal 配合的还有一个 `turn_continuation` 机制：当一个 turn 达到迭代上限但目标未完成时，系统可以自动启动一个"透明延续切片"，对用户来说看到的是一个连续的响应，但背后可能是多次 LLM 调用。Sustained Goal 最多支持 12 轮透明延续。

---

## 七、Workspace 上下文文件：专用 Bot 的最小配置框架

nanobot workspace 里的一组上下文文件共同组成了按职责划分的最小框架，并非零散配置。我在之前的笔记里已经详细梳理过各文件的用途，这里只从"专用 Bot 改造"的角度重新组织。

### 7.1 四文件职责表

| 文件 | 作用 | 注入时机 | 专用 Bot 是否改动 |
|------|------|----------|-------------------|
| `AGENTS.md` | 任务边界、流程约定、领域规则 | 每次对话构建 system prompt 时 | **重点修改**——写清 bot 做什么、不做什么 |
| `SOUL.md` | Bot 的长期身份和执行原则 | 每次对话；Dream 可更新 | **建议修改**——换成领域角色 |
| `USER.md` | 用户画像和偏好 | 每次对话；Dream 可更新 | 精简——只保留影响交付的稳定偏好 |
| `HEARTBEAT.md` | 周期巡检任务清单 | Heartbeat 服务周期性读取 | 有周期任务才写 |

Dream 会自动维护 `SOUL.md` 和 `USER.md`，所以这两个文件的长期准确性有自动化保障。但 `AGENTS.md` 是人工设置的"宪法"——它定义边界，Dream 不会修改它。

注意这组文件和 Dream 维护的"长期记忆文件"是两套不同的概念：上下文文件全部在 workspace 根目录，每次对话构建 system prompt 时读取；Dream 还额外维护 `memory/MEMORY.md` 和 `skills/<name>/SKILL.md` 这两个记忆文件，它们不直接注入 system prompt，而是作为长期知识库供 agent 检索和 Dream 编辑。

### 7.2 最小改造顺序

把 nanobot 从一个通用个人助手变成专用领域 Bot：

1. **先改 `SOUL.md`**：去掉"个人助手"身份，换成领域角色描述，保持简短稳定
2. **再改 `AGENTS.md`**：写清领域边界、禁止事项、输出格式和验收标准
3. **精简 `USER.md`**：只保留业务方、语言、交付偏好，避免无关个人画像污染判断
4. **按需写 `HEARTBEAT.md`**：只有真正需要周期性巡检的场景才加

这套设计的关键洞察是：**上下文文件的职责分离 = 让 AI 和人类都能理解"改什么会影响什么"**。不会出现"改了某个配置项，结果发现影响了 Agent 的行为模式"这种意外。

---

## 八、总结：nanobot 的设计哲学

回头看这些设计，它们背后有三个选择值得关注。

**第一，记忆系统选择文件编辑而非向量检索。** 2025 年 Letta/MemGPT 的基准测试中，简单文件系统方案（74%）已经反超了向量+图谱混合方案（68.5%）。nanobot 的 Dream 是这个路线上的一个独特实现：两阶段管道让实时摘要和定期编辑解耦，属性标签协议让 Consolidator 和 Dream 之间有了结构化的交接语言，Git 版本控制让每次 Dream 运行都有审计轨迹和回滚能力。问题不是"文件 vs 向量"谁对——文件路线已经在赢——而是怎么把文件编辑做得可靠、可恢复、能自动去重。

**第二，Agent 自省在生产框架里是罕见的。** Self Tool 让 Agent 能回答"我现在用什么模型、跑在第几步、消耗了多少 token"，这在研究界有探索（VIGIL、Context Rot Detection MCP），但在生产框架里暴露为一个 agent 可直接调用的工具，确实是 nanobot 的独特选择。配合三层安全边界（BLOCKED/READ_ONLY/RESTRICTED），它在"让 agent 有自我感知"和"不让 agent 碰到底层基础设施"之间画了一条清晰的线。

**第三，把 agent 当作需要长期自我维护的进程。** Sustained Goals 让目标在上下文压缩中存活，Always Skills 让核心能力不会在会话增长中被遗忘，Ephemeral Mode 让后台任务不污染用户可见的历史。这些设计单独看都不算大创新——Anthropic、GCC、Amp 都在探索类似的方向——但 nanobot 把它们整合进了一个统一的 Python 运行时，而且每个机制的边界都很清晰。

从工程角度看，nanobot 最值得学习的可能是它对"让 LLM 参与系统自身的长期维护"所做的设计取舍：把文件编辑和状态感知能力提供给 LLM，再用协议和边界控制风险。

---

*本文基于 nanobot v0.2.1 源码和公开文档整理。分析聚焦架构设计和技术决策，具体实现细节可能随版本变化。*
