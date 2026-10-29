import { createServer } from 'node:http'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const port = Number(args.find((arg) => arg.startsWith('--http-port='))?.split('=')[1])
let file = args.at(-1)
let state = 'playing'
let time = 10
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/test/finish') {
    time = 2699
    // Leave enough time for the production near-end poll to observe the last sample.
    setTimeout(() => { state = 'stopped' }, 5500)
  } else if (url.pathname === '/test/quit') {
    res.end('ok')
    server.close(() => process.exit(0))
    return
  } else if (url.pathname === '/test/current') {
    res.end(JSON.stringify({ file, pid: process.pid }))
    return
  } else if (url.searchParams.get('command') === 'in_play') {
    file = fileURLToPath(url.searchParams.get('input'))
    state = 'playing'
    time = 10
  }
  res.end(JSON.stringify({ state, time: state === 'stopped' ? 0 : time, length: state === 'stopped' ? 0 : 2700,
    information: { category: { meta: { filename: state === 'stopped' ? '' : basename(file) } } } }))
})
server.listen(port, '127.0.0.1')
