const http = require('http')

const PORT = process.env.PORT || 4000

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    ok: true,
    method: req.method,
    url: req.url,
    port: PORT
  }))
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SMOKE SERVER RUNNING ON ${PORT}`)
})