# 项目记忆文件：CLAUDE.md / AGENTS.md

如果把 coding agent 当成一个会写代码的聊天机器人，`CLAUDE.md` 和 `AGENTS.md` 看起来就只是两份“说明文档”。但如果把 agent runtime 拆开看，它们的位置要更靠前：它们不是给人读的 README，而是给模型读的项目级 system prompt。

每一轮任务开始前，agent 都要重新构建一次模型可见上下文。这个上下文里不只有用户刚刚输入的话，还会有系统规则、工具说明、权限约束、当前工作目录、历史摘要，以及从项目中发现的持久化指令。`CLAUDE.md` / `AGENTS.md` 就是在这个阶段被加载进来的。

所以项目记忆文件解决的不是“文档放在哪里”的问题，而是一个更底层的问题：

> 当 agent 每次进入一个仓库时，怎样稳定地获得这个项目的工作方式？

这篇文章从时间线、运行机制和实践规则三个层面讲清楚这件事。

---

## 一、从 Prompt 到项目记忆

早期使用大模型写代码时，很多上下文都靠用户临时补充：

```text
这个项目用 pnpm。
提交前要跑 npm test。
不要改 generated 文件。
CSS 用两空格缩进。
这个目录下面的服务不能直接访问数据库。
```

这些话第一次说很自然，第二次说就开始烦，第三次说明系统设计已经有问题了。

prompt engineering 的第一阶段，重点是“如何把这一次问题问清楚”。用户把目标、约束、输出格式、示例和注意事项都写进一个 prompt 里，希望模型一次性做对。

但 coding agent 的工作不是一次性问答。它要反复进入同一个仓库，读文件、改代码、运行测试、处理失败、再改代码。很多规则不是当前任务独有的，而是项目长期存在的事实：

- 项目结构和重要目录。
- 构建、测试、lint 命令。
- 代码风格和命名约定。
- 哪些文件是生成物，不能手改。
- PR、commit、验证步骤的团队习惯。
- 某个子目录里特殊的架构边界。

如果每次都靠用户重新输入，agent 的行为就不稳定：用户少说一句，它就可能用错包管理器、跑错测试、改错目录，或者把临时输出提交进去。

项目记忆文件就是这个问题的工程化答案。它把“每次进入这个项目都应该知道的事”写进仓库，让 agent runtime 在启动时自动读取。

从这个角度看，`CLAUDE.md` / `AGENTS.md` 是 prompt 从一次性文本走向工程资产的标志：

```text
临时 prompt
  -> 可复用 prompt 模板
  -> 项目级 instructions
  -> 分层加载的项目记忆
  -> 团队级 agent 工作协议
```

它仍然是自然语言，但它已经不再只是聊天内容，而是项目运行环境的一部分。

---

## 二、项目记忆文件的本质：项目级 System Prompt

在一次 agent 会话里，模型看到的内容通常不是用户消息本身，而是 runtime 组装后的 prompt。这个 prompt 可能包含：

```text
base system instructions
developer instructions
tool definitions
permission and sandbox policy
project memory files
current user request
conversation history or compact summary
tool results
```

`CLAUDE.md` / `AGENTS.md` 会进入其中的 project memory 或 project instructions 部分。它们的本质是：

> 一个随项目一起版本化、在任务开始时自动注入上下文的项目级 system prompt。

这句话有几个含义。

第一，它是“项目级”的。它描述的不是某个用户今天想做什么，而是这个仓库长期成立的事实和约束。比如“这个项目是静态博客”“新增文章后要运行生成索引脚本”“不要手动编辑生成文件”。

第二，它是“system prompt 风格”的。它不是写给人类快速浏览的市场介绍，而是写给 agent 执行任务时遵守的指令。好的项目记忆文件应该短、准、可执行，而不是泛泛而谈。

第三，它是“自动注入”的。用户不需要每次说“请先阅读项目规范”。agent runtime 会在启动或任务开始时发现这些文件，把它们和其他上下文一起送进模型。

第四，它仍然只是“上下文”，不是强制执行机制。模型会尽量遵守，但它不会像类型系统、权限系统或 CI 那样形成硬约束。如果你要禁止某个危险动作，应该使用 sandbox、approval、hook、CI、代码权限和分支保护，而不是只在 `AGENTS.md` 里写一句“不要这样做”。

所以更准确的分层是：

| 层级 | 作用 | 例子 |
| --- | --- | --- |
| 项目记忆 | 让模型知道项目该怎么工作 | `AGENTS.md`、`CLAUDE.md` |
| 配置 | 让 runtime 知道默认行为 | model、sandbox、approval、MCP |
| 权限 | 限制实际可执行动作 | 文件权限、hook、审批 |
| 验证 | 判断结果是否可接受 | tests、lint、CI、review |

项目记忆文件很重要，但它不应该承担所有控制责任。

---

## 三、CLAUDE.md 与 AGENTS.md：专用入口和开放格式

`CLAUDE.md` 最容易理解：它是 Claude Code 的项目记忆入口。Claude Code 会在会话开始时读取这些文件，把它们作为持久项目指令加载到上下文里。Anthropic 的文档也明确提醒：这些内容会消耗上下文，并且是 context，不是 enforced configuration。

`AGENTS.md` 的定位更开放。它试图成为“给 coding agents 看的 README”：一个简单、普通 Markdown 格式、可跨 agent 复用的项目说明入口。Codex、Aider、OpenCode、Cursor、Goose 等工具都在不同程度上支持或接近这个方向。

这两者的关系可以这样理解：

```text
CLAUDE.md
  -> Claude Code 生态里的项目记忆入口

AGENTS.md
  -> 更通用的 agent 项目记忆格式
```

如果一个团队只使用 Claude Code，维护 `CLAUDE.md` 就足够。如果团队里会混用 Codex、Claude Code、Cursor、OpenCode 或其他 coding agent，更稳妥的做法是把 `AGENTS.md` 作为单一事实源，然后让 `CLAUDE.md` 作为 Claude 的入口：

```text
repo/
├── AGENTS.md     # 完整项目记忆，由团队维护
└── CLAUDE.md     # Claude 入口，可引用或同步 AGENTS.md
```

这个结构的价值不是少写一个文件，而是减少分叉。当 `CLAUDE.md` 和 `AGENTS.md` 里同一条规则写得不一样时，agent 的行为会变得不可预测，团队也很难判断到底哪份才是准的。

从更大的时间线看，这其实是 agent 工程从厂商专用能力走向开放约定的缩影。早期每个工具都有自己的 prompt 配置、记忆文件、规则文件和工作区上下文。随着 agent 进入真实软件项目，团队开始需要一个能跟随仓库流动、能被多个工具理解、能被代码 review 的协作协议。

`AGENTS.md` 就处在这个位置上：它不是复杂标准，而是用最小格式承载最多共识。

---

## 四、多目录、多层级加载：为什么一个项目可以有多个

单仓库项目里，一个根目录的项目记忆通常够用。但大型项目、monorepo 或多语言仓库里，单个文件很快会变得混乱。

比如一个仓库可能同时包含：

```text
repo/
├── AGENTS.md
├── frontend/
│   └── AGENTS.md
├── backend/
│   └── AGENTS.md
└── infra/
    └── AGENTS.md
```

根目录的 `AGENTS.md` 适合写全局事实：

- 这个仓库的总体结构。
- 通用构建和验证策略。
- 所有目录都要遵守的代码规范。
- 安全、提交、生成物等跨项目约束。

子目录的 `AGENTS.md` 适合写局部事实：

- `frontend/` 使用哪个框架和组件库。
- `backend/` 使用哪个测试命令和数据库迁移方式。
- `infra/` 哪些命令危险、哪些环境不能动。

加载时，runtime 通常会从更广的范围走向更具体的范围。以 Codex 的公开文档为例，它会先读全局指导，再从项目根目录沿当前工作目录向下查找项目指导，并按从根到当前目录的顺序合并。越靠近当前目录的说明出现在越后面，因此更容易覆盖前面的通用说明。

这就形成了一种很自然的层级结构：

```text
用户当前消息
  > 当前目录 AGENTS.md / CLAUDE.md
  > 父目录 AGENTS.md / CLAUDE.md
  > 仓库根目录 AGENTS.md / CLAUDE.md
  > 用户级或组织级默认规则
```

这里的“大于”不是所有实现里严格的权限符号，而是工程上应该遵守的解释原则：越靠近当前任务的信息越具体，越应该作为当前工作的依据。

也正因为有这套分层，项目记忆文件不应该靠复制粘贴扩展。子目录不要重复父目录已经写过的通用规则，而应该只补充差异。否则多层级加载后，同一条规则会在上下文里出现多次，既浪费 token，又容易产生冲突。

---

## 五、应该写什么，不应该写什么

一个好的项目记忆文件不是越详细越好。它要解决的是“agent 每次进来都应该知道什么”，而不是“把项目所有文档塞给模型”。

比较推荐写的内容包括：

```markdown
# AGENTS

**Name**: blog
**Purpose**: Static GitHub Pages personal blog.
**Primary Language**: HTML, CSS, JavaScript, Markdown

## Directory Structure

- `blogs/tech/`: technical posts
- `blogs/papers/`: paper notes
- `blogs/projects/`: project posts
- `notes/`: scratch notes, not surfaced in frontend
- `scripts/`: static data generators

## Build and Test

- Preview with `python3 -m http.server 8000`
- Regenerate blog index with `node scripts/generate-blog-data.mjs`
- Check JavaScript syntax with `node --check script.js`

## Development Notes

- Do not edit `blog-data.js` by hand.
- New blog files should use date-prefixed slugs.
```

这些内容的共同点是：稳定、项目特定、会影响 agent 行为。

不推荐写的内容也很明确。

- 不要写通用编程知识。比如“数组是一种线性数据结构”“React 组件可以用 props 传参”。模型早就知道这些，写进去只会浪费上下文。
- 不要重复父层内容。如果根目录已经写了提交规范，子目录只需要写差异，不要再复制一遍。
- 不要写过时信息。项目记忆一旦过时，比没有还危险。agent 会把它当作当前项目事实，按错误路径执行。
- 不要把外部文档整篇粘进来。长规范、长流程、长 API 文档应该放在独立文档里，用链接或路径引用。只有那些每次都必须出现的短规则，才适合直接写进项目记忆。
- 不要写非技术内容。团队口号、会议纪要、营销介绍、成员背景，通常都不会帮助 agent 改代码。
- 也不要把某个需求的临时实现步骤写进长期项目记忆。项目记忆不是任务计划。一次性的多步任务更适合放进 `PLANS.md`、issue、PR 描述或当前对话。

一个实用判断标准是：

> 如果这条信息会影响未来十次 agent 任务，就写进项目记忆；如果只影响当前一次任务，就留在当前对话或计划文件里。

---

## 六、从 Prompt Engineering 到 Context Engineering

`CLAUDE.md` / `AGENTS.md` 的出现，说明 coding agent 的重点正在从“如何写一个好 prompt”转向“如何管理一个稳定上下文系统”。

在早期聊天模型里，prompt 是一次性的输入。到了 tool call 阶段，prompt 需要描述工具、函数 schema 和调用约束。到了 agent 阶段，prompt 又开始包含工作区、权限、历史、计划、技能、子 agent 报告和压缩摘要。

项目记忆文件处在这条演进线的中间：

```text
2022 前后：Prompt engineering
  关注如何在单轮输入里表达任务

2023 前后：Function call / Tool use
  关注模型如何稳定调用外部能力

2024 前后：Coding agent 工作区
  关注模型如何读写真实项目、运行命令、完成多步任务

2025 前后：项目记忆、Skills、MCP、Subagent
  关注上下文、能力和协作方式如何被长期组织
```

这里的变化不只是文件名变化，而是抽象层级变化。

当 agent 只回答问题时，用户 prompt 就是主要接口。当 agent 开始修改仓库时，项目本身必须提供机器可读的工作说明。当多个 agent、多个团队、多个目录共同工作时，这些说明还要能分层、能覆盖、能被版本控制、能被 review。

这就是 context engineering 的核心：不是把所有信息都塞进上下文，而是决定什么信息应该在什么时机、以什么优先级、用多少 token 进入上下文。

项目记忆文件是最简单的一层，也是最容易被低估的一层。它没有 MCP 那样的协议复杂度，没有 skills 那样的分层资源结构，也没有 subagent 那样的调度模型。但它会影响 agent 每一次任务的第一步。

第一步如果错了，后面的工具调用、代码修改和测试验证都会沿着错误上下文继续走。

---

## 七、FAQ：几个最容易混淆的问题

### 1. 加载顺序是什么？

不同 agent 的实现细节不完全一样，但主流设计都遵循“从通用到具体”的方向。

通常可以这样理解：

```text
组织级 / 用户级默认规则
  -> 仓库根目录项目记忆
  -> 当前工作目录路径上的子目录项目记忆
  -> 当前用户消息
```

Codex 的文档里把这称为 instruction chain：先加载全局 scope，再从项目根目录向当前工作目录逐层加载，并按根目录到当前目录的顺序合并。Claude Code 也区分组织、用户、项目等不同范围的记忆文件，并在会话开始时加载。

对使用者来说，最重要的不是背某个工具的内部字段，而是记住原则：越晚进入上下文、越靠近当前任务的指令，越应该具体。

### 2. 不同层级冲突怎么办？

优先级应该这样判断：

```text
当前用户明确要求
  > 当前目录项目记忆
  > 父目录项目记忆
  > 仓库根目录项目记忆
  > 用户级 / 组织级默认规则
```

比如根目录说“JavaScript 修改后运行 `npm test`”，但 `frontend/AGENTS.md` 说“本目录使用 `pnpm test:unit`”，那么在 `frontend/` 工作时，应该按子目录规则执行。

如果这种冲突经常出现，通常说明父目录写得太具体。更好的做法不是让 agent 每次猜，而是把局部规则下沉到对应子目录，让根目录只保留真正全局成立的规则。

### 3. 多层级都会加载吗？

通常会加载路径上的多个文件，但具体策略取决于 agent runtime。

Codex 会从项目根目录走到当前工作目录，每层最多选一个项目指导文件，并把它们合并。`AGENTS.override.md` 这类 override 文件可能会优先于普通 `AGENTS.md`。Claude Code 则围绕 `CLAUDE.md` 和不同 scope 的 memory 组织启动上下文。

所以实践上可以按这个规则设计：

- 根目录写全局规则。
- 子目录只写差异和局部约束。
- 不要复制父目录内容。
- 不要依赖两个同级文件同时生效。
- 如果要跨工具兼容，优先维护 `AGENTS.md`，再处理 `CLAUDE.md` 入口。

### 4. 会不会占用上下文数量？

会。

项目记忆文件本质上是被注入模型上下文的文本，因此一定会占用 token。文件越长，留给对话历史、代码片段、工具结果和模型推理的空间就越少。

这也是为什么项目记忆要短、准、稳定。推荐把它当作索引和行为约束，而不是资料仓库：

- 高频、稳定、必须知道的规则直接写进去。
- 长流程放到独立文档，只在项目记忆里写路径。
- 复杂工作流沉淀为 skill 或脚本。
- 过时规则及时删除。

一个经验范围是：100 到 300 行通常比较健康；300 到 600 行已经需要警惕；再长就应该考虑拆分、下沉到子目录，或者把细节移到专门文档。

### 5. CLAUDE.md 和 AGENTS.md 是否都要维护？

不一定。

如果团队始终只用 Claude Code，`CLAUDE.md` 就可以作为主入口。如果团队希望同一套项目记忆被多个 coding agent 复用，更推荐把 `AGENTS.md` 作为单一事实源。

一种常见结构是：

```text
repo/
├── AGENTS.md
└── CLAUDE.md
```

其中 `AGENTS.md` 写完整内容，`CLAUDE.md` 只作为 Claude Code 的入口，引用或同步 `AGENTS.md`。这样可以避免同一条规则在两个文件里漂移。

### 6. 它和 README 有什么区别？

README 主要服务人类读者。它解释项目是什么、怎么开始、怎么贡献，强调可读性和背景信息。

项目记忆文件主要服务 agent。它关心的是执行任务时必须遵守的上下文：命令、约束、目录边界、验证方式、不要做什么。

两者可以有重叠，但不应该互相替代。README 可以写得友好，项目记忆文件应该写得可执行。

---

## 结语

`CLAUDE.md` / `AGENTS.md` 看起来只是仓库里的 Markdown 文件，但它们实际承担的是 agent 时代的项目入口协议。

对人类开发者来说，进入一个项目先看 README。对 coding agent 来说，进入一个项目应该先获得项目记忆。前者帮助理解，后者影响执行。

当 agent 只是偶尔补全几行代码时，这种差异不明显。当 agent 开始承担跨文件修改、测试验证、代码审查、迁移重构和长任务协作时，项目记忆文件就会变成基础设施。它决定 agent 每次开始工作时，是站在一个清晰的项目语境里，还是从一片空白重新猜测。

未来的 agent 工程不会只比模型参数、工具数量或上下文窗口大小。更重要的是：项目能否把自己的工作方式，以稳定、分层、可维护的形式交给 agent。

`AGENTS.md` 和 `CLAUDE.md` 正是这条路上的早期形态。

---

## 参考资料

- [Claude Code: How Claude remembers your project](https://code.claude.com/docs/en/memory)
- [Codex: Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [AGENTS.md open format](https://agents.md/)
- [Codex best practices: Make guidance reusable with AGENTS.md](https://developers.openai.com/codex/learn/best-practices)
