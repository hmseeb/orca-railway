# Deploy and Host Orca ADE (w/ Relay) on Railway

Orca is an open-source agent development environment (ADE) from Stably. It runs Claude Code, Codex, Pi and other CLI coding agents in parallel, each in its own git worktree, with terminals, diff review and source control in one app. This template gives you two things: an Orca server on Railway that you can use from any device, and your own Orca relay, so your phone can also reach Orca running on computers you own, from anywhere.

## About Hosting Orca ADE (w/ Relay)

The template deploys two services that share one password.

**orca: your Orca server.** Orca runs headless on Railway with your projects, worktrees and agents on a persistent volume, so work continues while every device is off. Open it from any browser, or from the Orca desktop and mobile apps. A password-protected control page at `/control` gives you the sign-in link, a QR code, and the list of signed-in devices.

**relay: your own Orca relay.** When Orca runs on a laptop or desktop at home, your phone normally cannot reach it from outside that network. Orca solves this with a relay that both sides connect out to. This service runs Orca's open-source relay together with a small single-user sign-in, so you use your relay instead of Orca Cloud. The admin page at `/admin` lists connected computers, disconnects them, and gives you the setup commands.

The Railway server does not use the relay. It already has a public address, so every device reaches it directly.

## Common Use Cases

- Run Claude Code, Codex and Pi sessions on a server that never sleeps, and check on them from a phone
- Use one Orca workspace from a laptop, a tablet and a phone
- Reach Orca on your home or office computer from your phone over mobile data, through a relay you control
- Keep agent work and repositories off your laptop

## Dependencies for Orca ADE (w/ Relay) Hosting

- Two Railway volumes (included): projects and Orca state; relay state and keys
- Your own agent subscriptions or API keys. Nothing is billed through this template.

### Deployment Dependencies

- Orca: https://github.com/stablyai/orca
- Orca relay source: https://github.com/stablyai/orca/tree/main/cloud/apps/relay
- Image source: https://github.com/hmseeb/orca-railway

### Implementation Details

**1. Deploy.** The form asks for one thing: a password. It protects the control page, the relay admin page, and signing computers in to the relay. Optional fields:

- `GIT_USER_NAME` and `GIT_USER_EMAIL`: the name on commits made on the server. They default to "Orca" if left empty, so project creation works right away.
- `GH_TOKEN`: a GitHub token. If set, `gh` and `git push` work immediately. Otherwise run `gh auth login` in an Orca terminal and approve the code at github.com/login/device from any device.

**2. Open your Orca server.** Go to the orca service's URL followed by `/control` and enter your password. You get:

- **A browser link.** Open it on any device to get the full Orca interface, already signed in.
- **A QR code and pairing code** for the Orca desktop and mobile apps.
- **Signed-in devices**, each with a Revoke button. **New link** makes a fresh link without signing anyone out.

Treat the links like passwords. Pairing links never appear in the deploy logs.

**3. Start working.** A `hello-world` project is already open. Click it, open a terminal and run `claude`, `codex` or `pi` to log in once with your own subscription; logins are stored on the volume. New projects and clones go in `/data/home/projects`. Claude Code, Codex, Pi, Node.js 22, git, gh, build-essential, Python 3 and ripgrep are preinstalled, and `npm install -g` works without sudo and survives redeploys.

**4. Optional: reach your own computers.** Open the relay service's URL followed by `/admin` and sign in with the same password. Copy the command for your operating system and run it on the computer running Orca. Then, in that Orca: **Orca Mobile**, choose **Orca Relay**, click **Sign in for Relay**, enter your password, and scan the QR code with your phone. On macOS the setting lasts until reboot; rerun the command after restarting.

**What the relay can and cannot do.** It forwards end-to-end encrypted traffic between your phones and your computers; it cannot read it. It grants only relay access: Orca Cloud features such as sharing and teams are not available with it. One relay serves any number of computers. "Sign everyone out" on the admin page rotates its signing key, and each computer then signs in again.

**Troubleshooting**

- *Control page says "Starting Orca":* the first boot takes about 20 to 40 seconds. Refresh.
- *A browser link stopped working:* its row was revoked. Make a new link on `/control`.
- *A computer will not connect to the relay:* check it is not blocked on `/admin`, that Orca was started after running the setup command, and sign in for Relay again.
- *Harmless boot noise:* `dbus` errors and an `opencode-binder ... SQLite database does not exist` trace appear on every boot.

**Resources and scaling.** Orca is an Electron app and every agent is a separate process: plan for about 1 GB of RAM for Orca plus what your agents and builds use. The relay is light. Both are single-instance services; do not add replicas.

**Upgrading.** Each image tag pins an Orca release. Point both services at a newer `ghcr.io/hmseeb/orca-railway` and `orca-railway-relay` tag; volumes carry over.

## Why Deploy Orca ADE (w/ Relay) on Railway?

Railway is a singular platform to deploy your infrastructure stack. Railway will host your infrastructure so you don't have to deal with configuration, while allowing you to vertically and horizontally scale it.

By deploying Orca ADE (w/ Relay) on Railway, you are one step closer to supporting a complete full-stack application with minimal burden. Host your servers, databases, AI agents, and more on Railway.
