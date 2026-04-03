const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
}

function makeRequest(targetUrl, postData, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
      ...extraHeaders
    };

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers
    };

    const req = lib.request(options, res => {
      let data = '';
      const cookies = res.headers['set-cookie'] || [];
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ data, cookies, status: res.statusCode }));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ status: 'OdooAI Proxy v3 running' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/connect') {
    // Step 1: Authenticate and return session cookie
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { odooUrl, db, apiKey } = JSON.parse(body);

        // Odoo accepts API key as password with login "admin" or the user's login
        // Try authenticating via /web/session/authenticate
        const payload = JSON.stringify({
          jsonrpc: '2.0', method: 'call', id: 1,
          params: {
            db,
            login: 'admin',
            password: apiKey
          }
        });

        const result = await makeRequest(`${odooUrl}/web/session/authenticate`, payload);
        const parsed = JSON.parse(result.data);

        if (parsed.result && parsed.result.uid) {
          // Extract session cookie
          const sessionCookie = result.cookies.map(c => c.split(';')[0]).join('; ');
          res.writeHead(200, corsHeaders());
          res.end(JSON.stringify({
            success: true,
            uid: parsed.result.uid,
            name: parsed.result.name,
            sessionCookie
          }));
        } else {
          res.writeHead(200, corsHeaders());
          res.end(JSON.stringify({ success: false, error: 'Authentication failed. Check your API key and make sure it belongs to the admin user.' }));
        }
      } catch (e) {
        res.writeHead(200, corsHeaders());
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/proxy') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { odooUrl, path: odooPath, payload, sessionCookie } = JSON.parse(body);

        if (!odooUrl || !odooPath || !payload) {
          res.writeHead(400, corsHeaders());
          res.end(JSON.stringify({ error: 'Missing fields' }));
          return;
        }

        const extraHeaders = sessionCookie ? { 'Cookie': sessionCookie } : {};
        const result = await makeRequest(`${odooUrl}${odooPath}`, JSON.stringify(payload), extraHeaders);

        res.writeHead(result.status, corsHeaders());
        res.end(result.data);
      } catch (e) {
        res.writeHead(502, corsHeaders());
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, corsHeaders());
  res.end(JSON.stringify({ error: 'Use POST /connect or POST /proxy' }));
});

server.listen(PORT, () => console.log(`OdooAI Proxy v3 on port ${PORT}`));
