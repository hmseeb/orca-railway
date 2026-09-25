// Contract test for the relay service, run INSIDE the relay image (it carries
// ws/tweetnacl/relay-contract for upstream's smoke). Drives what the Orca
// desktop does: PKCE sign-in, relay token, then upstream's host+phone splice
// smoke; then the admin console: login, machine listing, block, sign-out-all.
// Usage: node relay-check.mjs <origin> <password>
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'

const [ORIGIN, PW] = process.argv.slice(2)
const ok = (cond, msg) => { if (!cond) { console.error(`FAIL ${msg}`); process.exit(1) } console.log(`ok   ${msg}`) }
const CB = 'http://127.0.0.1:5555/auth/callback'
const post = (path, body, token) => fetch(`${ORIGIN}${path}`, { method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } })

async function signIn(password = PW) {
  const ver = randomBytes(32).toString('base64url')
  const q = new URLSearchParams({ response_type: 'code', client_id: 'orca-desktop', redirect_uri: CB, state: 's',
    code_challenge_method: 'S256', code_challenge: createHash('sha256').update(ver).digest('base64url') })
  const r = await fetch(`${ORIGIN}/v1/desktop/auth/authorize`, { method: 'POST', body: new URLSearchParams({ ...Object.fromEntries(q), password }), redirect: 'manual' })
  if (r.status !== 303 && r.status !== 302) return { status: r.status }
  const code = new URL(r.headers.get('location')).searchParams.get('code')
  const s = await (await post('/v1/desktop/auth/session', { code, codeVerifier: ver, redirectUri: CB })).json()
  return { status: r.status, s }
}

// --- sign-in contract ---
const page = await fetch(`${ORIGIN}/v1/desktop/auth/authorize?response_type=code&redirect_uri=${encodeURIComponent(CB)}&code_challenge=x&code_challenge_method=S256&state=s`)
ok((await page.text()).includes('type="password"'), 'authorize shows password page')
const evil = await fetch(`${ORIGIN}/v1/desktop/auth/authorize?response_type=code&redirect_uri=https://evil.example/cb&code_challenge=x&code_challenge_method=S256&state=s`)
ok(evil.status === 400, 'non-loopback redirect rejected')
ok((await signIn('wrong')).status === 401, 'wrong password rejected')
await new Promise((r) => setTimeout(r, 2100))
const { s } = await signIn()
ok(s?.capabilities?.flags?.['relay.use'] === true, 'session grants relay.use')
ok((await post('/v1/desktop/auth/refresh', { refreshToken: s.refreshToken })).ok, 'refresh works')
ok((await post('/v1/desktop/auth/relay-token', { relayHostId: 'AAAAAAAAAAAAAAAA', hostPublicKeyB64: Buffer.alloc(32).toString('base64') }, s.accessToken)).status === 400, 'mismatched host id rejected')

// --- data plane: upstream smoke (host control, invite, phone, splice) ---
const out = execFileSync(process.execPath, ['/app/dev/scripts/smoke-relay.mjs', ORIGIN], {
  env: { ...process.env, ORCA_RELAY_SMOKE_AUTH_URL: ORIGIN, ORCA_RELAY_SMOKE_ACCESS_TOKEN: s.accessToken }, encoding: 'utf8' })
ok(out.includes('relay authenticated splice smoke passed'), 'upstream splice smoke through the front proxy')

// --- admin console ---
ok((await (await fetch(`${ORIGIN}/admin`)).text()).includes('type="password"'), 'admin asks for password')
const login = await fetch(`${ORIGIN}/admin/login`, { method: 'POST', body: new URLSearchParams({ password: PW }), redirect: 'manual' })
const cookie = login.headers.get('set-cookie')?.split(';')[0]
ok(login.status === 303 && cookie, 'admin login sets session')
const admin = await (await fetch(`${ORIGIN}/admin`, { headers: { cookie } })).text()
const hostId = /<code>([A-Za-z0-9_-]{16})<\/code>/.exec(admin)?.[1]
ok(hostId && admin.includes('Connect a computer'), 'admin lists the smoke host and connect instructions')
await fetch(`${ORIGIN}/admin/block`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: `id=${hostId}`, redirect: 'manual' })
ok((await (await fetch(`${ORIGIN}/admin`, { headers: { cookie } })).text()).includes('blocked'), 'block shows in admin')
await new Promise((r) => setTimeout(r, 3000)) // relay child restarts after block
const blockedHost = await fetch(`${ORIGIN}/health`)
ok(blockedHost.ok, 'relay back up after block restart')
await fetch(`${ORIGIN}/admin/rotate`, { method: 'POST', headers: { cookie }, redirect: 'manual' })
ok((await post('/v1/desktop/auth/refresh', { refreshToken: s.refreshToken })).status === 401, 'sign-everyone-out invalidates old sessions')
console.log('PASS')
