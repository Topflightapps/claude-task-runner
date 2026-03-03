# Claude Task Runner

Automated pipeline that receives ClickUp webhooks, runs Claude Code headlessly on a cloned repo, and creates GitHub PRs for review.

**Flow:** ClickUp task assigned to "Claude" user → Webhook fires → Runner clones repo → Kickoff (generates prd.json) → Ralph loop (implements stories one by one) → Creates PR → Updates ClickUp card to "in review"

Powered by the [Ralph autonomous agent loop](https://github.com/snarktank/ralph) and the [Buildwright plugin](https://github.com/jguerena15/buildwright-plugin).

Currently supports Next.js projects. Designed to run on Railway, a Linux VPS, or Docker container.

---

## Table of Contents

- [Deploy to Railway (Recommended)](#deploy-to-railway-recommended)
- [Environment Variables](#environment-variables)
- [ClickUp Setup](#clickup-setup)
- [Claude Authentication](#claude-authentication)
- [Running Locally](#running-locally)
- [Running with Docker](#running-with-docker)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Two-Phase Execution](#two-phase-execution)
- [Ralph Loop](#ralph-loop)
- [Task Lifecycle](#task-lifecycle)
- [Database](#database)
- [Prompt Generation](#prompt-generation)
- [Error Handling](#error-handling)
- [MCP Integrations](#mcp-integrations)
- [Admin Dashboard](#admin-dashboard)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Deploy to Railway (Recommended)

The fastest way to get started is a one-click deploy to Railway:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/PmV0za?referralCode=r_IbaC&utm_medium=integration&utm_source=template&utm_campaign=generic)

### What you get

- Pre-built Docker image with Node.js 22, git, gh CLI, Claude Code CLI, and Playwright + Chromium
- Persistent volume for database, cloned repos, and Claude auth tokens
- Auto-restart on failure with health checks
- Public URL for ClickUp/GitHub webhooks

### Step-by-step Railway setup

1. **Click the deploy button** above and connect your GitHub account
2. **Fill in the environment variables** (see [Environment Variables](#environment-variables) below)
3. **Wait for the build** — first deploy takes ~5 minutes due to Playwright/Chromium install
4. **Add a volume** — In Railway, go to your service → Settings → Volumes → Mount a volume at `/data`. This persists your database, cloned repos, and Claude auth tokens across deploys.
5. **Get your public URL** — Go to Settings → Networking → Generate Domain. This is your webhook URL.
6. **Register your ClickUp webhook** — Point it to `https://your-app.up.railway.app/webhook` (see [ClickUp Setup](#clickup-setup))
7. **Authenticate Claude** (if using Claude Max/Pro instead of API key) — see [Claude Authentication](#claude-authentication)

### Adding a volume

Railway volumes persist data across redeploys. You **must** attach one:

1. Open your service in the Railway dashboard
2. Go to **Settings → Volumes**
3. Click **Add Volume**
4. Set mount path to `/data`
5. Click **Create**

This single volume stores:

- `/data/db/` — SQLite database (run history, crash recovery)
- `/data/repos/` — Cloned git repositories
- `/data/claude/` — Claude CLI auth tokens (persists `claude login`)

---

## Environment Variables

All configuration is via environment variables, validated at startup with Zod. The process will fail fast if any required values are missing.

### Required

| Variable                 | Description                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLICKUP_API_TOKEN`      | ClickUp personal API token (`pk_...`). Get it from ClickUp → Settings → Apps.                                                                                               |
| `CLICKUP_TEAM_ID`        | Your ClickUp team/workspace ID. Found in the URL: `app.clickup.com/{team_id}/...`                                                                                           |
| `CLICKUP_CLAUDE_USER_ID` | ClickUp user ID for the "Claude" user. Assignment to this user triggers task pickup. Find it via the ClickUp API or `pnpm setup`.                                           |
| `CLICKUP_REPO_FIELD_ID`  | ID of your "GitHub Repo" custom field (URL type). The runner reads this field to know which repo to clone. Find it via the ClickUp API or `pnpm setup`.                     |
| `WEBHOOK_SECRET`         | Shared secret for verifying ClickUp webhook signatures (HMAC-SHA256). Generate one with `openssl rand -hex 32`. Must match what you register with ClickUp.                  |
| `GITHUB_TOKEN`           | GitHub personal access token with `repo` scope. Used for cloning, pushing, and creating PRs. Create at github.com → Settings → Developer settings → Personal access tokens. |

### Optional

| Variable                | Default                         | Description                                                                                                                                                                    |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`     | —                               | Anthropic API key for pay-per-use Claude. Not needed if you use `claude login` with a Max/Pro subscription. Get one at [console.anthropic.com](https://console.anthropic.com). |
| `WEBHOOK_PORT`          | `3000`                          | Port for the webhook HTTP server. Railway sets `PORT` automatically — the Dockerfile exposes 3000.                                                                             |
| `WORK_DIR`              | `/tmp/claude-task-runner/repos` | Directory where repos are cloned. On Railway, this is overridden to `/data/repos` via the Dockerfile.                                                                          |
| `DB_PATH`               | `./data/task-runner.db`         | SQLite database file path. On Railway, this is overridden to `/data/db/task-runner.db` via the Dockerfile.                                                                     |
| `CLAUDE_MAX_TURNS`      | `50`                            | Max agentic turns per Claude Code run. Higher = more thorough but slower/costlier.                                                                                             |
| `FIGMA_MCP_TOKEN`       | —                               | Figma MCP token for design-to-code tasks. Include Figma URLs in your ClickUp task description and the runner auto-detects them.                                                |
| `GITHUB_PR_ASSIGNEE`    | —                               | GitHub username to auto-assign created PRs to.                                                                                                                                 |
| `GITHUB_USERNAME`       | —                               | Your GitHub username. Enables the PR review pipeline when set alongside `GITHUB_WEBHOOK_SECRET`.                                                                               |
| `GITHUB_WEBHOOK_SECRET` | —                               | Secret for GitHub webhook signature verification. Enables automated PR reviews when set alongside `GITHUB_USERNAME`.                                                           |
| `REVIEW_TIMEOUT_MS`     | `900000` (15 min)               | Timeout for the PR review phase.                                                                                                                                               |
| `SLACK_BOT_TOKEN`       | —                               | Slack bot token (`xoxb-...`) for DM notifications when tasks complete or reviews are ready.                                                                                    |
| `SLACK_USER_ID`         | —                               | Your Slack user ID for receiving DM notifications.                                                                                                                             |
| `ADMIN_PASSWORD`        | —                               | Password to protect the admin dashboard. Leave empty to disable the dashboard.                                                                                                 |

---

## ClickUp Setup

### 1. Create a "Claude" User (or use your existing user)

Create a dedicated ClickUp user (e.g., "Claude") that will act as the trigger. When you assign a task to this user, the webhook fires and the runner picks it up.

### 2. Create the "GitHub Repo" Custom Field

In your ClickUp space, create a custom field:

- **Name:** "GitHub Repo"
- **Type:** URL
- **Value:** Full GitHub repo URL (e.g., `https://github.com/yourorg/your-next-app`)

### 3. Register a Webhook

Point your ClickUp webhook to your Railway URL:

```
POST https://api.clickup.com/api/v2/team/{team_id}/webhook
{
  "endpoint": "https://your-app.up.railway.app/webhook",
  "events": ["taskAssigneeUpdated"],
  "secret": "your-webhook-secret"
}
```

Or run `pnpm setup` locally to auto-register it.

### 4. Task Requirements

For the runner to pick up a task:

- **Assigned** to the "Claude" user (matching `CLICKUP_CLAUDE_USER_ID`)
- Has a valid **"GitHub Repo"** URL in the custom field
- **Not** already processed (tracked in SQLite)

Tasks are processed one at a time. Concurrent webhooks are queued.

### 5. Task Content Tips

For best results:

- Clear, descriptive **task name** (becomes the PR title)
- Detailed **description** in markdown (Claude's primary instruction)
- **Checklists** for acceptance criteria
- **Figma URLs** in the description (auto-detected for design-to-code)

---

## Claude Authentication

Claude Task Runner needs access to Claude Code. You have two options:

### Option A: API Key (Simplest)

Set `ANTHROPIC_API_KEY` in your environment variables. This is pay-per-use billing through [console.anthropic.com](https://console.anthropic.com).

No SSH or manual setup required — just add the env var and deploy.

### Option B: Claude Max/Pro Subscription (SSH into Railway)

If you have a Claude Max or Pro subscription and want to use `claude login` instead of an API key:

1. **Deploy first** — make sure the service is running on Railway
2. **SSH into your Railway service:**

   ```bash
   # Install Railway CLI if you haven't
   npm install -g @railway/cli

   # Login to Railway
   railway login

   # Link to your project
   railway link

   # SSH into the running service
   railway ssh
   ```

3. **Inside the Railway shell, run:**

   ```bash
   # The entrypoint already creates the claude user and .claude directory
   # Just switch to the claude user and login
   su claude
   claude login
   ```

4. **Follow the OAuth prompts** — Claude will give you a URL to visit in your browser. Authenticate and the tokens are saved to `/data/claude/` (persisted across deploys via the volume).

5. **Verify it worked:**

   ```bash
   claude --version
   ```

6. **Exit and restart the service** — the tokens persist in the `/data` volume.

> **Note:** The entrypoint script automatically creates the `claude` user, sets up `/home/claude/.claude`, and symlinks it to `/data/claude` on the persistent volume. You do NOT need to manually create directories.

---

## Running Locally

### Prerequisites

- **Node.js 22+**
- **pnpm 10.11+** (`corepack enable && corepack prepare pnpm@10.11.0 --activate`)
- **git** and **gh** CLI installed and authenticated
- **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code`
- Claude Code authenticated via `claude login` or `ANTHROPIC_API_KEY` env var

### Quick Start

```bash
# Clone and install
git clone https://github.com/Topflightapps/claude-task-runner.git
cd claude-task-runner
pnpm install

# Run the interactive setup to generate your .env file
pnpm setup

# Start the runner (dev mode with hot reload)
pnpm dev
```

### Setup Script

The interactive setup script walks you through generating a `.env` file:

```bash
pnpm run setup
```

NOTE: ^ `pnpm setup` will run pnpm's setup script, not ours. Use `pnpm run setup`.

It will:

1. Prompt for your **ClickUp API token**
2. Fetch your ClickUp teams and let you pick one
3. List team members so you can select the "Claude" user
4. Scan your ClickUp spaces for custom fields and auto-detect the "GitHub Repo" field
5. Generate a **webhook secret** and optionally register the webhook with ClickUp
6. Prompt for your **GitHub token** and **Anthropic API key**
7. Optionally collect a **Figma MCP token**
8. Write everything to a `.env` file

### Development (hot reload)

```bash
pnpm dev
```

### Production

```bash
pnpm build
pnpm start
```

---

## Running with Docker

### Build and run

```bash
docker compose up -d
```

### Claude Code Authentication (Docker)

```bash
# Run claude login inside the container
docker compose exec runner su claude -c "claude login"
```

Or set `ANTHROPIC_API_KEY` in your `.env` file.

### Persistent volumes

| Volume        | Mount   | Purpose                                           |
| ------------- | ------- | ------------------------------------------------- |
| `runner-data` | `/data` | SQLite database, cloned repos, Claude auth tokens |

### Commands

```bash
# View logs
docker compose logs -f runner

# Rebuild after code changes
docker compose up -d --build
```

---

## How It Works

### Architecture

Single-process Node.js service with a webhook-driven execution model:

```
ClickUp Webhook → Verify Signature → Fetch Task → Clone Repo → Kickoff (prd.json) → Ralph Loop (stories) → Create PR → Update ClickUp
```

The runner is intentionally simple — one process, one task at a time (with queuing), SQLite for state. No message queues, no workers, no distributed coordination.

### Two-Phase Execution

Every task goes through two phases:

**Phase 1 — Kickoff:** A single Claude Code invocation reads the ClickUp task details, explores the codebase, and generates `scripts/ralph/prd.json` — a structured breakdown of the task into small, ordered user stories. Timeout: 10 minutes.

**Phase 2 — Ralph Loop:** The `ralph.sh` script runs in a loop, spawning a **fresh Claude Code instance per iteration**. Each iteration:

1. Reads `prd.json` and `progress.txt` (for cross-iteration memory)
2. Picks the highest-priority story where `passes: false`
3. Implements that single story
4. Runs quality checks (typecheck, lint, test)
5. Commits with message `feat: [Story ID] - [Story Title]`
6. Updates `prd.json` to mark the story as `passes: true`
7. Appends learnings to `progress.txt`

The loop exits when all stories pass or max iterations are reached. Timeout: 60 minutes.

### Ralph Loop

The Ralph loop files live in `scripts/ralph/` and are copied into each target repo at runtime:

| File           | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `ralph.sh`     | Bash loop that spawns fresh Claude instances per iteration |
| `CLAUDE.md`    | Instructions piped to each Claude instance via stdin       |
| `prd.json`     | Generated by Phase 1 — structured user stories             |
| `progress.txt` | Cross-iteration memory — learnings, patterns, gotchas      |

**Key design principle:** Each Ralph iteration gets a fresh context window. Memory between iterations is maintained only through git commits, `progress.txt`, and `prd.json`.

#### prd.json Format

```json
{
  "project": "MyApp",
  "branchName": "claude/abc123-add-login-page",
  "description": "Add login page with email/password auth",
  "userStories": [
    {
      "id": "US-001",
      "title": "Add auth schema and migration",
      "description": "As a developer, I need user auth tables in the database.",
      "acceptanceCriteria": [
        "Add users table with email, password_hash columns",
        "Generate and run migration successfully",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}
```

### Task Lifecycle

```
CLAIMED         → Updates ClickUp status to "in progress", posts a comment, inserts DB row
    |
CLONING         → Clones repo (or fetches + resets if already cloned), creates feature branch
    |
RUNNING_CLAUDE  → Phase 1: Kickoff generates prd.json (10 min timeout)
    |              Phase 2: Ralph loop implements stories (60 min timeout)
    |
CREATING_PR     → Pushes branch, creates PR via `gh pr create`
    |
DONE            → Updates ClickUp to "in review", posts PR link comment, un-assigns Claude user

On any error → FAILED: posts error details as ClickUp comment, updates DB
```

### Database

SQLite (`better-sqlite3`) with WAL mode. Tables:

- **task_runs** — One record per task execution (status, repo, branch, PR URL, cost, timestamps)
- **review_runs** — PR review tracking
- **cloned_repos** — Cache of cloned repositories

Auto-created on first run. Used for duplicate prevention, crash recovery, and cost tracking.

### Prompt Generation

The prompt builder (`src/clickup/prompt-builder.ts`) generates detailed prompts from ClickUp task data, including task name, description, checklists (as acceptance criteria), and auto-detected Figma URLs.

### Error Handling

| Scenario              | Behavior                                                      |
| --------------------- | ------------------------------------------------------------- |
| Process crash/restart | Non-terminal DB rows marked `failed` with "Process restarted" |
| Kickoff timeout       | 10-minute timeout. Task marked `failed`.                      |
| Ralph loop timeout    | 60-minute timeout. Task marked `failed`.                      |
| Missing repo URL      | Task skipped, comment posted to ClickUp                       |
| ClickUp API errors    | Rate-limited to 90 req/min via `p-throttle`                   |
| Duplicate tasks       | DB check prevents re-processing                               |
| Any unhandled error   | Error posted as ClickUp comment, task marked `failed`         |

### MCP Integrations

- **Playwright MCP** — browser-based verification of UI changes (Chromium pre-installed)
- **Figma MCP** — design-to-code tasks (set `FIGMA_MCP_TOKEN`, include Figma URLs in task description)

Configure MCP servers in each target repo's `.mcp.json` file.

---

## Admin Dashboard

The runner includes a web-based admin dashboard for monitoring:

- Queue status and active/completed runs
- Real-time logs via WebSocket
- Cloned repos cache management

Access it at your service URL (e.g., `https://your-app.up.railway.app/`). Protected by `ADMIN_PASSWORD` if set.

---

## Development

### Scripts

| Command             | Description                                     |
| ------------------- | ----------------------------------------------- |
| `pnpm dev`          | Start with hot reload (tsx --watch), loads .env |
| `pnpm dev:admin`    | Run both backend and web frontend in parallel   |
| `pnpm build`        | Compile TypeScript to dist/                     |
| `pnpm start`        | Run compiled output (production)                |
| `pnpm setup`        | Interactive .env file generator                 |
| `pnpm type-check`   | TypeScript type checking (no emit)              |
| `pnpm lint`         | Run ESLint                                      |
| `pnpm lint:fix`     | Run ESLint with auto-fix                        |
| `pnpm format`       | Format all files with Prettier                  |
| `pnpm format:check` | Check formatting without writing                |
| `pnpm test`         | Run tests in watch mode (Vitest)                |
| `pnpm test:run`     | Run tests once                                  |
| `pnpm coverage`     | Run tests with coverage report                  |

### Tooling

- **Runtime**: Node.js 22 (ESM)
- **Package manager**: pnpm 10.11
- **TypeScript**: Strict mode, extends `@tsconfig/node22`
- **Linting**: ESLint 9 with `typescript-eslint`
- **Formatting**: Prettier
- **Testing**: Vitest with v8 coverage
- **Pre-commit hooks**: Husky + lint-staged

### Dependencies

| Package          | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `better-sqlite3` | SQLite database for run tracking and crash recovery |
| `p-throttle`     | Rate limiting for ClickUp API calls (90 req/min)    |
| `pino`           | Structured JSON logging                             |
| `ws`             | WebSocket for real-time admin updates               |
| `zod`            | Environment variable validation                     |

External CLIs (pre-installed in Docker/Railway):

| CLI      | Purpose                        |
| -------- | ------------------------------ |
| `git`    | Repository operations          |
| `gh`     | GitHub PR creation             |
| `claude` | Claude Code headless execution |

---

## Testing

```bash
# Watch mode
pnpm test

# Single run
pnpm test:run

# With coverage
pnpm coverage
```

### Integration testing (manual)

1. Set up a test repo on GitHub
2. Create a ClickUp task with "GitHub Repo" field pointing to your test repo
3. Give it a simple description like "Add a hello world page at /hello"
4. Assign it to the "Claude" user
5. Watch the logs for the full lifecycle

---

## Troubleshooting

### "Config not loaded" error

Make sure all required environment variables are set. Run `pnpm setup` locally to generate a `.env` file.

### ClickUp API 401

Your `CLICKUP_API_TOKEN` is invalid or expired. Generate a new one from ClickUp → Settings → Apps.

### No tasks being picked up

- Task is assigned to the correct Claude user (`CLICKUP_CLAUDE_USER_ID`)
- Webhook is registered and pointing to the correct URL
- `WEBHOOK_SECRET` matches the registered secret
- "GitHub Repo" custom field ID matches `CLICKUP_REPO_FIELD_ID`
- Task hasn't already been processed (check admin dashboard or SQLite DB)

### Kickoff fails (Phase 1)

- Check logs for Claude's output
- Verify `ANTHROPIC_API_KEY` is valid (or `claude login` was successful)
- Ensure the ClickUp task has enough detail

### Ralph loop fails or times out (Phase 2)

- Check `scripts/ralph/progress.txt` in the cloned repo
- Check `scripts/ralph/prd.json` for story status
- Stories may be too large — the kickoff should split them smaller

### gh CLI errors

The `GITHUB_TOKEN` needs `repo` scope. The entrypoint auto-authenticates `gh` with this token.

### Railway: Claude login tokens lost after redeploy

Make sure you have a volume mounted at `/data`. The entrypoint symlinks `/home/claude/.claude` → `/data/claude/` so tokens persist.

### Logs

Structured JSON via Pino. Key fields: `module`, `taskId`, `runId`, `branchName`, `prUrl`.

```bash
# Railway logs
railway logs

# Docker logs
docker compose logs -f runner

# Local dev with pretty printing
pnpm dev | npx pino-pretty
```
