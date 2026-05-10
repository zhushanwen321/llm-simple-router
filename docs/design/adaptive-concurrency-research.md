# 自适应并发算法调研

## 调研背景

为 LLM API 代理路由器设计自适应并发控制器时，调研了业界主流的自适应并发/拥塞控制算法。

### 本项目场景特征

| 特征 | 值 |
|---|---|
| 典型 max 并发 | ≤ 10 |
| 可用信号 | 成功/失败（429、5xx、网络错误） |
| 延迟信号 | 不可用（LLM 推理时间 0.5s-120s，非系统排队导致） |
| 流量模式 | 突发性高 |
| 上游透明度 | 不透明（无法探测上游真实容量） |

---

## 1. Netflix Gradient2

**来源**：[Netflix/concurrency-limits](https://github.com/Netflix/concurrency-limits) — 工业界最广泛参考的自适应并发实现。

### 核心公式

每个采样窗口（如 1 秒）计算一次：

```
gradient = max(0.5, min(1.0, longtermRtt / currentRtt))
newLimit = gradient × currentLimit + queueSize
newLimit = currentLimit × (1 - smoothing) + newLimit × smoothing   // 平滑（默认 0.2）
```

参数说明：
- `longtermRtt`：长期指数平滑 RTT（历史基准）
- `currentRtt`：当前窗口 RTT
- `queueSize`：允许的排队余量，默认 = `sqrt(currentLimit)`
- `smoothing`：平滑因子，默认 0.2

### 关键设计

1. **queueSize = sqrt(limit)**：低并发时余量占比大（允许快速爬升），高并发时余量占比小（更稳定）。

   | limit | sqrt(limit) | 占比 |
   |---|---|---|
   | 3 | 1.7 | 57% |
   | 5 | 2.2 | 44% |
   | 10 | 3.2 | 32% |
   | 100 | 10 | 10% |

2. **利用率门控**：`if (inflight < estimatedLimit / 2) return estimatedLimit` — 实际并发不到 limit 一半时不增长。与我们设计的 max/2 安全区思路一致。

3. **gradient 钳位** `[0.5, 1.0]`：限制单次调整幅度，防止异常 RTT 样本导致剧烈波动。

4. **长期 RTT 衰减**：当 `longRtt / shortRtt > 2` 时，主动衰减 longRtt（`×0.95`），帮助从过载中恢复。

### 对本项目的适用性

**不可直接用**。Gradient2 依赖 RTT 比值（longtermRtt / currentRtt）判断系统负载。LLM 代理场景中，RTT 主要由模型推理时间决定（0.5s-120s），波动完全不可预测，延迟信号是噪音而非信号。

**可借鉴**：
- `inflight < limit/2` 不增长的利用率门控
- `sqrt(limit)` 作为弹性余量的思路
- 指数平滑替代连续计数

---

## 2. Netflix Vegas（排队深度）

**来源**：同上 concurrency-limits 库，VegasLimit.java

### 核心公式

```java
queueSize = ceil(limit × (1 - noLoadRtt / currentRtt))

if (didDrop)            → 降级: limit - log10(limit)
else if (queueSize > beta)  → 降级: limit - log10(limit)
else if (queueSize < alpha) → 升级: limit + log10(limit)
else                    → 不动

// alpha = 3 × log10(limit), beta = 6 × log10(limit)
// smoothing 后应用
```

升降步长为 `log10(limit)`：

| limit | log10(limit) | alpha | beta |
|---|---|---|---|
| 3 | 0.5 | 1.5 | 3 |
| 5 | 0.7 | 2.1 | 4.2 |
| 10 | 1.0 | 3.0 | 6.0 |
| 100 | 2.0 | 6.0 | 12.0 |

### 关键设计

- **alpha/beta 随 limit 缩放**：低并发时容忍窗口窄（不容易误判），高并发时容忍窗口宽（不容易过度反应）
- **同样有利用率门控**：`if (inflight × 2 < estimatedLimit) return estimatedLimit`

### 对本项目的适用性

**不可直接用**（同样依赖 RTT）。但 alpha/beta 随 limit 缩放的思路值得借鉴——低 limit 时需要更多证据才触发变化。

---

## 3. Netflix AIMD

**来源**：同上 concurrency-limits 库，AIMDLimit.java

### 核心算法

```
每个采样窗口结束时：
  if (queueSize < alpha)  → limit + 1    // alpha 通常 2-3
  if (queueSize > beta)   → limit - 1    // beta 通常 4-6
```

最简单的变体，Netflix 把它作为基准实现。

### 对本项目的适用性

这是我们当前实现的基础。固定步长 + 固定阈值在低并发下表现不佳（+1 对 max=5 是 20% 增长），需要改为参数化的阈值。

---

## 4. Uber Cinnamon / TCP-Vegas

**来源**：[Uber Blog: Cinnamon Auto-Tuner](https://www.uber.com/au-en/blog/cinnamon-auto-tuner-adaptive-concurrency-in-the-wild/)

Uber 明确表示：

> Before choosing TCP-Vegas we experimented with other congestion control algorithms like AIMD and gradient descent, but we found that using TCP-Vegas leads to **more stable inflight limits and is better at handling latency variations at low inflight numbers**.

### 核心伪代码

```
queue = currentLimit × (1 - targetLatency / sampleLatency)

if queue > β(log(currentLimit)):
    currentLimit -= log(currentLimit)
elif queue < α(log(currentLimit)):
    currentLimit += log(currentLimit)
else:
    不变
```

关键特性：低 inflight 时容忍度更高——α/β 窗口随 limit 缩放（log 函数），limit 越小，需要更大的延迟偏差才触发变化。

### Uber 的三大生产改进

1. **延迟采样聚合**：不用单个请求 RTT，而是收集 ~250 个请求取 P90，再做中值滤波 + 指数平滑。消除个别异常请求的干扰。

2. **协方差检测基准漂移**：追踪最近 50 个窗口的 inflight 和吞吐量协方差。如果负相关（更多并发 → 更低吞吐），说明过载，强制降级。解决了"长期过载时 targetLatency 不断漂移"的问题。

3. **inflight 上限 = 实际并发 × 10**：防止空闲时 limit 无限增长。Uber 的具体做法：记录每个间隔内实际处理的最大并发请求数，乘以 10 作为 limit 上限。

### 对本项目的适用性

**核心算法不可用**（依赖 RTT）。但三个生产改进中的思路可借鉴：

- 实际并发上限约束 → 对应我们的利用率门控（max/2 安全区 + limitReached）
- 协方差检测 → 可作为后续增强（检测"当前方向是否正确"）
- 聚合采样 → 对应 EWMA 替代连续计数（后续评估）

---

## 5. Envoy Adaptive Concurrency（Gradient Controller）

**来源**：[Envoy 文档](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/adaptive_concurrency_filter.html)

### 核心公式

```
gradient = minRTT / (sampleRTT × (1 + buffer))
newLimit = floor(gradient × currentLimit)
// gradient 钳位 [0.5, 1.0]
```

- `minRTT`：周期性测量（默认每 60s 重算，采样 50 个请求取 P90）
- `buffer`：容忍度，默认 25%

### 测量 minRTT 的方式

临时把并发降到极低（默认 3），测量"无负载"延迟，然后恢复正常。这确保 minRTT 是真实的服务端处理时间，而非排队延迟。

### 对本项目的适用性

**不可用**（依赖 RTT）。但"主动降并发测基准"的思路有趣——对 LLM 代理不实际，因为上游推理时间本身波动就很大。

---

## 6. Vector ARC（Adaptive Request Concurrency）

**来源**：[Vector Blog](https://vector.dev/blog/adaptive-request-concurrency/)

Vector 的实现深受 Netflix 启发，使用 AIMD 变体：

- **线性增长**：成功时 limit + 1
- **指数退避**：失败时 limit × decrease_ratio（默认 0.9，即丢 10%）
- 三个可调参数：`decrease_ratio`、`warmup_secs`、`max_concurrency`

### 对本项目的适用性

Vector 的 decrease_ratio（乘法退避而非减半）对低并发更友好。max=5 时，0.9 比例只丢 0.5→1 格，比直接减半温和。但指数退避在我们的设计中通过固定丢 1 格实现，效果类似。

---

## 算法对比总结

| 算法 | 信号源 | 低并发表现 | 复杂度 | 本项目可用 |
|---|---|---|---|---|
| Netflix Gradient2 | RTT 梯度 | 一般（默认 initial=20） | 中 | 不可（依赖 RTT） |
| Netflix Vegas | RTT 排队深度 | 好（alpha/beta 缩放） | 中 | 不可（依赖 RTT） |
| Netflix AIMD | 排队深度 | 差（固定步长） | 低 | 部分可借鉴 |
| Uber TCP-Vegas | RTT + 协方差 | 好（Uber 专门优化） | 高 | 不可（依赖 RTT） |
| Envoy Gradient | RTT 梯度 | 未优化 | 中 | 不可（依赖 RTT） |
| Vector AIMD | 成功/失败 | 一般 | 低 | 可借鉴退避比例 |
| **我们的设计** | **成功/失败 + 利用率** | **专门优化** | **低** | **直接可用** |

### 共性设计模式

所有算法共享以下模式（我们的设计已包含）：

1. **利用率门控**：实际并发不到当前 limit 一半时不增长（Netflix `inflight < limit/2`，Uber `actual × 10`）
2. **平滑/缓冲**：不对单个样本做反应，需要积累证据（我们的连续计数、Netflix 的 EWMA）
3. **钳位**：限制单次调整幅度（Netflix gradient [0.5, 1.0]，我们的固定步长 1）
4. **升降不对称**：爬升慢、跌落快（AIMD 的 Additive Increase / Multiplicative Decrease）

### 后续可选增强

如果当前简单方案效果不够好，可按优先级逐步引入：

1. **EWMA 替代连续计数**（来源：Netflix 全系）— 抗噪能力更强
2. **实际并发上限约束**（来源：Uber）— `limit ≤ highWaterMark + 2`
3. **协方差方向检测**（来源：Uber）— 判断升降方向是否正确
