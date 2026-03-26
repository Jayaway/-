/**
 * 交易策略引擎
 * 每个策略实现 analyze(klines) → { signal, reason, confidence }
 * 信号: 'BUY' | 'SELL' | 'HOLD'
 */

// ===== 技术指标工具 =====
const Indicators = {
    // 简单移动平均
    SMA(data, period) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) { result.push(null); continue; }
            const slice = data.slice(i - period + 1, i + 1);
            result.push(slice.reduce((a, b) => a + b, 0) / period);
        }
        return result;
    },

    // 指数移动平均
    EMA(data, period) {
        const result = [];
        const multiplier = 2 / (period + 1);
        let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) { result.push(null); continue; }
            if (i === period - 1) { result.push(ema); continue; }
            ema = (data[i] - ema) * multiplier + ema;
            result.push(ema);
        }
        return result;
    },

    // RSI
    RSI(closes, period = 14) {
        const result = new Array(period).fill(null);
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) gains += diff; else losses -= diff;
        }
        let avgGain = gains / period;
        let avgLoss = losses / period;
        result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
        for (let i = period + 1; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? -diff : 0;
            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;
            result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
        }
        return result;
    },

    // MACD
    MACD(closes, fast = 12, slow = 26, signal = 9) {
        const emaFast = this.EMA(closes, fast);
        const emaSlow = this.EMA(closes, slow);
        const macdLine = closes.map((_, i) => {
            if (emaFast[i] === null || emaSlow[i] === null) return null;
            return emaFast[i] - emaSlow[i];
        });
        const validMacd = macdLine.filter(v => v !== null);
        const signalLine = this.EMA(validMacd, signal);
        const histogram = [];
        let si = 0;
        for (let i = 0; i < macdLine.length; i++) {
            if (macdLine[i] === null) { histogram.push(null); continue; }
            const sl = signalLine[si] ?? null;
            histogram.push(sl !== null ? macdLine[i] - sl : null);
            si++;
        }
        return { macdLine, signalLine: this._pad(signalLine, macdLine.length), histogram };
    },

    // Bollinger Bands
    Bollinger(closes, period = 20, multiplier = 2) {
        const sma = this.SMA(closes, period);
        const upper = [], lower = [];
        for (let i = 0; i < closes.length; i++) {
            if (sma[i] === null) { upper.push(null); lower.push(null); continue; }
            const slice = closes.slice(i - period + 1, i + 1);
            const std = Math.sqrt(slice.reduce((s, v) => s + (v - sma[i]) ** 2, 0) / period);
            upper.push(sma[i] + multiplier * std);
            lower.push(sma[i] - multiplier * std);
        }
        return { upper, middle: sma, lower };
    },

    // ADX (Average Directional Index)
    ADX(highs, lows, closes, period = 14) {
        const tr = [], plusDM = [], minusDM = [];
        for (let i = 1; i < closes.length; i++) {
            tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
            const upMove = highs[i] - highs[i - 1];
            const downMove = lows[i - 1] - lows[i];
            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        }
        const smoothTR = this.SMA(tr, period);
        const smoothPlus = this.SMA(plusDM, period);
        const smoothMinus = this.SMA(minusDM, period);
        const plusDI = [], minusDI = [], dx = [];
        for (let i = 0; i < smoothTR.length; i++) {
            if (smoothTR[i] === null || smoothTR[i] === 0) { plusDI.push(null); minusDI.push(null); dx.push(null); continue; }
            const pdi = (smoothPlus[i] / smoothTR[i]) * 100;
            const mdi = (smoothMinus[i] / smoothTR[i]) * 100;
            plusDI.push(pdi);
            minusDI.push(mdi);
            dx.push(pdi + mdi === 0 ? 0 : Math.abs(pdi - mdi) / (pdi + mdi) * 100);
        }
        const adx = this.SMA(dx.filter(v => v !== null), period);
        return { plusDI, minusDI, adx: this._pad(adx, closes.length) };
    },

    // SuperTrend
    SuperTrend(highs, lows, closes, period = 10, multiplier = 3) {
        const tr = [];
        for (let i = 0; i < closes.length; i++) {
            if (i === 0) { tr.push(highs[i] - lows[i]); continue; }
            tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
        }
        const atr = this.SMA(tr, period);
        const upperBand = [], lowerBand = [], superTrend = [];
        for (let i = 0; i < closes.length; i++) {
            if (atr[i] === null) { upperBand.push(null); lowerBand.push(null); superTrend.push(null); continue; }
            const hl2 = (highs[i] + lows[i]) / 2;
            upperBand.push(hl2 + multiplier * atr[i]);
            lowerBand.push(hl2 - multiplier * atr[i]);
            if (i === 0 || superTrend[i - 1] === null) {
                superTrend.push(upperBand[i]);
            } else {
                const prevST = superTrend[i - 1];
                if (closes[i - 1] <= prevST) {
                    superTrend.push(upperBand[i] < prevST ? upperBand[i] : prevST);
                } else {
                    superTrend.push(lowerBand[i] > prevST ? lowerBand[i] : prevST);
                }
            }
        }
        return { superTrend, upperBand, lowerBand };
    },

    _pad(arr, targetLen) {
        const result = new Array(targetLen - arr.length).fill(null);
        return result.concat(arr);
    }
};

// ===== 策略定义 =====
const strategies = {

    'boll-macd': {
        name: 'BOLL + MACD',
        description: '布林带结合MACD，价格触及布林带边界且MACD交叉时触发信号',
        params: { bollPeriod: 20, bollMult: 2, macdFast: 12, macdSlow: 26, macdSignal: 9 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const boll = Indicators.Bollinger(closes, this.params.bollPeriod, this.params.bollMult);
            const macd = Indicators.MACD(closes, this.params.macdFast, this.params.macdSlow, this.params.macdSignal);
            const last = closes.length - 1;
            const price = closes[last];
            const hist = macd.histogram.filter(v => v !== null);
            const prevHist = hist[hist.length - 2];
            const currHist = hist[hist.length - 1];

            // 价格触及下轨 + MACD 柱状图转正 → BUY
            if (boll.lower[last] && price <= boll.lower[last] * 1.002 && currHist > 0 && prevHist <= 0) {
                return { signal: 'BUY', reason: '价格触及布林下轨，MACD金叉', confidence: 0.75 };
            }
            // 价格触及上轨 + MACD 柱状图转负 → SELL
            if (boll.upper[last] && price >= boll.upper[last] * 0.998 && currHist < 0 && prevHist >= 0) {
                return { signal: 'SELL', reason: '价格触及布林上轨，MACD死叉', confidence: 0.75 };
            }
            return { signal: 'HOLD', reason: '无明确信号', confidence: 0.5 };
        }
    },

    'boll-macd-v2': {
        name: 'BOLL + MACD (优化版)',
        description: '布林带结合MACD，加入成交量过滤和趋势确认',
        params: { bollPeriod: 20, bollMult: 2, macdFast: 12, macdSlow: 26, macdSignal: 9, volumeFilter: 1.2 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const volumes = klines.map(k => k.volume);
            const boll = Indicators.Bollinger(closes, this.params.bollPeriod, this.params.bollMult);
            const macd = Indicators.MACD(closes, this.params.macdFast, this.params.macdSlow, this.params.macdSignal);
            const last = closes.length - 1;
            const price = closes[last];
            const hist = macd.histogram.filter(v => v !== null);
            const prevHist = hist[hist.length - 2];
            const currHist = hist[hist.length - 1];
            
            // 成交量过滤：当前成交量需高于均值
            const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
            const volumeRatio = volumes[last] / avgVolume;
            const volumeOk = volumeRatio >= this.params.volumeFilter;

            // 价格触及下轨 + MACD 柱状图转正 + 成交量放大 → BUY
            if (boll.lower[last] && price <= boll.lower[last] * 1.002 && currHist > 0 && prevHist <= 0 && volumeOk) {
                return { signal: 'BUY', reason: `价格触及布林下轨，MACD金叉，成交量放大(${volumeRatio.toFixed(1)}x)`, confidence: 0.8 };
            }
            // 价格触及上轨 + MACD 柱状图转负 + 成交量放大 → SELL
            if (boll.upper[last] && price >= boll.upper[last] * 0.998 && currHist < 0 && prevHist >= 0 && volumeOk) {
                return { signal: 'SELL', reason: `价格触及布林上轨，MACD死叉，成交量放大(${volumeRatio.toFixed(1)}x)`, confidence: 0.8 };
            }
            return { signal: 'HOLD', reason: '无明确信号', confidence: 0.5 };
        }
    },

    'supertrend': {
        name: 'SuperTrend',
        description: '基于ATR的趋势跟踪策略，SuperTrend指标方向变化时触发',
        params: { period: 10, multiplier: 3 },
        analyze(klines) {
            const highs = klines.map(k => k.high);
            const lows = klines.map(k => k.low);
            const closes = klines.map(k => k.close);
            const st = Indicators.SuperTrend(highs, lows, closes, this.params.period, this.params.multiplier);
            const last = closes.length - 1;
            if (st.superTrend[last] === null || st.superTrend[last - 1] === null) {
                return { signal: 'HOLD', reason: '数据不足', confidence: 0.3 };
            }
            // 价格从下方穿越 SuperTrend → BUY
            if (closes[last] > st.superTrend[last] && closes[last - 1] <= st.superTrend[last - 1]) {
                return { signal: 'BUY', reason: '价格突破SuperTrend上行', confidence: 0.7 };
            }
            // 价格从上方跌破 SuperTrend → SELL
            if (closes[last] < st.superTrend[last] && closes[last - 1] >= st.superTrend[last - 1]) {
                return { signal: 'SELL', reason: '价格跌破SuperTrend下行', confidence: 0.7 };
            }
            return { signal: 'HOLD', reason: closes[last] > st.superTrend[last] ? '趋势偏多' : '趋势偏空', confidence: 0.5 };
        }
    },

    'supertrend-v2': {
        name: 'SuperTrend (优化版)',
        description: 'SuperTrend + ADX趋势过滤，只在强趋势中交易',
        params: { stPeriod: 10, stMultiplier: 3, adxPeriod: 14, adxThreshold: 25 },
        analyze(klines) {
            const highs = klines.map(k => k.high);
            const lows = klines.map(k => k.low);
            const closes = klines.map(k => k.close);
            const st = Indicators.SuperTrend(highs, lows, closes, this.params.stPeriod, this.params.stMultiplier);
            const adx = Indicators.ADX(highs, lows, closes, this.params.adxPeriod);
            const last = closes.length - 1;
            
            if (st.superTrend[last] === null || st.superTrend[last - 1] === null) {
                return { signal: 'HOLD', reason: '数据不足', confidence: 0.3 };
            }
            
            const adxVal = adx.adx.filter(v => v !== null);
            const currADX = adxVal[adxVal.length - 1];
            if (!currADX) return { signal: 'HOLD', reason: 'ADX数据不足', confidence: 0.3 };
            
            // 只在强趋势中交易
            if (currADX < this.params.adxThreshold) {
                return { signal: 'HOLD', reason: `ADX=${currADX.toFixed(1)}（趋势太弱）`, confidence: 0.4 };
            }
            
            // 价格从下方穿越 SuperTrend → BUY
            if (closes[last] > st.superTrend[last] && closes[last - 1] <= st.superTrend[last - 1]) {
                return { signal: 'BUY', reason: `价格突破SuperTrend上行，ADX=${currADX.toFixed(1)}`, confidence: 0.75 };
            }
            // 价格从上方跌破 SuperTrend → SELL
            if (closes[last] < st.superTrend[last] && closes[last - 1] >= st.superTrend[last - 1]) {
                return { signal: 'SELL', reason: `价格跌破SuperTrend下行，ADX=${currADX.toFixed(1)}`, confidence: 0.75 };
            }
            return { signal: 'HOLD', reason: closes[last] > st.superTrend[last] ? '趋势偏多' : '趋势偏空', confidence: 0.5 };
        }
    },

    'adx-trend': {
        name: 'ADX 趋势过滤',
        description: 'ADX判断趋势强度，结合+DI/-DI交叉信号',
        params: { period: 14, threshold: 25 },
        analyze(klines) {
            const highs = klines.map(k => k.high);
            const lows = klines.map(k => k.low);
            const closes = klines.map(k => k.close);
            const adx = Indicators.ADX(highs, lows, closes, this.params.period);
            const last = closes.length - 1;
            const adxVal = adx.adx.filter(v => v !== null);
            const currADX = adxVal[adxVal.length - 1];
            if (!currADX) return { signal: 'HOLD', reason: '数据不足', confidence: 0.3 };

            const plusDI = adx.plusDI.filter(v => v !== null);
            const minusDI = adx.minusDI.filter(v => v !== null);
            const pdi = plusDI[plusDI.length - 1];
            const mdi = minusDI[minusDI.length - 1];
            const prevPdi = plusDI[plusDI.length - 2];
            const prevMdi = minusDI[minusDI.length - 2];

            if (currADX > this.params.threshold) {
                if (pdi > mdi && prevPdi <= prevMdi) {
                    return { signal: 'BUY', reason: `ADX=${currADX.toFixed(1)}（强趋势），+DI上穿-DI`, confidence: 0.72 };
                }
                if (mdi > pdi && prevMdi <= prevPdi) {
                    return { signal: 'SELL', reason: `ADX=${currADX.toFixed(1)}（强趋势），-DI上穿+DI`, confidence: 0.72 };
                }
            }
            return { signal: 'HOLD', reason: `ADX=${currADX.toFixed(1)}（${currADX > this.params.threshold ? '有趋势' : '震荡'}）`, confidence: 0.5 };
        }
    },

    'rsi-revert': {
        name: 'RSI 均值回归',
        description: 'RSI超买超卖反转策略，适合震荡行情',
        params: { period: 14, oversold: 30, overbought: 70 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const rsi = Indicators.RSI(closes, this.params.period);
            const validRSI = rsi.filter(v => v !== null);
            const curr = validRSI[validRSI.length - 1];
            const prev = validRSI[validRSI.length - 2];
            if (!curr) return { signal: 'HOLD', reason: '数据不足', confidence: 0.3 };

            if (curr < this.params.oversold && prev >= this.params.oversold) {
                return { signal: 'BUY', reason: `RSI=${curr.toFixed(1)} 进入超卖区`, confidence: 0.68 };
            }
            if (curr > this.params.overbought && prev <= this.params.overbought) {
                return { signal: 'SELL', reason: `RSI=${curr.toFixed(1)} 进入超买区`, confidence: 0.68 };
            }
            return { signal: 'HOLD', reason: `RSI=${curr.toFixed(1)}`, confidence: 0.5 };
        }
    },

    'ma-cross': {
        name: '双均线交叉',
        description: '快慢均线金叉死叉策略，经典趋势跟踪',
        params: { fast: 10, slow: 30 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const fastMA = Indicators.EMA(closes, this.params.fast);
            const slowMA = Indicators.EMA(closes, this.params.slow);
            const last = closes.length - 1;
            if (fastMA[last] === null || slowMA[last] === null || fastMA[last - 1] === null || slowMA[last - 1] === null) {
                return { signal: 'HOLD', reason: '数据不足', confidence: 0.3 };
            }
            if (fastMA[last] > slowMA[last] && fastMA[last - 1] <= slowMA[last - 1]) {
                return { signal: 'BUY', reason: `EMA${this.params.fast} 金叉 EMA${this.params.slow}`, confidence: 0.65 };
            }
            if (fastMA[last] < slowMA[last] && fastMA[last - 1] >= slowMA[last - 1]) {
                return { signal: 'SELL', reason: `EMA${this.params.fast} 死叉 EMA${this.params.slow}`, confidence: 0.65 };
            }
            return { signal: 'HOLD', reason: fastMA[last] > slowMA[last] ? '快线在上，偏多' : '快线在下，偏空', confidence: 0.5 };
        }
    },

    'ma-cross-v2': {
        name: '双均线交叉 (优化版)',
        description: 'EMA交叉 + RSI过滤，避免震荡市假信号',
        params: { fast: 10, slow: 30, rsiPeriod: 14, rsiOverbought: 70, rsiOversold: 30 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const fastMA = Indicators.EMA(closes, this.params.fast);
            const slowMA = Indicators.EMA(closes, this.params.slow);
            const rsi = Indicators.RSI(closes, this.params.rsiPeriod);
            const last = closes.length - 1;
            
            if (fastMA[last] === null || slowMA[last] === null || fastMA[last - 1] === null || slowMA[last - 1] === null) {
                return { signal: 'HOLD', reason: '数据不足', confidence: 0.3 };
            }
            
            const validRSI = rsi.filter(v => v !== null);
            const currRSI = validRSI[validRSI.length - 1];
            if (!currRSI) return { signal: 'HOLD', reason: 'RSI数据不足', confidence: 0.3 };
            
            // RSI过滤：超买区不追多，超卖区不追空
            const rsiFilter = (currRSI > this.params.rsiOverbought || currRSI < this.params.rsiOversold) ? false : true;
            
            if (fastMA[last] > slowMA[last] && fastMA[last - 1] <= slowMA[last - 1] && rsiFilter) {
                return { signal: 'BUY', reason: `EMA${this.params.fast}金叉EMA${this.params.slow}，RSI=${currRSI.toFixed(1)}`, confidence: 0.7 };
            }
            if (fastMA[last] < slowMA[last] && fastMA[last - 1] >= slowMA[last - 1] && rsiFilter) {
                return { signal: 'SELL', reason: `EMA${this.params.fast}死叉EMA${this.params.slow}，RSI=${currRSI.toFixed(1)}`, confidence: 0.7 };
            }
            return { signal: 'HOLD', reason: `RSI=${currRSI.toFixed(1)}，${fastMA[last] > slowMA[last] ? '偏多' : '偏空'}`, confidence: 0.5 };
        }
    },

    // ============================
    // 底层面包 (Base Layer) — 低风险底座策略
    // ============================

    'stable-fund': {
        name: '稳定基金',
        layer: 'base',
        description: '低波动稳定底座：仅在市场平稳时提供流动性，波动率过高时退出',
        params: { maPeriod: 20, volatilityThreshold: 0.03 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const last = closes.length - 1;
            if (last < this.params.maPeriod) return { signal: 'HOLD', reason: '数据不足', confidence: 0.5 };

            // 计算近 N 日波动率
            const recent = closes.slice(-this.params.maPeriod);
            const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
            const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
            const volatility = Math.sqrt(variance) / mean;

            if (volatility > this.params.volatilityThreshold) {
                return { signal: 'HOLD', reason: `波动率 ${(volatility * 100).toFixed(2)}% 过高，底座观望`, confidence: 0.3 };
            }
            // 低波动环境：温和偏多
            const trend = closes[last] > mean ? 'BUY' : 'SELL';
            return { signal: trend, reason: `波动率 ${(volatility * 100).toFixed(2)}%，底座温和${trend === 'BUY' ? '偏多' : '偏空'}`, confidence: 0.55 };
        }
    },

    'grid-base': {
        name: '网格底座',
        layer: 'base',
        description: '网格交易底座：在价格区间内高抛低吸，适合震荡行情',
        params: { gridLevels: 5, gridPct: 0.01 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const last = closes.length - 1;
            if (last < 20) return { signal: 'HOLD', reason: '数据不足', confidence: 0.5 };

            const recent = closes.slice(-20);
            const high = Math.max(...recent);
            const low = Math.min(...recent);
            const range = high - low;
            const price = closes[last];
            const position = (price - low) / range; // 0~1

            // 价格在下半区 → BUY (低吸)，在上半区 → SELL (高抛)
            if (position < 0.3) {
                return { signal: 'BUY', reason: `网格低吸区 (${(position * 100).toFixed(0)}%)`, confidence: 0.6 };
            }
            if (position > 0.7) {
                return { signal: 'SELL', reason: `网格高抛区 (${(position * 100).toFixed(0)}%)`, confidence: 0.6 };
            }
            return { signal: 'HOLD', reason: `网格中区 (${(position * 100).toFixed(0)}%)`, confidence: 0.5 };
        }
    },

    // ============================
    // 特殊酱汁 (Sauce Layer) — AI 过滤器
    // ============================

    'volume-gate': {
        name: '成交量门槛',
        layer: 'sauce',
        description: '酱汁过滤器：成交量不足时拒绝信号，成交量放大时确认信号',
        params: { lookback: 20, threshold: 1.2 },
        analyze(klines) {
            const volumes = klines.map(k => k.volume);
            const last = volumes.length - 1;
            if (last < this.params.lookback) return { signal: 'HOLD', reason: '数据不足', confidence: 0.5 };

            const avg = volumes.slice(-this.params.lookback).reduce((a, b) => a + b, 0) / this.params.lookback;
            const ratio = volumes[last] / avg;

            if (ratio >= this.params.threshold) {
                return { signal: 'BUY', reason: `成交量放大 ${ratio.toFixed(1)}x`, confidence: 0.65 };
            }
            if (ratio < 0.5) {
                return { signal: 'SELL', reason: `成交量萎缩 ${ratio.toFixed(1)}x`, confidence: 0.6 };
            }
            return { signal: 'HOLD', reason: `成交量正常 ${ratio.toFixed(1)}x`, confidence: 0.5 };
        }
    },

    'volatility-gate': {
        name: '波动率门槛',
        layer: 'sauce',
        description: '酱汁过滤器：波动率极端时过滤信号，避免在剧烈波动中被套',
        params: { lookback: 20, lowThreshold: 0.005, highThreshold: 0.04 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const last = closes.length - 1;
            if (last < this.params.lookback) return { signal: 'HOLD', reason: '数据不足', confidence: 0.5 };

            const recent = closes.slice(-this.params.lookback);
            const returns = recent.slice(1).map((c, i) => (c - recent[i]) / recent[i]);
            const vol = Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length);

            if (vol > this.params.highThreshold) {
                return { signal: 'SELL', reason: `波动率过高 ${(vol * 100).toFixed(2)}%，降权`, confidence: 0.4 };
            }
            if (vol < this.params.lowThreshold) {
                return { signal: 'HOLD', reason: `波动率极低 ${(vol * 100).toFixed(2)}%，观望`, confidence: 0.4 };
            }
            return { signal: 'BUY', reason: `波动率适中 ${(vol * 100).toFixed(2)}%`, confidence: 0.6 };
        }
    },

    'trend-confirm': {
        name: '趋势确认器',
        layer: 'sauce',
        description: '酱汁过滤器：多周期趋势确认，只有多周期共振时放行',
        params: { fast: 5, mid: 10, slow: 20 },
        analyze(klines) {
            const closes = klines.map(k => k.close);
            const last = closes.length - 1;
            if (last < this.params.slow) return { signal: 'HOLD', reason: '数据不足', confidence: 0.5 };

            const fastMA = Indicators.EMA(closes, this.params.fast);
            const midMA = Indicators.EMA(closes, this.params.mid);
            const slowMA = Indicators.EMA(closes, this.params.slow);

            if (fastMA[last] === null || midMA[last] === null || slowMA[last] === null) {
                return { signal: 'HOLD', reason: '数据不足', confidence: 0.5 };
            }

            // 多头排列: 快 > 中 > 慢
            if (fastMA[last] > midMA[last] && midMA[last] > slowMA[last]) {
                return { signal: 'BUY', reason: '多周期多头共振', confidence: 0.75 };
            }
            // 空头排列: 快 < 中 < 慢
            if (fastMA[last] < midMA[last] && midMA[last] < slowMA[last]) {
                return { signal: 'SELL', reason: '多周期空头共振', confidence: 0.75 };
            }
            return { signal: 'HOLD', reason: '多周期未共振', confidence: 0.5 };
        }
    }
};

function getStrategyList() {
    return Object.entries(strategies).map(([id, s]) => ({
        id,
        name: s.name,
        description: s.description,
        params: s.params,
        layer: s.layer || 'patty' // base | patty | sauce
    }));
}

function getStrategiesByLayer(layer) {
    return Object.entries(strategies)
        .filter(([, s]) => (s.layer || 'patty') === layer)
        .map(([id, s]) => ({ id, name: s.name, description: s.description, layer: s.layer || 'patty' }));
}

function getStrategy(id) {
    return strategies[id] || null;
}

module.exports = { getStrategyList, getStrategy, getStrategiesByLayer, Indicators };
