# Python 语言面试笔记

这篇笔记整理 Python 面试里最常见的基础问题：语法、数据类型、函数、面向对象、内存管理、异常、高级特性、并发和常用标准库。写法偏复习向，先给能直接回答的问题，再补充容易混淆的边界。

## 一、基础语法

### Python 有哪些特点

Python 常见特点：

- 解释型语言：代码通常由解释器执行，开发调试成本低。
- 动态类型：变量不需要提前声明类型，运行时绑定对象。
- 强类型：不同类型不会随意隐式转换，类型不匹配通常会报错。
- 面向对象：一切皆对象，支持类、继承、多态、特殊方法等机制。
- 跨平台：同一份代码通常可以运行在 Windows、Linux、macOS 等平台。
- 标准库丰富：覆盖文件、网络、正则、日期、并发、序列化等常见任务。
- 可扩展：可以用 C/C++ 编写扩展模块，也可以通过 Cython 等方式优化性能。

### Python 是值传递还是引用传递

Python 更准确的说法是“对象引用传递”或“共享传参”。函数调用时，实参对象的引用被绑定到形参名上，而不是复制整个对象。

不可变对象如 `int`、`str`、`tuple` 在函数内“修改”时会绑定到新对象，不影响外部变量。

```python
def change(x):
    x += 1

n = 1
change(n)
print(n)  # 1
```

可变对象如 `list`、`dict`、`set` 如果在函数内原地修改，会影响外部对象。

```python
def append_item(items):
    items.append(1)

data = []
append_item(data)
print(data)  # [1]
```

### 作用域规则 LEGB

Python 名称查找遵循 LEGB 顺序：

- `Local`：当前函数局部作用域。
- `Enclosing`：外层嵌套函数作用域。
- `Global`：模块级全局作用域。
- `Built-in`：内置作用域。

`global` 用于在函数内声明使用模块级全局变量。`nonlocal` 用于在嵌套函数中声明使用外层函数变量。

```python
count = 0

def outer():
    value = 1

    def inner():
        nonlocal value
        value += 1

    inner()
```

### is 和 == 的区别

`==` 比较对象的值，通常调用对象的 `__eq__` 方法。`is` 比较两个变量是否引用同一个对象，也就是身份是否相同。

```python
a = [1, 2]
b = [1, 2]

print(a == b)  # True
print(a is b)  # False
```

面试里要避免用 `is` 比较数字和字符串的值。小整数、字符串驻留等优化可能让结果看起来“刚好成立”，但语义上仍应使用 `==`。

### 可变对象和不可变对象

不可变对象创建后值不能原地修改，常见有 `int`、`float`、`str`、`tuple`、`frozenset`。它们通常可以作为字典 key 或集合元素，前提是自身可哈希。

可变对象创建后可以修改内容，常见有 `list`、`dict`、`set`。它们不能作为字典 key，也不能作为集合元素。

注意：`tuple` 本身不可变，但如果内部包含可变对象，内部对象仍可以被修改，这样的 tuple 也不可哈希。

```python
t = ([1], 2)
t[0].append(3)
print(t)  # ([1, 3], 2)
```

### *args 和 **kwargs

`*args` 接收任意数量的位置参数，并打包成元组。`**kwargs` 接收任意数量的关键字参数，并打包成字典。

```python
def func(*args, **kwargs):
    print(args)
    print(kwargs)

func(1, 2, name="python")
```

它们常用于装饰器、代理函数、框架回调和需要透传参数的场景。

### 深拷贝和浅拷贝

浅拷贝会创建一个新容器，但容器内部引用的对象仍然和原容器共享。常用 `copy.copy()` 或对象的 `copy()` 方法。

深拷贝会递归复制内部对象，创建尽量独立的新对象。常用 `copy.deepcopy()`。

```python
import copy

a = [[1], [2]]
b = copy.copy(a)
c = copy.deepcopy(a)

a[0].append(9)
print(b)  # [[1, 9], [2]]
print(c)  # [[1], [2]]
```

### 三元表达式、pass、continue、break

Python 三元表达式语法：

```python
result = "yes" if condition else "no"
```

循环控制：

- `pass`：空语句，占位，不执行任何操作。
- `continue`：跳过本次循环，进入下一次迭代。
- `break`：跳出整个循环。

## 二、数据类型

### Python 内置数据类型

常见内置类型：

- 数值类型：`int`、`float`、`complex`。
- 序列类型：`list`、`tuple`、`range`、`str`。
- 映射类型：`dict`。
- 集合类型：`set`、`frozenset`。
- 布尔类型：`bool`。
- 二进制类型：`bytes`、`bytearray`、`memoryview`。
- 空值类型：`NoneType`，唯一值是 `None`。

### 列表和元组的区别

`list` 是可变序列，适合存放需要增删改的数据；`tuple` 是不可变序列，适合表达固定结构数据。

| 特性 | list | tuple |
| --- | --- | --- |
| 可变性 | 可变 | 不可变 |
| 语法 | `[1, 2, 3]` | `(1, 2, 3)` |
| 常用方法 | `append`、`insert`、`remove` | `count`、`index` |
| 用途 | 动态集合 | 固定记录、函数多返回值、可哈希 key |

元组通常更轻量，但不要简单说“元组一定更快”。性能还取决于创建方式、访问模式和具体解释器实现。

### dict 的底层实现

Python 的 `dict` 基于哈希表实现。它通过 key 的哈希值定位槽位，冲突时使用开放寻址等策略继续探测。

常见结论：

- 查找、插入、删除平均时间复杂度是 O(1)。
- key 必须可哈希，并且 `__hash__` 和 `__eq__` 语义要一致。
- Python 3.7 起，字典插入顺序成为语言规范保证；Python 3.6 中 CPython 已经保序，但当时主要是实现细节。

### set 的特点和用途

`set` 是无重复元素集合，底层也基于哈希表。元素必须可哈希。

常见用途：

- 去重：`unique = list(set(items))`，但这种方式不保证保留原顺序。
- 成员测试：`x in s` 平均 O(1)。
- 集合运算：交集、并集、差集、对称差集。

```python
a = {1, 2, 3}
b = {3, 4}

print(a & b)  # {3}
print(a | b)  # {1, 2, 3, 4}
print(a - b)  # {1, 2}
```

注意：`set` 不保证插入顺序，不要把 `dict` 的保序结论套到 `set` 上。

### 字符串常用操作

```python
s = " hello python "

s.strip()             # 去除两端空白
s.split()             # 分割
"-".join(["a", "b"])  # 拼接
s.replace("python", "world")
s.startswith(" he")
s.endswith(" ")
s.find("py")
s.upper()
s.lower()
```

大量字符串拼接应优先使用 `join`，避免在循环中反复创建中间字符串。

### 推导式

列表、字典、集合推导式可以简洁地完成映射和过滤。

```python
squares = [x * x for x in range(5)]
even_squares = {x: x * x for x in range(5) if x % 2 == 0}
unique = {x % 3 for x in range(10)}
```

如果数据量很大，可以使用生成器表达式，避免一次性创建完整列表。

```python
total = sum(x * x for x in range(1_000_000))
```

### 切片操作

切片语法是 `seq[start:stop:step]`，左闭右开。

```python
nums = [0, 1, 2, 3, 4, 5]

nums[1:4]    # [1, 2, 3]
nums[:3]     # [0, 1, 2]
nums[::2]    # [0, 2, 4]
nums[::-1]   # 反转
```

切片通常会创建新序列。对大列表频繁切片要注意额外内存开销。

## 三、函数相关

### 函数参数类型

Python 函数参数常见形式：

- 位置参数：按位置传递。
- 默认参数：有默认值，默认值在函数定义时创建。
- 可变位置参数：`*args`。
- 关键字参数：按名称传递。
- 可变关键字参数：`**kwargs`。
- 仅位置参数：Python 3.8+ 使用 `/` 标记。
- 仅关键字参数：使用 `*` 标记。

```python
def func(a, b, /, c=1, *, d, **kwargs):
    pass
```

默认参数不要直接使用可变对象：

```python
def append_bad(x, items=[]):
    items.append(x)
    return items

def append_good(x, items=None):
    if items is None:
        items = []
    items.append(x)
    return items
```

### 闭包

闭包是内部函数引用外部函数变量，并且外部函数返回内部函数后，这些变量仍被保存的机制。

```python
def make_counter():
    count = 0

    def counter():
        nonlocal count
        count += 1
        return count

    return counter
```

闭包常用于装饰器、工厂函数和回调。

### 装饰器

装饰器本质是一个接收函数并返回新函数的函数，用于在不修改原函数代码的情况下增强行为。

```python
from functools import wraps

def log(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        print("before")
        return func(*args, **kwargs)
    return wrapper

@log
def hello():
    print("hello")
```

`@log` 等价于 `hello = log(hello)`。使用 `functools.wraps` 可以保留原函数的名称、文档等元信息。

带参数的装饰器需要再包一层函数：

```python
def retry(times):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_error = None
            for _ in range(times):
                try:
                    return func(*args, **kwargs)
                except Exception as exc:
                    last_error = exc
            raise last_error
        return wrapper
    return decorator
```

### 迭代器和生成器

迭代器实现 `__iter__` 和 `__next__` 方法，可以被 `for` 循环和 `next()` 使用。

生成器是使用 `yield` 的函数，调用后返回生成器对象。生成器会自动保存执行状态，下一次迭代从上次暂停位置继续。

```python
def gen():
    yield 1
    yield 2
```

对比：

| 特性 | 迭代器 | 生成器 |
| --- | --- | --- |
| 创建方式 | 自定义类实现协议 | 函数中使用 `yield` |
| 状态保存 | 手动维护 | 自动保存 |
| 计算方式 | 通常惰性 | 惰性 |
| 常用场景 | 自定义遍历逻辑 | 流式数据、懒加载 |

`yield` 会暂停函数执行并返回一个值，下次继续执行。生成器还支持 `send()`、`throw()`、`close()`。

### map、filter、reduce 和 lambda

`map(func, iterable)` 对每个元素应用函数，返回迭代器。

`filter(func, iterable)` 保留让函数返回真值的元素，返回迭代器。

`reduce(func, iterable)` 做累积计算，返回单个值，需要从 `functools` 导入。

```python
from functools import reduce

nums = [1, 2, 3]
list(map(lambda x: x * 2, nums))
list(filter(lambda x: x % 2 == 1, nums))
reduce(lambda a, b: a + b, nums)
```

`lambda` 是匿名函数，适合写短小表达式。复杂逻辑应使用普通函数，提高可读性。

## 四、面向对象

### 实例方法、类方法和静态方法

实例方法第一个参数是 `self`，可以访问实例属性和类属性。

类方法使用 `@classmethod`，第一个参数是 `cls`，常用于替代构造器或访问类级状态。

静态方法使用 `@staticmethod`，没有默认的 `self` 或 `cls` 参数，适合放在类命名空间下的工具函数。

### __new__ 和 __init__

`__new__` 负责创建对象，是对象创建阶段调用的方法，返回实例对象。它常用于不可变类型定制、单例模式等。

`__init__` 负责初始化对象，在对象创建后调用，通常用于设置实例属性，不能返回非 `None` 值。

```python
class User:
    def __new__(cls, *args, **kwargs):
        return super().__new__(cls)

    def __init__(self, name):
        self.name = name
```

### 继承、MRO 和 super

Python 支持单继承和多继承。多继承下方法查找顺序由 MRO 决定，现代 Python 使用 C3 线性化算法。

```python
class A: ...
class B(A): ...
class C(A): ...
class D(B, C): ...

print(D.__mro__)
```

`super()` 不是简单调用“父类”，而是按 MRO 找下一个类的方法。因此多继承中应配合协作式调用设计。

### 多态和鸭子类型

Python 的多态更偏鸭子类型：不关心对象真实类型，只关心对象是否提供需要的行为。

```python
def save(obj):
    obj.write("data")
```

只要 `obj` 有 `write` 方法，就可以传入。这让代码更灵活，但也要求接口约定清晰。

### 属性访问控制

Python 没有强制 private，更多依赖约定。

- `name`：公有属性。
- `_name`：保护属性，约定内部使用。
- `__name`：触发名称重整，变成 `_ClassName__name`，用于避免子类意外覆盖。
- `@property`：把方法包装成属性访问形式，并可定义 setter、deleter。

```python
class User:
    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, value):
        self._name = value
```

### 常用魔术方法

- 对象表示：`__str__`、`__repr__`、`__hash__`。
- 比较操作：`__eq__`、`__lt__`、`__le__`、`__gt__`、`__ge__`。
- 算术运算：`__add__`、`__sub__`、`__mul__`、`__truediv__`。
- 容器协议：`__len__`、`__getitem__`、`__setitem__`、`__contains__`。
- 可调用对象：`__call__`。
- 上下文管理：`__enter__`、`__exit__`。
- 迭代协议：`__iter__`、`__next__`。

### 描述符

描述符是实现了 `__get__`、`__set__`、`__delete__` 中任意方法的对象，用于控制属性访问。

`property`、`classmethod`、`staticmethod` 都基于描述符协议。ORM 字段、数据校验、懒加载属性也常用描述符实现。

## 五、内存管理与垃圾回收

### Python 的内存管理

以 CPython 为例，Python 使用私有堆管理对象内存。小对象分配通常由 PyMalloc 内存分配器优化，减少频繁系统调用。

常见机制：

- 引用计数管理对象生命周期。
- 垃圾回收器处理循环引用。
- 小整数、字符串等可能有缓存或驻留优化。
- 大对象和底层内存分配细节由解释器和平台共同决定。

### 垃圾回收机制

CPython 以引用计数为主，分代垃圾回收为辅。

引用计数：

- 每个对象维护引用计数。
- 引用增加计数加一，引用减少计数减一。
- 计数变为 0 时对象通常会立即释放。
- 缺点是无法单独解决循环引用。

分代回收：

- 对象分为 0、1、2 三代。
- 新对象先进入年轻代。
- 存活越久越可能晋升到老年代。
- 年轻代更频繁扫描，老年代扫描较少。

标记清除用于发现循环引用中的不可达对象。需要注意，带有复杂析构逻辑的对象循环引用可能更难处理，实际工程中应尽量避免无意义的强引用环。

### GIL

GIL 是 CPython 的全局解释器锁，保证同一时刻通常只有一个线程执行 Python 字节码。

它的好处是简化解释器内部对象和引用计数的线程安全问题。代价是 CPU 密集型 Python 多线程很难利用多核。

应对方式：

- CPU 密集型任务使用 `multiprocessing` 或原生扩展。
- IO 密集型任务可以使用多线程或 `asyncio`。
- 使用 NumPy、C 扩展、Cython 等释放 GIL 的计算路径。
- 其他解释器实现可能有不同策略，但面试默认一般讨论 CPython。

### 如何避免内存泄漏

- 及时释放不再需要的引用。
- 避免长期容器无限增长，例如全局缓存、列表、字典。
- 对缓存使用 `weakref` 或容量限制。
- 处理大数据时优先使用生成器和流式处理。
- 线程、本地变量、回调闭包、循环引用使用完后及时清理。
- 必要时用 `tracemalloc`、`gc`、`objgraph` 等工具定位问题。

`gc.collect()` 可以手动触发回收，但不应作为常规业务逻辑依赖。

## 六、异常处理

### 异常处理机制

Python 使用 `try/except/else/finally` 处理异常。

```python
try:
    data = load()
except FileNotFoundError as exc:
    print(exc)
else:
    process(data)
finally:
    cleanup()
```

- `except`：捕获异常。
- `else`：没有异常时执行。
- `finally`：无论是否异常都会执行，常用于释放资源。

常见内置异常包括 `ValueError`、`TypeError`、`KeyError`、`IndexError`、`AttributeError`、`FileNotFoundError`、`ZeroDivisionError`、`ImportError`。

### 自定义异常

自定义异常通常继承 `Exception`。

```python
class BusinessError(Exception):
    pass

raise BusinessError("invalid state")
```

不要随意捕获裸 `except:`，它会连 `KeyboardInterrupt`、`SystemExit` 等也捕获。更推荐捕获具体异常。

### raise 和 assert

`raise` 用于主动抛出异常，适合业务错误、参数校验、状态错误。

`assert` 用于调试期断言，条件为假时抛出 `AssertionError`。Python 可以通过 `-O` 优化参数禁用断言，因此不要用 `assert` 做运行时必须执行的业务校验。

## 七、高级特性

### 上下文管理器

上下文管理器用于管理资源获取和释放，典型语法是 `with`。

```python
with open("data.txt", "r", encoding="utf-8") as f:
    text = f.read()
```

自定义上下文管理器可以实现 `__enter__` 和 `__exit__`，也可以用 `contextlib.contextmanager`。

```python
from contextlib import contextmanager

@contextmanager
def managed():
    print("enter")
    try:
        yield
    finally:
        print("exit")
```

### 元类

元类是创建类的类。普通对象由类创建，类对象默认由 `type` 创建。

```python
class User:
    pass

print(type(User))  # <class 'type'>
```

自定义元类可以控制类创建过程，例如自动注册类、校验类属性、修改类定义。多数业务场景不需要直接写元类，装饰器或 `__init_subclass__` 往往更简单。

### __slots__

`__slots__` 用于限制实例可拥有的属性，并通常避免为每个实例创建 `__dict__`，从而节省内存。

```python
class Point:
    __slots__ = ("x", "y")

    def __init__(self, x, y):
        self.x = x
        self.y = y
```

它适合大量小对象场景。缺点是灵活性降低，继承时也要注意 slots 的组合规则。

### 协程、async 和 await

协程是轻量级并发单元，适合 IO 密集型任务。Python 使用 `async def` 定义协程函数，调用后返回协程对象；`await` 用于挂起当前协程，等待异步操作完成。

```python
import asyncio

async def fetch():
    await asyncio.sleep(1)
    return "done"

asyncio.run(fetch())
```

协程通常运行在事件循环中，由程序在等待 IO 时主动让出控制权。它不是多核并行计算工具。

### 类型注解

Python 3.5+ 支持类型注解，用于提升可读性、IDE 提示和静态检查。

```python
def add(a: int, b: int) -> int:
    return a + b
```

类型注解默认不在运行时强制检查，需要配合 mypy、pyright、pydantic 等工具或库使用。

### 模块和包

一个 `.py` 文件就是一个模块。包是组织模块的目录，传统包通常包含 `__init__.py`。Python 3.3+ 支持命名空间包，不一定需要 `__init__.py`。

`if __name__ == "__main__"` 用于判断模块是被直接运行还是被导入。

```python
def main():
    pass

if __name__ == "__main__":
    main()
```

直接运行时 `__name__` 是 `"__main__"`，被导入时是模块名。

## 八、并发编程

### 进程、线程、协程的区别

| 特性 | 进程 | 线程 | 协程 |
| --- | --- | --- | --- |
| 内存 | 独立内存空间 | 共享进程内存 | 共享线程内存 |
| 调度 | 操作系统 | 操作系统 | 用户态事件循环 |
| 开销 | 大 | 中 | 小 |
| 通信 | IPC、队列、管道 | 共享数据加锁 | await、队列 |
| 适合 | CPU 密集型 | IO 密集型 | 高并发 IO |
| GIL 影响 | 多进程绕开 | CPython 下受影响 | 单线程协作，无多核并行 |

### 多线程和多进程

多线程常用 `threading`。适合网络请求、文件 IO 等等待时间多的任务。

```python
import threading

def worker():
    print("work")

t = threading.Thread(target=worker)
t.start()
t.join()
```

多进程常用 `multiprocessing`。适合 CPU 密集型任务，可以绕开 CPython GIL 对多线程执行字节码的限制。

```python
from multiprocessing import Process

def worker():
    print("work")

p = Process(target=worker)
p.start()
p.join()
```

### 线程安全的数据结构和锁

`queue.Queue` 是线程安全队列，适合生产者消费者模型。`LifoQueue` 是后进先出队列，`PriorityQueue` 是优先级队列。跨进程通信可以使用 `multiprocessing.Queue`。

```python
import queue
import threading

q = queue.Queue()

def producer():
    for i in range(10):
        q.put(i)

def consumer():
    while True:
        item = q.get()
        try:
            print(item)
        finally:
            q.task_done()
```

共享状态需要加锁。

```python
import threading

lock = threading.Lock()
counter = 0

def increment():
    global counter
    with lock:
        counter += 1
```

常见同步工具：

- `Lock`：普通互斥锁。
- `RLock`：可重入锁。
- `Semaphore`：信号量，限制并发数量。
- `Event`：线程间事件通知。
- `Condition`：条件变量。

## 九、常用模块

### os 和 sys

`os` 常用于操作系统交互：

```python
import os

os.getcwd()
os.chdir("/path")
os.listdir("/path")
os.makedirs("a/b/c", exist_ok=True)
os.remove("file")
os.path.join("a", "b")
os.path.exists("path")
os.path.isfile("path")
os.path.isdir("path")
```

路径处理现代代码也常用 `pathlib`。

```python
from pathlib import Path

path = Path("a") / "b.txt"
path.exists()
```

`sys` 常用于解释器相关信息：

```python
import sys

sys.argv
sys.exit(0)
sys.path
sys.version
sys.platform
sys.stdin
sys.stdout
sys.stderr
```

### json、datetime 和 re

`json` 用于 JSON 序列化和反序列化。

```python
import json

json_str = json.dumps({"name": "张三"}, ensure_ascii=False)
data = json.loads(json_str)
```

文件读写建议使用 `with`：

```python
with open("file.json", "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False)
```

`datetime` 用于日期时间处理。

```python
from datetime import datetime, timedelta

now = datetime.now()
now.strftime("%Y-%m-%d %H:%M:%S")
datetime.strptime("2024-01-01", "%Y-%m-%d")
tomorrow = now + timedelta(days=1)
```

`re` 用于正则表达式。

```python
import re

re.match(r"\d+", "123abc")
re.search(r"\d+", "abc123")
re.findall(r"\d+", "a1b2c3")
re.sub(r"\d+", "X", "a1b2c3")
re.split(r",", "a,b,c")

pattern = re.compile(r"\d+")
pattern.findall("a1b2c3")
```

### collections 和 itertools

`collections` 提供常用容器扩展。

```python
from collections import Counter, defaultdict, namedtuple, deque

Counter("aaabbc")

d = defaultdict(list)
d["key"].append(1)

Point = namedtuple("Point", ["x", "y"])
p = Point(1, 2)

q = deque([1, 2, 3])
q.appendleft(0)
q.popleft()
```

Python 3.7+ 普通 `dict` 已保证插入顺序，`OrderedDict` 仍在需要移动顺序、顺序敏感比较等特定场景有价值。

`itertools` 提供高效迭代工具。

```python
import itertools

list(itertools.chain([1, 2], [3, 4]))
list(itertools.combinations([1, 2, 3], 2))
list(itertools.permutations([1, 2, 3], 2))
list(itertools.product([1, 2], ["a", "b"]))
list(itertools.islice(range(10), 3))
```

## 十、面试速答

- Python 是动态强类型语言，CPython 通常解释执行并配合字节码和运行时优化。
- Python 参数传递是对象引用传递，不是复制对象。
- 名称查找遵循 LEGB，修改外层变量用 `nonlocal`，修改模块全局变量用 `global`。
- `==` 比较值，`is` 比较身份。
- `list` 可变，`tuple` 不可变；`dict` 在 Python 3.7+ 保证插入顺序。
- `set` 不保证插入顺序，元素必须可哈希。
- 装饰器本质是函数包装，闭包常用于保存状态。
- 生成器用 `yield` 实现惰性计算，适合处理大数据流。
- Python 多态常体现为鸭子类型。
- CPython 以引用计数为主，分代 GC 处理循环引用。
- GIL 限制 CPU 密集型多线程并行执行 Python 字节码。
- `assert` 可被 `-O` 禁用，不应用于业务参数校验。
- 协程适合高并发 IO，不适合直接做 CPU 并行。

## 参考资料

- [Python Tutorial](https://docs.python.org/3/tutorial/)
- [Python Language Reference](https://docs.python.org/3/reference/)
- [Python Standard Library](https://docs.python.org/3/library/)
- [Python Data Model](https://docs.python.org/3/reference/datamodel.html)
- [asyncio documentation](https://docs.python.org/3/library/asyncio.html)
