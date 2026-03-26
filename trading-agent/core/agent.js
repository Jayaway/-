/**
 * 交易智能体核心
 * 循环: 获取行情 → 策略分析 → 决策 → 执行 → 记录
 */

const { getStrategy } = require('../strategies');
const { createExchange } = require('../api/adapter');

class TradingAgent {
    constructor(config = {}) {
        this.id = config.id || `agent-${Date.now()}`;
        this.name = config.name || 'Default Agent';
        this.symbol = config.symbol || 'BTCUSDT';
        this.strategyId = config.strategyId || 'boll-macd';
        this.exchangeType = config.exchangeType || 'mock';
        this.exchangeConfig = config.exchangeConfig || {};
        this.interval = config.interval || 3000;    // 轮询间隔 ms
        this.tradeAmount = config.tradeAmount || 0.01; // 每次交易量
        this.maxPosition = config.maxPosition || 0.1;   // 最大持仓

        // 状态
        this.status = 'idle'; // idle | running | paused | error
        this.position = 0;    // 当前持仓（正=多，负=空）
        this.entryPrice = 0;
        this.balance = { USDT: 50000 };
        this.trades = [];
        this.pnl = 0;
        this.signals = [];
        this.logs = [];

        // 内部
        this._exchange = null;
        this._strategy = null;
        this._timer = null;
        this._klineCache = [];

        // 回调
        this.onUpdate = config.onUpdate || (() => {});
    }

    log(level, message, data = {}) {
        const entry = {
            time: new Date().toISOString(),
            level,
            message,
            agentId: this.id,  // 确保包含 agentId
            agent: { id: this.id, name: this.name },
            ...data
        };
        this.logs.push(entry);
        if (this.logs.length > 500) this.logs.shift();
        this.onUpdate({ type: 'log', data: entry });
    }

    async start() {
        if (this.status === 'running') return;

        // 创建交易所实例时传入 symbol
        this._exchange = createExchange(this.exchangeType, {
            ...this.exchangeConfig,
            symbol: this.symbol
        });
        this._strategy = getStrategy(this.strategyId);
        if (!this._strategy) throw new Error(`Strategy not found: ${this.strategyId}`);

        this.status = 'running';
        this.log('info', `🚀 智能体启动`, {
            agent: this.name,
            strategy: this._strategy.name,
            exchange: this._exchange.name,
            symbol: this.symbol
        });
        this.onUpdate({ type: 'status', data: { id: this.id, status: this.status } });

        // 预热：获取初始K线
        try {
            this._klineCache = await this._exchange.getKlines(this.symbol, '1m', 100);
            this.log('info', `📊 预热完成，加载 ${this._klineCache.length} 根K线`);
        } catch (err) {
            this.log('warn', `⚠️ 预热失败: ${err.message}`);
        }

        // 启动主循环
        this._runLoop();
    }

    stop() {
        if (this._timer) clearTimeout(this._timer);
        this._timer = null;
        this.status = 'idle';
        this.log('info', '⏸ 智能体已停止');
        this.onUpdate({ type: 'status', data: { id: this.id, status: this.status } });
    }

    async _runLoop() {
        if (this.status !== 'running') return;

        try {
            await this._tick();
        } catch (err) {
            this.log('error', `❌ 执行异常: ${err.message}`);
        }

        this._timer = setTimeout(() => this._runLoop(), this.interval);
    }

    async _tick() {
        // 1. 获取最新行情
        const ticker = await this._exchange.getTicker(this.symbol);

        // 更新K线缓存（模拟追加最新K线）
        if (this._klineCache.length > 0) {
            const last = this._klineCache[this._klineCache.length - 1];
            const now = Date.now();
            if (now - last.time > 60000) {
                this._klineCache.push({
                    time: now,
                    open: last.close,
                    high: ticker.price,
                    low: ticker.price,
                    close: ticker.price,
                    volume: ticker.volume || 1000
                });
                if (this._klineCache.length > 200) this._klineCache.shift();
            } else {
                last.close = ticker.price;
                last.high = Math.max(last.high, ticker.price);
                last.low = Math.min(last.low, ticker.price);
            }
        }

        // 2. 策略分析
        const analysis = this._strategy.analyze(this._klineCache);
        const signal = {
            time: new Date().toISOString(),
            price: ticker.price,
            ...analysis
        };
        this.signals.push(signal);
        if (this.signals.length > 200) this.signals.shift();

        // 3. 决策 & 执行
        if (signal.signal === 'BUY' && signal.confidence >= 0.6) {
            await this._executeBuy(ticker.price, signal.reason, signal.confidence);
        } else if (signal.signal === 'SELL' && signal.confidence >= 0.6) {
            await this._executeSell(ticker.price, signal.reason, signal.confidence);
        }

        // 4. 推送状态更新（包含 agentId 以便前端正确更新）
        this.onUpdate({
            type: 'tick',
            data: {
                agentId: this.id,
                price: ticker.price,
                signal: signal.signal,
                reason: signal.reason,
                confidence: signal.confidence,
                position: this.position,
                pnl: this.pnl,
                balance: this.balance
            }
        });
    }

    async _executeBuy(price, reason, confidence) {
        if (this.position >= this.maxPosition) {
            this.log('debug', `已达最大持仓 ${this.maxPosition}，跳过买入`);
            return;
        }

        const qty = this.tradeAmount;
        try {
            const order = await this._exchange.placeOrder(this.symbol, 'BUY', 'MARKET', qty, price);
            this.position += qty;
            this.entryPrice = this.position > 0 ? price : this.entryPrice;
            this.balance.USDT = (this.balance.USDT || 0) - qty * price;

            const trade = {
                agentId: this.id,
                id: order.orderId,
                time: new Date().toISOString(),
                side: 'BUY',
                price: order.price,
                quantity: qty,
                reason,
                confidence
            };
            this.trades.push(trade);
            this.log('trade', `🟢 买入 ${qty} @ ${order.price}`, { reason, confidence: (confidence * 100).toFixed(0) + '%' });
            this.onUpdate({ type: 'trade', data: trade });
        } catch (err) {
            this.log('error', `❌ 买入失败: ${err.message}`);
        }
    }

    async _executeSell(price, reason, confidence) {
        if (this.position <= 0) {
            this.log('debug', `无持仓，跳过卖出`);
            return;
        }

        const qty = Math.min(this.tradeAmount, this.position);
        try {
            const order = await this._exchange.placeOrder(this.symbol, 'SELL', 'MARKET', qty, price);
            const tradePnl = (order.price - this.entryPrice) * qty;
            this.pnl += tradePnl;
            this.position -= qty;
            this.balance.USDT = (this.balance.USDT || 0) + qty * price;

            const trade = {
                agentId: this.id,
                id: order.orderId,
                time: new Date().toISOString(),
                side: 'SELL',
                price: order.price,
                quantity: qty,
                pnl: parseFloat(tradePnl.toFixed(2)),
                reason,
                confidence
            };
            this.trades.push(trade);
            this.log('trade', `🔴 卖出 ${qty} @ ${order.price} | 盈亏: ${trade.pnl >= 0 ? '+' : ''}${trade.pnl}U`, { reason, confidence: (confidence * 100).toFixed(0) + '%' });
            this.onUpdate({ type: 'trade', data: trade });

            if (this.position <= 0) this.entryPrice = 0;
        } catch (err) {
            this.log('error', `❌ 卖出失败: ${err.message}`);
        }
    }

    // 获取当前完整状态
    getState() {
        return {
            id: this.id,
            name: this.name,
            status: this.status,
            symbol: this.symbol,
            strategyId: this.strategyId,
            strategyName: this._strategy?.name || '-',
            exchangeName: this._exchange?.name || '-',
            position: this.position,
            entryPrice: this.entryPrice,
            pnl: parseFloat(this.pnl.toFixed(2)),
            balance: this.balance,
            totalTrades: this.trades.length,
            winRate: this.trades.filter(t => t.pnl > 0).length / Math.max(this.trades.filter(t => t.side === 'SELL').length, 1) * 100,
            trades: this.trades.slice(-50),
            signals: this.signals.slice(-50),
            logs: this.logs.slice(-100)
        };
    }
}

module.exports = { TradingAgent };
