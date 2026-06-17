# Aegra 项目解读：自托管 LangSmith Deployments 替代品是怎么实现的

Aegra 的一句话定位很容易理解，但也很容易被说得过头：它是一个开源、自托管的 Agent Protocol server，目标是替代 LangSmith Deployments 这一层，而不是替代整个 LangSmith 平台。

这一区分很重要。LangSmith 是一整套围绕 LLM 应用和 agent 的平台，包含 observability、evaluation、deployment、prompt / dataset / monitoring 等能力。Aegra 更聚焦：它要解决的是“我已经写好了 LangGraph agent，怎样用和 LangSmith Deployments 类似的 API，把它部署到自己的基础设施上运行”。

先给结论：Aegra 的核心不是另起一套 agent 框架，而是一个 **Agent Protocol 兼容层 + LangGraph 执行运行时 + PostgreSQL 状态持久化 + Redis worker 队列 + OpenTelemetry 观测导出**。它把 LangGraph agent 的生产运行能力从托管平台里拆出来，放到用户自己的数据库、认证系统和部署环境中。

---

## 一、Aegra 到底是什么

Aegra 官方 README 对自己的描述是“Self-hosted LangSmith Deployments alternative”。更具体地说，它提供一个生产可用的 HTTP 服务，让外部客户端通过 LangGraph SDK 或 Agent Protocol 风格的 API 调用 agent。

它处理的对象主要有五类：

| 概念 | 作用 |
| --- | --- |
| Assistant | 一个 graph 的可配置实例，可以理解为“某个 agent 的部署配置” |
| Thread | 多轮交互中的持久状态容器 |
| Run | 对某个 assistant 的一次执行 |
| Store | 跨 thread 可访问的 key-value / semantic storage |
| Cron | 定时触发的 recurring run |

这套抽象并不是 Aegra 自己随意发明的，而是来自 Agent Protocol / LangGraph Platform 的使用模型。Aegra 的价值在于：它尽量复用这个模型，同时把运行环境换成你自己的基础设施。

典型调用方式仍然是 LangGraph SDK：

```python
from langgraph_sdk import get_client

client = get_client(url="http://localhost:2026")

assistant = await client.assistants.create(graph_id="agent")
thread = await client.threads.create()

async for chunk in client.runs.stream(
    thread_id=thread["thread_id"],
    assistant_id=assistant["assistant_id"],
    input={"messages": [{"type": "human", "content": "Hello!"}]},
):
    print(chunk)
```

从使用者视角看，它像一个 LangSmith Deployment endpoint；从部署者视角看，它是一个可以自己运行、自己接数据库、自己写 auth handler、自己接 tracing backend 的服务端。

---

## 二、Aegra、Agent Protocol、LangSmith 的关系

这三个名字容易混在一起。比较清晰的分层是：

```text
Agent Chat UI / LangGraph Studio / CopilotKit / 自己的客户端
                         |
                         v
                  Agent Protocol API
                   /              \
                  v                v
      LangSmith Deployments       Aegra
       官方平台/托管运行时        开源自托管实现
                  \                /
                   v              v
                  LangGraph agent 代码
```

**Agent Protocol 是接口标准。** 它试图定义生产环境里服务 agent 所需的通用 API。Agent Protocol 文档把核心概念归纳为 runs、threads、store：runs 负责执行，threads 负责组织多轮状态，store 负责长期记忆或跨线程存储。[1]

**LangSmith Deployment 是 LangChain 官方平台里的部署运行能力。** 官方文档把 LangSmith Deployment 描述为面向 agent workloads 的 workflow orchestration runtime，提供 durable execution、real-time streaming、horizontal scaling，并支持 Cloud、Standalone server、Self-hosted 等部署模型。[2]

**Aegra 是这个运行层的开源自托管实现。** 它对标的是 LangSmith Deployments / Agent Server 这一层，而不是 LangSmith 的全部能力。LangSmith 仍然包含 tracing、evaluation、monitoring、dataset、prompt hub、Engine、Fleet、Sandboxes 等更大范围的平台功能。[3]

所以更准确的说法不是“Aegra 是 LangSmith 替代品”，而是：

> Aegra 是一个自托管的 LangSmith Deployments 替代实现，用相近的 SDK/API 模型运行 LangGraph agent。

这也是它的工程边界。它不试图做完整 SaaS 工作台，而是优先把 agent 运行时最关键的东西补齐：API、状态、执行、流式输出、队列、认证、观测、定时任务。

---

## 三、它解决了什么问题

托管平台的优势是省心：不用管数据库、队列、worker、升级、UI 和运维。但当 agent 进入生产环境后，一些原本可接受的托管假设会变成硬约束。

### 1. 数据和状态归属

Agent 和普通 API 不一样。一次 agent run 里可能包含用户输入、工具调用结果、检索内容、中间状态、checkpoint、长期记忆和 trace。如果这些都在托管平台上，团队对数据驻留、备份、迁移、审计和删除策略的控制会受到平台边界限制。

Aegra 的选择是把持久化放回用户自己的 PostgreSQL。threads、runs、assistants、store、checkpoint 等状态都落在自己的数据库里。你可以自己备份、查询、迁移，也可以把它放在已有的合规边界内。

### 2. 成本模型

LangSmith Pricing 页面显示，Plus plan 中 LangSmith Deployment 的额外 deployment run 会按运行计费，production / development deployment 还存在 uptime cost；Enterprise 则是 custom pricing。[4] 这对很多团队是合理的商业模型，但如果 workload 很大，agent run 数量和在线时间都会变成需要持续管理的成本项。

Aegra 的成本模型更直接：没有平台侧 per-run 费用，你支付自己的计算、PostgreSQL、Redis、网络和模型调用成本。这不是“免费运行 agent”，而是把平台费用换成自运维基础设施成本。

### 3. 认证和授权可编程

托管平台通常通过平台配置来管理认证。Aegra 则把 auth 设计成 Python handler。你可以在项目里写：

```python
from langgraph_sdk import Auth

auth = Auth()

@auth.authenticate
async def authenticate(headers: dict) -> dict:
    token = headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        raise Exception("Authentication required")

    return {
        "identity": "user123",
        "permissions": ["read", "write"],
        "is_authenticated": True,
    }
```

然后在 `aegra.json` 中指向这个 auth 对象。Aegra 还支持资源级 authorization handler，例如限制 assistant 删除、给 thread 创建请求注入 team metadata、按用户身份过滤 thread search 结果。

更关键的是，认证用户会由服务端注入到 graph execution config 中，放到 `config["configurable"]["langgraph_auth_user"]`。这意味着 graph 和 tool 可以根据真实用户身份做 RBAC 或个性化，而不是信任客户端传来的 input。

### 4. 观测不绑定单一后端

Aegra 的 observability 走 OpenTelemetry。它可以把 trace fan-out 到 Langfuse、Phoenix、Jaeger、Honeycomb、Datadog 或任何 OTLP-compatible backend，也可以同时发多个后端。

这和“平台内置 tracing”是不同取舍。Aegra 不提供一个完整的 LangSmith UI 替代品，而是把 trace 作为开放遥测数据导出，让团队接入已有观测栈。

---

## 四、API 层：FastAPI 承载 Agent Protocol 资源

Aegra 的服务入口在 `libs/aegra-api/src/aegra_api/main.py`。这里可以看到它的基本形态：一个 FastAPI application，挂载 health、assistants、threads、runs、stateless runs、crons、store 这些 router。

```text
FastAPI app
  ├── /assistants
  ├── /threads
  ├── /threads/{thread_id}/runs
  ├── /runs
  ├── /crons
  ├── /store
  └── /health
```

启动生命周期里做了几件关键事情：

1. 根据配置决定是否执行 Alembic migration。
2. 初始化 PostgreSQL 连接和 LangGraph checkpointer / store。
3. 初始化 OpenTelemetry。
4. 加载 `aegra.json` 中声明的 graph。
5. 根据 Redis 配置启动 broker、executor、lease reaper。
6. 根据 cron 配置启动 cron scheduler。

这说明 Aegra 不是“一个简单 FastAPI wrapper”。FastAPI 只是协议入口，真正的运行语义在背后的服务层：graph 加载、run 准备、执行器、stream broker、状态更新和恢复逻辑。

它还支持 custom routes。`main.py` 中会先尝试加载用户配置的 FastAPI app，再把 Aegra 的核心 routers 合并进去。这让用户可以把自己的业务 API 和 Agent Protocol API 放在同一个服务里，并选择是否对 custom routes 应用 Aegra auth dependency。

---

## 五、Graph 加载：把 LangGraph 代码变成可运行服务

Aegra 不要求你改写 LangGraph agent，而是通过 `aegra.json` 声明 graph：

```json
{
  "graphs": {
    "agent": "./src/agent/graph.py:graph"
  }
}
```

`libs/aegra-api/src/aegra_api/services/langgraph_service.py` 负责把这些 graph 加载进服务。它做了几个工程上很重要的处理。

### 1. 动态导入 graph module

Aegra 会解析 `file.py:export_name` 格式，按配置文件所在目录解析相对路径，然后用 `importlib.util.spec_from_file_location` 动态导入模块。为了避免 graph id 和真实 Python 包名冲突，它会把模块名放到私有命名空间下。

### 2. 区分 static graph 和 factory graph

如果导出的对象是普通 graph，Aegra 会编译并缓存 base graph。这个 base graph 被认为是结构不可变的。每次执行时再 copy 一份，并注入 checkpointer 和 store。

如果导出的对象是 factory，Aegra 不会在启动时用空用户上下文调用它，而是把 callable 存起来，在每次请求时带着 `ServerRuntime`、用户信息、config 和 context 重新生成 graph。这点很关键：有些 graph 的结构本来就依赖当前用户权限或请求上下文。

### 3. 每次请求注入 Postgres checkpointer/store

执行路径调用 `get_graph(...)` 时，Aegra 从数据库管理器拿到 checkpointer 和 store，然后复制 graph，把它们注入进去：

```text
cached base graph
      |
      v
per-request graph copy
      |
      +-- checkpointer = PostgreSQL
      +-- store        = PostgreSQL / pgvector
```

这样 thread state、checkpoint history、store 数据就不会只存在内存里。对 long-running agent 来说，这正是“部署运行时”和“本地脚本”的分界线。

---

## 六、Run 执行：从本地任务到 Redis worker

Aegra 的执行器选择很直接，逻辑在 `libs/aegra-api/src/aegra_api/services/executor.py`：

```text
REDIS_BROKER_ENABLED = false
  -> LocalExecutor
  -> asyncio.create_task()

REDIS_BROKER_ENABLED = true
  -> WorkerExecutor
  -> Redis BLPOP + semaphore + Postgres lease
```

这对应 dev 和 production 两种模式。

开发模式下，run 在当前进程里用 asyncio task 执行，不要求 Redis。好处是启动快、调试简单。

生产模式下，API 进程收到 run 请求后先把 run 记录和 execution params 写入 PostgreSQL，再把 run id 推入 Redis list。任意实例上的 worker 都可以通过 `BLPOP` 拿到 job。

完整链路大致是：

```text
Client
  -> POST /threads/{thread_id}/runs/stream
  -> FastAPI validate request
  -> PostgreSQL insert run + execution_params
  -> Redis RPUSH run_id
  -> Worker BLPOP run_id
  -> PostgreSQL acquire lease
  -> LangGraph execution
  -> Redis Pub/Sub streaming events
  -> PostgreSQL finalize run
  -> SSE client receives events
```

`WorkerExecutor` 里有几个值得注意的细节。

### 1. 并发控制

每个 worker loop 有一个 `asyncio.Semaphore`，最多同时执行 `N_JOBS_PER_WORKER` 个 run。实例总并发大致是：

```text
WORKER_COUNT * N_JOBS_PER_WORKER
```

默认文档里给出的生产模式是每实例 3 个 worker loop，每个 worker 10 个并发 run，也就是单实例 30 个并发 run。

### 2. Lease 防止重复执行

worker 拿到 run id 后不会直接执行，而是先到 PostgreSQL 里抢 lease。只有成功把 run 标记为当前 worker claimed 的实例才能继续执行。

这解决了分布式系统里的基本问题：Redis 队列可能重试，多个实例可能同时看到同一个任务，worker 可能崩溃。真正的执行所有权落在数据库 lease 上，而不是只信任队列。

### 3. Heartbeat 和 lease reaper

执行过程中 worker 会定期 heartbeat，延长 `lease_expires_at`。如果进程 OOM、被 kill 或网络断开，heartbeat 停止，lease 过期。

`LeaseReaper` 会扫描 expired lease，把 run 重置为 pending，再重新入队。新的 worker 从 PostgreSQL checkpoint 恢复执行。

这里的设计重点不是“永不失败”，而是失败后状态仍然在数据库里，任务可以被另一个 worker 接手。

### 4. 跨实例取消

取消请求可能打到任意 API 实例，而 run 可能在另一台实例上执行。Aegra 用 Redis pub/sub 广播 cancel message，真正执行 run 的 worker 收到后取消本地 task，并把 run 状态更新为 interrupted。

这也是为什么生产模式需要 Redis：它不只是 job queue，也是跨实例事件传播通道。

---

## 七、Streaming：SSE、replay buffer 和断线重连

Agent 产品不能只返回最终结果。用户通常需要看到 token、工具调用、中间状态、人类审批点和错误事件。Aegra 用 SSE 做 streaming，对应服务在 `libs/aegra-api/src/aegra_api/services/streaming_service.py`。

它支持多种 stream mode：

| mode | 含义 |
| --- | --- |
| `values` | 每个节点后的完整 state snapshot |
| `updates` | 每个节点产生的 state delta |
| `messages` | LLM token / tool call，并聚合 partial / complete 事件 |
| `messages-tuple` | 原始 message tuple |
| `custom` | graph 内部通过 `get_stream_writer()` 发出的自定义事件 |
| `events` | LangGraph 低层事件 |
| `debug` | checkpoint 和 task result 调试事件 |

执行时，`run_executor.py` 会调用 `stream_graph_events(...)`，每拿到一个 graph event，就分配 event id 并放进 broker。broker 再负责两件事：

1. 给当前 SSE 连接实时推送。
2. 把事件放进 replay buffer。

断线重连时，客户端带上 `Last-Event-ID`，Aegra 会先 replay 已存事件，再继续订阅 live event。生产模式下，worker 和 SSE 连接可以在不同实例上：worker 把事件 publish 到 Redis，API 实例上的 broker 再把事件转给客户端。

这个设计对 agent 很实用。因为 agent run 可能很长，中间可能调用外部 API、等待人类审批、执行工具或遇到网络抖动。如果一次断线就丢失输出，用户体验会很差；如果断线就强制取消 run，也不适合后台任务。Aegra 支持 `on_disconnect="continue"`，让 run 继续在后台执行，之后再重新连接拿结果。

---

## 八、Cron、Store、Human-in-the-loop 和 Observability

除了基本 runs / threads，Aegra 还补了几个生产运行时必需的能力。

### Cron

Cron 用来定时触发 run。它支持标准 5-field cron，也支持 seconds-level 6-field expression 和 IANA timezone。多实例场景下，cron claim 需要避免重复触发，Aegra 文档里提到使用 `SKIP LOCKED` 做 multi-instance safe claim。

这让 agent 不只被动响应请求，也可以定期执行任务：日报、巡检、同步、定期分析、后台维护。

### Store

Store 提供 namespaced key-value storage 和 semantic search。semantic store 基于 pgvector，可以配置 embedding model。和 thread checkpoint 不同，store 更像跨 thread 的长期存储：用户偏好、知识片段、业务实体、工具结果缓存都可以放在这里。

### Human-in-the-loop

Aegra 支持 interrupt before / after、approval gate、state editing、resume / reject interrupted run。这来自 LangGraph 本身的 interrupt 能力，但服务端需要把 interrupted 状态、thread state、resume command、stream event 都接起来，才能成为产品可用的 API。

### Observability

Aegra 的 trace 基于 OpenTelemetry，并通过 `openinference-instrumentation-langchain` 自动捕获 LangGraph / LangChain 执行步骤。它还允许 run 请求带 metadata，并把这些 metadata 写到 root span 上，方便在 Langfuse、Phoenix 或其他 OTLP backend 中过滤。

这点体现了 Aegra 的取舍：它不复制 LangSmith 的完整观测产品，而是把运行时埋点以开放协议导出。

---

## 九、和 LangSmith 的差异到底在哪里

最容易误解的是：Aegra 和 LangSmith 不是同一层级的产品。

| 维度 | LangSmith | Aegra |
| --- | --- | --- |
| 产品范围 | 平台级：观测、评估、部署、监控、数据集、Prompt、Engine、Fleet 等 | 运行时级：Agent Protocol server + LangGraph execution |
| 部署模型 | Cloud / Standalone server / Self-hosted 等，具体能力受计划影响 | 默认自托管，Apache 2.0 |
| 数据库 | 托管方案由平台管理；自托管/混合按官方部署模型配置 | 用户自带 PostgreSQL |
| SDK/API | LangGraph SDK / Agent Server API | 尽量兼容 LangGraph SDK / Agent Protocol 使用方式 |
| 执行 | 官方 Agent Server / Deployment runtime | FastAPI + LangGraph + Redis worker + Postgres lease |
| 观测 | LangSmith Observability 是完整产品 | OpenTelemetry 导出到第三方 backend |
| 成本 | 平台计划、seat、trace、deployment run、uptime 等 | 自己承担基础设施和模型成本 |

如果团队想要的是完整的一站式平台，LangSmith 的价值更完整：UI、协作、数据集、评估、监控、自动诊断、托管部署和企业支持都在一个体系里。

如果团队已经有自己的 infra、auth、observability、数据治理要求，只想要一个可控的 LangGraph agent server，Aegra 的定位就更清晰：它把运行层抽出来，让你用熟悉的 LangGraph SDK 调用自己的服务。

---

## 十、Aegra 的工程取舍

源码读下来，Aegra 最有价值的地方不是“功能列表很多”，而是它选择了几条比较务实的边界。

第一，**协议兼容优先**。它不要求用户学习一个新的 agent 框架，而是尽量贴近 LangGraph SDK / Agent Protocol 的资源模型。迁移成本主要在部署配置，而不是业务 graph 重写。

第二，**PostgreSQL 是状态中心**。assistant、thread、run、checkpoint、store、cron、execution params 都围绕数据库展开。Redis 可以做队列和 pub/sub，但执行所有权、恢复依据和最终状态仍然回到 Postgres。

第三，**生产执行和开发执行分开**。开发模式直接本地 asyncio，生产模式才引入 Redis worker、lease、reaper 和跨实例取消。这避免了开发环境过重，也让生产路径具备横向扩展和故障恢复能力。

第四，**观测走开放协议**。Aegra 不试图绑定自己的 tracing UI，而是把 OpenTelemetry 作为默认出口。这降低了平台锁定，但也意味着你需要自己选择和维护观测后端。

第五，**它承认自己的边界**。feature matrix 里明确列出 MCP server、A2A protocol 是 coming soon，RemoteGraph、encryption at rest、webhook callbacks、rate limiting、multi-org workspaces 等暂未规划。这比声称“完整替代 LangSmith”更诚实，也更容易判断是否适合当前项目。

---

## 结论

Aegra 可以理解成一个“开源版 Agent Server”：它站在 Agent Protocol 和 LangGraph 生态上，提供可自托管的 assistants / threads / runs / store / cron API，用 PostgreSQL 保存状态，用 Redis 承担生产队列和跨实例事件，用 OpenTelemetry 把 trace 发到外部观测系统。

它和 LangSmith 的关系不是简单竞争，而是层级不同：

- Agent Protocol 定义 agent 服务应该如何被调用。
- LangSmith Deployment 是 LangChain 官方平台里的生产部署运行时。
- Aegra 是这个运行时思路的开源自托管实现。

如果你的需求是完整的 agent 开发、调试、评估、监控和团队协作平台，LangSmith 的覆盖面更大。如果你的核心问题是“我想把 LangGraph agent 跑在自己的数据库和基础设施里，并继续使用熟悉的 SDK/API”，Aegra 解决的正是这个问题。

---

## 参考资料

[1] Agent Protocol: https://github.com/langchain-ai/agent-protocol

[2] LangSmith Deployment docs: https://docs.langchain.com/langsmith/deployment

[3] LangSmith Observability docs: https://docs.langchain.com/langsmith/observability

[4] LangSmith pricing: https://www.langchain.com/pricing

[5] Aegra README: https://github.com/aegra/aegra
