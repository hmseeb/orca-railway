// Relay service front process. One public port serves three things:
//   /admin                 password-protected console (machines, block, sign everyone out)
//   /v1/desktop/auth/*     single-user stand-in for Orca Cloud sign-in (what the desktop app calls)
//   /.well-known/jwks.json keys the relay verifies relay tokens with
//   everything else        proxied (HTTP + WebSocket) to upstream's relay on a loopback port
// Contract sources in stablyai/orca: src/main/orca-profiles/profile-cloud-client.ts (desktop)
// and cloud/apps/relay/src/relay-token-verifier.ts (relay).
import { spawn } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { ago, esc, passwordGate, proxyHttp, proxyUpgrade, readBody, redirect, send, shell } from './web.mjs'

const PORT = Number(process.env.PORT || 8080)
const RELAY_PORT = 8081
const DATA = process.env.ORCA_RELAY_DATA_DIR || '/data/relay'
const AUTH_DIR = process.env.AUTH_DATA_DIR || '/data/auth'
const PASSWORD = process.env.ORCA_PASSWORD
const ORIGIN = (process.env.PUBLIC_ORIGIN || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`).replace(/\/$/, '')
const ORCA_URL = process.env.ORCA_URL?.replace(/\/$/, '')
if (!process.env.PUBLIC_ORIGIN && !process.env.RAILWAY_PUBLIC_DOMAIN) throw new Error('RAILWAY_PUBLIC_DOMAIN is not set: add a public domain to this service')
mkdirSync(AUTH_DIR, { recursive: true })
mkdirSync(DATA, { recursive: true })

// ---- persistent state (volume) -------------------------------------------------
const file = (n) => `${AUTH_DIR}/${n}`
const writeAtomic = (path, data) => { writeFileSync(`${path}.tmp`, data, { mode: 0o600 }); renameSync(`${path}.tmp`, path) }
function readOrCreate(name, make) {
  if (!existsSync(file(name))) writeAtomic(file(name), make())
  return readFileSync(file(name), 'utf8')
}
const newSigningKey = () => generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' })
const ASSIGNMENT_KEY = readOrCreate('assignment-key', () => randomBytes(32).toString('hex')).trim()
let key
function loadKey() {
  const priv = createPrivateKey(readOrCreate('signing-key.pem', newSigningKey))
  const pub = createPublicKey(priv)
  const kid = createHash('sha256').update(pub.export({ type: 'spki', format: 'der' })).digest('base64url').slice(0, 16)
  key = { priv, pub, kid, jwks: { keys: [{ ...pub.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }] } }
}
loadKey()
let hosts = existsSync(file('hosts.json')) ? JSON.parse(readFileSync(file('hosts.json'), 'utf8')) : {}
const saveHosts = () => writeAtomic(file('hosts.json'), JSON.stringify(hosts, null, 1))

// ---- tokens ------------------------------------------------------------------------
const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
function signJwt(claims, ttlSec) {
  const now = Math.floor(Date.now() / 1000)
  const body = `${b64u({ alg: 'ES256', typ: 'JWT', kid: key.kid })}.${b64u({ iss: ORIGIN, iat: now, exp: now + ttlSec, ...claims })}`
  return `${body}.${sign('sha256', Buffer.from(body), { key: key.priv, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}
function verifyJwt(token, typ) {
  const [h, p, s] = String(token ?? '').split('.')
  if (!s) return null
  if (!verify('sha256', Buffer.from(`${h}.${p}`), { key: key.pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))) return null
  const claims = JSON.parse(Buffer.from(p, 'base64url'))
  return claims.typ === typ && claims.iss === ORIGIN && claims.exp * 1000 > Date.now() ? claims : null
}
const ACCESS_TTL = 60 * 60, REFRESH_TTL = 90 * 24 * 60 * 60, RELAY_TTL = 15 * 60
const ORG = { orgId: 'personal', name: 'Personal', role: 'Owner' }
// Only relay.use: share/team would call Orca Cloud APIs this service does not implement.
const account = () => ({
  cloud: { cloudProfileId: 'owner', userId: 'owner', email: 'owner@orca.relay', displayName: 'Relay owner',
    activeOrgId: ORG.orgId, activeOrgName: ORG.name, linkedAt: Date.now() },
  organizations: [ORG], capabilities: { flags: { 'relay.use': true }, refreshedAt: Date.now() }
})
const session = () => ({
  accessToken: signJwt({ sub: 'owner', typ: 'access' }, ACCESS_TTL),
  refreshToken: signJwt({ sub: 'owner', typ: 'refresh', jti: randomBytes(12).toString('base64url') }, REFRESH_TTL),
  expiresAt: Date.now() + ACCESS_TTL * 1000,
  ...account()
})

// ---- upstream relay (child process, restartable) ---------------------------------------
let relay, stopping = false
function startRelay() {
  relay = spawn(process.execPath, ['apps/relay/dist/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env, PORT: String(RELAY_PORT), NODE_ENV: 'production', ORCA_RELAY_DATA_DIR: DATA,
      ORCA_RELAY_PUBLIC_URL: ORIGIN, ORCA_RELAY_CELL_URL: ORIGIN, ORCA_RELAY_AUTH_ISSUER: ORIGIN,
      ORCA_RELAY_JWKS_URL: `http://127.0.0.1:${PORT}/.well-known/jwks.json`,
      ORCA_RELAY_ASSIGNMENT_SIGNING_KEY: ASSIGNMENT_KEY,
      // Admin routes verify Google-issued identity tokens for these; placeholders make them unusable.
      ORCA_RELAY_ADMIN_AUDIENCE: 'https://admin.invalid', ORCA_RELAY_DEPLOY_SERVICE_ACCOUNT: 'nobody@invalid.example'
    }
  })
  relay.on('exit', (code) => {
    console.log(`[front] relay exited (${code})`)
    if (!stopping) setTimeout(startRelay, 1000)
  })
}
const restartRelay = () => relay?.kill('SIGTERM')
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; relay?.kill(sig); process.exit(0) })

// ---- desktop sign-in ---------------------------------------------------------------
const codes = new Map()
const LOOPBACK_CALLBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}\/auth\/callback$/
let lastAuthFailure = 0
const digest = (v) => createHash('sha256').update(String(v ?? '')).digest()
const passwordOk = (v) => digest(v).equals(digest(PASSWORD))
const bearer = (req) => /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]

function authorizePage(params, error) {
  const hidden = [...params].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')
  return shell('Orca relay sign-in', `<form method="post" class="card narrow">${hidden}<h1>Connect this computer</h1>
<p class="mut">Enter the password you chose when deploying.</p>${error ? `<p class="err">${esc(error)}</p>` : ''}
<input type="password" name="password" placeholder="Password" autofocus required><button>Sign in</button></form>`)
}

async function handleAuth(req, res, url) {
  const path = url.pathname
  if (path === '/v1/desktop/auth/authorize') {
    const params = req.method === 'POST' ? new URLSearchParams(await readBody(req)) : url.searchParams
    const redirectUri = params.get('redirect_uri') ?? ''
    // Only the desktop's own loopback listener may receive a code.
    if (params.get('response_type') !== 'code' || !LOOPBACK_CALLBACK.test(redirectUri) ||
        params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge') || !params.get('state')) {
      return send(res, 400, 'Invalid sign-in request.', 'text/plain')
    }
    if (req.method !== 'POST') return send(res, 200, authorizePage(params))
    const password = params.get('password')
    params.delete('password')
    if (Date.now() - lastAuthFailure < 2000 || !passwordOk(password)) {
      lastAuthFailure = Date.now()
      return send(res, 401, authorizePage(params, 'Wrong password.'))
    }
    const code = randomBytes(32).toString('base64url')
    codes.set(code, { challenge: params.get('code_challenge'), redirectUri, exp: Date.now() + 5 * 60_000 })
    const to = new URL(redirectUri)
    to.searchParams.set('code', code)
    to.searchParams.set('state', params.get('state'))
    return redirect(res, to.toString())
  }
  if (req.method !== 'POST') return send(res, 404, '{"error":"not_found"}', 'application/json')
  const json = (status, body) => send(res, status, JSON.stringify(body), 'application/json')
  const body = JSON.parse((await readBody(req)) || '{}')
  const op = path.slice('/v1/desktop/auth/'.length)
  if (op === 'session') {
    const entry = codes.get(body.code)
    codes.delete(body.code)
    const challenge = createHash('sha256').update(String(body.codeVerifier ?? '')).digest('base64url')
    if (!entry || entry.exp < Date.now() || entry.redirectUri !== body.redirectUri || entry.challenge !== challenge) {
      return json(400, { error: 'invalid_grant' })
    }
    return json(200, session())
  }
  if (op === 'refresh') return verifyJwt(body.refreshToken, 'refresh') ? json(200, session()) : json(401, { error: 'invalid_grant' })
  if (op === 'logout') return json(200, {})
  if (!verifyJwt(bearer(req), 'access')) return json(401, { error: 'unauthorized' })
  if (op === 'capabilities' || op === 'org') return json(200, account())
  if (op === 'profile') return json(200, session())
  if (op === 'relay-token') {
    const pub = Buffer.from(String(body.hostPublicKeyB64 ?? ''), 'base64')
    const relayHostId = String(body.relayHostId ?? '')
    if (pub.length !== 32 || createHash('sha256').update(pub).digest('base64url').slice(0, 16) !== relayHostId) {
      return json(400, { error: 'invalid_host' })
    }
    const host = (hosts[relayHostId] ??= { firstSeen: Date.now(), label: '' })
    if (host.blocked) return json(403, { error: 'host_blocked' })
    host.lastToken = Date.now()
    saveHosts()
    return json(200, {
      relayToken: signJwt({ sub: 'owner', prof: 'owner', org: ORG.orgId, aud: 'orca-relay', purpose: 'host-control', relayHostId }, RELAY_TTL),
      expiresAt: Date.now() + RELAY_TTL * 1000
    })
  }
  return json(404, { error: 'not_found' })
}

// ---- admin console -----------------------------------------------------------------
const gate = passwordGate({ password: PASSWORD, basePath: '/admin', title: 'Orca relay' })

function relayView() {
  const view = new Map()
  const dbPath = `${DATA}/orca-relay.sqlite`
  if (existsSync(dbPath)) {
    let db
    try {
      db = new DatabaseSync(dbPath, { readOnly: true })
      for (const r of db.prepare('SELECT relay_host_id, last_activity_at FROM relay_assignments').all()) {
        view.set(r.relay_host_id, { lastActivity: Number(r.last_activity_at), phones: 0 })
      }
      for (const r of db.prepare('SELECT relay_host_id, COUNT(*) n FROM relay_devices WHERE revoked_at IS NULL GROUP BY relay_host_id').all()) {
        view.set(r.relay_host_id, { ...(view.get(r.relay_host_id) ?? {}), phones: Number(r.n) })
      }
    } catch (error) {
      console.error('[front] relay db read failed:', error.message)
    } finally {
      db?.close()
    }
  }
  return view
}

function connectInstructions() {
  const vars = { ORCA_CLOUD_API_URL: ORIGIN, ORCA_CLOUD_CLIENT_ID: 'orca-desktop', ORCA_RELAY_URL: ORIGIN }
  const mac = `osascript -e 'quit app "Orca"'; sleep 2\n` +
    Object.entries(vars).map(([k, v]) => `launchctl setenv ${k} ${v}`).join('\n') +
    `\nopen -a Orca --env ${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(' --env ')}`
  const linux = `${Object.entries(vars).map(([k, v]) => `export ${k}=${v}`).join('\n')}\n# then start Orca from this shell, for example:\n/opt/Orca/orca-ide   # or your AppImage path`
  const win = `${Object.entries(vars).map(([k, v]) => `setx ${k} "${v}"`).join('\n')}\n# then quit Orca completely and start it again`
  const block = (id, label, text) => `<details${id === 'mac' ? ' open' : ''}><summary>${label}</summary>
<pre id="cmd-${id}">${esc(text)}</pre><button class="ghost" onclick="copyText('cmd-${id}',this)">Copy</button></details>`
  return `<div class="card"><h2>Connect a computer</h2>
<p class="mut">Run on the computer whose Orca you want to reach from your phone. Then in Orca open <b>Orca Mobile</b>, choose <b>Orca Relay</b>, click <b>Sign in for Relay</b> and enter this deployment's password. Pair your phone with the QR code Orca shows.</p>
${block('mac', 'macOS (launchctl lasts until reboot; rerun after restarting the Mac)', mac)}
${block('linux', 'Linux', linux)}
${block('win', 'Windows (PowerShell, persistent)', win)}</div>`
}

function adminPage(notice) {
  const view = relayView()
  const ids = new Set([...Object.keys(hosts), ...view.keys()])
  const rows = [...ids].map((id) => {
    const h = hosts[id] ?? {}, v = view.get(id) ?? {}
    const lastActive = Math.max(v.lastActivity ?? 0, h.lastToken ?? 0)
    return { id, h, v, lastActive }
  }).sort((a, b) => b.lastActive - a.lastActive)
  const table = rows.length ? `<table><tr><th>Computer</th><th>Last active</th><th>Phones</th><th></th></tr>${rows.map(({ id, h, v, lastActive }) => `<tr>
<td><form class="inline row" method="post" action="/admin/label"><input type="hidden" name="id" value="${esc(id)}">
<input name="label" value="${esc(h.label)}" placeholder="Name it" style="width:160px"><button class="ghost">Save</button></form>
<div class="mut"><code>${esc(id)}</code>${h.blocked ? ' <span class="err">blocked</span>' : ''}</div></td>
<td>${esc(ago(lastActive))}</td><td>${v.phones ?? 0}</td>
<td><form class="inline" method="post" action="/admin/${h.blocked ? 'unblock' : 'block'}"><input type="hidden" name="id" value="${esc(id)}">
<button class="${h.blocked ? 'ghost' : 'danger'}">${h.blocked ? 'Unblock' : 'Disconnect and block'}</button></form></td></tr>`).join('')}</table>`
    : '<p class="mut">No computers have connected yet.</p>'
  return shell('Orca relay', `<nav><div><h1>Orca relay</h1><p class="sub" style="margin:0">${esc(ORIGIN)}</p></div>
<div class="row">${ORCA_URL ? `<a href="${esc(ORCA_URL)}/control">Orca control panel</a>` : ''}<a href="/admin/logout">Sign out</a></div></nav>
${notice ? `<div class="card ok">${esc(notice)}</div>` : ''}
<div class="card"><h2>Connected computers</h2>${table}</div>
${connectInstructions()}
<div class="card"><h2>Sign every computer out</h2><p class="mut">Rotates the signing key. Every computer has to click Sign in for Relay again. Paired phones keep working once their computer is back.</p>
<form method="post" action="/admin/rotate"><button class="danger">Sign everyone out</button></form></div>`)
}

async function handleAdmin(req, res, url) {
  if (await gate.handle(req, res, url)) return
  if (req.method === 'POST') {
    const form = new URLSearchParams(await readBody(req))
    const id = form.get('id') ?? ''
    const action = url.pathname.slice('/admin/'.length)
    if (action === 'label' && id) { (hosts[id] ??= { firstSeen: Date.now() }).label = (form.get('label') ?? '').slice(0, 60); saveHosts() }
    else if (action === 'block' && id) { (hosts[id] ??= { firstSeen: Date.now() }).blocked = true; saveHosts(); restartRelay() }
    else if (action === 'unblock' && id) { if (hosts[id]) hosts[id].blocked = false; saveHosts() }
    else if (action === 'rotate') { writeAtomic(file('signing-key.pem'), newSigningKey()); loadKey(); restartRelay() }
    return redirect(res, `/admin?done=${encodeURIComponent(action)}`)
  }
  const done = { block: 'Computer disconnected and blocked.', unblock: 'Computer unblocked.', rotate: 'Everyone signed out.', label: 'Saved.' }[url.searchParams.get('done')]
  return send(res, 200, adminPage(done))
}

// ---- routing -------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  try {
    if (url.pathname === '/') return redirect(res, '/admin')
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return await handleAdmin(req, res, url)
    if (url.pathname === '/.well-known/jwks.json') return send(res, 200, JSON.stringify(key.jwks), 'application/json')
    if (url.pathname.startsWith('/v1/desktop/auth/')) return await handleAuth(req, res, url)
    return proxyHttp(req, res, RELAY_PORT)
  } catch (error) {
    console.error('[front]', error.message)
    if (!res.headersSent) send(res, 400, JSON.stringify({ error: 'bad_request' }), 'application/json')
  }
})
server.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, RELAY_PORT))
server.listen(PORT, '::', () => {
  console.log(`[front] listening on ${PORT}, origin ${ORIGIN}`)
  startRelay()
})
