# 🍔 汉堡交易 · AI 智能体系统

可插拔策略 + 多交易所 API 的 AI 交易系统。

## 快速启动

```bash
cd trading-agent
node server.js
# 浏览器打开 http://localhost:3088
```

## 架构

```
trading-agent/
├── server.js            # HTTP + WebSocket 服务器（零依赖）
├── index.html           # 前端面板
├── api/
│   └── adapter.js       # 交易所 API 适配层
├── strategies/
│   └── index.js         # 策略引擎 + 技术指标库
└── core/
    └── agent.js         # 智能体核心（决策循环）
```

## 内置策略

| 策略 | ID | 说明 |
|------|----|------|
| BOLL + MACD | `boll-macd` | 布林带结合 MACD 交叉信号 |
| SuperTrend | `supertrend` | ATR 趋势跟踪 |
| ADX 趋势过滤 | `adx-trend` | ADX 判断趋势强度 + DI 交叉 |
| RSI 均值回归 | `rsi-revert` | RSI 超买超卖反转 |
| 双均线交叉 | `ma-cross` | EMA 金叉死叉 |

## 支持的交易所

| 交易所 | 类型 | 说明 |
|--------|------|------|
| 模拟盘 | `mock` | 内置随机行情，无需 API Key |
| Binance | `binance` | 需要 apiKey + apiSecret |
| OKX | `okx` | 需要 apiKey + apiSecret + passphrase |

## API

```
GET  /api/strategies           # 策略列表
POST /api/agents               # 创建智能体
GET  /api/agents               # 所有智能体
GET  /api/agents/:id           # 智能体详情
POST /api/agents/:id/start     # 启动
POST /api/agents/:id/stop      # 停止
DELETE /api/agents/:id         # 删除
WebSocket /                    # 实时推送
```

## 添加新策略

在 `strategies/index.js` 的 `strategies` 对象中添加：

```js
'my-strategy': {
    name: '我的策略',
    description: '策略说明',
    params: { period: 14 },
    analyze(klines) {
        // klines: [{ time, open, high, low, close, volume }]
        // 返回: { signal: 'BUY'|'SELL'|'HOLD', reason: string, confidence: 0~1 }
        return { signal: 'HOLD', reason: '观望', confidence: 0.5 };
    }
}
```

## 添加新交易所

在 `api/adapter.js` 中实现以下接口：

```js
class MyExchange {
    async getTicker(symbol)     // → { symbol, price, bid, ask, volume, timestamp }
    async getKlines(symbol, interval, limit)  // → [{ time, open, high, low, close, volume }]
    async placeOrder(symbol, side, type, quantity, price)  // → { orderId, status, ... }
    async getBalance()          // → { USDT: { free, locked }, ... }
}
```
