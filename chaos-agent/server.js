const http = require('http')
const { applyConfig, getStatus } = require('./chaos')

const PORT = 9666

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return res.end()
  }

  if (req.method === 'GET' && req.url === '/status') {
    return json(res, 200, getStatus())
  }

  if (req.method === 'POST' && req.url === '/config') {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body)
        applyConfig(parsed)
        return json(res, 200, { ok: true, status: getStatus() })
      } catch {
        return json(res, 400, { error: 'invalid JSON' })
      }
    })
    return
  }

  json(res, 404, { error: 'not found' })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[chaos-agent] listening on :${PORT}`)
  console.log('[chaos-agent] POST /config  { trafficLevel: 0-100, chaosLevel: 0-3 }')
  console.log('[chaos-agent] GET  /status')
})
