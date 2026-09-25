# Orca remote runtime (`orca serve`) for Railway.
# Upstream ships only desktop packages, no server image, so this wraps the
# official Linux AppImage exactly as docs/reference/headless-linux-server.md
# prescribes: extracted (no FUSE in containers), Electron libs + Xvfb, non-root.
FROM node:22-bookworm-slim AS node

FROM ubuntu:24.04
ARG ORCA_VERSION=1.4.210
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive

# Package list is the upstream Ubuntu 24.04 (t64) list, plus the tools agents
# expect in a dev box: git, gh (Orca shows PRs, issues and checks through it;
# without it the UI warns "GitHub CLI is not installed"), ssh, build-essential,
# ripgrep, python3.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl file jq xvfb xauth ca-certificates git gh openssh-client \
      libgtk-3-0t64 libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libgbm1 libasound2t64 \
      libxtst6 libcups2t64 libdrm2 libxkbcommon0 libpango-1.0-0 libcairo2 libatspi2.0-0t64 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxrender1 libx11-xcb1 \
      libxcb-dri3-0 libxss1 \
      build-essential python3 ripgrep less nano procps tini qrencode \
    && rm -rf /var/lib/apt/lists/*

# Node 22 for the npm-distributed agent CLIs (glibc build, copied whole).
COPY --from=node /usr/local /usr/local

RUN set -eux; \
    case "$TARGETARCH" in arm64) asset=orca-linux-arm64.AppImage ;; *) asset=orca-linux.AppImage ;; esac; \
    mkdir -p /opt/orca && cd /opt/orca; \
    curl -fsSL -o orca.AppImage "https://github.com/stablyai/orca/releases/download/v${ORCA_VERSION}/${asset}"; \
    chmod +x orca.AppImage && ./orca.AppImage --appimage-extract >/dev/null && rm orca.AppImage; \
    chmod -R a+rX squashfs-root; \
    echo "$ORCA_VERSION" > /opt/orca/VERSION

# Preinstalled agents. Users can `npm i -g` newer ones; the prefix below lives
# on the volume and comes first on PATH, so updates survive redeploys.
RUN npm install -g @anthropic-ai/claude-code @openai/codex @earendil-works/pi-coding-agent && npm cache clean --force

RUN useradd --create-home --shell /bin/bash orca
COPY orca-boot orca-seed /usr/local/bin/
# Control page + proxy, used when ORCA_PASSWORD is set (the w/ Relay template).
COPY common/web.mjs control/control.mjs /opt/orca-control/
# Orca's clone dialog suggests /home/user/projects; make that path land on the volume.
RUN mkdir -p /home/user && ln -s /data/home/projects /home/user/projects

ENV LIBGL_ALWAYS_SOFTWARE=1 \
    PORT=6768 \
    ORCA_HOME=/data/home
EXPOSE 6768
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/orca-boot"]
