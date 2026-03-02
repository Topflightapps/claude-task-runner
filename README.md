# Claude Task Runner

Automated pipeline that receives ClickUp webhooks, runs Claude Code headlessly on a cloned repo, and creates GitHub PRs for review.

**Flow:** ClickUp task assigned to "Claude" user → Webhook fires → Runner clones repo → Kickoff (generates prd.json) → Ralph loop (implements stories one by one) → Creates PR → Updates ClickUp card to "in review"

Powered by the [Ralph autonomous agent loop](https://github.com/snarktank/ralph) and the [Buildwright plugin](https://github.com/jguerena15/buildwright-plugin).

Currently supports Next.js projects. Designed to run on a Linux VPS or Docker container.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Setup Script](#setup-script)
- [Configuration](#configuration)
- [ClickUp Setup](#clickup-setup)
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
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 22+**
- **pnpm 10.11+** (`corepack enable && corepack prepare pnpm@10.11.0 --activate`)
- **git** and **gh** CLI (GitHub CLI) installed and authenticated
- **Claude Code CLI** installed globally: `npm install -g @anthropic-ai/claude-code`
- A **ClickUp** account with API access
- A **GitHub** account with a personal access token
- **Claude Code CLI** authenticated via one of:
  - `claude login` (uses your Claude Max/Pro subscription — run once on the server, tokens persist in `~/.claude/`)
  - `ANTHROPIC_API_KEY` env var (pay-per-use via [console.anthropic.com](https://console.anthropic.com))

## Quick Start

```bash
# Clone and install
cd claude-task-runner
pnpm install

# Run the interactive setup to generate your .env file
pnpm setup

# Start the runner (dev mode with hot reload)
pnpm dev
```

## Setup Script

The interactive setup script walks you through generating a `.env` file:

```bash
pnpm setup
```

It will:

1. Prompt for your **ClickUp API token**
2. Fetch your ClickUp teams and let you pick one
3. List team members so you can select the "Claude" user
4. Scan your ClickUp spaces for custom fields and auto-detect the "GitHub Repo" field
5. Generate a **webhook secret** and optionally register the webhook with ClickUp
6. Prompt for your **GitHub token** and **Anthropic API key**
7. Optionally collect a **Figma MCP token**
8. Write everything to a `.env` file

If any fields can't be auto-detected, it will ask you to paste the field ID manually.

## Configuration

All configuration is via environment variables, validated at startup with Zod. The process will fail fast if any required values are missing.

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Required Variables

| Variable                 | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `CLICKUP_API_TOKEN`      | ClickUp personal API token (`pk_...`)                                    |
| `CLICKUP_TEAM_ID`        | Your ClickUp team/workspace ID                                           |
| `CLICKUP_CLAUDE_USER_ID` | ClickUp user ID for the "Claude" user — assignment triggers task pickup  |
| `CLICKUP_REPO_FIELD_ID`  | ID of the "GitHub Repo" custom field (URL type)                          |
| `WEBHOOK_SECRET`         | Shared secret for verifying ClickUp webhook signatures (HMAC-SHA256)     |
| `GITHUB_TOKEN`           | GitHub personal access token with `repo` scope                           |

### Optional Variables (with defaults)

| Variable           | Default                         | Description                              |
| ------------------ | ------------------------------- | ---------------------------------------- |
| `ANTHROPIC_API_KEY` | —                              | Anthropic API key (if not using `claude login` OAuth) |
| `WEBHOOK_PORT`     | `3000`                          | Port for the webhook HTTP server         |
| `WORK_DIR`         | `/tmp/claude-task-runner/repos` | Directory where repos are cloned         |
| `DB_PATH`          | `./data/task-runner.db`         | SQLite database file path                |
| `CLAUDE_MAX_TURNS` | `50`                            | Max agentic turns per Claude run         |
| `FIGMA_MCP_TOKEN`  | —                               | Figma MCP token for design-to-code tasks |

## ClickUp Setup

### 1. Create a "Claude" User

Create a dedicated ClickUp user (e.g., "Claude") that will be used as the trigger. When you assign a task to this user, the webhook fires and the runner picks it up.

### 2. Register a Webhook

Run `pnpm setup` to auto-register, or manually register via the ClickUp API:

```
POST /api/v2/team/{team_id}/webhook
{
  "endpoint": "https://your-server.com/webhook",
  "events": ["taskAssigneeUpdated"],
  "secret": "your-webhook-secret"
}
```

### 3. Custom Fields (workspace-level)

Create this custom field in your ClickUp space:

- **"GitHub Repo"** — Type: **URL**. Set this to the full GitHub repo URL (e.g., `https://github.com/yourorg/your-next-app`).

### 4. Task Requirements

For the runner to pick up a task, it must:

- Be **assigned** to the "Claude" user (matching `CLICKUP_CLAUDE_USER_ID`)
- Have a valid **"GitHub Repo"** URL in the custom field
- **Not** have already been processed (tracked in SQLite)

Tasks are processed **one at a time**. If a webhook arrives while a task is running, it is queued and processed when the current task finishes.

### 3. Task Content Tips

For best results, write your ClickUp tasks with:

- A clear, descriptive **task name** (becomes the PR title)
- A detailed **description** in markdown (becomes Claude's primary instruction)
- **Checklists** for acceptance criteria (converted to a checklist in the prompt)
- **Figma URLs** in the description or a custom field (auto-detected and passed to Figma MCP)

## Running Locally

### Development (hot reload)

```bash
pnpm dev
```

Uses `tsx --watch` to recompile on file changes. Loads `.env` automatically.

### Production

```bash
pnpm build
pnpm start
```

Compiles TypeScript to `dist/` and runs with Node.js directly.

## Running with Docker

### Build and run

```bash
docker compose up -d
```

This builds the Docker image (Node.js 22, git, gh CLI, Claude Code CLI, Playwright + Chromium) and starts the runner.

### What the Docker image includes

- Node.js 22 (slim)
- git + gh CLI
- Claude Code CLI (`@anthropic-ai/claude-code`)
- Playwright with Chromium (for browser verification via MCP)
- pnpm 10.11

### Claude Code Authentication

If using a Claude Max/Pro subscription instead of an API key, you need to authenticate once:

```bash
# Option 1: Run claude login inside the container
docker compose exec runner claude login

# Option 2: Mount your local auth credentials
# Add to docker-compose.yml volumes:
#   - ~/.claude:/root/.claude
```

If using an API key instead, just set `ANTHROPIC_API_KEY` in your `.env` file.

### Persistent volumes

| Volume         | Mount    | Purpose                                       |
| -------------- | -------- | --------------------------------------------- |
| `runner-data`  | `/data`  | SQLite database (crash recovery, run history) |
| `runner-repos` | `/repos` | Cloned git repositories                       |

### View logs

```bash
docker compose logs -f runner
```

### Rebuild after code changes

```bash
docker compose up -d --build
```

## How It Works

### Architecture

Single-process Node.js service with a webhook-driven execution model:

```
ClickUp Webhook → Verify Signature → Fetch Task → Clone Repo → Kickoff (prd.json) → Ralph Loop (stories) → Create PR → Update ClickUp
```

The runner is intentionally simple — one process, one task at a time (with queuing), SQLite for state. No message queues, no workers, no distributed coordination.

### Two-Phase Execution

Every task goes through two phases:

**Phase 1 — Kickoff:** A single Claude Code invocation reads the ClickUp task details, explores the codebase, and generates `scripts/ralph/prd.json` — a structured breakdown of the task into small, ordered user stories. This is the equivalent of running `/buildwright-plugin:kickoff` + `/buildwright-plugin:prd` + `/buildwright-plugin:ralph` but in one automated, non-interactive pass.

**Phase 2 — Ralph Loop:** The `ralph.sh` script runs in a loop, spawning a **fresh Claude Code instance per iteration**. Each iteration:

1. Reads `prd.json` and `progress.txt` (for cross-iteration memory)
2. Picks the highest-priority story where `passes: false`
3. Implements that single story
4. Runs quality checks (typecheck, lint, test)
5. Commits with message `feat: [Story ID] - [Story Title]`
6. Updates `prd.json` to mark the story as `passes: true`
7. Appends learnings to `progress.txt`

The loop exits when all stories pass (`<promise>COMPLETE</promise>`) or max iterations are reached.

### Ralph Loop

The Ralph loop files live in `scripts/ralph/` and are **copied into each target repo** at runtime:

| File               | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `ralph.sh`         | Bash loop that spawns fresh Claude instances per iteration |
| `CLAUDE.md`        | Instructions piped to each Claude instance via stdin       |
| `prd.json`         | Generated by Phase 1 — structured user stories             |
| `progress.txt`     | Cross-iteration memory — learnings, patterns, gotchas      |
| `prd.json.example` | Example format for reference                               |

**Key design principle:** Each Ralph iteration gets a fresh context window. Memory between iterations is maintained only through:

- **Git commits** — the code itself
- **progress.txt** — learnings and patterns from previous iterations
- **prd.json** — which stories are done vs remaining

This prevents context degradation and ensures each iteration starts clean.

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

#### Story Sizing Rules

Each story must be completable in **one context window** (one Claude iteration). Rules:

- **Right-sized:** "Add a DB column", "Create a UI component", "Add a filter dropdown"
- **Too big (split these):** "Build entire dashboard", "Add authentication", "Refactor the API"
- **Rule of thumb:** If you can't describe the change in 2-3 sentences, it's too big
- **Dependency order:** Schema first → backend logic → UI components → summary views

### Task Lifecycle

Each task goes through these states:

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

### Branch Naming

Branches are created as: `claude/{clickupId}-{slugified-task-name}`

For example, a task named "Add login page" with ID `abc123` becomes: `claude/abc123-add-login-page`

### Database

SQLite database (`better-sqlite3`) with WAL mode. Single table `task_runs`:

| Column          | Type    | Description                   |
| --------------- | ------- | ----------------------------- |
| `id`            | INTEGER | Auto-incrementing primary key |
| `clickup_id`    | TEXT    | ClickUp task ID               |
| `status`        | TEXT    | Current lifecycle state       |
| `repo_url`      | TEXT    | GitHub repo URL               |
| `branch_name`   | TEXT    | Git branch created            |
| `pr_url`        | TEXT    | Created PR URL                |
| `error_message` | TEXT    | Error details if failed       |
| `cost_usd`      | REAL    | Claude API cost for this run  |
| `started_at`    | TEXT    | When the run started          |
| `updated_at`    | TEXT    | Last status update            |

Used for:

- **Duplicate prevention** — won't re-process a task that already has an active or completed run
- **Crash recovery** — on startup, any non-terminal runs (`claimed`, `cloning`, `running_claude`, `creating_pr`) are marked as `failed` with "Process restarted"
- **Cost tracking** — records Claude API cost per task when available

### Prompt Generation

The prompt builder (`src/clickup/prompt-builder.ts`) generates two types of prompts:

**Kickoff Prompt** (`buildKickoffPrompt`): Used in Phase 1. Includes:

1. Full ClickUp task details (name, description, checklists, Figma URLs)
2. The target branch name
3. Instructions to explore the codebase and generate `scripts/ralph/prd.json`
4. Story sizing rules, dependency ordering, and prd.json format spec
5. Explicit instruction to NOT implement anything — only generate the plan

**Direct Prompt** (`buildDirectPrompt`): Available for simple single-story tasks. Includes standard implementation instructions with `TASK_COMPLETE` completion signal.

The kickoff prompt tells Claude to output `TASK_COMPLETE` when prd.json is written. The Ralph loop uses `<promise>COMPLETE</promise>` as its completion signal (checked by `ralph.sh`).

### Error Handling

| Scenario                    | Behavior                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ |
| **Process crash/restart**   | On startup, all non-terminal DB rows are marked `failed` with "Process restarted"    |
| **Kickoff timeout**         | 10-minute timeout for Phase 1 (prd.json generation). Task marked `failed`.           |
| **Ralph loop timeout**      | 60-minute timeout for Phase 2 (story implementation). Task marked `failed`.          |
| **Ralph max iterations**    | If all stories aren't complete after max iterations, task marked `failed`.           |
| **Claude doesn't complete** | If kickoff output doesn't contain `TASK_COMPLETE`, task is marked `failed`           |
| **Missing repo URL**        | Task skipped, comment posted to ClickUp asking to add the URL                        |
| **ClickUp API errors**      | Rate-limited to 90 req/min (under 100 free-tier limit) via `p-throttle`              |
| **Git dirty state**         | `git reset --hard origin/main` before each task (safe — working dir is runner-owned) |
| **Duplicate tasks**         | DB check prevents re-processing; Claude user un-assigned after completion            |
| **Any unhandled error**     | Error message posted as ClickUp comment, task marked `failed` in DB                  |

### MCP Integrations

The runner is designed to work with MCP servers that Claude Code supports:

- **Playwright MCP** — for browser-based verification of UI changes. Chromium is installed in the Docker image.
- **Figma MCP** — for design-to-code tasks. Set `FIGMA_MCP_TOKEN` and include Figma URLs in your ClickUp task description. The prompt builder auto-detects Figma URLs and instructs Claude to use the MCP to extract exact design specs.

Configure MCP servers in each target repo's `.mcp.json` file so Claude Code picks them up automatically.

## Development

### Scripts

| Command             | Description                                     |
| ------------------- | ----------------------------------------------- |
| `pnpm dev`          | Start with hot reload (tsx --watch), loads .env |
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

### Project Structure

```
claude-task-runner/
  src/
    index.ts                    Entry point — loads config, inits DB, starts webhook server
    config.ts                   Zod-validated environment config
    db.ts                       SQLite setup, migrations, queries
    logger.ts                   Pino structured JSON logger
    webhook.ts                  HTTP server — receives ClickUp webhooks, queues tasks
    executor.ts                 Orchestrates the full task lifecycle
    clickup/
      client.ts                 ClickUp API v2 wrapper (rate-limited with p-throttle)
      types.ts                  TypeScript types for ClickUp API responses
      prompt-builder.ts         Converts ClickUp card → Claude prompt
    github/
      manager.ts                Git + gh CLI operations (clone, branch, commit, push, PR)
    claude/
      runner.ts                 Claude Code CLI subprocess execution
  scripts/
    setup.ts                    Interactive setup script
    ralph/
      ralph.sh                  Bash loop — spawns fresh Claude per iteration
      CLAUDE.md                 Instructions for each Ralph iteration
      prd.json.example          Example prd.json format
  Dockerfile
  docker-compose.yml
  package.json
  tsconfig.json
  tsconfig.build.json
  eslint.config.js
  vitest.config.ts
  .prettierrc
  .env.example
```

### Tooling

- **Runtime**: Node.js 22 (ESM)
- **Package manager**: pnpm 10.11
- **TypeScript**: Strict mode, extends `@tsconfig/node22`
- **Linting**: ESLint 9 with `typescript-eslint` (strict + stylistic) and `eslint-plugin-perfectionist` for import/object sorting
- **Formatting**: Prettier (defaults)
- **Testing**: Vitest with globals enabled and v8 coverage
- **Pre-commit hooks**: Husky + lint-staged (auto-lint and format on commit)

### Dependencies

| Package          | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `better-sqlite3` | SQLite database for run tracking and crash recovery |
| `p-throttle`     | Rate limiting for ClickUp API calls (90 req/min)    |
| `pino`           | Structured JSON logging                             |
| `zod`            | Environment variable validation                     |

External CLIs (must be installed):

| CLI      | Purpose                        |
| -------- | ------------------------------ |
| `git`    | Repository operations          |
| `gh`     | GitHub PR creation             |
| `claude` | Claude Code headless execution |

## Testing

### Run tests

```bash
# Watch mode
pnpm test

# Single run
pnpm test:run

# With coverage
pnpm coverage
```

### Integration testing (manual)

To test the full pipeline end-to-end:

1. **Set up a test repo**: Create a simple Next.js repo on GitHub that you can safely push branches to.

2. **Create a ClickUp task**:
   - Set "GitHub Repo" to your test repo URL
   - Give it a simple description like "Add a hello world page at /hello that displays 'Hello, World!'"
   - Assign it to the "Claude" user to trigger the webhook

3. **Start the runner**:

   ```bash
   pnpm dev
   ```

4. **Watch the logs** — you should see:
   - "Webhook server listening" with port
   - "Claude user assigned — enqueuing task"
   - "Starting task execution"
   - "Cloning repo" / "Repo exists, fetching latest"
   - "Starting Claude Code (kickoff)" — Phase 1 generating prd.json
   - "Kickoff complete, prd.json generated"
   - "Starting Ralph loop" — Phase 2 implementing stories
   - "Ralph Iteration 1 of N"
   - "Ralph completed all tasks!" (or iteration progress)
   - "Created PR"
   - "Task completed successfully"

5. **Verify**:
   - A PR was created on the test repo
   - The ClickUp task status changed to "in review"
   - A comment was posted on the ClickUp task with the PR link
   - The Claude user was un-assigned from the task

### Testing crash recovery

1. Start the runner and let it pick up a task
2. Kill the process mid-execution (`Ctrl+C` or `kill`)
3. Restart the runner
4. Check the logs for "Marked stale runs as failed" — the interrupted run should be cleaned up
5. Re-assign the Claude user to the task — the webhook should fire again and the runner can re-process

### Testing edge cases

- **Non-assignee webhook**: Sending a webhook for a different event type → should be ignored (200 but no action)
- **Wrong signature**: Sending a webhook with an invalid signature → should return 401
- **Missing repo URL**: Runner should skip the task and post a comment on ClickUp asking to add the URL
- **Already processed task**: Runner should skip it (duplicate prevention via DB check)

## Troubleshooting

### "Config not loaded" error

Make sure your `.env` file exists and has all required variables. Run `pnpm setup` to regenerate it.

### "Database not initialized" error

The `DB_PATH` directory must be writable. By default it creates `./data/task-runner.db`. Make sure the `data/` directory can be created.

### ClickUp API 401

Your `CLICKUP_API_TOKEN` is invalid or expired. Generate a new one from ClickUp Settings > Apps.

### No tasks being picked up

Check that your task meets all the requirements:

- Assigned to the "Claude" user matching `CLICKUP_CLAUDE_USER_ID`
- The webhook is registered and pointing to the correct URL
- The `WEBHOOK_SECRET` matches what was registered with ClickUp
- The "GitHub Repo" custom field ID in `.env` matches the actual field ID in ClickUp
- The task hasn't already been processed (check the SQLite DB)

### Kickoff fails (Phase 1)

- Check the logs for Claude's output (logged at debug level)
- The 10-minute timeout for kickoff is in `src/claude/runner.ts` (`KICKOFF_TIMEOUT_MS`)
- Make sure `ANTHROPIC_API_KEY` is valid and has credits
- Verify the ClickUp task has enough detail for Claude to generate meaningful stories

### Ralph loop fails or times out (Phase 2)

- The 60-minute timeout for the full loop is in `src/claude/runner.ts` (`RALPH_TIMEOUT_MS`)
- `CLAUDE_MAX_TURNS` controls how many Ralph iterations to run (default 50)
- Check `scripts/ralph/progress.txt` in the cloned repo for per-iteration status
- Check `scripts/ralph/prd.json` to see which stories passed and which are still pending
- Common cause: stories are too large for one context window — the kickoff prompt should split them smaller

### gh CLI errors

Make sure `gh` is installed and authenticated (`gh auth login`). The runner uses `GH_TOKEN` env var for auth, so the token needs `repo` scope.

### Logs

Logs are structured JSON via Pino. In dev mode they print to stdout. Key fields:

- `module` — which component logged the message (`webhook`, `executor`, `clickup`, `github`, `claude`, `db`)
- `taskId` — ClickUp task ID (when processing a task)
- `runId` — internal DB run ID
- `branchName`, `prUrl` — git/GitHub details

To get prettier logs in development, pipe through `pino-pretty`:

```bash
pnpm dev | npx pino-pretty
```
