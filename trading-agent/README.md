# 🍔 汉堡交易 · AI 智能体系统

> 🎯 可插拔策略 + 多交易所 API 的 AI 交易系统

![汉堡交易](https://img.shields.io/badge/🍔-汉堡交易-FF6B35?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-v20+-339933?style=for-the-badge&logo=node.js)
![WebSocket](https://img.shields.io/badge/实时-WebSocket-00D8FF?style=for-the-badge)

---

## 🚀 快速开始

```bash
# 克隆项目
git clone https://gitcode.com/gcw_lWxzeyAj/123.git
cd trading-agent

# 启动服务
node server.js

# 打开浏览器
🌐 http://localhost:3088
```

---

## 🎮 功能特点

| 功能 | 说明 |
|------|------|
| 🤖 AI 智能体 | 多智能体并发交易 |
| 📊 实时行情 | WebSocket 推送，零延迟 |
| 🎯 策略市场 | 5+ 内置策略，一键切换 |
| 🔄 模拟/实盘 | 先模拟验证，再实盘下单 |
| 🛠️ 插件化架构 | 轻松添加新策略/交易所 |

---

## 📁 项目结构

```
🍔 trading-agent/
├── 📄 server.js          # HTTP + WebSocket 服务器（零依赖！）
├── 📄 index.html         # 前端控制面板
├── 📄 package.json      # 依赖管理
├── 📄 Dockerfile         # Docker 部署
├── 📂 api/
│   └── adapter.js       # 🏦 交易所 API 适配层
├── 📂 strategies/
│   └── index.js         # 📈 策略引擎 + 技术指标库
├── 📂 core/
│   └── agent.js         # 🤖 智能体核心逻辑
└── 📄 deploy-server.sh   # 🚀 服务器一键部署脚本
```

---

## 🎯 内置策略

| 策略名称 | ID | 信号类型 |
|---------|-----|---------|
| 🔴 BOLL + MACD | `boll-macd` | 布林带 + MACD 交叉 |
| 🟠 SuperTrend | `supertrend` | ATR 趋势跟踪 |
| 🟡 ADX 趋势过滤 | `adx-trend` | ADX + DI 交叉 |
| 🟢 RSI 均值回归 | `rsi-revert` | RSI 超买超卖 |
| 🔵 双均线交叉 | `ma-cross` | EMA 金叉死叉 |

---

## 🏦 支持的交易所

| 交易所 | 类型 | API 要求 |
|--------|------|---------|
| 📊 模拟盘 | `mock` | ✅ 无需配置，内置随机行情 |
| 🟡 Binance | `binance` | 🔑 apiKey + apiSecret |
| 🔵 OKX | `okx` | 🔑 apiKey + apiSecret + passphrase |

---

## 🌐 在线演示

🔗 **https://crayfish.icu**

---

## 📡 API 接口

### REST API

```
GET  /api/strategies           # 📋 获取所有策略列表
GET  /api/agents               # 👥 获取所有智能体
POST /api/agents               # ➕ 创建智能体
GET  /api/agents/:id           # 🔍 获取智能体详情
POST /api/agents/:id/start     # ▶️ 启动智能体
POST /api/agents/:id/stop      # ⏹️ 停止智能体
DELETE /api/agents/:id         # 🗑️ 删除智能体
GET  /api/kitchen/stats        # 🍔 厨房统计
```

### WebSocket

```javascript
// 连接
const ws = new WebSocket('ws://localhost:3088');

// 接收消息类型
{ type: 'agent_state', data: {...} }    // 智能体状态更新
{ type: 'burger_state', data: {...} }    // 汉堡状态更新
{ type: 'kitchen_stats', data: {...} }   // 厨房统计数据
{ type: 'signal', data: {...} }         // 交易信号
```

---

## 🛠️ 扩展开发

### 添加新策略

在 `strategies/index.js` 中添加：

```javascript
'my-strategy': {
    name: '我的策略 🍕',
    description: '自定义策略说明',
    params: { period: 14 },
    analyze(klines) {
        // klines: [{ time, open, high, low, close, volume }]
        return {
            signal: 'BUY',      // BUY | SELL | HOLD
            reason: '原因说明',
            confidence: 0.8     // 0 ~ 1
        };
    }
}
```

### 添加新交易所

在 `api/adapter.js` 实现接口：

```javascript
class MyExchange {
    async getTicker(symbol)      // 获取实时行情
    async getKlines(symbol, interval, limit)  // 获取K线数据
    async placeOrder(symbol, side, type, quantity, price)  // 下单
    async getBalance()           // 获取账户余额
}
```

---

## 🐳 Docker 部署

```bash
# 构建镜像
docker build -t burger-trading .

# 运行容器
docker run -d -p 3088:3088 --name burger burger-trading
```

---

## 🚀 服务器部署

```bash
# 一键部署（需配置 PEM 密钥）
bash deploy-server.sh

# 或手动
cd /opt/burger-trading
git pull origin main
pkill -f "node server.js"
PORT=3088 nohup node server.js > app.log 2>&1 &
```

---

## 📜 许可证

MIT License 📄

---

## 🍔 关于

汉堡交易 · 田忌赛马 AI 博弈系统

Made with ❤️ by Matrix Agent
