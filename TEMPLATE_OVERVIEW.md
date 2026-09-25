# Deploy and Host Orca ADE on Railway

Orca is an open-source agent development environment (ADE) from Stably. It runs Claude Code, Codex, Pi and other CLI coding agents in parallel, each in its own git worktree, with terminals, diff review and source control in one app. This template runs Orca on Railway, so your agents keep working while every device is off, and you use it from any browser or from the Orca desktop and mobile apps.

## About Hosting Orca ADE

Orca runs headless on Railway with your projects, worktrees and agent logins on a persistent volume. A password-protected control panel, which opens when you visit the service's URL, gives you the sign-in link, a QR code for the Orca apps, and the list of signed-in devices.

Need your phone to reach Orca on a computer you own as well? Use the sibling template, Orca ADE (w/ Relay), which adds your own Orca relay.

## Common Use Cases

- Run Claude Code, Codex and Pi sessions on a server that never sleeps, and check on them from a phone
- Use one Orca workspace from a laptop, a tablet and a phone
- Keep agent work and repositories off your laptop

## Dependencies for Orca ADE Hosting

- A Railway volume (included) for projects, logins and Orca state
- Your own agent subscriptions or API keys. Nothing is billed through this template.

### Deployment Dependencies

- Orca: https://github.com/stablyai/orca
- Image source: https://github.com/hmseeb/orca-railway

### Implementation Details

**1. Deploy.** The form asks for one thing: a password. It protects your control panel. Optional fields:

- `GIT_USER_NAME` and `GIT_USER_EMAIL`: the name on commits made on the server. They default to "Orca" if left empty, so project creation works right away.
- `GH_TOKEN`: a GitHub token. If set, `gh` and `git push` work immediately. Otherwise run `gh auth login` in an Orca terminal and approve the code at github.com/login/device from any device.

**2. Open your control panel.** Click the service's URL in Railway (or add `/control` to it) and enter your password. You get:

- **A browser link.** Open it on any device to get the full Orca interface, already signed in.
- **A QR code and pairing code** for the Orca desktop and mobile apps.
- **Signed-in devices**, each with a Revoke button. **New link** makes a fresh link without signing anyone out.

Treat the links like passwords. Pairing links never appear in the deploy logs.

**3. Start working.** A `hello-world` project is already open. Click it, open a terminal and run `claude`, `codex` or `pi` to log in once with your own subscription; logins are stored on the volume. New projects and clones go in `/data/home/projects`. Claude Code, Codex, Pi, Node.js 22, git, gh, build-essential, Python 3 and ripgrep are preinstalled, and `npm install -g` works without sudo and survives redeploys.

**Troubleshooting**

- *Control page says "Starting Orca":* the first boot takes about 20 to 40 seconds. Refresh.
- *A browser link stopped working:* its row was revoked. Make a new link on `/control`.
- *Harmless boot noise:* `dbus` errors and an `opencode-binder ... SQLite database does not exist` trace appear on every boot.

**Resources and scaling.** Orca is an Electron app and every agent is a separate process: plan for about 1 GB of RAM for Orca plus what your agents and builds use. This is a single-instance service; do not add replicas.

**Upgrading.** Each image tag pins an Orca release. Point the service at a newer `ghcr.io/hmseeb/orca-railway` tag; your volume carries over.

## Why Deploy Orca ADE on Railway?

Railway is a singular platform to deploy your infrastructure stack. Railway will host your infrastructure so you don't have to deal with configuration, while allowing you to vertically and horizontally scale it.

By deploying Orca ADE on Railway, you are one step closer to supporting a complete full-stack application with minimal burden. Host your servers, databases, AI agents, and more on Railway.
