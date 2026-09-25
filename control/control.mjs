// Front process for the orca service when ORCA_PASSWORD is set. Runs
// `orca serve` on a loopback port and owns the public port:
//   /control   password-protected page: browser link, phone QR, paired devices, rotate
//   the rest   proxied (HTTP + WebSocket) to Orca, which authenticates clients itself
// Orca mints a pairing offer only at startup (no RPC for it), so "rotate" and
// "revoke" edit Orca's device registry while it is stopped, then restart it.
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { ago, esc, passwordGate, proxyHttp, proxyUpgrade, readBody, redirect, send, shell } from './web.mjs'

const PORT = Number(process.env.PORT || 8080)
const ORCA_PORT = 6768
const HOME = process.env.HOME
const REGISTRY = `${HOME}/.config/orca/orca-devices.json`
const RELAY_URL = process.env.RELAY_URL?.replace(/\/$/, '')
const PAIRING_ADDRESS = process.env.ORCA_PAIRING_ADDRESS || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
const gate = passwordGate({ password: process.env.ORCA_PASSWORD, basePath: '/control', title: 'Orca server' })

// ---- orca serve supervision -------------------------------------------------------------
let orca = null, ready = null, stopping = false, onExit = null
function startOrca() {
  ready = null
  const args = ['serve', '--port', String(ORCA_PORT), '--json', ...(PAIRING_ADDRESS ? ['--pairing-address', PAIRING_ADDRESS] : [])]
  // Agents run inside Orca's terminals: keep the control password out of their environment.
  const { ORCA_PASSWORD: _secret, ...env } = process.env
  orca = spawn('/opt/orca/squashfs-root/AppRun', args, { stdio: ['ignore', 'pipe', 'inherit'], env })
  // The ready line carries the pairing credential: keep it out of the logs.
  createInterface({ input: orca.stdout }).on('line', (line) => {
    if (line.startsWith('{') && line.includes('"orca_server_ready"')) {
      try { ready = JSON.parse(line) } catch {}
      console.log('[control] Orca server ready. Pairing links are on /control, not in these logs.')
      return
    }
    console.log(line)
  })
  orca.on('exit', (code) => {
    orca = null
    console.log(`[control] orca serve exited (${code})`)
    const cb = onExit
    onExit = null
    if (cb) cb()
    else if (!stopping) setTimeout(startOrca, 2000)
  })
}
// Stop Orca, run fn while it is down (registry edits must not race its own writes), start again.
function withOrcaStopped(fn) {
  return new Promise((resolve) => {
    const run = () => { try { fn() } finally { startOrca(); resolve() } }
    if (!orca) return run()
    onExit = run
    orca.kill('SIGTERM')
  })
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; orca?.kill(sig); setTimeout(() => process.exit(0), 5000).unref() })

// ---- device registry ---------------------------------------------------------------------
const readDevices = () => { try { return JSON.parse(readFileSync(REGISTRY, 'utf8')) } catch { return [] } }
function removeDevice(deviceId) {
  if (!existsSync(REGISTRY)) return
  writeFileSync(REGISTRY, JSON.stringify(readDevices().filter((d) => d.deviceId !== deviceId)), { mode: 0o600 })
}
const qrSvg = (text) => execFileSync('qrencode', ['-t', 'SVG', '-m', '0', '-o', '-', text], { encoding: 'utf8' })

// ---- page --------------------------------------------------------------------------------
function page(notice) {
  const p = ready?.pairing
  const current = p?.available ? p : null
  const devices = readDevices().sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
  const access = !ready
    ? '<div class="card"><h2>Starting Orca…</h2><p class="mut">This takes about 20 seconds. <a href="/control">Refresh</a>.</p></div>'
    : !current
      ? `<div class="card"><h2>No pairing link</h2><p class="err">${esc(p?.guidance ?? p?.reason ?? 'Orca did not create a pairing offer.')}</p></div>`
      : `<div class="card"><h2>Open Orca</h2>
<div class="row" style="align-items:flex-start;gap:24px">
<div class="qr" title="Scan with the Orca mobile app: Pair Desktop">${qrSvg(current.url)}</div>
<div style="flex:1;min-width:260px">
<p><b>Any browser</b> (laptop, phone, tablet): open this link. It signs that browser in.</p>
<pre id="web">${esc(current.webClientUrl)}</pre>
<div class="row"><a href="${esc(current.webClientUrl)}" target="_blank"><button>Open Orca</button></a><button class="ghost" onclick="copyText('web',this)">Copy link</button></div>
<p style="margin-top:18px"><b>Orca desktop or mobile app</b>: scan the QR code, or paste this pairing code.</p>
<pre id="code">${esc(current.url)}</pre><button class="ghost" onclick="copyText('code',this)">Copy pairing code</button>
<p class="mut">Both carry a credential. Anyone holding them can use this server, so share them only with your own devices.</p>
</div></div></div>`
  const rows = devices.length ? `<table><tr><th>Link</th><th>Created</th><th>Last used</th><th></th></tr>${devices.map((d) => `<tr>
<td>${esc(d.name)}${d.deviceId === current?.deviceId ? ' <span class="ok">current</span>' : ''}<div class="mut">${esc(d.scope)} access</div></td>
<td>${esc(ago(d.pairedAt))}</td><td>${esc(ago(d.lastSeenAt))}</td>
<td><form class="inline" method="post" action="/control/revoke"><input type="hidden" name="id" value="${esc(d.deviceId)}"><button class="danger">Revoke</button></form></td></tr>`).join('')}</table>`
    : '<p class="mut">Nothing paired yet.</p>'
  return shell('Orca server', `<nav><div><h1>Orca server</h1><p class="sub" style="margin:0">${esc(PAIRING_ADDRESS)}</p></div>
<div class="row">${RELAY_URL ? `<a href="${esc(RELAY_URL)}/admin">Relay admin</a>` : ''}<a href="/control/logout">Sign out</a></div></nav>
${notice ? `<div class="card ok">${esc(notice)}</div>` : ''}
${access}
<div class="card"><h2>Pairing links</h2><p class="mut">Every device that used a link shares that link's entry. Revoking one disconnects those devices and restarts Orca for a few seconds; agents keep running.</p>${rows}
<form method="post" action="/control/rotate" style="margin-top:12px"><button class="ghost">New link (revokes the current one)</button></form></div>
${RELAY_URL ? `<div class="card"><h2>Your own computers</h2><p class="mut">This server needs no relay: every device reaches it directly. The relay is for Orca running on computers you own, so your phone reaches them from anywhere. Setup commands are on the <a href="${esc(RELAY_URL)}/admin">relay admin page</a>.</p></div>` : ''}`)
}

// ---- routing -----------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (url.pathname === '/control/health') return send(res, ready ? 200 : 503, ready ? 'ok' : 'starting', 'text/plain')
    if (url.pathname === '/control' || url.pathname.startsWith('/control/')) {
      if (await gate.handle(req, res, url)) return
      if (req.method === 'POST') {
        const id = new URLSearchParams(await readBody(req)).get('id')
        const action = url.pathname.slice('/control/'.length)
        if (action === 'rotate' && ready?.pairing?.deviceId) await withOrcaStopped(() => removeDevice(ready.pairing.deviceId))
        else if (action === 'revoke' && id) await withOrcaStopped(() => removeDevice(id))
        return redirect(res, `/control?done=${action}`)
      }
      const done = { rotate: 'New link created. The old one no longer works.', revoke: 'Revoked. Devices using that link are disconnected.' }[url.searchParams.get('done')]
      return send(res, 200, page(done))
    }
    return proxyHttp(req, res, ORCA_PORT)
  } catch (error) {
    console.error('[control]', error.message)
    if (!res.headersSent) send(res, 500, 'error', 'text/plain')
  }
})
server.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, ORCA_PORT))
server.listen(PORT, '::', () => { console.log(`[control] listening on ${PORT}`); startOrca() })
