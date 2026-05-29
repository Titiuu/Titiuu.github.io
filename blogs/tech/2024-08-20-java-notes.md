# Java 语言面试笔记

这篇笔记整理 Java 面试中最常见的基础问题：语言特性、面向对象、常用类、集合、并发和 JVM 相关机制。写法偏复习向，先给能直接回答面试官的结论，再补容易说错的版本差异和边界。

## 一、Java 基础

### Java 有哪些特性

Java 常被总结为：面向对象、平台无关、支持多线程、可靠、安全，以及具备较完善的标准库和运行时生态。

- 面向对象：支持封装、继承、多态，用类和接口组织程序。
- 平台无关：Java 源码编译成字节码，由不同平台上的 JVM 执行，即“一次编译，到处运行”。
- 多线程支持：Java 标准库内置线程、锁、并发集合、线程池等机制。
- 可靠性：异常处理、类型检查、自动内存管理降低了很多手工内存错误。
- 安全性：访问权限、类加载校验、安全管理模型和限制直接访问底层资源等设计提高了安全边界。

### JIT 是什么

Java 程序通常先由 `javac` 编译成 `.class` 字节码，运行时由 JVM 执行。JVM 可以解释执行字节码，也可以把热点代码即时编译成本地机器码，这就是 JIT。

准确说，JIT 不是把机器码写回 `.class` 文件，而是 JVM 在运行时识别热点方法或热点循环，将其编译到 Code Cache 中，后续执行可以直接运行编译后的机器码。这样 Java 同时具有解释执行的灵活性和热点代码接近本地执行的性能。

### Java 和 C++ 的区别

常见回答：

- Java 没有暴露给程序员直接操作的指针，内存访问更受约束；C++ 可以直接操作指针。
- Java 对象主要由 GC 管理生命周期；C++ 通常依赖 RAII、智能指针或手动释放资源。
- Java 类只支持单继承，但接口可以多继承；C++ 支持多重继承。
- Java 只支持方法重载，不支持 C++ 风格的操作符重载。
- Java 编译为字节码运行在 JVM 上；C++ 通常编译为平台相关的本地机器码。

这类问题不要答成“Java 一定比 C++ 安全”或“C++ 一定更快”。更稳妥的说法是：两者的内存模型、运行时和抽象成本不同，适合的工程场景也不同。

### 基本类型和包装类型的区别

Java 有 8 种基本类型：`byte`、`short`、`int`、`long`、`float`、`double`、`char`、`boolean`。包装类型是对应的对象类型，例如 `Integer`、`Long`、`Boolean`。

主要区别：

- 用途：基本类型适合局部计算和字段存储；包装类型可以用于泛型、集合、反射和需要对象语义的场景。
- 默认值：成员变量中基本类型有默认值，例如 `int` 为 `0`；包装类型默认值是 `null`。
- 比较方式：基本类型用 `==` 比较值；包装类型用 `==` 比较引用，比较值应使用 `equals`。
- 空值表达：包装类型可以表示 `null`，基本类型不行。
- 装箱拆箱：基本类型和包装类型之间赋值时可能发生自动装箱和拆箱。

```java
Integer a = 128;
Integer b = 128;
System.out.println(a == b);      // false，比较引用
System.out.println(a.equals(b)); // true，比较值
```

注意，基本类型局部变量存在于栈帧的局部变量表中；对象实例通常在堆上分配。不要把“引用在栈上、对象在堆上”说成绝对规则，JIT 逃逸分析可能做标量替换等优化。

### 成员变量和局部变量的区别

- 定义位置：成员变量定义在类中；局部变量定义在方法、构造器或代码块中。
- 修饰符：成员变量可以使用访问修饰符、`static`、`final` 等；局部变量不能使用访问修饰符，但可以用 `final`。
- 生命周期：实例成员变量随对象存在；静态成员变量随类加载存在；局部变量随方法调用进入和退出而创建、销毁。
- 默认值：成员变量有默认值，局部变量必须显式赋值后才能使用。

被 `final` 修饰的成员变量必须在声明处、构造方法或初始化块中完成初始化。局部变量未赋值就使用会在编译期报错。

### Java 只有值传递

Java 方法参数传递永远是值传递。

基本类型传递的是值的副本。引用类型传递的是“引用值”的副本，也就是对象地址语义的副本。方法内不能让调用方的引用变量指向新对象，但可以通过这份引用副本修改同一个对象的内部状态。

```java
static void changeName(User user) {
    user.setName("new name"); // 会影响原对象
    user = new User("other"); // 不会改变调用方变量指向
}
```

## 二、面向对象

### 多态有哪些

Java 多态通常分为：

- 静态多态：方法重载，编译期根据参数列表确定调用哪个方法。
- 动态多态：方法重写，运行期根据对象实际类型进行动态绑定。

重载要求方法名相同、参数列表不同；返回值不能单独作为重载依据。重写发生在继承关系中，子类方法覆盖父类方法，方法签名要兼容。

### 接口和抽象类的区别

设计目的不同：

- 接口强调行为约束，表示“能做什么”。
- 抽象类强调代码复用和抽象父类关系，表示“是什么的一种”。

继承关系不同：

- 一个类只能继承一个抽象类。
- 一个类可以实现多个接口。
- 接口可以继承多个接口。

成员不同：

- 接口中的字段默认是 `public static final`，必须初始化。
- 抽象类可以有普通成员变量、静态变量、构造方法、普通方法和抽象方法。

方法能力要按版本说明：

- Java 8 之前，接口主要是抽象方法和常量。
- Java 8 起，接口可以有 `default` 方法和 `static` 方法。
- Java 9 起，接口可以有 `private` 和 `private static` 方法，用于复用接口内部逻辑。

### 深拷贝、浅拷贝和引用拷贝

引用拷贝只是复制引用变量，两个引用指向同一个对象。

浅拷贝会创建一个新对象，但对象内部的引用类型字段仍然和原对象指向同一个子对象。

深拷贝会复制对象本身，也复制对象内部引用指向的对象，使新旧对象的内部状态相互独立。

```java
class User {
    Address address;
}
```

如果只是复制 `User` 对象，但 `address` 仍然指向同一个 `Address`，这是浅拷贝；如果 `Address` 也复制出新对象，就是深拷贝。

## 三、常用类与语言机制

### String、StringBuffer、StringBuilder 的区别

`String` 是不可变类。字符串内容不能被修改，每次看似修改字符串，实际上都会产生新的字符串对象或新的拼接结果。不可变性的基础包括：内部存储不暴露可变修改接口，类本身是 `final`，避免被子类破坏语义。

`StringBuffer` 和 `StringBuilder` 都继承自 `AbstractStringBuilder`，内部维护可变字符缓冲区。

- `StringBuffer` 的关键方法带同步控制，线程安全，性能相对低。
- `StringBuilder` 不做同步，线程不安全，但单线程场景性能更好。

使用建议：

- 少量字符串操作：直接用 `String`。
- 单线程大量拼接：用 `StringBuilder`。
- 多线程共享同一个字符串缓冲区：用 `StringBuffer`，但实际工程中更常见的是避免共享可变对象。

关于 `+` 拼接要注意版本差异。Java 8 及以前，`javac` 常把字符串拼接编译成 `StringBuilder.append` 链。Java 9 起，JEP 280 将字符串拼接改为基于 `invokedynamic` 和 `StringConcatFactory`，为运行时优化留下空间。无论哪个版本，在循环里大量拼接字符串都应优先考虑 `StringBuilder`。

### Exception 和 Error 的区别

`Throwable` 有两个重要子类：`Exception` 和 `Error`。

`Exception` 表示程序可以捕获和处理的异常。它又分为：

- Checked Exception：受检异常，除了 `RuntimeException` 及其子类之外的很多异常都属于此类，方法需要 `throws` 声明或调用方捕获处理。
- Unchecked Exception：非受检异常，主要是 `RuntimeException` 及其子类，可以不强制捕获。

`Error` 表示程序通常无法处理的严重问题，例如 `OutOfMemoryError`、`StackOverflowError`、`VirtualMachineError`。一般不建议业务代码捕获并继续运行。

### 泛型

泛型是 Java 提供的参数化类型机制，可以让类、接口、方法在编译期接受不同类型参数，减少重复代码并提高类型安全。

```java
class Box<T> {
    private T value;
    T get() {
        return value;
    }
}
```

Java 泛型主要通过类型擦除实现。编译后很多泛型类型信息会被擦除为上界类型，因此运行期不能直接 `new T()`，也不能创建普通的泛型数组。

### 反射

JVM 加载类后，会为类元数据创建对应的 `Class` 对象。通过反射可以在运行期获取类、字段、方法、构造器等信息，并动态创建对象或调用方法。

```java
Class<?> clazz = Class.forName("com.example.User");
Method method = clazz.getDeclaredMethod("getName");
```

反射的优点是灵活，框架可以基于注解、配置和约定动态处理对象。缺点是编译期检查减少、性能开销更高、可读性和安全性更差。Spring、ORM、序列化框架、动态代理等都大量使用反射或相关机制。

### 序列化和反序列化

序列化是把对象或数据结构转换成字节流、文本或其他可传输格式的过程。反序列化是把这些数据还原成对象或数据结构。

常见用途：

- 网络传输。
- 缓存或持久化。
- RPC 参数编码。
- 消息队列数据交换。

Java 原生序列化使用 `Serializable`，但很多工程更偏向 JSON、Protobuf、Kryo 等方案。反序列化来自不可信输入时要非常谨慎，历史上出现过大量反序列化安全漏洞。

### Java 代理模式

静态代理是在编译期写好代理类。代理类和被代理类实现同一个接口，代理类内部持有真实对象，并在方法调用前后增强逻辑。

JDK 动态代理基于接口，通过 `InvocationHandler` 在运行期生成代理对象。

```java
Object proxy = Proxy.newProxyInstance(
    target.getClass().getClassLoader(),
    target.getClass().getInterfaces(),
    (p, method, args) -> method.invoke(target, args)
);
```

CGLIB 动态代理通过生成目标类子类来增强方法，适合没有接口的类。Spring AOP 中常见规则是：有接口时优先 JDK 动态代理，没有接口时可使用 CGLIB。

### Unsafe 类

`Unsafe` 提供了一批绕过普通 Java 安全边界的底层能力，常见包括：

- 直接内存分配和释放，例如堆外内存。
- CAS 操作。
- 内存屏障。
- 对象字段偏移访问。
- 线程挂起和恢复相关操作。
- 类和系统级底层信息访问。

`Unsafe` 能做很多高性能基础设施工作，但风险很高，普通业务代码不应直接依赖。现代 Java 中很多能力已有替代方案，例如 `VarHandle`、`ByteBuffer`、`java.util.concurrent.atomic` 等。

## 四、Java 集合

### 集合体系

Java 集合主要分为两大接口：

- `Collection`：存放单个元素，主要子接口有 `List`、`Set`、`Queue`。
- `Map`：存放键值对。

`List` 关注有序和可重复，`Set` 关注不重复，`Queue` 关注队列语义，`Map` 关注 key-value 映射。

### ArrayList 和 LinkedList 的区别

- 线程安全：二者都不是线程安全容器。
- 底层结构：`ArrayList` 基于动态数组；`LinkedList` 基于双向链表。
- 随机访问：`ArrayList` 支持高效随机访问，实现了 `RandomAccess`；`LinkedList` 随机访问需要遍历。
- 插入删除：`ArrayList` 在尾部追加均摊 O(1)，中间插入删除需要移动元素；`LinkedList` 在已知节点位置时插入删除快，但按下标定位仍需 O(n)。
- 内存占用：`ArrayList` 可能预留容量；`LinkedList` 每个节点需要额外保存前驱、后继引用。

### ArrayList 扩容机制

`ArrayList` 底层是数组。容量不足时会创建更大的数组，并把旧元素复制过去。

在常见 OpenJDK 实现中，新容量通常按旧容量的 1.5 倍增长；如果仍然不够，则直接扩到所需容量；如果超过最大数组限制，会走超大容量处理逻辑。这个结论适合回答 Java/OpenJDK 面试，但要知道具体实现可能随 JDK 版本变化。

### HashMap 和 Hashtable 的区别

- 线程安全：`HashMap` 非线程安全；`Hashtable` 方法基本使用 `synchronized`，线程安全但并发性能差。
- null 支持：`HashMap` 允许一个 `null` key 和多个 `null` value；`Hashtable` 不允许 null key 或 null value。
- 初始容量和扩容：`HashMap` 默认容量 16，扩容通常翻倍，并保持容量为 2 的幂；`Hashtable` 默认容量 11，扩容通常为 `2n + 1`。
- 数据结构：Java 8 之后 `HashMap` 采用数组 + 链表 + 红黑树，链表过长且数组足够大时树化；`Hashtable` 没有同样的树化机制。

### HashSet 如何检查重复

`HashSet` 底层通常基于 `HashMap` 实现，元素作为 key，value 使用一个固定占位对象。

判断重复大致过程：

1. 先计算元素的 `hashCode` 定位桶。
2. 如果 hash 冲突，再用 `equals` 判断是否是同一个逻辑元素。
3. 如果已存在相等元素，新增失败并返回 `false`；不会真正插入重复元素。

所以自定义对象放入 `HashSet` 时，必须正确重写 `hashCode` 和 `equals`。

### HashMap 的长度为什么是 2 的幂

当数组长度是 2 的幂时，`hash % length` 可以优化为 `hash & (length - 1)`，计算更快。

更重要的是，2 的幂配合 HashMap 的扰动函数和扩容迁移，可以让元素在扩容后只需要判断一个新增高位，决定留在原位置还是移动到 `oldIndex + oldCapacity`，迁移效率更高。

### HashMap 多线程为什么不安全

`HashMap` 不是并发容器，多线程同时读写可能出现数据覆盖、结构不一致、扩容期间异常行为等问题。

Java 8 之前，扩容迁移使用头插法，在并发扩容时可能形成链表环，导致死循环。Java 8 改为尾插法并引入树化，避免了这个典型问题，但并不意味着 `HashMap` 可以并发写。并发场景应使用 `ConcurrentHashMap` 或外部同步。

### ConcurrentHashMap 和 Hashtable 的区别

`Hashtable` 使用一把大锁保护大多数方法，并发度很低。

`ConcurrentHashMap` 面向并发访问优化：

- JDK 1.7 使用 Segment 分段锁，每个 Segment 类似一个小 HashMap。
- JDK 1.8 取消 Segment 作为主要并发控制结构，使用数组 + 链表/红黑树，配合 CAS 和 `synchronized` 锁桶头节点。

JDK 1.8 中，只要不同线程操作的桶不冲突，通常可以并发进行，锁粒度比 `Hashtable` 小得多。

### ConcurrentHashMap 为什么 key 和 value 不能为 null

核心原因是避免二义性。`ConcurrentHashMap.get(key)` 返回 `null` 时，必须能明确表示“没有这个 key”。如果允许 value 为 `null`，调用方无法区分“key 不存在”和“key 存在但 value 是 null”。

在并发环境下，这种二义性更难通过 `containsKey` 再判断解决，因为两次操作之间 Map 状态可能已经被其他线程修改。

## 五、Java 并发

### sleep 和 wait 的区别

- `Thread.sleep()` 是线程休眠，不释放已持有的锁。
- `Object.wait()` 必须在同步代码块或同步方法中调用，会释放当前对象监视器锁，并等待 `notify`、`notifyAll` 或超时唤醒。

`sleep` 关注时间暂停；`wait` 关注线程间协作。

### 可以直接调用 run 方法吗

可以调用，但不会启动新线程。直接调用 `run()` 只是普通方法调用，仍在当前线程执行。只有调用 `start()`，JVM 才会创建新线程并在新线程中执行 `run()`。

### 单核 CPU 上多线程一定更快吗

不一定。

- CPU 密集型任务：单核上多个线程会增加上下文切换，可能更慢。
- IO 密集型任务：线程等待 IO 时可以让出 CPU，其他线程继续执行，整体吞吐可能提升。

线程数设置要根据任务类型、阻塞比例、机器资源和系统目标综合判断。

### volatile

`volatile` 的作用：

- 保证可见性：一个线程写入 volatile 变量，其他线程后续读取能看到最新值。
- 禁止特定指令重排序：通过内存屏障约束读写顺序。

`volatile` 不能保证复合操作的原子性。

```java
volatile int count = 0;
count++; // 不是原子操作
```

需要原子性时，应使用 `synchronized`、`Lock`、`AtomicInteger` 等机制。

### 乐观锁和悲观锁

悲观锁认为并发冲突经常发生，因此访问共享资源前先加锁，其他线程阻塞等待。

乐观锁认为冲突较少，先不加锁执行，提交时检查数据是否被修改。常见实现有版本号机制和 CAS。

CAS 全称 Compare And Swap，涉及三个值：

- V：内存中的当前值。
- E：预期值。
- N：要写入的新值。

只有当 V 等于 E 时，才把 V 更新为 N。CAS 通常依赖 CPU 原子指令，并在 Java 中通过 `Unsafe` 或 VarHandle 等底层能力支撑。

CAS 常见问题：

- 自旋时间过长会浪费 CPU。
- ABA 问题：值从 A 变成 B 又变回 A，CAS 看不出中间变化。可用版本号或 `AtomicStampedReference` 解决。

### synchronized

`synchronized` 可以修饰实例方法、静态方法和代码块，保证同一时刻只有一个线程持有对应监视器锁。

```java
synchronized void instanceMethod() {}

static synchronized void staticMethod() {}

void block() {
    synchronized (this) {
        // critical section
    }
}
```

构造方法不能用 `synchronized` 修饰。对象构造阶段通常还没有被其他线程安全发布，但这不代表构造过程可以随意把 `this` 暴露给其他线程。

同步代码块在字节码层面通常对应 `monitorenter` 和 `monitorexit` 指令。同步方法则通过方法访问标志表达同步语义，进入方法时获取监视器，退出时释放。

`synchronized` 和 `volatile` 的区别：

- `volatile` 只能修饰变量；`synchronized` 可以修饰方法和代码块。
- `volatile` 保证可见性和有序性，不保证复合操作原子性。
- `synchronized` 同时保证可见性、原子性和有序性。

锁升级常见说法包括无锁、偏向锁、轻量级锁、重量级锁。需要注意版本差异：偏向锁在较新的 JDK 中已被默认禁用或移除，面试时最好说明这是 HotSpot 历史实现细节，不是 Java 语言规范。

### ReentrantLock

`ReentrantLock` 实现了 `Lock` 接口，是可重入的独占锁。默认非公平，也可以通过构造参数创建公平锁。

和 `synchronized` 相比：

- `synchronized` 由 JVM 管理加锁释放；`ReentrantLock` 需要手动 `lock()` 和 `unlock()`，通常在 `finally` 中释放。
- `ReentrantLock` 支持可中断等待锁、超时获取锁、公平锁和多个 `Condition`。
- `synchronized` 语法更简单，不容易忘记释放锁。

```java
lock.lock();
try {
    // critical section
} finally {
    lock.unlock();
}
```

### ThreadLocal

`ThreadLocal` 用于让每个线程拥有一份独立变量副本，常见于保存用户上下文、traceId、数据库连接上下文等。

原理上，每个 `Thread` 内部有一个 `ThreadLocalMap`，key 是 `ThreadLocal`，value 是当前线程绑定的值。

内存泄漏风险来自：`ThreadLocalMap` 的 key 是弱引用，value 是强引用。如果线程长期存活，例如线程池线程，而 `ThreadLocal` 外部引用被回收，key 可能变成 null，但 value 仍留在 map 中。因此使用完应调用 `remove()`。

key 为什么设计成弱引用？如果 key 是强引用，即使业务代码不再持有 `ThreadLocal`，只要线程还活着，key 和 value 都无法回收，泄漏更严重。弱引用只能缓解 key 的泄漏，value 仍需要清理。

### 线程池

推荐通过 `ThreadPoolExecutor` 构造函数创建线程池，不推荐直接使用 `Executors` 的快捷方法，因为快捷方法隐藏了队列大小、最大线程数等关键参数，容易导致 OOM 或资源耗尽。

核心参数：

- `corePoolSize`：核心线程数。
- `maximumPoolSize`：最大线程数。
- `keepAliveTime`：非核心线程空闲存活时间。
- `workQueue`：任务队列。
- `threadFactory`：线程创建工厂。
- `handler`：拒绝策略。

核心线程默认不会因为空闲被回收，但可以调用 `allowCoreThreadTimeOut(true)` 让核心线程也遵循 keep-alive 策略。

常见拒绝策略：

- `AbortPolicy`：抛出 `RejectedExecutionException`。
- `CallerRunsPolicy`：由提交任务的线程执行任务，起到反压作用。
- `DiscardPolicy`：直接丢弃新任务。
- `DiscardOldestPolicy`：丢弃队列中最旧任务，再尝试提交新任务。

常见队列：

- `LinkedBlockingQueue`：链表阻塞队列，未指定容量时容量很大，常用于 `FixedThreadPool` 和 `SingleThreadExecutor`。
- `SynchronousQueue`：不存储元素，提交任务必须直接交给工作线程，常用于 `CachedThreadPool`。
- `DelayedWorkQueue`：延迟队列，常用于 `ScheduledThreadPool`，内部按执行时间排序。

线程池执行流程：

1. 运行线程数小于核心线程数，直接创建核心线程执行任务。
2. 核心线程已满，尝试放入队列。
3. 队列满且线程数小于最大线程数，创建非核心线程执行。
4. 仍无法处理，执行拒绝策略。

线程异常后是否复用：

- `execute()` 提交的任务抛出未捕获异常时，执行该任务的线程通常会终止，线程池再补充新线程。
- `submit()` 提交的任务异常会被封装进 `Future`，调用 `get()` 时再抛出，线程本身通常可继续复用。

线程池大小经验值：

- CPU 密集型：接近 CPU 核心数，常见经验是 `N + 1`。
- IO 密集型：可以大于核心数，例如 `2N` 作为起点，再根据阻塞比例和压测结果调整。

### CompletableFuture

`CompletableFuture` 用于异步任务编排。它可以表达任务完成后的回调、多个任务组合、异常处理和结果汇总。

典型场景：一个接口需要并发请求多个下游服务，最后汇总返回。

```java
CompletableFuture<User> userFuture = CompletableFuture.supplyAsync(this::queryUser);
CompletableFuture<Order> orderFuture = CompletableFuture.supplyAsync(this::queryOrder);

CompletableFuture<Result> result = userFuture.thenCombine(orderFuture, Result::new);
```

从设计上看，每个 `CompletableFuture` 可以看作一个可完成的异步结果，内部维护依赖动作。任务完成时触发后续回调，整体有点类似观察者模式和依赖图调度。

### AQS

AQS 是 `AbstractQueuedSynchronizer`，用于构建锁和同步器的基础框架。`ReentrantLock`、`Semaphore`、`CountDownLatch` 等都基于 AQS。

核心思想：

- 用一个 `volatile int state` 表示同步状态。
- 获取资源成功的线程继续执行。
- 获取失败的线程进入 CLH 变体同步队列等待。
- 释放资源时唤醒队列中的后继节点。

AQS 支持独占模式和共享模式。独占模式一次只有一个线程获取资源，例如 `ReentrantLock`；共享模式允许多个线程同时获取资源，例如 `Semaphore`、`CountDownLatch`。

## 六、面试速答

- Java 特性：面向对象、平台无关、自动内存管理、多线程、异常处理和安全机制。
- JIT：运行时把热点字节码编译成本地机器码，结果进入 Code Cache。
- Java 只有值传递：引用类型传递的是引用值的副本。
- 接口和抽象类：接口偏行为约束，抽象类偏代码复用和所属关系。
- `String` 不可变；大量拼接优先用 `StringBuilder`。
- 受检异常必须捕获或声明；运行时异常不强制处理。
- `HashSet` 通过 `hashCode` 和 `equals` 判断重复，重复元素不会插入。
- `HashMap` 非线程安全，并发写用 `ConcurrentHashMap`。
- `volatile` 保证可见性和有序性，不保证复合操作原子性。
- CAS 有自旋开销和 ABA 问题。
- `synchronized` 由 JVM 管理锁；`ReentrantLock` 更灵活但要手动释放。
- `ThreadLocal` 在线程池中用完要 `remove()`。
- 线程池不要盲用 `Executors`，要明确核心线程数、队列和拒绝策略。

## 参考资料

- [OpenJDK JEP 280: Indify String Concatenation](https://openjdk.org/jeps/280)
- [Oracle Java 8 API: ConcurrentHashMap](https://docs.oracle.com/javase/8/docs/api/java/util/concurrent/ConcurrentHashMap.html)
- [Oracle Java API: ThreadPoolExecutor](https://docs.oracle.com/en/java/javase/26/docs/api/java.base/java/util/concurrent/ThreadPoolExecutor.html)
- [Oracle Java Collections Framework Guide](https://docs.oracle.com/javase/8/docs/technotes/guides/collections/index.html)
- [Java Language Specification](https://docs.oracle.com/javase/specs/)
