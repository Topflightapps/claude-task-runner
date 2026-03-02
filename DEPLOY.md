# Deployment Guide

## Overview

Claude Task Runner is a single Docker container that runs:
- **Backend** (Node.js) — webhook server, task executor, WebSocket for live logs
- **Admin dashboard** (Vite/React) — served as static files from the same port
- **Claude CLI** — installed globally, spawns child processes to implement tasks

All on one port (3000).

## Prerequisites

- A **Claude Max** (or Pro) subscription — the CLI authenticates via OAuth, not an API key
- A **GitHub** account with a personal access token (repo scope)
- **ClickUp** API token and workspace configured with a "Claude" user
- **Railway** account (recommended) or any Docker host with persistent volumes

## Railway Deployment

### 1. Create the project

- Push this repo to GitHub
- Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
- Railway auto-detects the Dockerfile

### 2. Add persistent volumes

In the Railway dashboard, add **three volumes** to the service:

| Mount path | Purpose |
|------------|---------|
| `/data` | SQLite database (`task-runner.db`) |
| `/repos` | Cloned git repositories (working directory) |
| `/root/.claude` | Claude CLI auth tokens (persists OAuth login) |

### 3. Set environment variables

Set these in Railway's Variables tab:

```bash
# ClickUp
CLICKUP_API_TOKEN=pk_...
CLICKUP_TEAM_ID=...
CLICKUP_CLAUDE_USER_ID=...
CLICKUP_REPO_FIELD_ID=...
WEBHOOK_SECRET=...           # HMAC secret for verifying ClickUp webhooks

# GitHub
GITHUB_TOKEN=ghp_...         # Personal access token with repo scope

# Runner config
WEBHOOK_PORT=3000
WORK_DIR=/repos
DB_PATH=/data/task-runner.db
CLAUDE_MAX_TURNS=50

# Admin dashboard (optional)
ADMIN_PASSWORD=...            # Omit to disable auth on the admin panel

# Optional
LOG_LEVEL=info                # debug, info, warn, error
FIGMA_MCP_TOKEN=...           # If tasks include Figma design URLs
GITHUB_PR_ASSIGNEE=username   # Auto-assign PRs to this GitHub user
```

> **Note:** You do NOT need `ANTHROPIC_API_KEY`. The Claude CLI uses your Max subscription via OAuth.

### 4. Set the Railway port

Railway needs to know which port your app exposes. Either:
- Set `PORT=3000` in env vars, or
- Configure it in Railway's Networking settings → expose port 3000

### 5. Deploy

Railway auto-deploys on push. First deploy will take a few minutes (Playwright + Chromium install is large).

### 6. Authenticate the Claude CLI

After the first deploy, you need to log in once:

```bash
# Install Railway CLI if you haven't
brew install railway

# Link to your project
railway link

# SSH into the running container
railway shell

# Inside the container, log in to Claude
claude login
```

This prints a URL. Open it in your browser, authenticate with your Claude Max account, and the tokens are stored in `/root/.claude/` (persisted by the volume).

You only need to do this **once** — the volume keeps the auth across redeploys.

### 7. Authenticate the GitHub CLI

The `gh` CLI reads `GITHUB_TOKEN` from the environment automatically — no interactive login needed. But if you prefer:

```bash
railway shell
gh auth login
```

### 8. Register the ClickUp webhook

Point your ClickUp webhook to:
```
https://<your-app>.up.railway.app/webhook
```

Events to subscribe to: `taskAssigneeUpdated`

### 9. Access the admin dashboard

Open your Railway public URL in a browser:
```
https://<your-app>.up.railway.app
```

This serves the Vite admin SPA with real-time task monitoring, log streaming, and queue management.

## Docker Compose (self-hosted)

If deploying on your own server:

```bash
# Build and start
docker compose up --build -d

# First-time Claude auth
docker compose exec runner claude login

# First-time GitHub auth (if not using GITHUB_TOKEN env var)
docker compose exec runner gh auth login
```

The `docker-compose.yml` mounts three volumes:
- `runner-data` → `/data` (SQLite)
- `runner-repos` → `/repos` (cloned repos)
- `claude-auth` → `/root/.claude` (Claude OAuth tokens)

## How Auth Works

### Claude CLI (Max subscription)
- Uses OAuth, not API keys
- Tokens stored in `/root/.claude/.credentials.json` and `/root/.claude.json`
- Volume mount persists tokens across container restarts/redeploys
- Tokens auto-refresh — you should rarely need to re-login
- If child Claude processes fail with auth errors, SSH in and run `claude login` again

### GitHub CLI
- Reads `GITHUB_TOKEN` from environment automatically
- Used for `gh pr create` and `gh auth status`
- No interactive login needed if the env var is set

### ClickUp
- Uses `CLICKUP_API_TOKEN` (personal API token) from environment
- Rate-limited to 90 req/min (below ClickUp free tier limit of 100)

## Architecture Notes

- **Single-threaded queue** — one task runs at a time (sequential processing)
- **No horizontal scaling** — SQLite is the database, local to the container
- **Long-running processes** — Ralph loops can run up to 60 minutes; Railway handles this fine (no request timeouts on workers)
- The webhook responds 200 immediately, then processes async — ClickUp requires < 7s response

## Troubleshooting

### Claude CLI auth expired
```bash
railway shell   # or: docker compose exec runner bash
claude login
```

### Task stuck in "running_claude" after restart
On startup, the app automatically marks all in-progress runs as `failed` with "Process restarted". This prevents orphaned runs.

### Webhook not firing
- Verify the webhook URL is correct in ClickUp settings
- Check that `WEBHOOK_SECRET` matches what ClickUp has
- Hit `/health` to confirm the server is up: `curl https://<your-app>.up.railway.app/health`

### Admin dashboard not loading
- Ensure the Vite frontend was built during Docker build (`web/dist/` must exist)
- Check logs for the static file serving path
