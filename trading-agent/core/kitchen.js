/**
 * 厨房引擎 (Kitchen Engine) — 田忌赛马并发调度核心
 *
 * 职责:
 *   1. 管理多个汉堡实例的并发运行 (Multi-Grill)
 *   2. 实时计算赛马排名 (Race Ranking)
 *   3. 动态资金再分配 (Dynamic Allocation)
 *   4. 全局防焦协调 (Global Anti-Burn)
 */

const { BurgerStrategy } = require('./burger');

class KitchenEngine {
    constructor(config = {}) {
        this.burgers = new Map();
        this.onUpdate = config.onUpdate || (() => {});
        this._rankTimer = null;

        // === 全局厨房状态 ===
        this.stats = {
            totalPnl: 0,
            activeCount: 0,
            burnedCount: 0,
            totalTrades: 0,
            totalCapital: 0,
            rankings: []
        };
    }

    // === 汉堡管理 ===
    createBurger(config) {
        const burger = new BurgerStrategy({
            ...config,
            onUpdate: (event) => {
                // 透传事件，附加排名信息
                this._updateGlobalStats();
                this.onUpdate(event);
            }
        });
        this.burgers.set(burger.id, burger);
        this._updateGlobalStats();
        this.onUpdate({
            type: 'burger_created',
            data: burger.getState()
        });
        return burger;
    }

    getBurger(id) {
        return this.burgers.get(id);
    }

    getAllBurgers() {
        return [...this.burgers.values()].map(b => b.getState());
    }

    // === 厨房控制 ===
    async startBurger(id) {
        const burger = this.burgers.get(id);
        if (!burger) throw new Error(`Burger not found: ${id}`);
        await burger.start();
        this._updateGlobalStats();
        return burger.getState();
    }

    stopBurger(id) {
        const burger = this.burgers.get(id);
        if (!burger) throw new Error(`Burger not found: ${id}`);
        burger.stop();
        this._updateGlobalStats();
        return burger.getState();
    }

    deleteBurger(id) {
        const burger = this.burgers.get(id);
        if (!burger) throw new Error(`Burger not found: ${id}`);
        burger.stop();
        const name = burger.name;
        this.burgers.delete(id);
        this._updateGlobalStats();
        this.onUpdate({ type: 'burger_deleted', data: { id, name } });
    }

    // 启动所有汉堡 (一键出餐)
    async startAll() {
        const results = [];
        for (const [id, burger] of this.burgers) {
            if (burger.status !== 'running') {
                await burger.start();
                results.push(id);
            }
        }
        this._updateGlobalStats();
        this.onUpdate({ type: 'kitchen_start', data: { started: results } });
        return results;
    }

    // 停止所有汉堡 (关火)
    stopAll() {
        for (const [, burger] of this.burgers) {
            burger.stop();
        }
        this._updateGlobalStats();
        this.onUpdate({ type: 'kitchen_stop', data: {} });
    }

    // === 田忌赛马排名 ===
    _updateGlobalStats() {
        const allBurgers = [...this.burgers.values()];
        let totalPnl = 0;
        let totalTrades = 0;
        let totalCapital = 0;
        let activeCount = 0;
        let burnedCount = 0;

        const rankings = allBurgers.map(burger => {
            totalPnl += burger.pnl;
            totalTrades += burger.trades.length;
            totalCapital += burger.totalCapital;
            if (burger.status === 'running') activeCount++;
            if (burger.status === 'burned') burnedCount++;

            return {
                id: burger.id,
                name: burger.name,
                emoji: burger.emoji,
                score: burger.ranking.score,
                winRate: burger.ranking.winRate,
                pnl: burger.pnl,
                status: burger.status,
                consecutiveLosses: burger.antiBurn.consecutiveLosses,
                burned: burger.antiBurn.burned
            };
        });

        // 按分数降序排名
        rankings.sort((a, b) => b.score - a.score);
        rankings.forEach((r, i) => r.rank = i + 1);

        this.stats = {
            totalPnl: parseFloat(totalPnl.toFixed(2)),
            activeCount,
            burnedCount,
            totalTrades,
            totalCapital,
            rankings,
            burgerCount: allBurgers.length
        };

        this.onUpdate({
            type: 'kitchen_stats',
            data: this.stats
        });
    }

    getStats() {
        this._updateGlobalStats();
        return this.stats;
    }

    getRankings() {
        this._updateGlobalStats();
        return this.stats.rankings;
    }

    // === 推荐配置 (田忌赛马预设) ===
    static getPresets() {
        return [
            {
                id: 'angus',
                name: '安格斯牛堡',
                emoji: '🥩',
                description: '高收益组合：趋势跟踪 + 情绪过滤',
                baseId: 'stable-fund',
                pattyId: 'boll-macd',
                sauceId: 'rsi-revert',
                allocBase: 0.6,
                allocPatty: 0.3,
                allocSauce: 0.1,
                antiBurnEnabled: true,
                maxConsecutiveLosses: 3
            },
            {
                id: 'mcchicken',
                name: '板烧鸡腿堡',
                emoji: '🍗',
                description: '快速波动获利：均线交叉 + ADX确认',
                baseId: 'stable-fund',
                pattyId: 'ma-cross',
                sauceId: 'adx-trend',
                allocBase: 0.5,
                allocPatty: 0.4,
                allocSauce: 0.1,
                antiBurnEnabled: true,
                maxConsecutiveLosses: 4
            },
            {
                id: 'bigmac',
                name: '巨无霸双层',
                emoji: '🍔',
                description: '三层策略并发：SuperTrend + BOLL双重过滤',
                baseId: 'stable-fund',
                pattyId: 'supertrend',
                sauceId: 'boll-macd',
                allocBase: 0.5,
                allocPatty: 0.35,
                allocSauce: 0.15,
                antiBurnEnabled: true,
                maxConsecutiveLosses: 3
            },
            {
                id: 'filet',
                name: '麦香鱼堡',
                emoji: '🐟',
                description: '保守型：RSI均值回归 + 低杠杆',
                baseId: 'stable-fund',
                pattyId: 'rsi-revert',
                sauceId: 'none',
                allocBase: 0.7,
                allocPatty: 0.25,
                allocSauce: 0.05,
                antiBurnEnabled: true,
                maxConsecutiveLosses: 2
            },
            {
                id: 'spicy',
                name: '麦辣鸡腿堡',
                emoji: '🌶️',
                description: '激进型：SuperTrend v2 + 高杠杆',
                baseId: 'stable-fund',
                pattyId: 'supertrend-v2',
                sauceId: 'boll-macd-v2',
                allocBase: 0.4,
                allocPatty: 0.4,
                allocSauce: 0.2,
                antiBurnEnabled: true,
                maxConsecutiveLosses: 5
            },
            {
                id: 'fries',
                name: '薯条',
                emoji: '🍟',
                description: '高频配菜：双均线交叉 + 成交量过滤，快速进出',
                baseId: 'stable-fund',
                pattyId: 'ma-cross',
                sauceId: 'volume-gate',
                allocBase: 0.8,
                allocPatty: 0.15,
                allocSauce: 0.05,
                antiBurnEnabled: true,
                maxConsecutiveLosses: 2
            },
            {
                id: 'coke-zero',
                name: '无糖可乐',
                emoji: '🥤',
                description: '零风险底座：纯稳定策略，0杠杆对冲型',
                baseId: 'grid-base',
                pattyId: 'rsi-revert',
                sauceId: 'trend-confirm',
                allocBase: 0.85,
                allocPatty: 0.1,
                allocSauce: 0.05,
                antiBurnEnabled: true,
                maxConsecutiveLosses: 1
            },
            {
                id: 'mcflurry',
                name: '麦旋风',
                emoji: '🍦',
                description: '随机爆发型：ADX趋势 + 波动率门控，等待大行情',
                baseId: 'stable-fund',
                pattyId: 'adx-trend',
                sauceId: 'volatility-gate',
                allocBase: 0.55,
                allocPatty: 0.35,
                allocSauce: 0.1,
                antiBurnEnabled: true,
                maxConsecutiveLosses: 4
            }
        ];
    }
}

module.exports = { KitchenEngine };
