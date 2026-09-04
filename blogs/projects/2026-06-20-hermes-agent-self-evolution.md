# Hermes Agent 自进化机制解读：它到底在“自己改写”什么

很多个人 agent 已经不再只是本地命令行工具。它们可以部署在云端，可以从 CLI、Web、Telegram、Slack、Discord、WhatsApp 等入口接收任务，也可以在 VPS、容器或远程机器上长期运行。入口变多以后，一个更难的问题浮出来：agent 做过的事，下一次还能不能变成它自己的经验？

Hermes Agent 所说的“自进化”，是把任务经验写入**外部认知资产**，再让这些资产进入后续任务的上下文；模型权重和内部隐藏状态都没有因此改变。

可以把闭环概括成：

```text
任务经验
  -> 会话历史沉淀
  -> 后台 review 读取自然交互轨迹
  -> 记忆 / 技能 / 用户模型改写
  -> curator 后台治理
  -> 后续 prompt、skill 加载、历史检索、memory-context 回灌
  -> 改变未来行为
```

所以本文集中回答五个问题：Hermes 到底自己改写什么？改写的证据来自哪里？它如何判断什么值得保存？改写在什么时候发生？改写后的内容又如何进入后续上下文？

---

## 一、自进化首先意味着“有东西被自己改写”

先排除一个误解：Hermes 的自进化不改模型权重。模型仍然是外部 provider 提供的 GPT、Claude、Gemini、Nous、OpenRouter 或其他模型。Hermes 改的是模型之外的状态，也就是它自己可读、可写、可审计的认知资产。

第一类是文件型记忆。`tools/memory_tool.py` 把记忆分成两个文件：

| 文件 | 角色 | 典型内容 |
| --- | --- | --- |
| `MEMORY.md` | agent 的个人笔记 | 环境事实、项目约定、工具坑点、已验证结论、经验教训 |
| `USER.md` | 用户画像 | 用户偏好、沟通风格、长期约束、工作习惯 |

这两个文件默认位于 Hermes profile 的 `memories/` 目录下。它们不是无限增长的聊天记录，而是有字符上限的精选条目：源码默认 `MEMORY.md` 约 2200 字符，`USER.md` 约 1375 字符。这个限制很关键，它迫使 agent 把经验压缩成“以后真的会影响行为”的事实，而不是把每次对话都倒进去。

第二类是 skills。`tools/skills_tool.py` 和 `tools/skill_manager_tool.py` 把 skill 定义为程序性记忆：它记录的不是“知道什么”，而是“下次遇到这类任务该怎么做”。一个 skill 目录至少包含 `SKILL.md`，也可以带上：

- `references/`：较长背景资料、API 摘要、项目细节、复盘记录。
- `templates/`：可复用输出模板或配置模板。
- `scripts/`：可重复执行的验证脚本、探针或自动化片段。
- `assets/`：图片、示例数据等支持材料。

第三类是 skill 的治理状态。`tools/skill_usage.py` 使用 `skills/.usage.json` 这样的 sidecar 文件记录 view/use/patch 计数、最近活动时间、`active` / `stale` / `archived` 生命周期、`pinned` 标记以及 curator 是否可管理。`agent/curator.py` 还会维护 `.curator_state` 和 `logs/curator/` 下的运行报告。

第四类是完整会话库。`hermes_state.py` 把 CLI 和 gateway 会话写入 SQLite `state.db`，并维护 FTS5 全文索引。它不是常驻 prompt 记忆，而是完整经验库。`tools/session_search_tool.py` 可以按需从里面取回真实消息窗口、会话开头/结尾 bookends，或者围绕某条消息滚动查看上下文。

第五类是可选外部记忆层。以 Honcho 插件为例，`plugins/memory/honcho/` 在内置 `MEMORY.md` / `USER.md` 之外维护 user peer、AI peer、session summary、peer card 和 dialectic reasoning。它不是替代内置记忆，而是并行增强用户建模。

这些资产共同构成了 Hermes 的“可改写自我”。它们都在模型外部，因此可以被阅读、审批、修改、归档和迁移。

---

## 二、为什么要把自进化做成外部资产改写

长期运行的个人 agent 需要解决的不是多背知识，而是四件更具体的事。

第一，用户不想反复解释偏好和背景。比如“回答要短”“这个项目不要改生成文件”“这个服务器 Docker 不需要 sudo”。这些信息如果只存在于某次聊天里，下一次新会话就会丢。

第二，agent 不该重复踩同一个工具坑。某个 CLI 的参数兼容性、某个项目的测试命令、某个远程环境的限制，都是一次任务里试出来的经验。下次再从零试一遍，就是浪费。

第三，复杂任务的过程经验很难靠聊天记录主动复用。一次成功排查可能包含判断路径、验证命令、失败模式和回滚步骤。如果它只留在历史对话中，agent 需要先想起来“过去有类似任务”，再搜到那段历史，最后重新抽象流程。更合理的做法是把它沉淀成 skill。

第四，全量历史不能一直塞进 prompt。个人 agent 的历史会越来越长，而 prompt 预算、延迟和缓存稳定性都要求上下文有边界。

Hermes 的分层就是为了解这个矛盾：

| 层级 | 保存什么 | 何时进入上下文 |
| --- | --- | --- |
| `USER.md` | 长期用户偏好和工作习惯 | 会话开始时进入 system prompt |
| `MEMORY.md` | 环境事实、项目约定、工具经验 | 会话开始时进入 system prompt |
| session DB | 完整历史消息 | 调用 `session_search` 时按需召回 |
| skills | 可复用工作流和判断标准 | 先暴露元数据，需要时再 `skill_view` |
| curator state/report | skill 生命周期和治理结果 | 影响未来 skill 可见性与库结构 |
| Honcho | 可选外部用户建模和语义记忆 | 按配置注入 `<memory-context>` 或提供工具 |

这个设计的价值是可见性。学习结果不是藏在模型内部的不可解释变化，而是落成文件、数据库记录和报告。用户可以审计它、编辑它、删除它，也可以把 skills 复制到另一个环境里复用。

---

## 三、内容是怎么被改写的

### 1. 记忆改写：小而稳定的事实

Hermes 通过 `memory` 工具修改内置记忆，动作只有 `add`、`replace`、`remove`。`replace` 和 `remove` 使用唯一子字符串匹配，而不是要求完整条目 ID。这样 agent 可以把旧条目合并、缩短或替换。

这里的“有界”不是实现细节，而是产品判断。记忆满了以后，工具不会鼓励无限追加，而是要求 agent 整合或删除旧条目。适合进入 `MEMORY.md` / `USER.md` 的内容，应该是稳定、复用概率高、会改变未来行为的事实。

这句话如果不拆开，很容易变成口号。Hermes 实际给 agent 的判断标准更接近三道门槛。

**第一，稳定性。** 这个事实至少应该在接下来一段时间里仍然成立。Hermes 的系统提示词里有一个很硬的排除标准：如果一个事实一周内就可能过期，它不该进入 memory。所以 PR 编号、issue 编号、commit SHA、“第 2 阶段完成了”、一次性文件计数、某个临时修复结果，都不适合写进 `MEMORY.md`。这些东西应该留在 session DB，需要时通过 `session_search` 找。

**第二，复用概率。** 好记忆不是“我刚刚做了什么”，而是“下次可以少问用户什么”。用户偏好、反复纠正、环境事实、项目约定、工具坑点，复用概率最高。比如用户多次要求“回答短一点”，或者某个项目每次测试都必须带一个特殊参数，这些信息一旦缺失，未来会反复造成摩擦。

**第三，行为影响。** 一条记忆应该能改变 agent 的未来行为：改变它的语气、命令选择、验证方式、风险判断，或者避免同一个错误。不能改变行为的事实，即使真实，也不值得占用常驻 prompt 预算。

因此 `MEMORY.md` / `USER.md` 更像一组高密度“未来行为偏置”，不是流水账。可以用几个例子看边界：

| 观察到的信息 | 应放位置 | 原因 |
| --- | --- | --- |
| 用户偏好简洁回答，不喜欢长篇解释 | `USER.md` | 长期偏好，会影响回复风格 |
| 当前项目用 `pytest -n auto`，普通 `pytest` 太慢 | `MEMORY.md` | 环境/项目约定，会影响验证命令 |
| 修复了 PR #1287 的登录 bug | session DB | 完成日志，很快过期 |
| 排查某类 OAuth 回调失败时，要先核对 redirect URI、cookie same-site 和反向代理 header | `SKILL.md` | 程序性排查流程，可迁移到同类任务 |
| 某 API 文档的长摘录和字段表 | `references/` | 有价值但太长，不适合常驻 prompt |

还有一个重要细节：memory 应写成声明性事实，而不是自我命令。`User prefers concise responses` 是合适的；`Always respond concisely` 就不合适。后者在下一次会话里会被重新读成指令，可能压过当前任务的实际需要。流程、步骤、检查清单应该进入 skill，而不是 memory。

源码还做了安全处理：记忆条目在进入系统 prompt 快照前会扫描注入和外泄模式；会话中写入会立即落盘，但不会立即改变当前 system prompt。这个冻结快照机制是为了保持 prompt cache 稳定。

### 2. 技能改写：把流程变成可调用资产

Hermes 通过 `skill_manage` 修改 skills，支持：

| 动作 | 含义 |
| --- | --- |
| `create` | 创建完整 `SKILL.md` 和目录 |
| `edit` | 整体重写已有 `SKILL.md` |
| `patch` | 对 `SKILL.md` 或支持文件做定点替换 |
| `write_file` | 写入 `references/`、`templates/`、`scripts/`、`assets/` 等支持文件 |
| `remove_file` | 删除支持文件 |
| `delete` | 删除 skill，并可声明内容已并入哪个 umbrella skill |

`skill_manage` 成功写入后会清理 skills system prompt cache，让后续会话看到新的索引。它还会更新 usage telemetry：`patch`、`edit`、`write_file`、`remove_file` 会增加 patch 计数；`skill_view` 成功读取时会同时增加 view 和 use 计数。

这里有一个容易写错的细节：不是所有前台创建的 skill 都会被 curator 当成 agent 自己生成的 skill。当前源码里，`skill_manage(create)` 只有在 background review fork 中发生时，才会通过 `mark_agent_created` 标记为 `created_by: agent`。**前台用户指令创建的 skill 更接近“用户资产”，curator 默认不应该随便治理它。**

skill 写入还可以经过 approval gate。`tools/skill_manager_tool.py` 会调用 `tools/write_approval.py` 的 gate；如果策略要求审批，就先 stage 写入，等待用户 approve 后再 replay。

### 3. Curator 改写：技能库不能无限堆积

如果每个复杂会话都留下一个小 skill，最后会得到一个很难搜索、很难维护的技能库。`agent/curator.py` 的目标就是治理这个问题。

curator 有两层行为，必须分开看。

第一层是确定性的生命周期迁移。它读取 `tools/skill_usage.py` 提供的报告，根据最近活动时间把 skill 从 `active` 标记为 `stale`，再在更久未使用后移动到 `.archive/`。默认阈值是 30 天 stale、90 天 archive。`pinned` skill 会跳过自动迁移。归档是可恢复的，不是删除。

第二层是可选的 LLM consolidation pass。当前源码里 `curator.consolidate` 默认关闭；开启后，curator 会启动一个后台 review agent，目标不是找重名 skill，而是把大量窄 skill 合并成 class-level umbrella skill。它会判断哪些内容应该成为 umbrella skill 的小节，哪些应该迁移到 `references/`、`templates/` 或 `scripts/`，然后归档被吸收的窄 skill。

这里的“合并”不是一个纯字符串聚类算法，而是一个受约束的后台 agent 维护流程。Hermes 先把候选范围缩小，再让 curator review agent 在明确规则下重构技能库。

候选范围先被过滤。Hub 安装的 skill 不碰；受保护的内置 skill 不碰；`pinned` skill 不碰；前台用户直接要求创建的 skill 默认不当成 agent-created skill 交给 curator 管理。真正进入候选集的，是 usage sidecar 中被标记为 agent-created 的技能，以及在配置允许时可被 prune 的内置技能。

然后 curator 看的不是“名字相似不相似”，而是“未来 agent 会不会更容易发现和使用”。它的 review prompt 明确反对两种偷懒判断：不能因为 use_count 低就直接说没价值，也不能因为每个 skill 的触发条件有差别就拒绝合并。正确问题是：一个人类维护者会把这些写成 N 个独立 skill，还是写成一个 umbrella skill，里面用小节覆盖不同场景？

所以 curator 会先找 prefix/domain cluster，例如一组 `gateway-*`、`pr-*`、`mcp-*`、`hermes-config-*`。对每个 cluster，它要判断这个 cluster 服务的上位任务类别是什么。如果上位任务明确，就进入三种合并路径之一。

**第一种：合并进已有 umbrella。** 如果某个 skill 已经足够宽，可以代表这个任务类别，curator 会 patch 它的 `SKILL.md`，把 sibling 的独特经验改写成新小节、注意事项或验证步骤，然后把 sibling 归档。这里不是把多个 `SKILL.md` 原样拼接，而是把“触发条件、判断标准、核心流程”整理进 umbrella 主文档。

**第二种：创建新 umbrella。** 如果 cluster 里没有现成的宽 skill，curator 可以用 `skill_manage(action="create")` 创建一个新的 class-level `SKILL.md`。新 skill 的 `description` 要覆盖这个任务类别，让未来的 skills index 能搜到它；正文则放共享流程、分支判断和失败模式。原来的窄 skill 被吸收后归档。

**第三种：降级为支持文件。** 有些窄 skill 不是没价值，而是不该占一个 top-level skill 名额。它们可能是一次具体 provider 的坑、某个 API 字段表、一段复盘、一个脚本、一个模板。curator 会把这类内容迁入 umbrella 的支持目录：

| 迁移目标 | 放什么 |
| --- | --- |
| `references/<topic>.md` | 会话特定细节、API 摘要、provider quirks、复现步骤、长背景材料 |
| `templates/<name>.<ext>` | 以后要复制再改的文件骨架、配置样例、提示模板 |
| `scripts/<name>.<ext>` | 可以静态重复运行的验证脚本、fixture 生成器、探针 |

可以抽象成这样：

```text
合并前：
skills/
  pr-ci-failure-triage/SKILL.md
  pr-review-summary-format/SKILL.md
  pr-branch-salvage/SKILL.md

合并后：
skills/
  pr-workflow/
    SKILL.md
    references/
      ci-failure-triage.md
      branch-salvage-notes.md
    templates/
      review-summary.md
  .archive/
    pr-ci-failure-triage/
    pr-review-summary-format/
    pr-branch-salvage/
```

在这个例子里，`pr-workflow/SKILL.md` 不应该塞满三篇旧 skill 的全文。它应该讲清楚“什么时候用、先检查什么、如何分流到 CI 排查/summary/branch salvage、最后如何验证”。旧 skill 中很长的 CI 日志模式、具体恢复案例、summary 模板，则分别进入 `references/` 和 `templates/`。

Hermes 还专门约束了“包完整性”。一个 skill root 可能不仅有 `SKILL.md`，还带 `references/`、`templates/`、`scripts/`、`assets/`，而 `skill_view` 是按 skill root 发现这些文件的。因此 curator 不能把旧 `SKILL.md` 粗暴复制到另一个 skill 的 `references/old.md` 就算完成。如果原 skill 的主文档引用了 `references/foo.md` 或 `scripts/check.py`，合并时必须把相关支持文件也搬到 umbrella 的规范目录，并改写引用路径；否则就保持独立，或者完整归档整个旧包。

合法性主要由工具层兜底。`skill_manage(create/edit/patch)` 会校验 `SKILL.md` 必须有 YAML frontmatter，且包含 `name` 和 `description`，正文不能为空，内容大小不能超限。patch `SKILL.md` 后会重新校验 frontmatter。`write_file` 和 `remove_file` 只能操作 `references/`、`templates/`、`scripts/`、`assets/`，并做路径穿越防护。写入采用临时文件加原子替换；可选 security scan 失败会回滚。删除时如果声明 `absorbed_into=<umbrella>`，工具会验证目标 umbrella 已存在，且不能等于自己；`pinned` skill 会拒绝删除。

合并结束也不是“算出了全局最优”。它是一次 review pass 的收敛条件：完整扫描候选列表，处理所有明显的 2+ cluster，合并一轮后再看剩余集合，直到没有明显 umbrella opportunity。curator prompt 甚至明确说，如果只合并了几个就停，通常说明还没认真扫完。结束时必须输出 human summary 和结构化 YAML block，把每个被归档的 skill 放进 `consolidations` 或 `prunings`。随后 Hermes 会结合 `absorbed_into`、tool calls、结构化 summary 和启发式审计生成 curator report。也就是说，curator 的“科学性”不来自一个神秘分数，而来自候选过滤、硬规则、工具校验、结构化报告和可恢复归档。

### 4. 历史检索参与改写

`session_search` 自身不改写 memory 或 skill，但它为改写提供证据。它有三种调用形态：传 `query` 做 FTS5 discovery；传 `session_id` 和 `around_message_id` 滚动查看窗口；不传参数则浏览最近会话。

重要的是，它返回真实数据库消息，不是 LLM 摘要。这意味着 agent 在决定“这条经验要不要保存”“应该写进 memory 还是 skill”“过去那次失败到底怎么解决”时，可以回到原始历史，而不是凭模糊印象写入长期资产。

### 5. Honcho：可选的外部用户建模层

Honcho 插件提供的是另一条并行路径。根据 `plugins/memory/honcho/README.md` 和实现，它维护 user peer 与 AI peer，支持 session summary、user representation、peer card、semantic search、persistent conclusion 和 dialectic reasoning。

它的上下文注入方式也很克制：动态内容不是大段改写 system prompt，而是在 API 调用时包装成用户消息侧的 `<memory-context>`。base context 按 `contextCadence` 刷新，dialectic supplement 按 `dialecticCadence` 触发，并通过 token/字符预算裁剪。配置为 `tools` 模式时，它不自动注入，只暴露工具；配置为 `context` 模式时，则隐藏工具，仅自动注入；`hybrid` 两者都有。

所以 Honcho 是可选增强，不是 Hermes 自进化闭环成立的前提。

---

## 四、自进化基于什么内容进行改写

很多自进化 agent 的学习闭环是从运行 trace 开始，再由 evaluator、测试集或 reward model 给出成功率、分数和错误标签，最后根据这些结构化评估结果优化 prompt、策略或代码。Hermes 也读取运行轨迹，但它走的不是这条“trace + 独立评估信号”路线。

Hermes 最直接的证据是刚刚发生的自然交互。`agent/background_review.py` 会复制当前会话的消息快照，在独立后台 agent 中重新播放，然后追加一条 review prompt，让模型判断是否需要保存或更新 memory 和 skills。默认使用与前台任务相同的模型时，review fork 读取完整会话；如果配置了另一个辅助模型，为了降低冷缓存成本，较早的消息会被压成 digest，最近一段消息仍然原样保留。

这份会话快照不是只有用户问题和最终答案。它保留了任务过程中真正能说明“发生了什么”的内容：

- 用户提出的目标、约束、偏好和后续纠正。
- agent 的中间回复、工具选择与最终回答，以及任务最后是否形成了可用结果。
- 工具调用、工具返回值、错误信息、重试路径和验证结果。
- 本轮通过 slash command 加载或通过 `skill_view` 查阅过的 skill。
- 任务中形成的非平凡技巧、修复方法、绕行方案和调试路径。

因此，Hermes 的学习信号并不只是“任务成功了没有”。用户说“不要再这样排版”，是风格改写信号；用户纠正了执行顺序，是工作流改写信号；某个已加载 skill 遗漏了关键步骤，是 skill 修补信号；一条排查路径最终通过验证，则可能成为可复用方法。反过来，如果会话只留下未解决的失败尝试，review prompt 明确要求不要把它包装成可靠流程。

后台 review 使用提示词中的启发式规则直接解释这条轨迹。它没有先调用一个独立 evaluator，也没有消费 reward、测试集得分或统一的结构化 failure label。即使工具输出中可能包含测试结果，那也只是会话证据的一部分，不等于系统存在一个专门负责给轨迹打分的评估层。

除了本轮轨迹，Hermes 还有两类补充证据。

第一类是按需召回的历史会话。`session_search` 可以从 SQLite 会话库取回真实消息窗口，让前台 agent 在写 memory 或 skill 前核对过去发生过什么。不过后台 review 本身主要消费触发时传入的当前会话快照，不会自动扫描整个历史库。历史检索是一种可调用的证据补全能力，不是每次自进化都必经的离线训练数据管道。

第二类是 skill 库自身的内容与使用元数据。Curator 会读取 skill 的**正文、来源、生命周期、最近活动时间、view/use/patch 计数**、`pinned` 状态以及是否由 agent 创建。这些证据用于判断哪些 skill 应保持独立，哪些应合并成 umbrella，哪些可以变为 stale 或归档。它们反映的是技能库的结构和使用情况，而不是某一次任务的外部质量评分。

可以把几条证据路径区分开：

| 改写环节 | 主要证据 | 是否依赖独立 evaluator |
| --- | --- | --- |
| Memory review | 当前会话中的用户信息、偏好、纠正和长期约束 | 否，由 review agent 直接判断 |
| Skill review | 当前会话轨迹、工具结果、有效方法、失败与重试、已加载 skill | 否，由 review agent 按启发式规则判断 |
| 前台主动改写 | 当前任务上下文，以及 agent 主动调用的历史检索结果 | 否 |
| Curator 治理 | skill 内容、来源、usage sidecar、生命周期与保护状态 | 否，LLM consolidation 只是受约束的库维护 pass |

这也构成了 Hermes 与评估驱动型自进化方案的核心区别：

> Hermes 的自进化是“基于自然交互轨迹的语言模型自审”，而不是“基于外部评估信号的策略优化”；它更容易从真实使用中持续学习，但也缺少独立 evaluator 提供的客观纠错信号。

这个差异既是优势，也是风险。自然交互中包含用户真实偏好、环境限制和工具使用细节，不需要额外构造 benchmark 就能积累经验；但负责执行任务和负责复盘轨迹的模型通常来自同一套能力边界，自审可能继承原回答的盲点。Hermes 用排除规则、写入审批、protected/pinned 边界、工具校验和可恢复归档降低风险，却没有把“模型认为值得保存”变成经过外部评分验证的正确结论。

---

## 五、如何确定该改写什么

自进化系统需要避免“什么都学”。如果写入判断差，长期记忆会变成杂乱笔记本，skills 会变成一堆搜索不到的会话残片。

比较稳的判断原则是：只有稳定、可复用、会影响未来行为的信息才值得改写。但不同资产的“稳定”和“复用”不是同一个尺度。

`USER.md` 的稳定性来自人，而不是任务。用户的沟通偏好、工作习惯、身份背景、长期约束，通常跨项目有效。比如“用户希望先给结论，再给细节”会影响几乎所有后续对话；“用户今天在调试登录页”则只是当前任务上下文。

`MEMORY.md` 的稳定性来自环境和项目。项目结构、默认测试命令、部署环境、工具限制、团队约定，都可能在未来多次任务中复用。它不适合保存“某次任务做到了哪一步”，因为进度会过期；它适合保存“这个项目为什么必须这样验证”，因为这会影响未来操作。

`SKILL.md` 的稳定性来自任务类型。只要未来还会遇到同类任务，流程就值得保存。它不要求某个具体项目永远不变，但要求抽象出来的判断步骤和失败模式可迁移。比如“排查 OAuth 回调问题”比“修复今天这个 OAuth bug”更像 skill。

具体路由可以这样看：

| 写入位置 | 适合保存 | 不适合保存 |
| --- | --- | --- |
| `USER.md` | 用户偏好、沟通风格、长期工作习惯、身份背景 | 某次临时情绪、一次性任务细节 |
| `MEMORY.md` | 项目结构、环境配置、工具坑点、已验证结论、工作约定 | 大段日志、临时路径、容易重新搜索的公共知识 |
| `SKILL.md` | 重复任务类型、操作步骤、判断标准、验证命令、失败模式 | 只对某一次任务有意义的流水账 |
| `references/` | 较长背景资料、API 摘要、项目细节、复盘材料 | 应该直接进入主流程的关键步骤 |
| `templates/` | 可复用文件模板、提示模板、配置骨架 | 不会复用的一次性输出 |
| `scripts/` | 可重复执行的验证脚本、迁移脚本、探针 | 依赖一次性环境的临时代码 |

比如，“用户喜欢简洁回答”应该进 `USER.md`；“这个项目的测试命令是 `npm test -- --runInBand`”应该进 `MEMORY.md`；“每次做 PR salvage 时先比对 base/head、再检查 CI、最后写 reviewer-facing summary”更适合沉淀成 skill。

如果 agent 正在犹豫，可以按这个顺序问：

1. 这是不是关于用户长期偏好的事实？是，就优先 `USER.md`。
2. 这是不是关于当前环境、项目或工具的可复用事实？是，就考虑 `MEMORY.md`。
3. 这是不是一组操作流程、判断标准或失败模式？是，就考虑 `SKILL.md`。
4. 这是不是太长、太细、但未来可能作为证据或背景使用？是，就放到 `references/`。
5. 这是不是可以直接复制再改的文件？是，就放到 `templates/`。
6. 这是不是可以重复运行的验证或自动化动作？是，就放到 `scripts/`。
7. 如果以上都不是，就保留在 session DB，不进入常驻资产。

这个顺序其实是在保护 prompt 预算。常驻 memory 最贵，因为每个会话都会读；skill 次之，因为它会出现在索引里，并可能被主动加载；session DB 最便宜，因为只有检索时才进入上下文。

curator 的判断标准也类似，但对象换成了整个 skill library。usage counter 是信号，但不是唯一依据。一个 skill 没被用过，可能是因为它没价值，也可能是因为名字和描述不可发现。真正要看的是内容是否重叠、是否容易被未来 agent 搜到、是否应该归入更高层的任务类别。

所以“科学判断需要合并”不是给每个 skill 算一个相似度阈值，而是看它是否降低了未来检索和使用成本。如果五个 skill 都服务同一个任务类别，只是分别记录了五次会话里的坑，那它们很可能应该变成一个 umbrella skill 的五个小节或支持文件。反过来，如果两个 skill 名字相似，但一个是面向用户沟通流程，另一个是面向底层部署脚本，它们就不该为了整洁而合并。

---

## 六、什么时候发生改写

“什么时候改写”不能只回答一个时间点。Hermes 把它分散在任务执行、回复完成和长期维护三个阶段，而且不同资产使用不同触发单位。

### 1. 任务进行中：前台 agent 主动写

只要相应工具可用，前台 agent 在执行任务时就可以调用 `memory` 或 `skill_manage`。用户也可以直接要求它记住某件事、创建 skill 或修补已有 skill。这条路径没有等待固定计数器：改写发生在模型已经识别出明确学习信号，并决定调用写入工具的时候。

但“允许随时写”不等于“每轮都会写”。memory 和 skill 的系统提示词会约束写入内容，skill 还可能经过 approval gate。尤其是用户明确要求前台创建的 skill，会被视为更接近用户拥有的资产，而不是自动交给 curator 改造的 agent-created skill。

### 2. 回复完成后：后台 review 按活动量触发

Hermes 还会在正常回复已经生成、当前任务没有被中断之后，异步启动 background review。它不会在前台解题过程中与主任务争夺模型注意力，也不会把 review prompt 和结果写回用户的真实会话历史；review fork 只拿会话快照，工具权限也被限制在 memory 和 skill 管理范围内。

Memory review 和 skill review 使用不同计数器：

| 审查对象 | 计数单位 | 当前源码默认值 | 为什么这样计数 |
| --- | --- | --- | --- |
| memory | 用户轮次 | 每 10 个用户轮次 | 用户画像、偏好和长期事实主要随持续对话积累 |
| skills | 工具迭代次数 | 累计 10 次工具迭代 | 程序性经验更可能出现在工具密集、步骤复杂的任务里 |

这里的 10 和 10 都来自当前配置默认值：`memory.nudge_interval` 与 `skills.creation_nudge_interval` 可以修改，也可以通过非正值关闭相应周期 review。真正稳定的设计不是某个数字，而是**memory 按对话轮次采样，skill 按工具活动量采样**。

为什么不是每次回复结束都改写？源码没有给出一条正式的产品论证，但从实现可以推断，这种采样同时控制额外模型调用成本和过度学习风险。简单问答未必产生值得固化的经验；工具活动密集的任务更可能形成新流程；把 review 放到回复之后，则让学习成为 best-effort 后台工作，即使失败也不影响用户刚刚请求的任务。

触发只代表“开始审查”，不代表“一定写入”。Review agent 仍要阅读轨迹并判断是否存在真实信号；平稳完成、没有用户纠正、也没有形成新技巧的会话，**可以输出 `Nothing to save.`**。因此 Hermes 的时间门槛解决的是“何时检查”，提示词规则解决的是“检查后写不写”。

### 3. 长期运行中：Curator 按周期维护

Curator 的时间尺度更长。自动 curator 开启时，长时间运行的 gateway 会在 housekeeping loop 中**定期轮询**，但只有距离上次运行超过 `curator.interval_hours` 才真正执行；当前默认间隔约为 7 天。首次观察到没有历史运行时间时，它会先记录时间并等待一个完整周期，而不是安装后立刻改动 skill 库。用户也可以通过命令手动运行或先做 dry run。

Curator 处理的不是“这一轮应该学到什么”，而是“累计下来的 skill 库是否需要治理”。确定性的生命周期迁移会依据闲置时间标记 stale 或归档；可选的 LLM consolidation pass 才会进一步合并重叠 skill、创建 umbrella、迁移支持文件。后台 skill review 与 curator 的关系可以理解为：前者持续产生和修补经验，后者周期性整理经验库。

因此，Hermes 的改写时间线不是一个统一的 episode-end hook，而是三个层次：

```text
任务进行中
  -> 前台 agent 发现明确信号，可立即写 memory / skill

正常回复完成后
  -> 用户轮次或工具迭代达到阈值
  -> 后台 review 重放会话并决定是否写入

长期运行期间
  -> curator 到达配置周期或被手动触发
  -> 整理、合并、标记和归档 skill 库
```

这套时间分层把“经验提取”和“资产治理”解耦了：前台路径处理明确意图，后台 review 从近期交互中提炼学习，curator 再以更慢的节奏控制技能库规模和可发现性。

---

## 七、改写后的内容如何进入上下文

Hermes 的闭环成立，关键不只是“能写”，还要看“写完怎么回到推理里”。

### `MEMORY.md` / `USER.md`

内置记忆会在会话开始时从磁盘加载，渲染为冻结快照，注入 system prompt。`agent/system_prompt.py` 把 memory snapshot、user profile、外部 memory provider block 放在 volatile tier。虽然叫 volatile，它仍然在一个 agent 会话内被缓存；会话中途通过 `memory` 写入的新内容会立即落盘，但通常要到下一次会话才进入 prompt。

有一个例外边界：源码里的 `invalidate_system_prompt` 会在上下文压缩后重新加载 memory。因此更准确地说，Hermes 不会因为一次 memory 写入立刻重建 prompt；它优先保持本会话 prompt 稳定，直到下一次会话或特定重建路径再捕获新快照。

### Skills

Hermes 不会把所有 `SKILL.md` 全量塞进 prompt。`tools/skills_tool.py` 明确采用 progressive disclosure：

```text
Level 0: skills_list()          -> name / description / category
Level 1: skill_view(name)       -> 完整 SKILL.md
Level 2: skill_view(name,path)  -> 指定支持文件
```

系统 prompt 里主要是 skill 索引和可用性信息。agent 判断需要某个 skill 时，再调用 `skill_view(name)` 读取完整内容；如果 skill 主文档指向支持文件，再用 `skill_view(name, "references/xxx.md")` 读取。用户也可以通过 `/<skill-name>` 显式加载。显式加载和 `skill_view` 都会更新 usage telemetry，从而影响 curator 对“最近是否活动”的判断。

### Session DB

会话数据库不会自动进入上下文。它是长期历史的检索层。只有 agent 调用 `session_search` 时，才会把命中窗口、bookends、滚动窗口或最近会话列表带回当前推理。

这也是为什么 session DB 和 memory 不冲突：memory 保存少量常驻结论，session DB 保留完整证据，需要时再取。

### Honcho

Honcho 的动态上下文通过 `<memory-context>` 注入到用户消息侧，并带有系统说明，标明它是背景数据而不是新的用户指令。Hermes 的 `agent/memory_manager.py` 还会清理泄漏回历史的 `<memory-context>` 块，避免上下文污染。

这个路径取决于配置。`recallMode=tools` 时没有自动注入；`context` 和 `hybrid` 模式才会注入。base context 与 dialectic supplement 还有各自 cadence 和预算。

### Curator

curator 不直接给当前对话塞内容。它通过改写、归档、合并 skills，改变未来的 skill 索引、`skill_view` 结果和 slash command 可见性。也就是说，curator 改变的是“未来 agent 能发现什么、加载什么、少被什么干扰”。

---

## 八、价值与边界

Hermes 这套机制的价值在于，它把“越用越懂你”拆成了可工程化的几件事。

第一，agent 越用越懂用户和环境。偏好、约定、工具坑点不必每次重讲。

第二，重复任务从重新推理变成调用沉淀流程。一次复杂任务如果被整理成 skill，下次 agent 可以直接加载操作步骤、判断标准和验证方式。

第三，经验可迁移。skills 是文件，支持材料也是文件；它们可以复制、审查、版本化，而不是被锁在某个模型权重里。

第四，自进化可审计。`MEMORY.md`、`USER.md`、`SKILL.md`、`.usage.json`、curator report 都是外部 artifact。用户可以看到 agent 记住了什么，也可以纠正它。

边界同样明显。

错误经验也可能被保存，所以需要字符上限、写入审批、归档、pinned 和 curator。自进化不是自动变聪明，而是把可复用经验放到正确层级。如果判断错了，系统不会变成专家，只会变成一个更自信的杂乱笔记本。

因此，Hermes 的关键是分层，而不只是“会写文件”：什么进入常驻记忆，什么留在历史库，什么沉淀为 skill，什么交给 curator 合并和归档。

回到标题，Hermes 改写的是自己的记忆、技能库和用户模型，并不改变大模型本身；这些内容再通过 prompt 注入、按需 skill 加载、历史检索和可选的 Honcho context 回到后续推理中。

**Hermes 的自进化，是让 agent 把一次任务里的经验，变成下一次任务可见、可调用、可维护的上下文资产。**

---

## 参考源码与文档

- `README.md`
- `tools/memory_tool.py`
- `tools/skill_manager_tool.py`
- `tools/skills_tool.py`
- `tools/skill_usage.py`
- `tools/session_search_tool.py`
- `hermes_state.py`
- `agent/system_prompt.py`
- `agent/background_review.py`
- `agent/turn_context.py`
- `agent/turn_finalizer.py`
- `agent/curator.py`
- `agent/memory_manager.py`
- `plugins/memory/honcho/README.md`
- `plugins/memory/honcho/__init__.py`
- `plugins/memory/honcho/session.py`
- `website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/user-guide/features/memory.md`
- `website/i18n/zh-Hans/docusaurus-plugin-content-docs/current/user-guide/features/skills.md`
