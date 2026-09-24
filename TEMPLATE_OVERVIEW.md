# Deploy and Host Orca on Railway

Orca is an open-source agent development environment (ADE) from Stably. It runs Claude Code, Codex, Gemini, OpenCode and other CLI coding agents in parallel, each in its own git worktree, with terminals, diff review and source control in one app. This template runs Orca's remote runtime (`orca serve`) on Railway, so your agents keep working when your laptop is closed and you can drive them from a browser, the Orca desktop app, or the Orca mobile app.

## About Hosting Orca

Orca ships as a desktop app, and its headless mode needs Electron's system libraries, a virtual X display and a non-root user. This template packages all of that into a prebuilt image, so a deploy is a pull and a roughly 20 second boot, with no source build.

The image includes:

- Orca 1.4.210, extracted from the official Linux AppImage
- Claude Code and OpenAI Codex CLIs, preinstalled
- Node.js 22, git, the GitHub CLI (`gh`), build-essential, Python 3 and ripgrep
- A persistent volume at `/data`: your projects, worktrees, agent logins and Orca settings survive redeploys

Access is protected by Orca's own pairing: a client needs the server's pairing credential (a device token plus an end-to-end encryption key). Anyone else who opens your URL only sees a "Connect to Orca" screen.

## Common Use Cases

- Keep long-running Claude Code or Codex sessions going on a server instead of a laptop
- Run several agents in parallel on isolated worktrees of the same repo
- Check on and steer your agents from a phone or any browser
- Give a thin laptop or tablet a full Linux dev box with agents ready to go

## Dependencies for Orca Hosting

- A Railway volume (included) for projects and state
- Your own agent subscriptions or API keys (Claude, ChatGPT/Codex, and so on). Nothing is billed through this template.

### Deployment Dependencies

- Orca: https://github.com/stablyai/orca
- Headless server guide: https://github.com/stablyai/orca/blob/main/docs/reference/headless-linux-server.md
- Image source: https://github.com/hmseeb/orca-railway

### Implementation Details

**1. Get your pairing link.** After the deploy turns green, open the service's **Deploy Logs**. Near the end of the boot output you will find:

```
Orca server ready
Advertised endpoint: wss://<your-app>.up.railway.app
Web client URL: https://<your-app>.up.railway.app/web-index.html#pairing=...
Pairing URL: orca://pair?code=...
```

Treat both links like a password. They carry the credential for your server.

**2. Connect.** Pick any of these:

- **Browser:** open the full **Web client URL**. You get the whole Orca interface, already paired.
- **Desktop app:** in Orca, add a remote runtime and paste the **Pairing URL**.
- **Mobile app:** pair with the same **Pairing URL**.

**3. Start working.** Click **Add project**, then **Clone from URL** (a good location is `/data/home/projects`) or create a new project. Open a terminal in the worktree and log in to your agents once, for example `claude` or `codex login`. Logins are stored on the volume.

**Private repos:** run `gh auth login` in an Orca terminal, or add an SSH key under `~/.ssh` (home is `/data/home`).

**Installing more agents:** `npm install -g <package>` works without sudo and installs onto the volume, so it survives redeploys. For example `npm i -g @google/gemini-cli opencode-ai`. Newer versions of Claude Code or Codex installed this way take precedence over the preinstalled ones.

**Variables:**

- `PORT` (default `6768`): the port Orca listens on. Leave it; it matches the domain's target port.
- `ORCA_PAIRING_ADDRESS` (optional): the address clients dial. Leave empty to use the Railway domain. If you add a custom domain, set it to `https://your.domain` and redeploy so new pairing links point there.

**Expected boot noise:** the logs show `dbus` connection errors and an `opencode-binder ... SQLite database does not exist` stack trace on every boot. Both are harmless in a headless container.

**Troubleshooting:**

- *Client cannot connect:* make sure you used the link from the most recent boot, and that `Advertised endpoint` shows `wss://` and your current domain. After changing domains, set `ORCA_PAIRING_ADDRESS` and redeploy.
- *Lost the link:* redeploy the service; the ready block prints again. Already-paired clients keep working across restarts.
- *"GitHub CLI" features empty:* run `gh auth login` in an Orca terminal.

**Resources and scaling:** Orca is an Electron app and each agent is a separate process. Plan for about 1 GB of RAM for Orca itself plus what your agents and builds use. This is a single-user, single-instance service; do not add replicas.

**Upgrading:** each image tag pins an Orca release. Point the service at a newer `ghcr.io/hmseeb/orca-railway` tag to upgrade; your volume carries over.

## Why Deploy Orca on Railway?

Railway is a singular platform to deploy your infrastructure stack. Railway will host your infrastructure so you don't have to deal with configuration, while allowing you to vertically and horizontally scale it.

By deploying Orca on Railway, you are one step closer to supporting a complete full-stack application with minimal burden. Host your servers, databases, AI agents, and more on Railway.
