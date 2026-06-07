# AI Agent 多租户工作区隔离：从文件存储到沙箱容器的架构设计

AI Agent 和传统 SaaS 有一个关键差异：Agent 不是只读数据库、返回 JSON，它需要在真实的操作系统环境里执行代码、读写文件、安装依赖。当一个平台要服务多个用户、每个用户有多个对话时，一个根本问题就出现了——如何让 Agent 拥有真实的执行环境，又确保不同用户、不同对话之间的数据和操作绝对隔离？

这篇文章从文件存储、向量检索、沙箱容器、生命周期管理到底层运行时选型，梳理一套完整的隔离架构设计。文中引用的数据和方案均基于 2025–2026 年的生产实践。

---

## 一、问题的本质：隔离三角

Agent 工作区隔离面临三个互相制约的目标：

```
        安全性
        （绝对隔离）
          /\
         /  \
        /    \
       /______\
持久化          资源效率
（跨会话状态）    （按需分配）
```

- **安全性**：Agent 执行的是 LLM 生成的代码——不可信、未经审查、可能被 prompt injection 操纵。一旦逃逸，影响的不只是一个对话。
- **持久化**：用户隔天回来，期望文件还在、依赖还在、上下文还能接上。
- **资源效率**：GPU 和内存昂贵，不能为每个对话永久占用一台虚拟机。

任何单点方案都只能满足其中两个。把这三角同时解开的思路是：**计算无状态化 + 存储持久化 + 按需重建**——这也是贯穿全文的核心设计原则。

---

## 二、文件存储与知识隔离

Agent 需要处理用户上传的文件（文档解析、RAG 检索、代码生成），这些文件必须在用户间和对话间同时做到可见性隔离。

### 2.1 物理存储与逻辑映射

生产环境的典型做法是物理上混合存储、逻辑上严格隔离：

```
用户上传文件
    ↓
对象存储（OSS / S3）           ← 物理层：统一存放，生成唯一 file_id
    ↓
关系型数据库                   ← 逻辑层：记录元数据映射
    user_id + conversation_id + file_id
    ↓
API 层强制过滤                 ← 访问层：所有查询带 conversation_id
```

查询文件列表时，后端强制注入 `WHERE conversation_id = ?`，不依赖前端传参。对话 A 只能查到对话 A 的文件。物理上文件混存在同一个 bucket，但访问路径被元数据完全隔离。

### 2.2 向量数据库与 RAG 隔离

文件切片存入向量数据库时，每个切片打上元数据标签：`{user_id, conversation_id, file_id}`。检索时系统强制注入过滤条件：

```python
# 不可省略的过滤——由后端注入，不从请求参数读取
results = vector_db.search(
    query_embedding=embedding,
    filter={"conversation_id": current_conversation_id},
    top_k=10,
)
```

这里有一个重要的安全边界需要明确：**元数据过滤适用于个性化场景，但不适用于安全隔离**。DeepLearning.AI 2025 年的指南明确指出，对于安全关键的隔离需求，应该使用租户级别的独立 collection 而非仅依赖过滤条件。OWASP LLM08:2025 也专门把"向量和嵌入漏洞"列为一个独立风险类别——权限绕过和跨对话信息泄漏的核心原因就是过滤条件缺失或绕过。

安全实践的分级建议：

| 场景 | 方案 |
|------|------|
| 同一用户的不同对话 | 单 collection + `conversation_id` 过滤 |
| 不同租户/组织 | 独立 collection，物理隔离 |
| 合规/监管要求 | 独立向量数据库实例 |

### 2.3 知识库挂载：跨对话持久化的正确姿势

文件实体的归属应该是用户而非对话。对话结束了文件不能丢。这个模型可以理解为：

> **对话 = 计算实例，文件 = 云硬盘。用户可以按需将知识库中的文件"挂载"到指定对话，用后即卸载。**

实现上，文件实体与解析后的知识绑定在 `user_id` 下的个人知识库中。对话创建时，用户选择要关联的文件，后端建立 `conversation_id ↔ file_id` 的挂载关系。对话结束时解除挂载，文件本身保留在用户知识库中。

跨对话引用需要遵循一个硬规则：**禁止隐式传递，必须显式挂载**。仅在新对话中提到文件名，Agent 不应能获取文件内容。用户必须在新对话中重新关联该文件。

---

## 三、沙箱运行时隔离

文件隔离解决的是"看什么"的问题，沙箱解决的是"能做什么"的问题。

### 3.1 容器级隔离：每对话一个沙箱

每个对话动态分配独立的沙箱容器。对话 A 的 Agent 运行在容器 A，对话 B 运行在容器 B。即使 Agent 在对话 A 中执行 `rm -rf /`，也不会影响对话 B——就像两台不联网的电脑。

实际上，生产环境已经超越了普通 Docker 容器。2025–2026 年的主流方案是 MicroVM（Firecracker）或用户态内核（gVisor），做到硬件级或系统调用级隔离。具体选型见第五节。

### 3.2 路径虚拟化：囚笼机制

Agent 看到的工作区永远是 `/mnt/data/` 或 `/workspace/`，但后端的拦截器根据 `conversation_id` 做了路径重定向：

```
Agent 视角：  /mnt/data/user_script.py
系统实际路径：/storage/conv_12345/mnt/data/user_script.py

Agent 视角：  /workspace/output.csv
系统实际路径：/storage/conv_67890/workspace/output.csv
```

效果是 Agent 以为在操作完整文件系统，实际被限制在对话专属的目录子树中。不同对话的同名文件互不冲突。

### 3.3 运行时状态隔离

Agent 的 ReAct 循环上下文、环境变量、pip/npm 安装的包，都与沙箱生命周期强绑定。新对话意味着全新干净的环境。前序对话的内存状态不自动继承——这是安全要求，不是功能缺失。

### 3.4 工具调用越权拦截

Agent 操作工作区必须通过工具接口（如 `code_interpreter`、`file_read`、`file_write`）。工具接口层是最后一道防线：

```
Agent 调用 file_write("/mnt/data/result.csv", content)
    ↓
工具接口层校验：
  - conversation_id 是否匹配？
  - 目标路径是否在允许的目录子树内？
  - 操作类型是否在允许列表中？
    ↓
放行或拒绝
```

任何试图跨越当前对话路径的读写请求都应被拦截并记录审计日志。

---

## 四、沙箱生命周期管理

计算资源昂贵——GPU 实例动辄几美元/小时——沙箱不能永久运行。但用户隔天回来期望继续工作。解决方案是"计算无状态化 + 存储持久化 + 按需重建"。

### 4.1 短期离开（分钟到小时）：暂停与唤醒

不立即销毁容器，而是挂起或降级：

- 释放 CPU/内存资源
- 保留文件系统缓存和容器状态
- 用户重新发消息时唤醒，变量、环境、文件无缝衔接

2025 年 Kubernetes SIG Agent Sandbox 的 CRD 已原生支持 Pause/Resume 语义：`pause: true` 时 Controller 删除 Pod 但保留 Sandbox 对象和持久卷；`pause: false` 时重建 Pod 并自动恢复。

Daytona 的做法更激进：15 分钟无活动自动停止，7 天无活动归档。停止状态保留文件系统快照，恢复只需 ~90ms。

### 4.2 长期离开（数天或更久）：销毁与状态落盘

容器销毁前执行严格的状态落盘：

1. **文件持久化**：`/mnt/data/` 中的所有文件异步且定期同步至对象存储（与 `conversation_id` 绑定）。销毁前强制做最后一次全量同步。
2. **环境快照（可选）**：生成 `requirements.txt` 或 `Dockerfile` 存入数据库，用于后续重建。
3. **内存状态丢弃**：Python 运行时的内存变量不持久化——成本极高且数据一致性难以保证。应该引导用户把关键状态落盘为文件。

### 4.3 长期后切回：按需重建

1. **分配新沙箱**：感知容器已销毁，从预热池（见 5.5 节）分配新的干净沙箱
2. **挂载持久卷**：将该对话绑定的持久化存储重新挂载到新容器的 `/mnt/data/`，历史文件全部恢复
3. **上下文重放**：Agent 利用 LLM 的长上下文能力恢复状态：
   - 阅读聊天历史记录
   - 主动生成代码从落盘文件中重建变量（如 `df = pd.read_csv('/mnt/data/result.csv')`）
   - 自动执行 `pip install -r requirements.txt` 恢复依赖

核心隐喻：**Agent 的工作区不是容器本身，而是挂在容器背后的持久化存储。容器如电脑可随时更换，持久卷如 U 盘即插即用。** 运行中的内存状态需要根据聊天历史重新"启动"。

---

## 五、底层沙箱技术选型

原生 Docker 不适合 Agent 沙箱场景：冷启动慢（秒级）、共享宿主机内核（逃逸风险）、频繁创建/销毁造成宿主机负载。2025–2026 年的生产实践已经形成三条主流技术路线。

### 5.1 三种隔离方案的对比

| 维度 | **Firecracker MicroVM** | **gVisor** | **Kata Containers** |
|------|------------------------|------------|---------------------|
| 隔离模型 | 硬件虚拟化，独立 guest kernel | 用户态内核，syscall 拦截 | OCI 容器 + 轻量 VM（KVM） |
| 安全等级 | 最强——硬件隔离边界 | 中——减少内核攻击面 | 强——硬件虚拟化 |
| 启动时间 | ~125ms | 50–100ms | 150–300ms |
| 内存开销 | < 5 MiB/VM | 低 | 数十 MB |
| GPU 支持 | ❌ | ✅（nvproxy） | ✅（VFIO 直通） |
| 需要 KVM | ✅ | ❌（可运行在 VM 节点上） | ✅ |
| 生产用户 | AWS Lambda、E2B、Fly.io | OpenAI Code Interpreter、Google Cloud Run、Modal | 蚂蚁集团、Northflank |

选型决策：

| 场景 | 推荐方案 |
|------|----------|
| LLM 生成代码、多租户 SaaS、最高安全需求 | Firecracker 或 Kata |
| 不满足 KVM 条件（运行在云 VM 上）、GPU 工作负载 | gVisor |
| 内部可信代码、开发工作流 | 加固 Docker（seccomp + AppArmor + 只读 rootfs） |

### 5.2 Firecracker：为 Serverless 而生的 MicroVM

Firecracker 是 AWS 为 Lambda 开发的 MicroVM 管理器，用 Rust 实现，核心代码约 5 万行，仅暴露 5–6 个 virtio 设备。启动时间 ~125ms，内存开销 < 5 MiB/VM。它的设计哲学是"不做多余的事"——没有 BIOS、没有 PCI 总线、没有 VGA 输出，攻击面极小。

E2B 在 Firecracker 基础上做了 snapshot pool，实现 ~150ms 冷启动。Zeroboot 的 CoW fork 技​​术更是把启动时间降到 0.8ms——本质上是 fork 一个已有的 Firecracker 进程，只复制被修改的内存页。

### 5.3 gVisor：不需要硬件虚拟化的隔离

gVisor 在容器内插入一个用户态内核（Sentry），拦截应用的 syscall 并自行处理，只有约 53–68 个经过严格审计的 syscall 会穿透到宿主机。因为不需要 KVM，gVisor 可以运行在云 VM 节点上——这是它相比 Firecracker 的最大优势。

OpenAI 的 Code Interpreter 运行在 gVisor 上（Kubernetes + runsc，9GB RAM / 4 vCPU，网络完全锁定）。Modal 用 gVisor 支持了 20,000+ 并发沙箱，包括完整的 NVIDIA GPU 透传。

gVisor 的代价是 syscall 性能开销——I/O 密集场景下可能达到 2–72 倍的性能损失。但 LLM 推理时长通常远大于沙箱执行时长，这个开销在生产中往往被掩盖。

### 5.4 本地 Agent 的沙箱方案

对于运行在开发者本机的 CLI Agent（如 Claude Code、Codex CLI），完整虚拟机太重。2025–2026 年的共识方案是组合 OS 原生原语：

- **macOS**：Apple Seatbelt（`sandbox-exec`）+ Virtualization.framework
- **Linux**：bubblewrap + Landlock + seccomp-bpf + user namespace remapping
- **网络**：JWT-based egress proxy，编码域名白名单（Claude Code 开源为 `@anthropic-ai/sandbox-runtime`）

### 5.5 冷启动优化：预热池

传统容器冷启动 4–7 秒的瓶颈在于镜像拉取和容器初始化。预热池的思路是把这些耗时操作全部前置：

```
传统流程：拉取镜像(2-5s) → 创建容器(500ms) → 启动(1s) → 初始化(500ms) → 就绪
预热池　：匹配可用容器(10ms) → 更新网络规则(30ms) → 就绪

后台持续预创建容器，请求到达时直接从 Ready Pool 分配
分配后立即触发补充，维持池子大小
```

Daytona 实测数据：创建沙箱 71ms + 执行代码 67ms + 清理 59ms = 完整生命周期 197ms。

Google Agent Sandbox（CNCF 沙箱项目，2025 年 KubeCon NA 公布）在 Kubernetes 上提供了 `SandboxWarmPool` 资源，支持声明式的预热池管理。GKE 独占的 Pod Snapshots 功能允许对运行中的沙箱做 checkpoint/restore，冷启动从分钟级降至秒级。

---

## 六、防御纵深：不只是选一个沙箱技术

单一隔离手段不足以应对生产环境的威胁模型。2025–2026 年的实践共识是七层防御纵深：

| 层级 | 机制 |
|------|------|
| L1 文件系统 | 只读 rootfs，overlay 挂载，tmpfs 存放临时密钥 |
| L2 进程 | 非 root 运行，drop `CAP_SYS_ADMIN`/`CAP_NET_ADMIN`/`CAP_SYS_MODULE` |
| L3 网络 | 默认拒绝出站，DNS 感知白名单，代理中介出站请求 |
| L4 内核 | MicroVM guest kernel 或 gVisor Sentry（不共享宿主机内核） |
| L5 资源限制 | CPU/内存 cgroups，磁盘配额，网络带宽限制 |
| L6 凭证注入 | 宿主机侧代理在边界注入凭证——密钥永不进入沙箱 |
| L7 可观测性 | 不可变审计日志，系统调用模式异常检测，DNS 渗出监控 |

L6（凭证注入）是一个特别值得展开的模式：**沙箱内部零密钥**。所有外部 API 的访问通过宿主机侧代理转发，凭证在代理层注入。即使 Agent 完全逃逸出沙箱，也无法窃取长期有效的 API key。

---

## 七、最佳实践

基于上述架构，与 Agent 交互的推荐范式：

1. **文件即存档**：关键中间结果务必让 Agent 保存为文件（CSV、JSON、Parquet），而非仅留在内存变量中。跨天重建时，文件可以从持久卷恢复，内存变量不能。

2. **显式挂载，禁止隐式引用**：跨对话复用数据必须通过知识库显式挂载。Agent 不应能从"文件名"推测并访问其他对话的文件。

3. **环境声明为文件**：如需特殊依赖，让 Agent 生成 `requirements.txt` 或 `Dockerfile` 保存在工作区。跨天重建时，Agent 可以读取这个文件自动恢复环境。

4. **安全过滤不在 Agent 侧做**：向量检索的 `conversation_id` 过滤由后端强制注入，不依赖 Agent 的 prompt 指令或前端参数。

5. **假设沙箱会被逃逸**：以沙箱逃逸为威胁模型设计凭证管理——长期密钥永远不进入沙箱，使用代理注入短期凭证。

---

*本文基于 2025–2026 年公开的生产实践、学术论文和开源项目整理。核心技术数据来源包括 E2B、Daytona、Agent Sandbox (CNCF)、Firecracker、gVisor、Kata Containers 的官方文档及 Northflank 沙箱技术对比报告。架构设计部分综合了阿里云 AICon 2025 分享、OWASP LLM08:2025 安全指南及 DeepLearning.AI 多租户 RAG 安全实践。*
