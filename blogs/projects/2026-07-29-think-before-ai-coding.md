# AI 写得太快了：从 grill-me、OpenSpec 到 Superpowers

先说清楚一个容易混淆的地方：grill-me、OpenSpec 和 Superpowers 都不是新的 AI 编程模型。它们不替代 Claude、GPT 或其他底层模型，而是运行在 Claude Code、Codex、Cursor 等 Coding Agent 之上的工作方法。

三者解决的问题不同：

> **grill-me 负责把需求问清楚；OpenSpec 负责把需求沉淀成规格；Superpowers 负责约束整个软件开发过程。**

AI coding 最危险的时刻，往往是它写得太顺了。

你说“给博客加一个文章收藏功能”，agent 立刻开始搜索文件、设计数据结构、修改页面。几分钟后，它告诉你功能已经完成。然后你才发现：收藏是只保存在当前浏览器，还是要跨设备同步？无痕模式怎么办？收藏列表放在哪里？搜索结果能否只看收藏？文章重命名后原来的收藏是否失效？

AI 没有偷懒。恰恰相反，它行动得太积极了。需求里没有说清楚的地方，它只能用概率最高的答案补齐；而它生成代码的速度，又让这些未经确认的假设迅速扩散到多个文件中。

这形成了当前 AI coding 一个很重要的矛盾：

```text
AI 想得少，干得快
        ↓
隐含假设很快变成代码
        ↓
功能“完成”后才发现不符合预期
        ↓
反复修改，甚至推倒重来
```

我们通常把 AI coding 的收益理解为“编码更快”，但真正应该优化的是从想法到可靠交付的总时间。生成代码只占其中一段。需求偏差、遗漏、回归和返工，同样属于开发成本。

`grill-me`、OpenSpec 和 Superpowers 都在尝试解决这个问题，只是它们施加约束的位置和强度不同。本文不准备选出一个“最佳工具”，重点是建立一个习惯：

> 在允许 AI 执行之前，先让它帮助我们把问题想清楚。

## 默认流程太容易鼓励 AI 立即行动

coding agent 的产品体验通常围绕“完成任务”设计。用户提出一个动作型请求，它就倾向于读代码、列计划、调用工具、修改文件。这种积极性在明确任务上非常高效，但在模糊任务上会产生三个问题。

第一，聊天中的自然语言经常只描述目标，没有描述边界。“增加收藏功能”说了要什么，却没有说数据保存在哪里、哪些页面需要入口、哪些情况不支持。

第二，人自己也未必已经想清楚。很多细节并不是被遗忘了，而是只有在有人连续追问时才会第一次浮现。此时要求 AI “严格遵守需求”并没有用，因为需求本身还不存在。

第三，代码会制造一种虚假的确定感。方案仍是一段文字时，推翻它很便宜；当它已经变成十个文件的 diff，人的心理会自然转向“在现有实现上修补”。错误决策因此变得越来越昂贵。

所以，“先思考”不是让模型在内部多运行几秒，也不只是打开更高的 reasoning 档位。它更接近一种流程设计：把提问、比较、确认和验收放到写代码之前，并为 AI 设置一个清晰的行动门槛。

## 三种方法，约束的是三个不同层次

粗略看，三者可以放在一条由轻到重的轴上：

| 方法 | 本质 | 主要解决什么 | 覆盖范围 |
| --- | --- | --- | --- |
| grill-me | 单个 Agent Skill / 访谈流程 | 需求含糊、方案考虑不周 | 需求澄清 |
| OpenSpec | Spec-Driven Development 工具与规范体系 | 需求只存在聊天中，后续容易偏离 | 需求、设计、任务与变更管理 |
| Superpowers | Agent 软件工程方法论与 Skills 集合 | Agent 直接写代码，缺少测试、调试和评审纪律 | 从需求到实现、测试、调试和评审 |

但这张表也容易造成误解。它们并非严格的替代品。

grill-me 来自 Matt Pocock 的 skills 仓库，是一种访谈机制。当前 skill 的实现非常克制：它只要求启动一次 grilling session，官方描述是“A relentless interview to sharpen a plan or design”。重点不在模板，而在“持续追问，直到计划经得起质疑”。它能被放在任何工作流之前。[grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md)

OpenSpec 是规格层。它把聊天中容易消失的共识，沉淀为跟随代码版本管理的 Markdown 资产。默认的 spec-driven schema 将一次 change 拆成 proposal、specs、design 和 tasks：为什么改、系统应该表现成什么样、准备怎么实现、具体做哪些工作。它尤其强调用 `WHEN/THEN` 场景描述可观察行为，而不是把实现细节伪装成需求。[OpenSpec](https://github.com/Fission-AI/OpenSpec)

Superpowers 则更像一套完整的软件开发方法。它从 brainstorming 开始，在实现前设置设计批准门槛，随后进入隔离工作区、详细计划、TDD、分任务执行、代码审查和完成前验证。它约束的不只是“写什么”，还包括“以什么顺序写、如何证明写对了”。[Superpowers](https://github.com/obra/superpowers)

因此，更准确的关系是：

```text
grill-me：提高问题的清晰度
OpenSpec：保存并维护需求共识
Superpowers：把共识变成受控的工程执行
```

## 同一个需求，三种工具分别会怎么做

假设我们的原始需求只有一句：

> 给博客增加文章收藏功能。

这个例子很适合测试“先想后做”，因为它看起来足够简单，足以诱使 agent 立即动手；但只要多问几层，就会发现许多产品和技术选择。

### grill-me：先证明这句话足够明确

一次 grilling 可能像这样：

```text
AI：收藏给谁使用？匿名访客、登录用户，还是两者都支持？
人：博客没有账号系统，只支持匿名访客。

AI：收藏保存到浏览器 localStorage，可以接受无法跨设备同步吗？
人：可以，第一版不做服务端。

AI：用户在哪里收藏？文章列表、阅读页，还是两个位置都有？
人：两个位置都有，并且状态需要同步。

AI：用户如何查看已收藏文章？
人：在项目分类旁边增加“收藏”筛选，不做独立页面。

AI：搜索和收藏筛选能否组合？
人：可以，先筛收藏，再按当前搜索词过滤。

AI：文章改名或移动后如何识别原收藏？
人：使用文章 slug；slug 变化导致收藏失效可以接受，但需要忽略失效记录。

AI：怎样才算完成？
人：刷新后收藏仍存在；列表与阅读页状态一致；搜索、排序和直达链接不回归；
    localStorage 不可用时页面仍可阅读，只是不持久化收藏。
```

这些回答没有一行代码，却已经避免了几种完全不同的实现方向：不需要账号系统，不需要后端数据库，不需要新页面，也不需要为文章建立永久 ID。

grill-me 的优势是轻。它几乎不要求项目改造，也不规定必须生成什么文件。对于尚处在“我有个想法”阶段的需求，这种高密度追问往往比立即写一份正式设计更有效。它还会逼出一个常被忽略的事实：有些问题不是 AI 不知道答案，而是人此前根本没有作出决定。

它的弱点也来自这种轻量。回答通常留在对话里，新的会话、新的 agent 或新的团队成员未必能看到；它也不负责保证这些结论被完整转化为任务、测试和验收。grilling 解决的是“有没有问到”，不自动解决“是否被长期遵守”。

因此，它更像一个 AI 产品经理或架构评审专家的追问模式。除了编码需求，也可以用来检查 PRD、API、数据模型、技术选型和实施计划。

### OpenSpec：把回答变成项目里的行为契约

如果这个功能需要跨几次会话完成，或者之后还会继续演进，就可以把 grilling 的结果交给 OpenSpec。

首先是 proposal。它解释为什么要做、改变哪些能力、影响哪些区域：

```markdown
## Why

读者目前无法在本地保存感兴趣的文章，需要反复搜索才能重新找到内容。

## What Changes

- 在文章列表和阅读页提供收藏/取消收藏操作
- 使用 localStorage 持久化收藏 slug
- 支持收藏筛选与现有搜索、排序组合
- 存储不可用时降级为当前会话内状态
```

随后是 spec。这里不写“增加一个 `FavoriteStore` 类”，因为类名是实现选择，不是用户能依赖的行为。OpenSpec 的默认规范更关注可验证场景：

```markdown
### Requirement: 收藏状态持久化
系统 SHALL 在浏览器存储可用时保存用户收藏的文章 slug。

#### Scenario: 刷新后恢复收藏
- **WHEN** 用户收藏一篇文章并刷新页面
- **THEN** 列表页和阅读页均显示该文章已收藏

#### Scenario: 存储不可用
- **WHEN** 浏览器拒绝访问持久化存储
- **THEN** 用户仍可阅读文章且收藏操作不会导致页面报错
```

design 再决定如何实现：存储 key 的格式是什么，状态由哪个模块管理，列表和阅读页如何复用接口，初始化失败如何降级。tasks 最后才把设计拆成可以跟踪的修改。

这条链路最有价值的地方，是把四类问题分开：

- proposal 回答为什么做、范围多大；
- specs 回答外部可观察行为；
- design 回答技术选择及权衡；
- tasks 回答执行顺序。

OpenSpec 的 OPSX 工作流也并非不可回退的瀑布模型。需求明确时可以直接 `/opsx:propose`，不明确时先用 `/opsx:explore` 读取代码、比较方案；实现中发现设计错误，还可以更新 artifacts，再继续 apply。它希望维护的是持续一致的共识，而不是一次写完就不能改变的文档。[OPSX workflow](https://github.com/Fission-AI/OpenSpec/blob/main/docs/opsx.md)

对于 AI coding 时代之前就存在的项目，它还有一个非常重要的建议：不要为了采用 spec-driven development，先给整个旧系统补规格。正确做法是只描述本次变化，用 `ADDED`、`MODIFIED`、`REMOVED` delta 逐步积累可信 spec。一次性回填大量历史行为，不但成本高，而且很容易生成没人验证、很快过时的“文档幻觉”。[Using OpenSpec in an Existing Project](https://github.com/Fission-AI/OpenSpec/blob/main/docs/existing-projects.md)

### Superpowers：不仅先想，还限制怎么执行

如果“文章收藏”只是一个更大会员系统的第一步，后续还涉及登录、跨设备同步、隐私、离线冲突和数据迁移，那么仅有一组 spec 可能还不够。真正容易出错的部分会延伸到实施过程。

Superpowers 的 brainstorming 会先读取现有项目，再逐个澄清需求，给出两到三种方案及权衡，分段展示设计并等待批准。设计确认后，writing-plans 会把它写成足够具体的实施计划：精确到修改哪些文件、各模块提供什么接口、先写哪一个失败测试、运行什么命令看到什么失败、最小实现是什么、怎样验证通过。

随后它还会继续施加约束：

```text
brainstorming
  → 用户批准设计
  → 隔离 worktree
  → writing-plans
  → TDD：RED → GREEN → REFACTOR
  → 按任务执行
  → 任务级审查
  → 全局审查
  → 重新运行验证
  → 才能声明完成
```

用收藏功能举例，一个任务不会只是“实现收藏逻辑”，而可能被定义为：

1. 先为存储成功、损坏数据和存储异常写失败测试；
2. 运行指定测试，确认失败原因确实是功能尚未实现；
3. 实现最小收藏存储接口；
4. 再运行测试确认通过；
5. 由 reviewer 检查是否满足 spec，以及是否引入不必要设计；
6. 最后再让 UI 任务依赖这个已经验证的接口。

Superpowers 试图防止的是另一类偏差：需求已经想清楚，但 agent 在长时间实现过程中逐渐偏离计划，跳过测试，或在没有新证据时宣布“已经完成”。它用 worktree、TDD、任务边界、独立 review 和 verification 把执行也纳入约束。

代价同样明显。即使设计很短，完整流程仍然会产生更多对话、文档、测试和审查步骤。对于低风险小改动，这些步骤可能比代码本身更贵。它适合的是返工代价高、任务可拆分、需要长时间自治执行的工作，而不是所有改动。

## 用不确定性选择方法

“小改动用 grill-me，中型需求用 OpenSpec，复杂开发用 Superpowers”可以作为第一版经验，但不能机械地按代码行数分类。

有些改动只改五行，却涉及支付幂等性或权限校验，应该先写清行为并认真验证。有些改动影响几十个配置项，却是确定性的机械迁移，未必需要漫长访谈。

更可靠的判断维度有四个：

| 维度 | 低 | 高 |
| --- | --- | --- |
| 需求不确定性 | 输入、输出和边界已经明确 | 目标清楚，但大量细节未决 |
| 影响面 | 单文件、局部、无外部契约 | 跨模块、跨服务或影响用户数据 |
| 可逆性 | 出错后容易撤销 | 涉及迁移、兼容性或不可逆状态 |
| 验收难度 | 一个命令即可判断 | 需要多个场景、人工判断或长期观察 |

四项都低时，可以直接执行并验证。只要“不确定性”升高，先 grilling；需要跨会话保存共识时，引入 OpenSpec；影响面、不可逆性和验收难度继续升高时，再采用 Superpowers 式完整流程。

这不是三个互斥档位。一个复杂任务完全可以组合使用：

```text
grill-me
  → 把需求和边界问清楚
OpenSpec
  → 把结论沉淀为 proposal / specs / design / tasks
Superpowers
  → 通过 TDD、分任务执行、代码评审和验证完成实现
```

换句话说，grill-me 是一场需求审讯，OpenSpec 是一本持续演进的规格账本，Superpowers 是一套约束 Coding Agent 的软件工程制度。

## 老项目：先理解现实，再描述变化

AI coding 时代之前形成的项目，最大的风险是大量真实约束只存在于代码、测试、配置、部署脚本和人的经验中，一份漂亮 spec 无法弥补这一点。

对这类项目，最佳实践是：

1. **先让 AI 读取相关路径并追踪真实调用链。** 不要先让它根据通用经验设计。现有命名、依赖、兼容行为和失败处理都是需求的一部分。
2. **先运行基线验证。** 如果修改前测试就失败，完成后的“仍然失败”不能证明是本次改动导致；反过来，缺少基线也会让 agent 误报成功。
3. **只规格化当前变化。** 不要要求 AI 一夜之间为整个遗留系统生成文档。没有通过真实变更验证的 spec，很容易只是对代码的有损复述。
4. **把隐含行为写成场景。** 特别是兼容性、降级、旧数据和错误路径。这些通常正是 AI 最容易遗漏的部分。
5. **限制顺手重构。** 只处理直接阻碍本次目标的问题。大范围“顺便优化”会放大 review 难度，也让需求偏差更难定位。
6. **让验证覆盖原有能力。** 新功能测试通过不等于旧功能没有回归。像本博客这样的项目，还要检查分类导航、搜索、排序、直达链接、Markdown 和 Mermaid 渲染。

面对老项目，应先建立对现实系统足够准确的模型，再设计理想系统。

## 新项目：先确定边界，再追求速度

从零开发没有历史包袱，却更容易过度设计。因为没有现成代码约束，AI 可以非常自然地补出账号、权限、消息队列、缓存、插件系统和抽象层。

新项目更需要提前明确：

- 谁是第一批用户，他们要完成的核心动作是什么；
- 第一版明确不做什么；
- 哪个最小垂直切片能够端到端验证价值；
- 数据模型和外部接口中，哪些决定以后很难撤销；
- 用什么可观察结果判断第一版成功；
- 哪些扩展点有真实近期需求，哪些只是“未来也许需要”。

在这个阶段，grilling 用来削减想当然的功能，OpenSpec 用来保存目标、非目标和核心行为，Superpowers 式计划则应围绕最小垂直切片展开。不要用文档页数冒充清晰度，也不要让 detailed plan 提前锁死仍需实验的技术细节。

对新项目而言，“先想清楚”不等于“预先想完一切”。真正应该提前决定的是方向、边界、风险和验收；可以通过低成本实验回答的问题，就应该尽快做 spike，再把新证据更新回设计。

## 什么时候三个都不该用

流程本身也会形成依赖。

如果需求是“把配置里的超时时间从 30 秒改成 60 秒”，而配置位置、影响范围和验证方法都很明确，那么启动长时间 grilling、建立 change artifacts、再走完整 TDD 与 review 流程，可能只是浪费。

类似的任务还包括：

- 修正确定性的错别字；
- 更新一个明确版本号；
- 按既定规则执行机械重命名；
- 修改单一、可立即验证且容易回滚的配置值。

这时更合理的约束可能只有三步：确认目标文件和影响范围，执行修改，运行对应验证。

需要警惕的是把某个工具变成条件反射，而非单纯担心“流程太少”。工具的价值来自它降低了错误与返工成本；当流程成本高于风险成本时，就应该减轻甚至跳过。

## 结语：晚一点写代码，可能更早交付

grill-me、OpenSpec 和 Superpowers 都在尝试推迟未经确认的行动，生成更多 Markdown 只是可能出现的副产品。

grill-me 用追问让隐藏假设浮出水面；OpenSpec 把人机共识变成可追踪的行为契约；Superpowers 再把这种约束延伸到计划、测试、执行、审查和验证。它们解决的是不同层次的问题，也承担不同强度的流程成本。

不存在最佳工具。真正值得保留的是一个可以脱离任何工具存在的习惯：下一次把需求交给 coding agent 时，不要先说“开始实现”，而是先要求它完成三件事：

1. 用自己的话复述目标和非目标；
2. 列出会改变方案的未知项与隐含假设；
3. 给出可以判断完成的验收场景。

如果三件事几分钟就能完成，直接行动。如果问题越问越多，就升级到规格和完整工程流程。

AI coding 的关键能力包括让 AI 写得更快，也包括知道什么时候还不该让它写。

## 参考资料

1. [Matt Pocock skills：grill-me](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md)
2. [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)
3. [OpenSpec：Explore First](https://github.com/Fission-AI/OpenSpec/blob/main/docs/explore.md)
4. [OpenSpec：Using OpenSpec in an Existing Project](https://github.com/Fission-AI/OpenSpec/blob/main/docs/existing-projects.md)
5. [OpenSpec：OPSX Workflow](https://github.com/Fission-AI/OpenSpec/blob/main/docs/opsx.md)
6. [obra/superpowers](https://github.com/obra/superpowers)
7. [Superpowers：brainstorming skill](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md)
8. [Superpowers：writing-plans skill](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md)
9. [Superpowers：test-driven-development skill](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md)
10. [Superpowers Plugin｜Claude](https://claude.com/plugins/superpowers)
