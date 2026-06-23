1. 概述
本指南说明如何创建和编写 AGENTS.md 文件，并对编写过程中的常见疑问进行了解答。
2. CLAUDE.md 与 AGENTS.md 的关系
2.1 为什么同时有CLAUDE.md 与 AGENTS.md？
● AGENTS.md是大多数AI Agent支持的项目记忆文件命名
● CLAUDE.md是Claude Code支持的项目记忆文件命名
● 除非可以确保团队始终统一使用Claude Code，否则需要参考下面的目录结构同时维护两个文件
2.2 目录结构
directory/
├── AGENTS.md    # 完整项目记忆文件（开发者维护）
└── CLAUDE.md    # Claude 入口，内容：@AGENTS.md
关系：claude.md 通过 @ 导入 AGENTS.md 作为单一真相源。
3. 如何初始化 AGENTS.md
3.1 手动创建
在组件目录中手动创建 AGENTS.md 文件
3.2 使用 /init 命令
如果可用，使用AGENT的 /init 命令生成初稿：
/init
然后手动修改生成的内容。
4. 推荐字段（推荐包含的内容）
4.1 核心元数据
字段	描述
Name	组件名称
Purpose	组件职责的简要描述
Primary Language	主要编程语言
4.2 目录结构
当前目录的目录结构说明，建议1-2层
## Directory Structure

. linter                                                                                                                                                                                        
  ├── cookbook_convertor/                                                                                                                                                                                                                                                                                                                                   
  ├── test/  (test suite)                                                                                                                                                                                                                                                                                                                                                        
  ├── scripts/                                                                                                                                                                                                                                                                                                      
  ├── src/  (source code)                                                                                                                                                                               
  │   ├── sdk                                                                                                                                                                               
  │   ├── lib                                                                                                                                                                               
  │   ├── cli                                                                                                                                                                               
  │   └── testRunner                                                                                                                                                                        
  ├── docs/  (document)                                                                                                                                                                               
  │   ├── rules-en                                                                                                                                                                          
  │   ├── rules                                                                                                                                                                             
  │   └── rules-cn                                                                                                                                                                          
  ├── bin/  (product)                                                                                                                                                                                
  │   └── tslinter.js                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       
  └── webpack.config.js 
4.3 编译构建说明
该组件如何构建的说明
## Building

```bash
npm run build # Full clean build: compile + pack
```
4.4 测试套说明
该组件如何进行代码测试
## Test suite

```bash
npm run test # full test
npm run testrunner -- -d  # run in specific directory
```
4.5 依赖说明
该组件依赖哪些库/包/外部组件，哪些地方会和外部目录进行交互
## Dependency

```bash
# package
- `typescript` - TypeScript compiler
- `webpack` - Application bundling
- `eslint`, `prettier` - Code quality

# directory dependency
- `ETS test`: ../../tests/test.sh
```
5. 禁止字段（不应该包含的内容）
5.1 通用编程知识
❌ 不要：解释基础 C++ 语法、标准库用法
❌ 示例："Vector 是一个自动增长的动态数组"
✅ 原因：AI 模型已知这些知识，会浪费上下文
5.2 重复父层内容
❌ 不要：复制父层 CLAUDE.md/AGENTS.md 的内容
❌ 示例：重复项目级的 License 模板
✅ 原因：渐进式加载已提供此信息
5.3 过时信息
❌ 不要：包含已废弃的 API 或已移除的功能
❌ 示例：2024 年已移除的 API 文档
✅ 原因：可能误导 AI 生成错误代码
5.4 非技术内容
❌ 不要：团队信息、会议纪要、营销语言
❌ 示例："本团队有10位经验丰富的开发者"
✅ 原因：与 AI 辅助开发无关
5.5 外部文档转储
❌ 不要：复制整个外部文档
❌ 示例：粘贴 3000 行的 C++ 风格指南
✅ 原因：应使用引用来节省上下文
5.6 实现细节（除非关键）
❌ 不要：描述内部实现，除非必要
❌ 示例：某个需求的逐步实现说明
✅ 原因：AI 可以直接读取代码；保存上下文用于高层指导
6. 完整模板示例（推荐英文）
# AGENTS
**Name**: linter
**Purpose**: This directory is a ArkTS-dynamic linter ...
**Primary Language**: TypeScript
---
## Directory Structure
```text
linter/
├── cookbook_convertor/
├── test/                   # Test suite
├── scripts/
├── src/                    # Source code
│   ├── sdk
│   ├── lib
│   ├── cli
│   └── testRunner
├── docs/                   # Documentation
│   ├── rules-en
│   ├── rules
│   └── rules-cn
├── bin/                    # Product
│   └── tslinter.js
└── webpack.config.js
```
---
## Building
To perform a full clean build (compilation + packaging), run the following command:
```bash
npm run build
```
---
## Test suite
To execute the code tests:
```bash
# Run full test suite
npm run test
# Run tests in a specific directory
npm run testrunner -- -d <directory_path>
```
---
## Dependency
### Package Dependencies
- `typescript` - TypeScript compiler
- `webpack` - Application bundling
- `eslint`, `prettier` - Code quality
### Directory / External Dependencies
- `ETS test`: ../../tests/test.sh
---
## Development Notes
- Always install dependencies before linting a project

7. FAQ
Q1: 如果我的组件涉及的依赖在不同深度层级怎么办？
A: 始终在当前AGENTS.md使用相对路径说明
/src/CLAUDE.md
../repo/subsystem/tests
../../core/comp/src/..
Q2: AGENTS.md 的推荐最大长度是多少？
A: 没有硬性限制，但考虑：
● 100-300 行：典型长度
● 300-600 行：较大组件
● 如果更长：考虑将详细信息沉淀为skill或用单独文档描述并引用
Q3: 如果当前目录的 AGENTS.md 与父目录的发生内容冲突怎么办？
A: 对于当前的主流AGENTS.md 规范，定义优先级通常是：
1. 用户对话信息优先级最高
2. 当前目录的 AGENTS.md（次高）
3. 父目录的 AGENTS.md（向上遍历）
如果担心发生冲突：很可能父目录的AGENTS.md包含了非通用信息，考虑是否需要将父目录的AGENTS.md的信息下沉到子目录