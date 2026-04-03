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

const server = http.createServer((req, res) => {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // Health check
  if (req.path === '/' || req.url === '/') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ status: 'OdooAI Proxy running' }));
    return;
  }

  // Only allow /proxy endpoint
  if (req.method === 'POST' && req.url === '/proxy') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const { odooUrl, path: odooPath, payload } = parsed;

      if (!odooUrl || !odooPath || !payload) {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'Missing odooUrl, path, or payload' }));
        return;
      }

      // Parse the Odoo URL
      let parsedUrl;
      try {
        parsedUrl = new url.URL(odooUrl + odooPath);
      } catch (e) {
        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'Invalid Odoo URL: ' + odooUrl }));
        return;
      }

      const postData = JSON.stringify(payload);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const proxyReq = lib.request(options, proxyRes => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, corsHeaders());
          res.end(data);
        });
      });

      proxyReq.on('error', e => {
        res.writeHead(502, corsHeaders());
        res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }));
      });

      proxyReq.write(postData);
      proxyReq.end();
    });
    return;
  }

  res.writeHead(404, corsHeaders());
  res.end(JSON.stringify({ error: 'Not found. Use POST /proxy' }));
});

server.listen(PORT, () => {
  console.log(`OdooAI Proxy running on port ${PORT}`);
});
