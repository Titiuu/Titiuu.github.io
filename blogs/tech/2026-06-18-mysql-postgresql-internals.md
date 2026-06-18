# MySQL 和 PostgreSQL 底层技术对比：从 Agent 项目为什么偏爱 Postgres 说起

最近看很多 agent 项目时，会发现一个有意思的现象：它们越来越自然地把 PostgreSQL 放在状态中心的位置。

比如 LangGraph 的 memory 文档里，短期记忆的生产环境示例使用 `PostgresSaver` 做 checkpointer，长期记忆的生产环境示例使用 `PostgresStore` 做 store。也就是说，一个 agent 的对话线程、checkpoint、用户记忆、可恢复执行状态，都可以落在 PostgreSQL 里。

这会引出一个问题：如果只是存业务数据，MySQL 也很成熟；如果只是做向量检索，也有专门的向量数据库；如果只是缓存状态，Redis 更快。为什么 agent 项目会频繁选择 PostgreSQL？

答案不是一句“PostgreSQL 支持向量插件”就能解释的。更准确地说，agent runtime 需要的是一个统一状态底座：它要能保存结构化业务数据，也要能保存 JSON 元数据；要能事务化地更新 run、thread、checkpoint，也要能做审计、回放、恢复；要能跑普通 SQL，也希望通过扩展支持向量检索、全文检索、复杂索引和自定义类型。

PostgreSQL 正好长在这个交叉点上。

但这并不意味着 PostgreSQL 在所有场景都比 MySQL 更好。MySQL/InnoDB 和 PostgreSQL 的差异，本质上来自底层设计取舍：InnoDB 更像一个围绕聚簇索引、undo 版本链、redo 日志和 Server 层 binlog 协作构建的 OLTP 存储引擎；PostgreSQL 更像一个围绕 heap table、多版本 tuple、WAL、丰富索引和扩展机制构建的通用关系数据库内核。

下面不只做结论对比，而是按几个实际动作来看：

- 插入一行时，数据到底放到哪里？
- 通过索引查一行时，数据库走了什么路径？
- 更新一行时，旧版本和新版本怎么共存？
- 删除或更新留下的垃圾怎么清理？
- 为什么这些底层机制会影响 agent 系统的数据库选择？

## 一、先建立一个心智模型：MySQL 是索引组织表，PostgreSQL 是堆表

先用一句话抓住核心区别：

**InnoDB 的表数据挂在主键 B+Tree 的叶子节点上；PostgreSQL 的表数据放在固定大小的 Page 里，一张表有多个 Pages，索引只是指向 Page 中某个 tuple （某个版本的行数据） 的入口。**

这句话非常重要。后面的索引、MVCC、更新、vacuum 都从这里分叉。

### 1.1 InnoDB：主键索引就是表本身

MySQL 的主流存储引擎是 InnoDB。讨论 MySQL 底层时，通常默认是在讨论 InnoDB。

InnoDB 的一个核心特征是：每张表都有 clustered index。官方文档说明，每个 InnoDB 表都有一个特殊索引叫 clustered index，它存储 row data；通常这个 clustered index 就是主键。

这意味着在 InnoDB 中，主键不是一个普通索引，而是数据组织方式。可以把一张 InnoDB 表想成这样：

```text
PRIMARY KEY B+Tree

root page
  -> internal page
      -> leaf page: (primary key, full row)
      -> leaf page: (primary key, full row)
      -> leaf page: (primary key, full row)
```

通过主键查一行时，搜索 B+Tree 后直接到叶子节点，叶子节点里就是整行数据。

二级索引不存整行，而是存：

```text
(secondary index key, primary key)
```

所以通过二级索引查完整行时，需要两步：

```text
secondary index B+Tree
  -> 找到 primary key
      -> 回到 clustered index B+Tree
          -> 找到 full row
```

这就是 MySQL 里常说的“回表”。

这个模型带来几个直接后果：

- 主键查询很快，因为索引搜索直接定位行数据。
- 二级索引会携带主键，所以主键越长，所有二级索引越膨胀。
- 主键最好短、稳定、递增，随机 UUID 主键容易造成页分裂和写放大。
- 覆盖索引很有价值，因为它可以避免二级索引查完后再回聚簇索引。

所以 MySQL 面试里反复讲“主键设计”和“回表”，不是因为这些概念高级，而是 InnoDB 表结构就是这么长的。

### 1.2 PostgreSQL：表是 heap，索引是指针

PostgreSQL 的基础模型不同。它的普通表是 heap table。

heap 不是“堆内存”的意思，而是说表里的行没有被主键索引持续组织成一棵聚簇树。表数据存放在表文件的一批 page 里，一行可以放在任意合适的 page 中。

PostgreSQL 官方文档说明，表和索引都由固定大小的 page 组成，默认通常是 8KB。表里的 page 逻辑上是等价的，某个 row 可以放在任何 page。一个普通 heap page 大致可以理解成这样：

```text
8KB heap page

+----------------------+
| PageHeaderData       |  page 元信息，比如 LSN、free space 指针
+----------------------+
| ItemIdData array     |  line pointer 数组
|  slot 1 -> tuple A   |
|  slot 2 -> tuple B   |
|  slot 3 -> tuple C   |
+----------------------+
| free space           |
+----------------------+
| tuple C              |
| tuple B              |
| tuple A              |
+----------------------+
```

这里有两个点很关键。

第一，page 里不是直接用“第几个字节”暴露给索引，而是通过 `ItemIdData` 这种 line pointer 间接定位 tuple。line pointer 里记录 tuple 在本 page 内的偏移和长度。

第二，PostgreSQL 中一个 row version 的物理位置叫 `ctid`，它由 page number 和 page 内的 line pointer 编号组成。你可以把它想成：

```text
ctid = (block number, item offset)
```

比如 `(42, 7)` 大概表示：第 42 个 page 里的第 7 个 line pointer 指向的 tuple。

PostgreSQL 的索引项通常保存的就是 key 和指向 heap tuple 的 TID：

```text
B-tree index entry:
  (index key, TID/ctid)

heap:
  ctid -> tuple
```

因此 PostgreSQL 的主键默认会创建唯一 B-tree 索引，但主键索引不是表本身。主键只是一个约束和访问路径，不天然决定整张表的物理组织。

这和 InnoDB 的差异非常大：

| 维度 | MySQL/InnoDB | PostgreSQL |
| --- | --- | --- |
| 表数据组织 | 主键聚簇索引叶子节点存整行 | heap page 存 tuple |
| 主键角色 | 通常就是表的物理组织方式 | 唯一索引 + 约束，不持续组织 heap |
| 二级索引指向 | 二级索引 key -> 主键 -> 聚簇索引行 | 索引 key -> TID/ctid -> heap tuple |
| 行物理位置 | 跟聚簇索引相关 | `ctid = page + line pointer` |
| 典型代价 | 二级索引受主键长度影响 | 普通 index scan 可能随机访问 heap |

这也是为什么 PostgreSQL 文档说所有索引都是 secondary indexes。即使是主键索引，它也和 heap 分开存。

## 二、PostgreSQL 的一行到底长什么样

理解 PostgreSQL 的 MVCC 前，必须先理解 tuple header。

严格说，PostgreSQL 里的一个 heap tuple 不是“逻辑行”本身，而是逻辑行的一个物理版本。一次 `INSERT` 会创建第一个 tuple version；后续 `UPDATE` 通常会创建新的 tuple version；多个 tuple version 通过 `xmin`、`xmax`、`ctid` 和可见性规则，共同表示同一逻辑行在不同事务视角下的状态。

PostgreSQL 的每个 heap tuple 不只是用户列数据，它前面还有一段头信息。官方 page layout 文档列出的 `HeapTupleHeaderData` 里，有几个字段尤其重要：

- `t_xmin`：插入这个 tuple version 的事务 ID。
- `t_xmax`：删除或更新这个 tuple version 的事务 ID，未删除时通常为 0。
- `t_ctid`：指向当前 tuple 或更新后的新版本 tuple。
- `t_infomask` / `t_infomask2`：各种可见性和状态标记。
- `t_hoff`：用户列数据开始的位置。

用户能看到的系统列 `xmin`、`xmax`、`ctid`，背后就对应这些 tuple 级信息。官方文档也说明，每次 update 都会为同一逻辑行创建新的 row version。

可以把 PostgreSQL 的一行想成：

```text
heap tuple

+----------------------------+
| tuple header               |
|  xmin = 创建它的事务 ID     |
|  xmax = 删除/更新它的事务 ID |
|  ctid = 自己或新版本位置     |
|  flags                     |
+----------------------------+
| null bitmap / padding      |
+----------------------------+
| user columns               |
+----------------------------+
```

这里的关键不是字段名，而是它把“这行对谁可见”直接写在 tuple version 上。

这和 InnoDB 很不一样。

InnoDB 行里也有隐藏列，例如最近修改事务 ID 和回滚指针。更新时，旧版本主要进入 undo log，当前行通过 `roll_ptr` 可以沿 undo 链找旧版本。

PostgreSQL 则把不同版本直接留在 heap 里。旧版本不是先被挪到 undo 区，而是仍然作为 tuple 留在表文件中，只是可见性发生变化。

所以一句话对比：

```text
InnoDB:
  current row + undo log version chain

PostgreSQL:
  heap 中多个 tuple version + xmin/xmax 可见性判断
```

这个差异会决定更新、索引、垃圾回收的全部后续行为。

## 三、PostgreSQL MVCC：读的时候不是找“最新行”，而是找“对我可见的版本”

MVCC 的目标是让读和写尽量不要互相阻塞。

没有 MVCC 时，如果一个事务正在更新某行，另一个事务想读这行，最简单的做法是让读等待写。但这样并发性能会很差。

MVCC 的思路是：保留多个版本。写事务生成新版本，读事务按自己的快照选择能看到的版本。

### 3.1 PostgreSQL 的 INSERT

假设有一张表：

```sql
create table runs (
  id bigint primary key,
  status text,
  metadata jsonb
);
```

执行：

```sql
insert into runs values (1, 'pending', '{"model":"gpt"}');
```

PostgreSQL 会在某个 heap page 中写入一个 tuple：

```text
tuple V1
  xmin = 100        -- 插入事务
  xmax = 0          -- 还没有被删除/更新
  ctid = (42, 7)    -- 物理位置
  data = (1, pending, {...})
```

如果 `id` 上有主键索引，B-tree 索引里会有：

```text
key = 1
tid = (42, 7)
```

查询 `where id = 1` 时，执行路径大致是：

```text
primary key B-tree
  -> 找到 key = 1 的 TID: (42, 7)
      -> 访问 heap page 42 的 slot 7
          -> 读取 tuple header
              -> 判断 xmin/xmax 对当前快照是否可见
                  -> 返回用户列
```

注意最后一步：即使索引找到了 tuple，PostgreSQL 仍然要判断这个 tuple 对当前事务是否可见。索引负责“可能在哪里”，MVCC 负责“你能不能看”。

### 3.2 PostgreSQL 的 UPDATE

现在执行：

```sql
update runs set status = 'running' where id = 1;
```

PostgreSQL 通常不会在原 tuple 上原地覆盖成 `running`。它会写一个新 tuple version，并把旧版本标记为被这个更新事务结束。

可以想成：

```text
更新前：

tuple V1
  xmin = 100
  xmax = 0
  ctid = (42, 7)
  data = (1, pending, {...})

更新后：

tuple V1
  xmin = 100
  xmax = 120        -- 事务 120 更新/删除了它
  ctid = (42, 8)    -- 指向新版本
  data = (1, pending, {...})

tuple V2
  xmin = 120        -- 新版本由事务 120 创建
  xmax = 0
  ctid = (42, 8)
  data = (1, running, {...})
```

如果有事务在更新前就开始了，它的快照可能仍然能看到 V1。更新后才开始的事务会看到 V2。

这就是 PostgreSQL MVCC 的核心：**UPDATE = 旧 tuple 结束 + 新 tuple 创建**。

### 3.3 可见性判断怎么理解

PostgreSQL 事务读数据时会拿到一个 snapshot。这个 snapshot 可以粗略理解为：

- 哪些事务在我开始读的时候已经提交。
- 哪些事务当时还活跃。
- 哪些事务是在我之后才开始。

判断某个 tuple 是否可见时，核心逻辑可以简化成：

```text
看 xmin：
  创建该 tuple 的事务是否已经提交？
  如果创建事务未提交，通常不可见。
  如果创建事务在我的快照之后才开始，也不可见。

看 xmax：
  如果 xmax = 0，说明这个版本还没有被删除/更新，可能可见。
  如果 xmax 对应事务未提交，旧版本仍可能可见。
  如果 xmax 对应事务已提交，并且对我的快照可见，说明这个版本已经结束，不可见。
```

实际实现会更复杂，例如 hint bits、事务状态缓存、subtransaction、multixact 都会参与。但从理解 MVCC 的角度，抓住 `xmin` 决定“它什么时候出生”，`xmax` 决定“它什么时候死亡”就够了。

这也解释了为什么 PostgreSQL 的旧版本不能立刻删除。只要还有某个老事务的快照可能看到 V1，V1 就必须留着。

### 3.4 DELETE 其实也是标记版本结束

执行：

```sql
delete from runs where id = 1;
```

不是马上把 tuple 从文件中擦掉，而是把当前版本的 `xmax` 标成删除事务：

```text
tuple V2
  xmin = 120
  xmax = 150       -- 删除事务
  data = (1, running, {...})
```

对删除事务之后的快照来说，V2 不再可见。对删除前已经开始的事务来说，V2 仍可能可见。

所以 PostgreSQL 的 UPDATE/DELETE 都会制造“旧版本”。这些旧版本后面就要靠 vacuum 清理。

## 四、Vacuum：PostgreSQL 为什么需要清垃圾

前面说过，PostgreSQL 更新和删除不会立刻物理移除旧 tuple。这样读写并发更好，但会带来一个问题：表里会积累 dead tuples。

官方文档说明，PostgreSQL 需要定期 vacuum，原因包括：

- 回收或复用被 update/delete 占用的空间。
- 更新 planner 统计信息。
- 更新 visibility map，帮助 index-only scan。
- 防止 transaction ID wraparound。

### 4.1 普通 VACUUM 做什么

普通 `VACUUM` 不是简单地把表文件压缩到最小。它的主要工作是：

1. 找出已经不可能被任何事务看到的 dead tuples。
2. 清理这些 dead tuples。
3. 把 page 里的空间标记为可复用。
4. 清理相关索引项。
5. 更新 visibility map 和统计信息。

这里最容易误解的一点是：普通 `VACUUM` 通常不会把空间立刻还给操作系统。它更多是让空间在表内部可复用。

比如一个表文件已经长到 10GB，里面有 3GB dead tuple。普通 vacuum 后，这 3GB 空间通常变成“表内部未来 insert/update 可以复用的空间”，但文件不一定缩回 7GB。

如果要真正重写表、压缩文件、还给操作系统，可能需要 `VACUUM FULL`、`CLUSTER` 或表重写操作。但它们代价更高，锁也更重。

### 4.2 Autovacuum 为什么是 PostgreSQL 运维核心

因为 PostgreSQL 的 MVCC 旧版本在 heap 里，清理是否及时会直接影响：

- 表膨胀。
- 索引膨胀。
- 查询要扫描更多无效版本。
- index-only scan 能不能命中 visibility map。
- transaction ID wraparound 风险。

所以 PostgreSQL 不是“写完就结束”，而是后台需要 autovacuum 持续维护。

如果一个 agent 系统频繁更新 run 状态：

```text
pending -> queued -> running -> tool_calling -> streaming -> completed
```

每次状态更新都可能生成新 tuple version。这个表如果更新频繁，就要关注 autovacuum 是否跟得上。

这不是 PostgreSQL 的缺陷，而是它的 MVCC 模型暴露出来的工程成本。

### 4.3 HOT：为什么有些更新可以不改索引

PostgreSQL 也知道“每次 update 都新增 tuple，还要更新所有索引”很贵，所以有一个优化叫 HOT，也就是 Heap-Only Tuple。

HOT 更新成立需要两个核心条件：

- 更新没有修改任何被索引引用的列。
- 旧 tuple 所在 page 还有足够空间放新版本。

如果满足条件，新版本可以放在同一个 heap page 里，索引仍然指向旧版本的 line pointer，再通过 tuple chain 找到新版本。这样就不需要为每个索引都插入新 index entry。

举个例子：

```sql
create table runs (
  id bigint primary key,
  status text,
  metadata jsonb
);

create index runs_status_idx on runs(status);
```

如果更新 `metadata`，而 `metadata` 没有被索引引用，就更可能发生 HOT：

```sql
update runs set metadata = metadata || '{"retry":1}' where id = 1;
```

如果更新 `status`，因为 `status` 在索引里，通常需要更新相关索引：

```sql
update runs set status = 'completed' where id = 1;
```

这会影响表设计：高频变化字段要不要建索引，需要结合查询频率和更新成本判断。agent runtime 里状态字段通常会被查询，例如找 pending run、running run、expired lease；这类索引有必要，但也会增加更新成本。

### 4.4 visibility map：为什么 PostgreSQL 的覆盖索引还要看 heap

MySQL/InnoDB 的覆盖索引很好理解：查询需要的列都在二级索引里，就不用回表。

PostgreSQL 也有 index-only scan 和 covering index，但它多了一个 MVCC 可见性问题。

因为 PostgreSQL 的可见性信息在 heap tuple 里，不在普通索引项里。即使索引里已经有查询需要的列，数据库也要知道这个 tuple 对当前 snapshot 是否可见。

为了解决这个问题，PostgreSQL 维护 visibility map。它记录某个 heap page 上的 tuple 是否都足够老、对所有当前和未来事务可见。

index-only scan 的路径大概是：

```text
B-tree index
  -> 找到 key 和 payload column
      -> 查 visibility map
          -> 如果 heap page all-visible，直接返回索引里的值
          -> 如果不是 all-visible，访问 heap 判断 tuple 可见性
```

所以 PostgreSQL 的“覆盖索引”不是只看列够不够，还要看 visibility map 状态。变化很频繁的表，index-only scan 的收益可能没有想象中大，因为它仍然经常要访问 heap。

这也是 PostgreSQL 索引优化和 InnoDB 索引优化的一个关键差异。

## 五、PostgreSQL 索引体系：不是只有 B-tree

InnoDB 的索引优化主线大多围绕 B+Tree：联合索引、最左匹配、范围查询、覆盖索引、回表成本。

PostgreSQL 默认 `CREATE INDEX` 也是 B-tree。B-tree 适合等值、范围、排序相关查询，例如：

```sql
where id = 1
where created_at >= now() - interval '1 day'
order by created_at desc
```

但 PostgreSQL 的索引体系更像一组 access method。官方文档列出的内置索引类型包括 B-tree、Hash、GiST、SP-GiST、GIN、BRIN，扩展还可以继续增加能力。

可以按“它们解决什么问题”来理解。

### 5.1 B-tree：最常用的有序索引

B-tree 处理可排序数据上的等值和范围查询。大部分普通业务查询都先考虑 B-tree。

例子：

```sql
create index runs_user_created_idx on runs(user_id, created_at desc);
```

适合：

```sql
where user_id = 10
order by created_at desc
limit 20
```

这和 MySQL 联合索引有相似点：前导列、排序方向、选择性、范围条件都会影响索引使用。

但 PostgreSQL 的 B-tree 指向 heap TID，不是指向聚簇索引里的主键。所以普通 index scan 的随机 heap 访问成本更突出。查询大量行时，优化器可能选择 bitmap index scan：先从索引收集一批 TID，再按 heap page 顺序访问，减少随机 I/O。

### 5.2 GIN：倒排索引，适合一个字段里有多个 token/key

GIN 可以理解成 inverted index。它适合一个字段内部包含多个可搜索元素的场景，例如数组、全文检索、JSONB。

比如 agent message 或 metadata 用 JSONB 存：

```sql
create table runs (
  id bigint primary key,
  metadata jsonb
);

create index runs_metadata_gin on runs using gin (metadata);
```

查询：

```sql
select *
from runs
where metadata @> '{"model":"gpt-5"}';
```

GIN 的思路不是把整个 JSONB 当一个值排进 B-tree，而是把 JSONB 内部的 key/value 拆成可检索项。查询某个 key/value 时，通过倒排结构找到包含它的 tuple。

这就是 PostgreSQL 对 agent 项目有吸引力的一个点：很多 runtime metadata 很难一开始就拆成稳定列，但又不能完全不可查询。JSONB + GIN 给了一个折中方案。

### 5.3 GiST / SP-GiST：通用搜索树，适合范围、空间、相似性

GiST 是 Generalized Search Tree。它不是某一个固定算法，而是一套让不同数据类型实现“如何组织、如何判断可能匹配”的索引框架。

典型用途包括：

- 几何和地理空间数据。
- range 类型。
- nearest-neighbor 查询。
- 一些扩展类型。

SP-GiST 则适合某些空间分区类结构，例如 trie、quad tree、k-d tree 这类非平衡分区结构。

你不需要在普通业务里天天手写 GiST，但要理解 PostgreSQL 的索引能力为什么强：它不是把所有数据都塞进 B-tree，而是允许不同数据类型接入不同 access method。

### 5.4 BRIN：块范围索引，适合天然有序的大表

BRIN 是 Block Range Index。它不为每一行建立精确索引项，而是为一段 heap block 记录摘要信息，例如最小值、最大值。

适合这种表：

```text
events
  created_at 基本按插入顺序递增
  数据量巨大
```

建索引：

```sql
create index events_created_brin on events using brin(created_at);
```

查询最近一天数据时，BRIN 可以快速排除大部分不可能包含目标时间范围的 block range。它不如 B-tree 精确，但索引很小，维护成本低，适合超大 append-only 或时间相关表。

agent 系统里的 trace、event、audit log，如果按时间追加写入，BRIN 可能比大 B-tree 更省。

### 5.5 部分索引和表达式索引：PostgreSQL 很实用的两把刀

PostgreSQL 的部分索引可以只索引满足条件的行：

```sql
create index runs_pending_idx
on runs(created_at)
where status = 'pending';
```

这对 agent worker 很常见。比如 worker 只关心 pending run，没有必要让 completed run 都进入同一个大索引。

表达式索引可以索引计算结果：

```sql
create index users_lower_email_idx
on users (lower(email));
```

这样：

```sql
where lower(email) = lower($1)
```

就有机会使用表达式索引。

这类能力让 PostgreSQL 不只是“索引更多类型”，而是可以更贴近查询语义建索引。

## 六、锁与隔离：gap lock 和 SSI 是两种并发控制思路

InnoDB 默认隔离级别通常是 Repeatable Read。它在快照读场景下通过 MVCC 提供一致性视图，在当前读场景下通过记录锁、间隙锁、临键锁处理并发修改和幻读问题。

临键锁 Next-Key Lock 可以理解为记录锁 + 间隙锁。它不只锁住已存在的索引记录，也锁住索引记录之间的间隙，从而阻止其他事务在这个范围内插入新记录。

例如：

```sql
select * from orders
where user_id = 10 and amount > 100
for update;
```

如果走了某个范围索引，InnoDB 可能锁住相关索引记录和间隙，避免其他事务插入新的匹配记录。

PostgreSQL 的并发控制思路不同。它也支持 Read Committed、Repeatable Read、Serializable 等隔离级别，但 PostgreSQL 的 Repeatable Read 基于快照隔离，不靠 InnoDB 那种 gap lock 方式覆盖所有范围插入问题。Serializable 则使用 SSI，也就是 Serializable Snapshot Isolation，通过检测危险的读写依赖来保证可串行化。

这会造成一个使用体验差异：

- MySQL/InnoDB 在某些范围更新、`select for update`、唯一性检查场景下，锁等待和死锁可能来自 gap/next-key lock。
- PostgreSQL 在 Serializable 下更常见的是 serialization failure，需要应用层捕获错误并重试事务。

两者都不是“没有并发问题”。只是一个更偏向通过锁住索引范围来提前阻止冲突，另一个更偏向通过快照和冲突检测来发现不可串行化执行。

## 七、WAL：PostgreSQL 的恢复、复制和持久化主线

PostgreSQL 的日志主线是 WAL，也就是 Write-Ahead Logging。

WAL 的核心规则是：数据页落盘前，描述这个修改的日志必须先落盘。这样即使宕机时数据页还没刷到磁盘，只要 WAL 在，重启时就能 replay WAL，把数据库恢复到一致状态。

一个更新大致经历：

```text
1. 修改 shared buffers 中的 heap page / index page
2. 生成 WAL record
3. commit 时按配置等待 WAL flush
4. 后台 checkpoint 逐步把脏页写回数据文件
5. 崩溃后从 checkpoint 开始 replay WAL
```

这和 InnoDB 的 redo log 在思想上相似，都是 WAL 思路。但 MySQL/InnoDB 的日志体系分层更明显：

- redo log：InnoDB 层，页级崩溃恢复。
- undo log：InnoDB 层，回滚和 MVCC。
- binlog：MySQL Server 层，复制和逻辑恢复。
- redo + binlog 需要两阶段提交保证一致。

PostgreSQL 的 WAL 同时是崩溃恢复、物理复制、归档恢复、PITR 的基础。逻辑复制也建立在 WAL decoding 能力之上。

这不是说 PostgreSQL 内部更简单。它也有事务状态、clog/pg_xact、relation fork、checkpoint、full page write 等细节。但从系统主线看，WAL 是 PostgreSQL 的恢复和复制中心。

对 agent 系统来说，这意味着 PostgreSQL 很适合承担“可恢复状态中心”：

- run 状态写入事务提交后，可以依赖 WAL 持久化。
- checkpoint 和 message 可以在同一事务里提交。
- 主从复制和 PITR 可以覆盖执行状态恢复需求。
- 审计、回放、追踪数据都留在同一个恢复体系里。

## 八、为什么 agent 项目会喜欢 PostgreSQL

回到开头的问题：为什么 agent 项目越来越常拿 PostgreSQL 做数据库？

不是因为 agent 只需要传统关系型数据库。恰好相反，是因为 agent 的状态形态太混合了。

一个真实 agent runtime 可能同时需要这些数据：

- assistant 配置：模型、工具、system prompt、权限。
- thread：会话、用户、租户、状态。
- run：执行状态、开始时间、结束时间、错误信息。
- checkpoint：每一步图状态、可恢复点、版本。
- message：多轮对话和工具调用结果。
- memory：用户长期偏好、事实、embedding。
- audit log：谁在什么时候触发了什么操作。
- queue/lease：worker 执行所有权、重试、超时恢复。

这些数据之间有强关系，也有半结构化字段；有事务一致性要求，也有检索需求；有在线路径，也有调试和审计路径。

PostgreSQL 的优势不是单点能力最强，而是组合能力强：

- 用事务保证 run、checkpoint、message 的状态更新一致。
- 用 heap + MVCC 支撑读写并发和历史版本可见性。
- 用 JSONB 保存变化快的 metadata，避免过早拆表。
- 用 B-tree、GIN、BRIN、部分索引、表达式索引贴合不同访问模式。
- 用 pgvector 等扩展支持 memory 的语义检索。
- 用 SQL 支持复杂排查、审计和运营查询。
- 用 WAL、备份、复制、PITR 接入成熟运维体系。

MySQL 当然也能做 agent 状态库，尤其是结构化 OLTP 数据非常稳。但当系统开始同时需要 JSON、复杂索引、向量扩展、长事务状态、审计查询和灵活 schema 演进时，PostgreSQL 的“一库多能力”会更有吸引力。

这解释了很多 agent 框架的默认选择：生产环境不是只要把 message 存下来，而是要能恢复、回放、追踪、检索、审计和演进。

## 九、那 MySQL 还适合什么

写到这里，容易产生一个误解：PostgreSQL 更适合 agent，所以 MySQL 就落后了。

这个结论太粗糙。

MySQL/InnoDB 在大量传统互联网 OLTP 场景里仍然非常合适：

- 访问路径明确。
- 主键查询和二级索引查询占大头。
- 数据模型稳定。
- 分库分表、读写分离、缓存配套成熟。
- 团队已有 MySQL 运维经验。
- 对复杂类型、复杂查询、扩展索引需求不高。

InnoDB 的聚簇索引模型对很多业务表非常高效。比如订单表、账户表、库存表，只要主键和二级索引设计合理，访问路径非常清晰。MySQL 生态里的中间件、迁移工具、备份工具、在线 DDL 工具也非常成熟。

PostgreSQL 更适合这些场景：

- 查询逻辑复杂，SQL 表达能力很重要。
- 需要 JSONB、数组、范围类型、全文检索等能力。
- 希望通过扩展获得向量、地理空间、时序等能力。
- 不希望一开始就拆出多个专用数据库。
- 状态模型经常演进，但仍需要事务和强一致。
- 需要把 operational data 和 retrieval data 放近一点。

所以更实用的判断不是“选 MySQL 还是 PostgreSQL”，而是先问数据模型和访问模式：

- 数据是不是高度结构化、路径稳定、典型 OLTP？MySQL 很稳。
- 数据是不是结构化 + 半结构化 + 检索 + 审计混合？PostgreSQL 更自然。
- 是否已有强团队经验和成熟运维体系？已有体系往往比理论优劣更重要。
- 是否需要向量能力？如果只是轻中量 memory，PostgreSQL + pgvector 足够简单；如果是大规模向量检索，专门向量系统仍可能更合适。

## 十、总结：把差异压成一张图

最后用一张心智图收束：

```text
MySQL/InnoDB

table = clustered primary key B+Tree
secondary index -> primary key -> clustered row
MVCC old versions -> undo log chain
cleanup -> purge
durability -> redo log
replication/logical recovery -> binlog


PostgreSQL

table = heap pages
index -> TID/ctid -> heap tuple
MVCC old versions -> old tuples in heap
cleanup -> vacuum/autovacuum
durability/recovery/physical replication -> WAL
extensibility -> access methods + types + extensions
```

如果只记结论：

- InnoDB 的主键是表的骨架，所以主键设计和回表成本特别重要。
- PostgreSQL 的 heap 是表的主体，索引是通往 heap tuple 的路径，所以 `ctid`、tuple header、visibility、vacuum 特别重要。
- InnoDB 通过 undo log 保存旧版本，PostgreSQL 通过 heap 中的多版本 tuple 保存旧版本。
- PostgreSQL 的索引体系不是单一 B-tree 思维，而是为不同数据类型和查询语义提供不同 access method。
- agent 项目偏爱 PostgreSQL，不是因为它在每个单项上都最强，而是因为它能把关系数据、JSON、索引扩展、向量检索、事务和恢复体系放在一个数据库里。

这正是底层设计影响上层架构的地方。

## 参考资料

- [LangGraph Memory: short-term and long-term memory with Postgres](https://docs.langchain.com/oss/python/langgraph/add-memory)
- [MySQL 8.4 Reference Manual: Clustered and Secondary Indexes](https://dev.mysql.com/doc/refman/8.4/en/innodb-index-types.html)
- [MySQL 8.4 Reference Manual: InnoDB Multi-Versioning](https://dev.mysql.com/doc/refman/8.4/en/innodb-multi-versioning.html)
- [MySQL 8.4 Reference Manual: Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)
- [PostgreSQL 18 Documentation: Database Page Layout](https://www.postgresql.org/docs/current/storage-page-layout.html)
- [PostgreSQL 18 Documentation: System Columns](https://www.postgresql.org/docs/current/ddl-system-columns.html)
- [PostgreSQL 18 Documentation: Heap-Only Tuples](https://www.postgresql.org/docs/current/storage-hot.html)
- [PostgreSQL 18 Documentation: Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
- [PostgreSQL 18 Documentation: Index-Only Scans and Covering Indexes](https://www.postgresql.org/docs/current/indexes-index-only-scans.html)
- [PostgreSQL 18 Documentation: Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [PostgreSQL 18 Documentation: Concurrency Control](https://www.postgresql.org/docs/current/mvcc.html)
- [PostgreSQL 18 Documentation: Write-Ahead Log](https://www.postgresql.org/docs/current/wal.html)
