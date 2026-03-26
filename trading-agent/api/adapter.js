/**
 * 交易所 API 适配层
 * 统一接口，支持不同交易所。新增交易所只需实现相同接口。
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ===== 基础 HTTP 请求 =====
function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.request(url, {
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: 10000,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { resolve(data); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        if (options.body) req.write(options.body);
        req.end();
    });
}

// ===== 模拟交易所（用于测试和演示）=====
class MockExchange {
    constructor(config = {}) {
        this.name = 'MockExchange';
        this.symbol = config.symbol || 'BTCUSDT';
        
        // 每个币种的基础价格和波动率配置 (波动率调高以触发更多策略信号)
        this.symbolConfigs = {
            'BTCUSDT': { basePrice: 70000, volatility: 0.008, decimals: 2 },
            'ETHUSDT': { basePrice: 3500, volatility: 0.010, decimals: 2 },
            'SOLUSDT': { basePrice: 145, volatility: 0.012, decimals: 2 },
            'BNBUSDT': { basePrice: 600, volatility: 0.010, decimals: 2 },
            'DOGEUSDT': { basePrice: 0.18, volatility: 0.015, decimals: 5 },
            'HYPEUSDT': { basePrice: 14.5, volatility: 0.012, decimals: 4 },
        };
        
        // 初始化当前币种的价格状态
        this._initSymbol(this.symbol);
    }
    
    // 初始化指定币种的价格状态
    _initSymbol(symbol) {
        const cfg = this.symbolConfigs[symbol] || { basePrice: 100, volatility: 0.003, decimals: 4 };
        this.basePrice = cfg.basePrice;
        this.volatility = cfg.volatility;
        this.decimals = cfg.decimals;
        this.price = this.basePrice;
        this.trend = 0;
        this.trendDuration = 0;
    }

    // 根据币种获取配置
    _getSymbolConfig(symbol) {
        return this.symbolConfigs[symbol] || { basePrice: 100, volatility: 0.003, decimals: 4 };
    }

    // 模拟价格波动 — 带趋势的随机游走
    _nextPrice(symbol) {
        // 每个币种有独立的价格状态
        const cfg = this._getSymbolConfig(symbol);
        
        // 使用币种特定的状态或创建新状态
        if (!this._symbolStates) this._symbolStates = {};
        if (!this._symbolStates[symbol]) {
            this._symbolStates[symbol] = {
                price: cfg.basePrice,
                trend: 0,
                trendDuration: 0
            };
        }
        
        const state = this._symbolStates[symbol];
        
        if (state.trendDuration <= 0) {
            state.trend = (Math.random() - 0.5) * cfg.volatility * 2;
            state.trendDuration = Math.floor(Math.random() * 50) + 20;
        }
        state.trendDuration--;
        
        const noise = (Math.random() - 0.5) * cfg.volatility;
        state.price = state.price * (1 + state.trend + noise);
        state.price = Math.max(state.price, cfg.basePrice * 0.8);
        state.price = Math.min(state.price, cfg.basePrice * 1.2);
        
        return parseFloat(state.price.toFixed(cfg.decimals));
    }

    async getTicker(symbol) {
        const price = this._nextPrice(symbol);
        const cfg = this._getSymbolConfig(symbol);
        return {
            symbol,
            price,
            bid: parseFloat((price * 0.9995).toFixed(cfg.decimals)),
            ask: parseFloat((price * 1.0005).toFixed(cfg.decimals)),
            volume: Math.floor(Math.random() * 10000) + 1000,
            timestamp: Date.now()
        };
    }

    async getKlines(symbol, interval = '1m', limit = 100) {
        const klines = [];
        const cfg = this._getSymbolConfig(symbol);
        let p = cfg.basePrice;
        
        for (let i = 0; i < limit; i++) {
            const noise = (Math.random() - 0.5) * cfg.volatility;
            p = p * (1 + noise);
            const high = p * (1 + Math.random() * 0.005);
            const low = p * (1 - Math.random() * 0.005);
            klines.push({
                time: Date.now() - (limit - i) * 60000,
                open: parseFloat(p.toFixed(cfg.decimals)),
                high: parseFloat(high.toFixed(cfg.decimals)),
                low: parseFloat(low.toFixed(cfg.decimals)),
                close: parseFloat((p * (1 + (Math.random() - 0.5) * 0.003)).toFixed(cfg.decimals)),
                volume: Math.floor(Math.random() * 5000) + 500
            });
        }
        return klines;
    }

    async placeOrder(symbol, side, type, quantity, price) {
        const orderId = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const cfg = this._getSymbolConfig(symbol);
        const execPrice = price || this._nextPrice(symbol);
        return {
            orderId,
            symbol,
            side,
            type,
            quantity,
            price: parseFloat(execPrice.toFixed(cfg.decimals)),
            status: 'FILLED',
            timestamp: Date.now()
        };
    }

    async getBalance() {
        return {
            USDT: { free: 50000, locked: 0 },
            BTC: { free: 0.5, locked: 0 }
        };
    }
}

// ===== Binance 适配器 (公开行情 + 可选私有) =====
class BinanceAdapter {
    constructor(config = {}) {
        this.name = 'Binance';
        this.apiKey = config.apiKey || '';
        this.apiSecret = config.apiSecret || '';
        this.baseURL = config.baseURL || 'https://api.binance.com';
        this.publicOnly = !this.apiKey || !this.apiSecret; // 无密钥则仅公开行情
        this._simBalance = { USDT: { free: 50000, locked: 0 } };
        this._orderCounter = 0;
    }

    _sign(params) {
        const query = Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
        const signature = crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex');
        return `${query}&signature=${signature}`;
    }

    async getTicker(symbol) {
        // 使用 24hr ticker 获取更丰富的数据 (含 bid/ask/volume)
        const data = await request(`${this.baseURL}/api/v3/ticker/24hr?symbol=${symbol}`);
        return {
            symbol: data.symbol,
            price: parseFloat(data.lastPrice),
            bid: parseFloat(data.bidPrice),
            ask: parseFloat(data.askPrice),
            volume: parseFloat(data.volume),
            priceChange: parseFloat(data.priceChangePercent),
            timestamp: Date.now()
        };
    }

    async getKlines(symbol, interval = '1m', limit = 100) {
        const data = await request(`${this.baseURL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        return data.map(k => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));
    }

    async placeOrder(symbol, side, type, quantity, price) {
        // 公开模式：模拟下单
        if (this.publicOnly) {
            this._orderCounter++;
            const execPrice = price || this._lastPrice || 0;
            // 更新模拟余额
            if (side === 'BUY') {
                this._simBalance.USDT.free -= quantity * execPrice;
            } else {
                this._simBalance.USDT.free += quantity * execPrice;
            }
            return {
                orderId: `BINANCE-PUB-${Date.now()}-${this._orderCounter}`,
                symbol, side, type,
                quantity: parseFloat(quantity.toFixed(6)),
                price: parseFloat(execPrice.toFixed(2)),
                status: 'FILLED',
                timestamp: Date.now(),
                _simulated: true
            };
        }

        // 私有模式：真实下单
        const params = {
            symbol, side, type,
            quantity: quantity.toString(),
            timestamp: Date.now(),
            recvWindow: 5000
        };
        if (type === 'LIMIT' && price) params.price = price.toString();
        if (type === 'LIMIT') params.timeInForce = 'GTC';

        const signed = this._sign(params);
        const data = await request(`${this.baseURL}/api/v3/order`, {
            method: 'POST',
            headers: { 'X-MBX-APIKEY': this.apiKey },
            body: signed
        });
        return {
            orderId: String(data.orderId),
            symbol: data.symbol,
            side: data.side,
            type: data.type,
            quantity: parseFloat(data.executedQty || data.origQty),
            price: parseFloat(data.fills?.[0]?.price || price || 0),
            status: data.status,
            timestamp: data.transactTime || Date.now()
        };
    }

    async getBalance() {
        // 公开模式：返回模拟余额
        if (this.publicOnly) {
            return this._simBalance;
        }

        // 私有模式：真实查询
        const params = { timestamp: Date.now(), recvWindow: 5000 };
        const signed = this._sign(params);
        const data = await request(`${this.baseURL}/api/v3/account?${signed}`, {
            headers: { 'X-MBX-APIKEY': this.apiKey }
        });
        const balances = {};
        (data.balances || []).forEach(b => {
            const free = parseFloat(b.free);
            const locked = parseFloat(b.locked);
            if (free > 0 || locked > 0) balances[b.asset] = { free, locked };
        });
        return balances;
    }
}

// ===== OKX 适配器 =====
class OKXAdapter {
    constructor(config = {}) {
        this.name = 'OKX';
        this.apiKey = config.apiKey || '';
        this.apiSecret = config.apiSecret || '';
        this.passphrase = config.passphrase || '';
        this.baseURL = config.baseURL || 'https://www.okx.com';
    }

    _sign(timestamp, method, path, body = '') {
        const message = timestamp + method + path + body;
        return crypto.createHmac('sha256', this.apiSecret).update(message).digest('base64');
    }

    _headers(method, path, body = '') {
        const ts = new Date().toISOString();
        const sign = this._sign(ts, method, path, body);
        return {
            'OK-ACCESS-KEY': this.apiKey,
            'OK-ACCESS-SIGN': sign,
            'OK-ACCESS-TIMESTAMP': ts,
            'OK-ACCESS-PASSPHRASE': this.passphrase,
            'Content-Type': 'application/json'
        };
    }

    async getTicker(instId) {
        const data = await request(`${this.baseURL}/api/v5/market/ticker?instId=${instId}`);
        const t = data.data?.[0];
        return {
            symbol: instId,
            price: parseFloat(t?.last || 0),
            bid: parseFloat(t?.bidPx || 0),
            ask: parseFloat(t?.askPx || 0),
            timestamp: Date.now()
        };
    }

    async getKlines(instId, bar = '1m', limit = 100) {
        const data = await request(`${this.baseURL}/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`);
        return (data.data || []).reverse().map(k => ({
            time: parseInt(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));
    }

    async placeOrder(instId, side, type, size, price) {
        const body = JSON.stringify({
            instId, side, ordType: type,
            sz: size.toString(),
            ...(type === 'limit' && price ? { px: price.toString() } : {})
        });
        const path = '/api/v5/trade/order';
        const data = await request(`${this.baseURL}${path}`, {
            method: 'POST',
            headers: this._headers('POST', path, body),
            body
        });
        const order = data.data?.[0];
        return {
            orderId: order?.ordId || '',
            symbol: instId,
            side,
            type,
            quantity: parseFloat(size),
            price: parseFloat(price || 0),
            status: order?.sCode === '0' ? 'FILLED' : 'FAILED',
            timestamp: Date.now()
        };
    }

    async getBalance() {
        const path = '/api/v5/account/balance';
        const data = await request(`${this.baseURL}${path}`, {
            headers: this._headers('GET', path)
        });
        const balances = {};
        (data.data?.[0]?.details || []).forEach(b => {
            balances[b.ccy] = { free: parseFloat(b.availBal), locked: parseFloat(b.frozenBal) };
        });
        return balances;
    }
}

// ===== Huobi 适配器 (国内可用) =====
class HuobiAdapter {
    constructor(config = {}) {
        this.name = 'Huobi';
        this.baseURL = 'https://api.huobi.pro';
        this.publicOnly = true; // 仅公开行情
        this._simBalance = { USDT: { free: 50000, locked: 0 } };
        this._orderCounter = 0;
    }

    async getTicker(symbol) {
        // Huobi symbol格式: btcusdt
        const huobiSymbol = symbol.toLowerCase();
        const data = await request(`${this.baseURL}/market/detail/merged?symbol=${huobiSymbol}`);
        const tick = data.tick || {};
        return {
            symbol: symbol,
            price: parseFloat(tick.close || tick.ask?.[0] || 0),
            bid: parseFloat(tick.bid?.[0] || 0),
            ask: parseFloat(tick.ask?.[0] || 0),
            volume: parseFloat(tick.vol || 0),
            high: parseFloat(tick.high || 0),
            low: parseFloat(tick.low || 0),
            timestamp: Date.now()
        };
    }

    async getKlines(symbol, interval = '1m', limit = 100) {
        // Huobi interval映射
        const intervalMap = { '1m': '1min', '5m': '5min', '15m': '15min', '1h': '60min', '4h': '4hour', '1d': '1day' };
        const huobiInterval = intervalMap[interval] || '1min';
        const huobiSymbol = symbol.toLowerCase();
        const data = await request(`${this.baseURL}/market/history/kline?symbol=${huobiSymbol}&period=${huobiInterval}&size=${limit}`);
        return (data.data || []).reverse().map(k => ({
            time: k.id * 1000,
            open: parseFloat(k.open),
            high: parseFloat(k.high),
            low: parseFloat(k.low),
            close: parseFloat(k.close),
            volume: parseFloat(k.vol)
        }));
    }

    async placeOrder(symbol, side, type, quantity, price) {
        // 公开模式：模拟下单
        this._orderCounter++;
        const execPrice = price || 0;
        if (side === 'BUY') {
            this._simBalance.USDT.free -= quantity * execPrice;
        } else {
            this._simBalance.USDT.free += quantity * execPrice;
        }
        return {
            orderId: `HUOBI-${Date.now()}-${this._orderCounter}`,
            symbol, side, type,
            quantity: parseFloat(quantity.toFixed(6)),
            price: parseFloat(execPrice.toFixed(2)),
            status: 'FILLED',
            timestamp: Date.now(),
            _simulated: true
        };
    }

    async getBalance() {
        return this._simBalance;
    }
}

// ===== CoinGecko 适配器 (免费公开API) =====
class CoinGeckoAdapter {
    constructor(config = {}) {
        this.name = 'CoinGecko';
        this.baseURL = 'https://api.coingecko.com/api/v3';
        this.publicOnly = true;
        this._simBalance = { USDT: { free: 50000, locked: 0 } };
        this._orderCounter = 0;
        this._lastPrices = {};
    }

    // CoinGecko ID映射
    _getCoinId(symbol) {
        const map = {
            'BTCUSDT': 'bitcoin',
            'ETHUSDT': 'ethereum',
            'SOLUSDT': 'solana',
            'BNBUSDT': 'binancecoin',
            'DOGEUSDT': 'dogecoin'
        };
        return map[symbol] || 'bitcoin';
    }

    async getTicker(symbol) {
        const coinId = this._getCoinId(symbol);
        const data = await request(`${this.baseURL}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`);
        const coin = data[coinId] || {};
        const price = coin.usd || 0;
        this._lastPrices[symbol] = price;
        return {
            symbol,
            price,
            bid: price * 0.9999,
            ask: price * 1.0001,
            volume: coin.usd_24h_vol || 0,
            priceChange: coin.usd_24h_change || 0,
            timestamp: Date.now()
        };
    }

    async getKlines(symbol, interval = '1m', limit = 100) {
        // CoinGecko 无需K线直接返回当前价格的模拟数据
        const ticker = await this.getTicker(symbol);
        const price = ticker.price;
        const klines = [];
        let p = price * (1 - 0.01 * limit / 100);
        for (let i = 0; i < limit; i++) {
            const noise = (Math.random() - 0.5) * 0.003;
            p = p * (1 + noise);
            klines.push({
                time: Date.now() - (limit - i) * 60000,
                open: parseFloat(p.toFixed(2)),
                high: parseFloat((p * 1.002).toFixed(2)),
                low: parseFloat((p * 0.998).toFixed(2)),
                close: parseFloat((p * (1 + (Math.random() - 0.5) * 0.002)).toFixed(2)),
                volume: Math.floor(Math.random() * 10000) + 1000
            });
        }
        // 最后一根K线使用真实价格
        klines[klines.length - 1].close = price;
        return klines;
    }

    async placeOrder(symbol, side, type, quantity, price) {
        this._orderCounter++;
        const execPrice = price || this._lastPrices[symbol] || 0;
        if (side === 'BUY') {
            this._simBalance.USDT.free -= quantity * execPrice;
        } else {
            this._simBalance.USDT.free += quantity * execPrice;
        }
        return {
            orderId: `CG-${Date.now()}-${this._orderCounter}`,
            symbol, side, type,
            quantity: parseFloat(quantity.toFixed(6)),
            price: parseFloat(execPrice.toFixed(2)),
            status: 'FILLED',
            timestamp: Date.now(),
            _simulated: true
        };
    }

    async getBalance() {
        return this._simBalance;
    }
}

// ===== Gate.io 适配器 =====
class GateAdapter {
    constructor(config = {}) {
        this.name = 'Gate.io';
        this.apiKey = config.apiKey || '';
        this.apiSecret = config.apiSecret || '';
        this.baseURL = config.baseURL || 'https://api.gateio.ws'; // 主网
        this.publicOnly = !this.apiKey || !this.apiSecret;
        this._simBalance = { USDT: { free: 50000, locked: 0 } };
        this._orderCounter = 0;
    }

    _sign(timestamp, method, url, body = '') {
        const message = `${method}\n${url}\n${timestamp}\n${body}`;
        return crypto.createHmac('sha512', this.apiSecret).update(message).digest('hex');
    }

    _headers(method, url, body = '') {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const sign = this._sign(timestamp, method, url, body);
        return {
            'KEY': this.apiKey,
            'SIGN': sign,
            'Timestamp': timestamp,
            'Content-Type': 'application/json'
        };
    }

    async getTicker(symbol) {
        // Gate.io 格式: BTC_USDT
        const gateSymbol = symbol.replace('USDT', '_USDT');
        const path = `/api/v4/spot/tickers?currency_pair=${gateSymbol}`;
        const data = await request(`${this.baseURL}${path}`);
        const ticker = Array.isArray(data) ? data[0] : data;
        return {
            symbol,
            price: parseFloat(ticker?.last || 0),
            bid: parseFloat(ticker?.highest_bid || 0),
            ask: parseFloat(ticker?.lowest_ask || 0),
            volume: parseFloat(ticker?.base_volume || 0),
            priceChange: parseFloat(ticker?.change_percentage || 0),
            timestamp: Date.now()
        };
    }

    async getKlines(symbol, interval = '1m', limit = 100) {
        const gateSymbol = symbol.replace('USDT', '_USDT');
        // Gate.io interval映射
        const intervalMap = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' };
        const gateInterval = intervalMap[interval] || '1m';
        const to = Math.floor(Date.now() / 1000);
        const from = to - limit * 60;
        const path = `/api/v4/spot/candlesticks?currency_pair=${gateSymbol}&interval=${gateInterval}&from=${from}&to=${to}&limit=${limit}`;
        const data = await request(`${this.baseURL}${path}`);
        return (data || []).reverse().map(k => ({
            time: parseInt(k[0]) * 1000,
            open: parseFloat(k[2]),
            high: parseFloat(k[3]),
            low: parseFloat(k[4]),
            close: parseFloat(k[1]),
            volume: parseFloat(k[5])
        }));
    }

    async placeOrder(symbol, side, type, quantity, price) {
        if (this.publicOnly) {
            this._orderCounter++;
            const execPrice = price || 0;
            if (side === 'BUY') {
                this._simBalance.USDT.free -= quantity * execPrice;
            } else {
                this._simBalance.USDT.free += quantity * execPrice;
            }
            return {
                orderId: `GATE-${Date.now()}-${this._orderCounter}`,
                symbol, side, type,
                quantity: parseFloat(quantity.toFixed(6)),
                price: parseFloat(execPrice.toFixed(2)),
                status: 'FILLED',
                timestamp: Date.now(),
                _simulated: true
            };
        }

        const gateSymbol = symbol.replace('USDT', '_USDT');
        const path = '/api/v4/spot/orders';
        const body = JSON.stringify({
            currency_pair: gateSymbol,
            type: type.toLowerCase(),
            side: side.toLowerCase(),
            amount: quantity.toString(),
            ...(type === 'LIMIT' && price ? { price: price.toString() } : {})
        });
        const data = await request(`${this.baseURL}${path}`, {
            method: 'POST',
            headers: this._headers('POST', path, body),
            body
        });
        return {
            orderId: String(data.id || data.order_id),
            symbol,
            side: side.toUpperCase(),
            type: type.toUpperCase(),
            quantity: parseFloat(data.amount || quantity),
            price: parseFloat(data.price || price || 0),
            status: data.status || 'FILLED',
            timestamp: Date.now()
        };
    }

    async getBalance() {
        if (this.publicOnly) {
            return this._simBalance;
        }
        const path = '/api/v4/wallet/balances';
        const data = await request(`${this.baseURL}${path}`, {
            headers: this._headers('GET', path)
        });
        const balances = {};
        (data || []).forEach(b => {
            const free = parseFloat(b.available || 0);
            const locked = parseFloat(b.locked || 0);
            if (free > 0 || locked > 0) balances[b.currency] = { free, locked };
        });
        return balances;
    }
}

// ===== 工厂函数 =====
function createExchange(type, config = {}) {
    switch (type.toLowerCase()) {
        case 'mock': return new MockExchange(config);
        case 'binance': return new BinanceAdapter(config);
        case 'binance-public': return new BinanceAdapter({ ...config, apiKey: '', apiSecret: '' });
        case 'gate': return new GateAdapter(config);
        case 'okx': return new OKXAdapter(config);
        default: throw new Error(`Unknown exchange: ${type}`);
    }
}

module.exports = { createExchange, MockExchange, BinanceAdapter, GateAdapter, OKXAdapter };
