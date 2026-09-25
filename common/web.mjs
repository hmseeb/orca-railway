// Shared by the orca control page and the relay admin page: a password gate,
// an HTML shell, and a transparent HTTP + WebSocket reverse proxy to a
// loopback port. No dependencies.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { request } from 'node:http'
import { connect } from 'node:net'

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export async function readBody(req, limit = 64 * 1024) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > limit) throw new Error('body too large')
  }
  return raw
}

export function proxyHttp(req, res, port) {
  const upstream = request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers)
    r.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
    res.end('Upstream is starting, retry in a few seconds.')
  })
  req.pipe(upstream)
}

export function proxyUpgrade(req, socket, head, port) {
  const upstream = connect(port, '127.0.0.1', () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
    upstream.write(`${raw}\r\n`)
    if (head?.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  const kill = () => { upstream.destroy(); socket.destroy() }
  upstream.on('error', kill)
  socket.on('error', kill)
  upstream.on('close', () => socket.destroy())
  socket.on('close', () => upstream.destroy())
}

// Password gate for one path prefix. Sessions are HMAC cookies keyed by a
// per-process secret, so a restart signs the operator out (and nothing else).
export function passwordGate({ password, basePath, title }) {
  if (!password) throw new Error('ORCA_PASSWORD is required')
  const secret = randomBytes(32)
  const cookieName = 'orca_session'
  const TTL = 12 * 60 * 60 * 1000
  const digest = (v) => createHash('sha256').update(String(v ?? '')).digest()
  let lastFailure = 0
  const sign = (exp) => `${exp}.${createHmac('sha256', secret).update(`${basePath}:${exp}`).digest('base64url')}`
  const valid = (req) => {
    const raw = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    const exp = Number(raw?.split('.')[0])
    return Boolean(raw) && exp > Date.now() && timingSafeEqual(digest(raw), digest(sign(exp)))
  }
  const loginPage = (error) => shell(title, `<form method="post" action="${basePath}/login" class="card narrow">
<h1>${esc(title)}</h1>${error ? `<p class="err">${esc(error)}</p>` : ''}
<input type="password" name="password" placeholder="Password" autofocus required>
<button>Sign in</button></form>`)
  return {
    /** Returns true when the request was fully handled (login page, login post, logout). */
    async handle(req, res, url) {
      if (url.pathname === `${basePath}/login` && req.method === 'POST') {
        const given = new URLSearchParams(await readBody(req)).get('password')
        if (Date.now() - lastFailure < 2000 || !timingSafeEqual(digest(given), digest(password))) {
          lastFailure = Date.now()
          send(res, 401, loginPage('Wrong password.'))
          return true
        }
        res.writeHead(303, {
          location: basePath,
          'set-cookie': `${cookieName}=${sign(Date.now() + TTL)}; Path=${basePath}; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL / 1000}`
        })
        res.end()
        return true
      }
      if (url.pathname === `${basePath}/logout`) {
        res.writeHead(303, { location: basePath, 'set-cookie': `${cookieName}=; Path=${basePath}; Max-Age=0` })
        res.end()
        return true
      }
      if (!valid(req)) {
        send(res, 200, loginPage())
        return true
      }
      // Every state-changing action is a same-origin POST; SameSite=Strict covers CSRF.
      return false
    }
  }
}

export function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers })
  res.end(body)
}

export const redirect = (res, to) => { res.writeHead(303, { location: to }); res.end() }

export function ago(ms) {
  if (!ms) return 'never'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function shell(title, body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0b0b0c;--card:#151517;--line:#26262a;--mut:#8b8b92;--fg:#ececef;--acc:#e8e8ea}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 20px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
.sub{color:var(--mut);margin:0 0 24px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:0 0 16px}
.narrow{max-width:340px;margin:18vh auto;display:grid;gap:12px}
input,button,select{font:inherit;padding:10px 12px;border-radius:9px;border:1px solid var(--line);background:#0f0f11;color:var(--fg)}
button{background:var(--acc);color:#111;border:0;cursor:pointer;font-weight:600}button.ghost{background:transparent;color:var(--fg);border:1px solid var(--line)}
button.danger{background:#3a1416;color:#ffb4b4;border:1px solid #5a2024}
code,pre{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}pre{background:#0f0f11;border:1px solid var(--line);border-radius:9px;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-all}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px 6px;border-top:1px solid var(--line);vertical-align:middle}th{color:var(--mut);font-weight:500;border:0}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.mut{color:var(--mut)}.err{color:#ff8a8a;margin:0}.ok{color:#8fe3a1}
.qr{background:#fff;border-radius:12px;padding:12px;width:220px;height:220px}.qr svg{width:100%;height:100%}
nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}nav a{color:var(--mut)}a{color:var(--fg)}
.tabs button{margin-right:6px}details summary{cursor:pointer;color:var(--mut)}form.inline{display:inline}
</style>
<script>function copyText(id,btn){navigator.clipboard.writeText(document.getElementById(id).textContent.trim());const t=btn.textContent;btn.textContent='Copied';setTimeout(()=>btn.textContent=t,1500)}</script>
<main>${body}</main></html>`
}
