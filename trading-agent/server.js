/**
 * 汉堡交易 · HTTP + WebSocket 服务器
 * 纯 Node.js，零依赖
 *
 * 支持两套系统:
 *   1. 经典 Agent 模式 (legacy)
 *   2. 汉堡组合模式 (田忌赛马)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { getStrategyList, getStrategy, getStrategiesByLayer } = require('./strategies');
const { TradingAgent } = require('./core/agent');
const { KitchenEngine } = require('./core/kitchen');

const PORT = process.env.PORT || 3088;
const HOST = process.env.HOST || '0.0.0.0';

// HTTPS JSON 请求工具
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON parse error')); }
            });
        }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
    });
}

// ===== Agent 实例管理 (Legacy) =====
const agents = new Map();

function createAgent(config) {
    const agent = new TradingAgent({
        ...config,
        onUpdate: (event) => broadcast(event)
    });
    agents.set(agent.id, agent);
    return agent;
}

// ===== Kitchen Engine (田忌赛马) =====
const kitchen = new KitchenEngine({
    onUpdate: (event) => broadcast(event)
});

// ===== WebSocket =====
const wsClients = new Set();

function broadcast(data) {
    const msg = JSON.stringify(data);
    const frame = encodeWSFrame(msg);
    for (const client of wsClients) {
        try { client.write(frame); } catch { wsClients.delete(client); }
    }
}

function encodeWSFrame(data) {
    const payload = Buffer.from(data, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81;
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

function handleWSUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const crypto = require('crypto');
    const accept = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    wsClients.add(socket);
    console.log(`[WS] Client connected (${wsClients.size} total)`);

    // 发送当前所有 agent 状态
    for (const [, agent] of agents) {
        socket.write(encodeWSFrame(JSON.stringify({ type: 'agent_state', data: agent.getState() })));
    }

    // 发送当前所有汉堡状态
    for (const burger of kitchen.getAllBurgers()) {
        socket.write(encodeWSFrame(JSON.stringify({ type: 'burger_state', data: burger })));
    }

    // 发送厨房统计
    socket.write(encodeWSFrame(JSON.stringify({ type: 'kitchen_stats', data: kitchen.getStats() })));

    socket.on('close', () => {
        wsClients.delete(socket);
        console.log(`[WS] Client disconnected (${wsClients.size} total)`);
    });

    socket.on('error', () => wsClients.delete(socket));
}

// ===== HTTP API =====
function parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { resolve({}); }
        });
    });
}

function sendJSON(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

async function handleAPI(req, res) {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;
    const method = req.method;

    // CORS preflight
    if (method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    try {
        // ========================================
        // 策略相关
        // ========================================

        // GET /api/strategies — 列出所有策略
        if (pathname === '/api/strategies' && method === 'GET') {
            return sendJSON(res, { ok: true, data: getStrategyList() });
        }

        // GET /api/strategies/layer/:layer — 按层级获取策略 (base/patty/sauce)
        const layerMatch = pathname.match(/^\/api\/strategies\/layer\/(\w+)$/);
        if (layerMatch && method === 'GET') {
            return sendJSON(res, { ok: true, data: getStrategiesByLayer(layerMatch[1]) });
        }

        // ========================================
        // 经典 Agent API (Legacy)
        // ========================================

        // POST /api/agents — 创建智能体
        if (pathname === '/api/agents' && method === 'POST') {
            const body = await parseBody(req);
            const agent = createAgent(body);
            return sendJSON(res, { ok: true, data: agent.getState() }, 201);
        }

        // GET /api/agents — 列出所有智能体
        if (pathname === '/api/agents' && method === 'GET') {
            const list = [];
            for (const [, agent] of agents) list.push(agent.getState());
            return sendJSON(res, { ok: true, data: list });
        }

        // POST /api/agents/:id/start
        const agentStartMatch = pathname.match(/^\/api\/agents\/([^/]+)\/start$/);
        if (agentStartMatch && method === 'POST') {
            const agent = agents.get(agentStartMatch[1]);
            if (!agent) return sendJSON(res, { ok: false, error: 'Agent not found' }, 404);
            await agent.start();
            const state = agent.getState();
            broadcast({ type: 'agent_state', data: state });
            return sendJSON(res, { ok: true, data: state });
        }

        // POST /api/agents/:id/stop
        const agentStopMatch = pathname.match(/^\/api\/agents\/([^/]+)\/stop$/);
        if (agentStopMatch && method === 'POST') {
            const agent = agents.get(agentStopMatch[1]);
            if (!agent) return sendJSON(res, { ok: false, error: 'Agent not found' }, 404);
            agent.stop();
            const state = agent.getState();
            broadcast({ type: 'agent_state', data: state });
            return sendJSON(res, { ok: true, data: state });
        }

        // DELETE /api/agents/:id
        const agentDelMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
        if (agentDelMatch && method === 'DELETE' && !pathname.includes('burger')) {
            const agent = agents.get(agentDelMatch[1]);
            if (!agent) return sendJSON(res, { ok: false, error: 'Agent not found' }, 404);
            const agentName = agent.name;
            agent.stop();
            agents.delete(agentDelMatch[1]);
            broadcast({ type: 'agent_deleted', data: { id: agentDelMatch[1], name: agentName } });
            return sendJSON(res, { ok: true });
        }

        // GET /api/agents/:id
        const agentGetMatch = pathname.match(/^\/api\/agents\/([^/]+)$/);
        if (agentGetMatch && method === 'GET' && !pathname.includes('burger')) {
            const agent = agents.get(agentGetMatch[1]);
            if (!agent) return sendJSON(res, { ok: false, error: 'Agent not found' }, 404);
            return sendJSON(res, { ok: true, data: agent.getState() });
        }

        // ========================================
        // 汉堡组合 API (田忌赛马)
        // ========================================

        // GET /api/burgers/presets — 获取预设汉堡组合
        if (pathname === '/api/burgers/presets' && method === 'GET') {
            return sendJSON(res, { ok: true, data: KitchenEngine.getPresets() });
        }

        // GET /api/burgers — 列出所有汉堡
        if (pathname === '/api/burgers' && method === 'GET') {
            return sendJSON(res, { ok: true, data: kitchen.getAllBurgers() });
        }

        // POST /api/burgers — 创建汉堡组合
        if (pathname === '/api/burgers' && method === 'POST') {
            const body = await parseBody(req);
            const burger = kitchen.createBurger(body);
            return sendJSON(res, { ok: true, data: burger.getState() }, 201);
        }

        // GET /api/burgers/:id — 获取汉堡详情
        const burgerGetMatch = pathname.match(/^\/api\/burgers\/([^/]+)$/);
        if (burgerGetMatch && method === 'GET') {
            const burger = kitchen.getBurger(burgerGetMatch[1]);
            if (!burger) return sendJSON(res, { ok: false, error: 'Burger not found' }, 404);
            return sendJSON(res, { ok: true, data: burger.getState() });
        }

        // POST /api/burgers/:id/start — 启动汉堡
        const burgerStartMatch = pathname.match(/^\/api\/burgers\/([^/]+)\/start$/);
        if (burgerStartMatch && method === 'POST') {
            try {
                const state = await kitchen.startBurger(burgerStartMatch[1]);
                broadcast({ type: 'burger_state', data: state });
                return sendJSON(res, { ok: true, data: state });
            } catch (err) {
                return sendJSON(res, { ok: false, error: err.message }, 404);
            }
        }

        // POST /api/burgers/:id/stop — 停止汉堡
        const burgerStopMatch = pathname.match(/^\/api\/burgers\/([^/]+)\/stop$/);
        if (burgerStopMatch && method === 'POST') {
            try {
                const state = kitchen.stopBurger(burgerStopMatch[1]);
                broadcast({ type: 'burger_state', data: state });
                return sendJSON(res, { ok: true, data: state });
            } catch (err) {
                return sendJSON(res, { ok: false, error: err.message }, 404);
            }
        }

        // DELETE /api/burgers/:id — 删除汉堡
        const burgerDelMatch = pathname.match(/^\/api\/burgers\/([^/]+)$/);
        if (burgerDelMatch && method === 'DELETE') {
            try {
                kitchen.deleteBurger(burgerDelMatch[1]);
                return sendJSON(res, { ok: true });
            } catch (err) {
                return sendJSON(res, { ok: false, error: err.message }, 404);
            }
        }

        // POST /api/kitchen/start-all — 一键启动所有汉堡
        if (pathname === '/api/kitchen/start-all' && method === 'POST') {
            const started = await kitchen.startAll();
            return sendJSON(res, { ok: true, data: { started } });
        }

        // POST /api/kitchen/stop-all — 一键停止所有汉堡
        if (pathname === '/api/kitchen/stop-all' && method === 'POST') {
            kitchen.stopAll();
            return sendJSON(res, { ok: true });
        }

        // GET /api/kitchen/stats — 厨房全局统计 + 排名
        if (pathname === '/api/kitchen/stats' && method === 'GET') {
            return sendJSON(res, { ok: true, data: kitchen.getStats() });
        }

        // GET /api/kitchen/rankings — 赛马排名
        if (pathname === '/api/kitchen/rankings' && method === 'GET') {
            return sendJSON(res, { ok: true, data: kitchen.getRankings() });
        }

        // ========================================
        // 实时行情代理 (避免浏览器 CORS)
        // ========================================

        // GET /api/ticker/:symbol — 获取实时行情
        if (pathname === '/api/ticker' && method === 'GET') {
            const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
            const gateSymbol = symbol.replace('USDT', '_USDT');
            try {
                const data = await fetchJSON(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${gateSymbol}`);
                return sendJSON(res, { ok: true, data });
            } catch (err) {
                return sendJSON(res, { ok: false, error: err.message }, 500);
            }
        }

        // GET /api/tickers — 批量获取行情
        if (pathname === '/api/tickers' && method === 'GET') {
            const symbols = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'DOGE_USDT', 'HYPE_USDT', 'BNB_USDT'];
            try {
                const results = await Promise.all(
                    symbols.map(s => fetchJSON(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${s}`).catch(() => null))
                );
                const tickers = results.filter(Boolean).map(d => {
                    const t = Array.isArray(d) ? d[0] : d;
                    return {
                        symbol: (t.currency_pair || '').replace('_USDT', 'USDT'),
                        price: parseFloat(t.last || 0),
                        change: parseFloat(t.change_percentage || 0),
                        volume: parseFloat(t.base_volume || 0),
                        high: parseFloat(t.high_24h || 0),
                        low: parseFloat(t.low_24h || 0)
                    };
                });
                return sendJSON(res, { ok: true, data: tickers });
            } catch (err) {
                return sendJSON(res, { ok: false, error: err.message }, 500);
            }
        }

        // ========================================
        // 交易所配置存储
        // ========================================

        // POST /api/exchange — 保存交易所配置
        if (pathname === '/api/exchange' && method === 'POST') {
            const body = await parseBody(req);
            // 配置存入内存（重启后由前端 localStorage 恢复）
            global._exchangeConfig = global._exchangeConfig || {};
            global._exchangeConfig[body.type] = { apiKey: body.apiKey, apiSecret: body.apiSecret, passphrase: body.passphrase, host: body.host };
            return sendJSON(res, { ok: true });
        }

        // GET /api/exchange/:type — 获取交易所配置
        const exchMatch = pathname.match(/^\/api\/exchange\/(\w+)$/);
        if (exchMatch && method === 'GET') {
            const config = (global._exchangeConfig || {})[exchMatch[1]] || {};
            // 不返回 secret，只确认是否已配置
            return sendJSON(res, { ok: true, data: { configured: !!config.apiKey } });
        }

        return sendJSON(res, { ok: false, error: 'Not found' }, 404);
    } catch (err) {
        console.error('[API Error]', err);
        return sendJSON(res, { ok: false, error: err.message }, 500);
    }
}

// ===== 静态文件服务 =====
function serveStatic(req, res) {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    // 去掉查询参数
    filePath = filePath.split('?')[0];
    filePath = path.join(__dirname, filePath);

    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.gif': 'image/gif',
        '.heic': 'image/heic'
    };

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

// ===== 主服务器 =====
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname.startsWith('/api/')) {
        handleAPI(req, res);
    } else {
        serveStatic(req, res);
    }
});

// WebSocket 升级
server.on('upgrade', (req, socket) => {
    if (req.headers['upgrade']?.toLowerCase() === 'websocket') {
        handleWSUpgrade(req, socket);
    } else {
        socket.destroy();
    }
});

server.listen(PORT, HOST, () => {
    console.log(`\n🍔 汉堡交易 · 田忌赛马 AI 博弈系统`);
    console.log(`   🌐 http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`   📡 WebSocket ws://localhost:${PORT}`);
    console.log(`   📊 Strategies http://localhost:${PORT}/api/strategies`);
    console.log(`   🍔 Burgers    http://localhost:${PORT}/api/burgers`);
    console.log(`   🏇 Kitchen    http://localhost:${PORT}/api/kitchen/stats\n`);
});
