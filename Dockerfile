FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Install Playwright and Chromium
RUN npx playwright install --with-deps chromium

WORKDIR /app

# Copy package files and install deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build backend
RUN pnpm build

# Build admin frontend
RUN cd web && pnpm install --frozen-lockfile && pnpm build

# Rewrite SSH git URLs to HTTPS and configure token auth
RUN git config --global url."https://github.com/".insteadOf "git@github.com:" \
    && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'

# All persistent data under /data (single Railway volume)
# /data/db/       — SQLite database
# /data/repos/    — Cloned git repositories
# /data/claude/   — Claude CLI auth tokens
RUN mkdir -p /data/db /data/repos /data/claude

ENV DB_PATH=/data/db/task-runner.db
ENV WORK_DIR=/data/repos

EXPOSE 3000

# Symlink Claude auth dir so the CLI finds it at ~/.claude
CMD ln -sfn /data/claude /root/.claude && exec node dist/index.js
