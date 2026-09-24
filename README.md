# Orca on Railway

Railway image for [Orca](https://github.com/stablyai/orca)'s remote runtime (`orca serve`): the agent development environment for running Claude Code, Codex and other CLI agents in parallel worktrees, reachable from a browser, the Orca desktop app, or the Orca mobile app.

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/TBD)

## What is in the image

- Orca (pinned by `ARG ORCA_VERSION` in the `Dockerfile`), extracted from the official AppImage, with Xvfb and the Electron libraries from upstream's headless Linux guide
- Claude Code, Codex, Node.js 22, git, gh, build-essential, Python 3, ripgrep
- `tini` as PID 1 and `orca-boot`, which fixes volume ownership, drops to the non-root `orca` user, and advertises `https://$RAILWAY_PUBLIC_DOMAIN` as the pairing address

State lives on the volume at `/data` (`HOME=/data/home`).

## Using it

After deploying, open the service's Deploy Logs and copy the **Web client URL** (browser) or **Pairing URL** (desktop/mobile app). Both are credentials. Full guide: [TEMPLATE_OVERVIEW.md](TEMPLATE_OVERVIEW.md).

## Development

```sh
docker build -t orca-rw:local .
./test/smoke.sh orca-rw:local   # boots, checks pairing, web client, non-root, CLIs
```

Pushing to `main` builds, smoke-tests and publishes `ghcr.io/hmseeb/orca-railway:<version>` and `:latest`.

Template maintenance scripts: `build_source.py` (source project), `repair.py` (template config), `deploy_as_stranger.py`, `deploy_status.py`. Design notes and evidence: `template.json`.
