const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function post(targetUrl, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify(data);
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors()); res.end(); return; }
  if (req.method === 'GET') { res.writeHead(200, cors()); res.end(JSON.stringify({ ok: true })); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { odooUrl, db, apiKey, model, method, args, kwargs } = JSON.parse(body);

      // Step 1: get uid using API key as password
      const auth = await post(`${odooUrl}/xmlrpc/2/common`, {
        jsonrpc: '2.0', method: 'call', id: 1,
        params: { service: 'common', method: 'authenticate', args: [db, 'admin', apiKey, {}] }
      });

      const uid = auth.result;
      if (!uid) {
        res.writeHead(200, cors());
        res.end(JSON.stringify({ error: 'Invalid API key or database. Check your Odoo API key.' }));
        return;
      }

      // Step 2: if only auth needed, return uid
      if (!model) {
        res.writeHead(200, cors());
        res.end(JSON.stringify({ uid, success: true }));
        return;
      }

      // Step 3: call the requested model/method
      const result = await post(`${odooUrl}/xmlrpc/2/object`, {
        jsonrpc: '2.0', method: 'call', id: 2,
        params: { service: 'object', method: 'execute_kw', args: [db, uid, apiKey, model, method, args || [], kwargs || {}] }
      });

      res.writeHead(200, cors());
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(200, cors());
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => console.log(`OdooAI Proxy running on port ${PORT}`));
