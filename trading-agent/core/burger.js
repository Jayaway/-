/**
 * 汉堡策略组合 (BurgerStrategy)
 * 将 底层面包(base) + 核心肉饼(patty) + 特殊酱汁(sauce) 组合成完整策略实例
 *
 * base:  低风险底座策略 (资金分配比例, 如 60%)
 * patty: 核心收益引擎 (资金分配比例, 如 30%)
 * sauce: AI 过滤器 (决定是否执行 patty 信号)
 *
 * 田忌赛马逻辑:
 *   - 不同汉堡组合在不同市场环境下表现不同
 *   - 系统并发运行多个汉堡，实时排名
 *   - 表现差的自动熔断（防焦），表现好的加仓
 */

const { getStrategy } = require('../strategies');

class BurgerStrategy {
    constructor(config = {}) {
        this.id = config.id || `burger-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this.name = config.name || '自定义汉堡';
        this.emoji = config.emoji || '🍔';

        // === 三层组件 ===
        this.baseId = config.baseId || 'stable-fund';     // 底层面包
        this.pattyId = config.pattyId || 'boll-macd';     // 核心肉饼
        this.sauceId = config.sauceId || 'none';          // 特殊酱汁 (可选)

        // === 资金分配 (田忌赛马的核心：错位分配) ===
        this.allocBase = config.allocBase || 0.6;   // 60% 低风险
        this.allocPatty = config.allocPatty || 0.3; // 30% 中风险
        this.allocSauce = config.allocSauce || 0.1; // 10% 高风险

        // === 交易参数 ===
        this.symbol = config.symbol || 'BTCUSDT';
        this.exchangeType = config.exchangeType || 'mock';
        this.exchangeConfig = config.exchangeConfig || {};
        this.interval = config.interval || 3000;
        this.totalCapital = config.totalCapital || 50000;

        // === 防焦机制 ===
        this.antiBurn = {
            enabled: config.antiBurnEnabled !== false,
            maxConsecutiveLosses: config.maxConsecutiveLosses || 3,  // 连续亏损 N 次触发熔断
            maxDrawdownPct: config.maxDrawdownPct || 0.15,           // 最大回撤 15% 触发熔断
            cooldownMs: config.cooldownMs || 60000,                  // 熔断冷却时间
            consecutiveLosses: 0,
            peakPnl: 0,
            burnedAt: null,
            burned: false
        };

        // === 运行状态 ===
        this.status = 'idle'; // idle | running | burned | paused
        this.position = 0;
        this.entryPrice = 0;
        this.balance = { USDT: this.totalCapital };
        this.pnl = 0;
        this.trades = [];
        this.signals = [];
        this.logs = [];
        this.ranking = { score: 0, rank: 0, winRate: 0 };

        // === 内部 ===
        this._exchange = null;
        this._timer = null;
        this._klineCache = [];
        this._baseStrategy = null;
        this._pattyStrategy = null;
        this._sauceStrategy = null;
        this._tradeCount = 0;
        this._lastTradeTime = 0;

        // 回调
        this.onUpdate = config.onUpdate || (() => {});
    }

    log(level, message, data = {}) {
        const entry = {
            time: new Date().toISOString(),
            level,
            message,
            burgerId: this.id,
            burger: { id: this.id, name: this.name },
            ...data
        };
        this.logs.push(entry);
        if (this.logs.length > 300) this.logs.shift();
        this.onUpdate({ type: 'log', data: entry });
    }

    // === 初始化策略组件 ===
    _initStrategies() {
        this._pattyStrategy = getStrategy(this.pattyId);
        if (!this._pattyStrategy) throw new Error(`Patty strategy not found: ${this.pattyId}`);

        // sauce 是可选的过滤器
        if (this.sauceId && this.sauceId !== 'none') {
            this._sauceStrategy = getStrategy(this.sauceId);
        }
    }

    // === 启动汉堡 ===
    async start() {
        if (this.status === 'running') return;

        const { createExchange } = require('../api/adapter');
        this._exchange = createExchange(this.exchangeType, {
            ...this.exchangeConfig,
            symbol: this.symbol
        });

        this._initStrategies();

        this.status = 'running';
        this.antiBurn.burned = false;
        this.antiBurn.burnedAt = null;
        this.antiBurn.consecutiveLosses = 0;
        this.antiBurn.peakPnl = this.pnl;

        this.log('info', `${this.emoji} 汉堡启动: ${this.name}`, {
            base: this.baseId,
            patty: this.pattyId,
            sauce: this.sauceId,
            symbol: this.symbol,
            capital: this.totalCapital,
            allocation: {
                base: `${(this.allocBase * 100).toFixed(0)}%`,
                patty: `${(this.allocPatty * 100).toFixed(0)}%`,
                sauce: `${(this.allocSauce * 100).toFixed(0)}%`
            }
        });

        this.onUpdate({ type: 'status', data: { id: this.id, status: this.status } });

        // 预热
        try {
            this._klineCache = await this._exchange.getKlines(this.symbol, '1m', 100);
            this.log('info', `📊 预热完成 ${this._klineCache.length} 根K线`);
        } catch (err) {
            this.log('warn', `⚠️ 预热失败: ${err.message}`);
        }

        this._runLoop();
    }

    stop() {
        if (this._timer) clearTimeout(this._timer);
        this._timer = null;
        if (this.status === 'running') this.status = 'idle';
        this.log('info', `⏸ 汉堡已停止: ${this.name}`);
        this.onUpdate({ type: 'status', data: { id: this.id, status: this.status } });
    }

    // === 主循环 ===
    _runLoop() {
        if (this.status !== 'running') return;
        this._tick().catch(err => {
            this.log('error', `❌ 执行异常: ${err.message}`);
        });
        this._timer = setTimeout(() => this._runLoop(), this.interval);
    }

    async _tick() {
        // 1. 获取行情
        const ticker = await this._exchange.getTicker(this.symbol);
        this._updateKlineCache(ticker);

        // 2. 防焦检查
        if (this._checkAntiBurn(ticker)) return;

        // 3. Patty 信号分析 (核心肉饼)
        const pattySignal = this._pattyStrategy.analyze(this._klineCache);

        // 4. Sauce 过滤 (特殊酱汁 — AI 二次确认)
        let finalSignal = pattySignal;
        if (this._sauceStrategy) {
            const sauceSignal = this._sauceStrategy.analyze(this._klineCache);
            // Sauce 作为过滤器: 如果 sauce 方向与 patty 相反，降权
            if (sauceSignal.signal !== 'HOLD' && sauceSignal.signal !== pattySignal.signal) {
                finalSignal = {
                    ...pattySignal,
                    confidence: pattySignal.confidence * 0.5,  // 信心减半
                    reason: `${pattySignal.reason} | ⚠️ Sauce反向过滤`
                };
            } else if (sauceSignal.signal === pattySignal.signal) {
                // 双重确认，加权
                finalSignal = {
                    ...pattySignal,
                    confidence: Math.min(pattySignal.confidence * 1.2, 0.95),
                    reason: `${pattySignal.reason} | ✅ Sauce确认`
                };
            }
        }

        // 5. 记录信号
        const signal = {
            time: new Date().toISOString(),
            price: ticker.price,
            ...finalSignal
        };
        this.signals.push(signal);
        if (this.signals.length > 200) this.signals.shift();

        // 6. 执行交易 (基于资金分配比例)
        if (finalSignal.signal === 'BUY' && finalSignal.confidence >= 0.6) {
            await this._executeBuy(ticker.price, finalSignal.reason, finalSignal.confidence);
        } else if (finalSignal.signal === 'SELL' && finalSignal.confidence >= 0.6) {
            await this._executeSell(ticker.price, finalSignal.reason, finalSignal.confidence);
        }

        // 7. 更新排名分数
        this._updateRanking();

        // 8. 推送状态
        this.onUpdate({
            type: 'tick',
            data: {
                burgerId: this.id,
                price: ticker.price,
                signal: finalSignal.signal,
                reason: finalSignal.reason,
                confidence: finalSignal.confidence,
                position: this.position,
                pnl: this.pnl,
                balance: this.balance,
                ranking: this.ranking,
                antiBurn: {
                    consecutiveLosses: this.antiBurn.consecutiveLosses,
                    burned: this.antiBurn.burned,
                    peakPnl: this.antiBurn.peakPnl
                }
            }
        });
    }

    _updateKlineCache(ticker) {
        if (this._klineCache.length === 0) return;
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

    // === 防焦机制 (Anti-Burn) ===
    _checkAntiBurn(ticker) {
        if (!this.antiBurn.enabled) return false;

        // 检查最大回撤
        if (this.pnl > this.antiBurn.peakPnl) {
            this.antiBurn.peakPnl = this.pnl;
        }
        const drawdown = this.antiBurn.peakPnl > 0
            ? (this.antiBurn.peakPnl - this.pnl) / this.antiBurn.peakPnl
            : 0;

        if (drawdown >= this.antiBurn.maxDrawdownPct && this.antiBurn.peakPnl > 0) {
            this._triggerBurn('最大回撤触发', `回撤 ${(drawdown * 100).toFixed(1)}% >= ${(this.antiBurn.maxDrawdownPct * 100).toFixed(0)}%`);
            return true;
        }

        // 检查连续亏损
        if (this.antiBurn.consecutiveLosses >= this.antiBurn.maxConsecutiveLosses) {
            this._triggerBurn('连续亏损触发', `连续亏损 ${this.antiBurn.consecutiveLosses} 次`);
            return true;
        }

        // 冷却恢复检查
        if (this.antiBurn.burned) {
            const elapsed = Date.now() - this.antiBurn.burnedAt;
            if (elapsed >= this.antiBurn.cooldownMs) {
                this.antiBurn.burned = false;
                this.antiBurn.consecutiveLosses = 0;
                this.status = 'running';
                this.log('info', `🔥 冷却恢复: ${this.name} 重新上线`);
                this.onUpdate({ type: 'status', data: { id: this.id, status: this.status } });
            }
            return true; // 仍在冷却中
        }

        return false;
    }

    _triggerBurn(reason, detail) {
        this.antiBurn.burned = true;
        this.antiBurn.burnedAt = Date.now();
        this.status = 'burned';
        this.log('warn', `🔥🔥 汉堡糊了! ${reason}: ${detail}`, {
            consecutiveLosses: this.antiBurn.consecutiveLosses,
            peakPnl: this.antiBurn.peakPnl,
            currentPnl: this.pnl
        });
        this.onUpdate({ type: 'burned', data: { id: this.id, reason, detail } });
        this.onUpdate({ type: 'status', data: { id: this.id, status: this.status } });
    }

    // === 交易执行 (基于资金分配) ===
    _calculatePositionSize(price) {
        // 田忌赛马：根据分配比例计算仓位
        const pattyCapital = this.totalCapital * this.allocPatty;
        const tradeAmount = pattyCapital * 0.1; // 每次用 patty 资金的 10%
        const qty = tradeAmount / price;
        return parseFloat(qty.toFixed(6));
    }

    async _executeBuy(price, reason, confidence) {
        if (this.position >= this.totalCapital * this.allocPatty / price) {
            this.log('debug', '已达最大持仓，跳过买入');
            return;
        }

        // 避免过于频繁交易
        const now = Date.now();
        if (now - this._lastTradeTime < this.interval) return;
        this._lastTradeTime = now;

        const qty = this._calculatePositionSize(price);
        if (qty <= 0) return;

        try {
            const order = await this._exchange.placeOrder(this.symbol, 'BUY', 'MARKET', qty, price);
            this.position += qty;
            this.entryPrice = this.position > 0 ? price : this.entryPrice;
            this.balance.USDT -= qty * order.price;

            const trade = {
                burgerId: this.id,
                id: order.orderId,
                time: new Date().toISOString(),
                side: 'BUY',
                price: order.price,
                quantity: qty,
                reason,
                confidence
            };
            this.trades.push(trade);
            this._tradeCount++;
            this.log('trade', `🟢 买入 ${qty} @ ${order.price}`, { reason, confidence: `${(confidence * 100).toFixed(0)}%` });
            this.onUpdate({ type: 'trade', data: trade });
        } catch (err) {
            this.log('error', `❌ 买入失败: ${err.message}`);
        }
    }

    async _executeSell(price, reason, confidence) {
        if (this.position <= 0) return;

        const now = Date.now();
        if (now - this._lastTradeTime < this.interval) return;
        this._lastTradeTime = now;

        const qty = Math.min(this._calculatePositionSize(price), this.position);
        try {
            const order = await this._exchange.placeOrder(this.symbol, 'SELL', 'MARKET', qty, price);
            const tradePnl = (order.price - this.entryPrice) * qty;
            this.pnl += tradePnl;
            this.position -= qty;
            this.balance.USDT += qty * order.price;

            // 更新防焦计数
            if (tradePnl < 0) {
                this.antiBurn.consecutiveLosses++;
            } else {
                this.antiBurn.consecutiveLosses = 0;
            }

            const trade = {
                burgerId: this.id,
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
            this.log('trade', `🔴 卖出 ${qty} @ ${order.price} | 盈亏: ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}U`, { reason, confidence: `${(confidence * 100).toFixed(0)}%` });
            this.onUpdate({ type: 'trade', data: trade });

            if (this.position <= 0) this.entryPrice = 0;
        } catch (err) {
            this.log('error', `❌ 卖出失败: ${err.message}`);
        }
    }

    // === 排名计算 (赛马计分) ===
    _updateRanking() {
        const sellTrades = this.trades.filter(t => t.side === 'SELL');
        const winTrades = sellTrades.filter(t => (t.pnl || 0) > 0);
        const winRate = sellTrades.length > 0 ? (winTrades.length / sellTrades.length) * 100 : 0;

        // 综合评分: 胜率权重 40% + 盈亏权重 40% + 活跃度 20%
        const pnlScore = Math.min(Math.max(this.pnl / this.totalCapital * 100, -50), 50) + 50; // 0~100
        const activityScore = Math.min(this._tradeCount / 50, 1) * 100;
        const score = winRate * 0.4 + pnlScore * 0.4 + activityScore * 0.2;

        this.ranking = {
            score: parseFloat(score.toFixed(1)),
            winRate: parseFloat(winRate.toFixed(1)),
            totalTrades: this.trades.length,
            sellTrades: sellTrades.length,
            winTrades: winTrades.length,
            avgProfit: winTrades.length > 0
                ? parseFloat((winTrades.reduce((s, t) => s + t.pnl, 0) / winTrades.length).toFixed(2))
                : 0,
            avgLoss: sellTrades.length - winTrades.length > 0
                ? parseFloat((sellTrades.filter(t => (t.pnl || 0) <= 0).reduce((s, t) => s + t.pnl, 0) / (sellTrades.length - winTrades.length)).toFixed(2))
                : 0
        };
    }

    // === 获取完整状态 ===
    getState() {
        this._updateRanking();
        return {
            id: this.id,
            name: this.name,
            emoji: this.emoji,
            status: this.status,
            symbol: this.symbol,
            baseId: this.baseId,
            pattyId: this.pattyId,
            sauceId: this.sauceId,
            allocation: {
                base: this.allocBase,
                patty: this.allocPatty,
                sauce: this.allocSauce
            },
            position: this.position,
            entryPrice: this.entryPrice,
            pnl: parseFloat(this.pnl.toFixed(2)),
            totalCapital: this.totalCapital,
            balance: this.balance,
            totalTrades: this.trades.length,
            ranking: this.ranking,
            antiBurn: {
                enabled: this.antiBurn.enabled,
                consecutiveLosses: this.antiBurn.consecutiveLosses,
                maxConsecutiveLosses: this.antiBurn.maxConsecutiveLosses,
                maxDrawdownPct: this.antiBurn.maxDrawdownPct,
                burned: this.antiBurn.burned,
                burnedAt: this.antiBurn.burnedAt,
                peakPnl: this.antiBurn.peakPnl
            },
            trades: this.trades.slice(-50),
            signals: this.signals.slice(-50),
            logs: this.logs.slice(-80)
        };
    }
}

module.exports = { BurgerStrategy };
