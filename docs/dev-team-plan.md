# AI Dev Team Simulation — Adapted Architecture Plan

## Overview

Extend the existing Claude Task Runner into a multi-agent dev team simulation. The runner already handles PM/Architect (kickoff phase), Dev (Ralph loop), and Reviewer (review-runner). The main additions are:

1. **Librarian** — persistent cross-task learning via a vector store
2. **Richer agent role separation** within the existing two-phase model
3. **QA agent** as a distinct Ralph iteration step

No new orchestration framework (Prefect) or per-agent containers needed — the existing webhook queue, sequential task processing, and Claude Code CLI headless execution already handle this.

---

## How It Maps to the Existing System

| Original Plan | This Project Already Has | What to Add |
|---|---|---|
| PM Agent | Kickoff phase (`buildKickoffPrompt`) | Inject Librarian learnings into kickoff prompt |
| Architect Agent | Kickoff phase (generates prd.json with story breakdown) | Already covered by kickoff |
| Dev Agent | Ralph loop iterations (`ralph.sh` + `CLAUDE.md`) | Inject Librarian learnings into Ralph CLAUDE.md |
| Reviewer Agent | `review-runner.ts` + GitHub webhook flow | Inject Librarian learnings; extract learnings from review feedback |
| QA Agent | Ralph loop already runs quality checks per iteration | Could add a dedicated QA pass after all stories complete |
| Librarian Agent | `progress.txt` (per-task only, not cross-task) | **New: Librarian service with vector store** |
| Prefect orchestration | `webhook.ts` queue + `executor.ts` two-phase flow | Not needed — existing system is sufficient |
| Docker per-agent | Single process spawning Claude CLI | Not needed — CLI calls are the "containers" |

---

## System Components

### 1. Agent Roles (via System Prompts)

Each "agent" is a Claude Code CLI invocation (`claude -p` or `claude --print`) with a role-specific prompt. No separate containers — just different prompts passed to the same CLI.

| Agent | Implementation | Trigger |
|---|---|---|
| **PM/Architect** | `runClaude()` with kickoff prompt | `executeTask()` Phase 1 |
| **Dev** | Ralph loop iterations via `ralph.sh` | `runRalphLoop()` Phase 2 |
| **Reviewer** | `review-runner.ts` | GitHub webhook (PR review requested) |
| **QA** | New: dedicated Claude invocation after Ralph loop | After Phase 2 completes |
| **Librarian** | New: in-process TypeScript module (not a separate service) | Called before/after each agent phase |

### 2. The Librarian Module

Unlike the original plan's separate service, the Librarian is an **in-process module** (`src/librarian/`) that other phases call directly. This keeps the single-process architecture and avoids adding network hops.

#### Architecture

```
src/librarian/
  index.ts          — public API: research(), filelearnings()
  embeddings.ts     — embedding generation (OpenAI or local)
  vectorstore.ts    — SQLite-backed vector search (sqlite-vss or manual cosine similarity)
  learnings-db.ts   — CRUD for learnings metadata table
  extractor.ts      — prompt + parser for extracting learnings from agent output
```

#### Write mode — filing a learning

Called at the end of each phase (kickoff, Ralph iteration, review).

```typescript
// src/librarian/index.ts
export async function fileLearnings(input: {
  rawText: string;          // agent output or progress.txt content
  sourceAgent: string;      // 'kickoff' | 'dev' | 'reviewer' | 'qa'
  projectType?: string;     // detected from package.json (e.g., 'nextjs')
  repoUrl: string;
  taskId: string;
}): Promise<void>
```

**Process:**
1. Call Claude to extract structured learnings from the raw text (using `claude -p` with extraction prompt)
2. Embed each learning
3. Search for semantically similar existing learnings
4. Claude decides: `SKIP` | `UPDATE` | `REPLACE` | `FILE_NEW`
5. Write to SQLite vector store + metadata

#### Read mode — research before a task

Called at the start of each phase to inject relevant context.

```typescript
export async function research(input: {
  taskDescription: string;
  projectType?: string;
  limit?: number;
}): Promise<Learning[]>
```

**Process:**
1. Embed the task description
2. Semantic search across stored learnings
3. Filter by project type and recency
4. Return top N as structured context

#### Librarian decision prompt

```
You are a knowledge librarian. You received a new learning:
<new_learning>{{learning}}</new_learning>

Most similar existing learnings:
<existing>{{similar_learnings}}</existing>

Decide: SKIP, UPDATE (existing_id), REPLACE (existing_id), or FILE_NEW.
If filing, extract: category, tags, project_type.
Respond in JSON only.
```

### 3. Storage Layer

Keep it simple — extend the existing SQLite database. No Qdrant, no Postgres, no separate services.

| Layer | Tool | Purpose |
|---|---|---|
| Vector store | **SQLite + manual cosine similarity** | Semantic search over learnings |
| Metadata store | **SQLite** (same DB as task_runs) | Categories, tags, version history |
| Embedding model | OpenAI `text-embedding-3-small` via API | Generating embeddings (small, cheap, fast) |

**Why not a dedicated vector DB?** The learning corpus will be small (hundreds to low thousands of entries). SQLite with stored embeddings and in-memory cosine similarity is fast enough and avoids adding infrastructure. If it outgrows this, swap in `sqlite-vss` or Qdrant later.

#### New SQLite tables

```sql
-- Add to src/db.ts migrate()

CREATE TABLE IF NOT EXISTS learnings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  content         TEXT NOT NULL,
  embedding       BLOB,                  -- Float32Array serialized
  category        TEXT,                   -- e.g., 'nextjs', 'auth', 'database'
  tags            TEXT,                   -- JSON array: ["drizzle", "migration"]
  project_type    TEXT,                   -- e.g., 'nextjs', 'python-api'
  source_agent    TEXT NOT NULL,          -- 'kickoff' | 'dev' | 'reviewer' | 'qa'
  source_repo     TEXT,                   -- repo URL for context
  source_task_id  TEXT,                   -- ClickUp task ID
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  superseded_by   INTEGER REFERENCES learnings(id)
);

CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
CREATE INDEX IF NOT EXISTS idx_learnings_project_type ON learnings(project_type);
```

### 4. Integration Points

#### Phase 1: Kickoff (`executor.ts`)

```
Before kickoff:
  learnings = await research({ taskDescription, projectType })
  → Inject into kickoff prompt as "## Relevant Learnings from Previous Tasks"

After kickoff:
  await fileLearnings({ rawText: kickoffResult.output, sourceAgent: 'kickoff', ... })
```

#### Phase 2: Ralph Loop (`ralph.sh` / `CLAUDE.md`)

```
Before Ralph loop:
  learnings = await research({ taskDescription, projectType })
  → Write to scripts/ralph/learnings.md in the target repo
  → Ralph CLAUDE.md already reads progress.txt; add instruction to also read learnings.md

After Ralph loop:
  → Read progress.txt from the repo
  await fileLearnings({ rawText: progressContent, sourceAgent: 'dev', ... })
```

#### Review phase (`review-runner.ts`)

```
Before review:
  learnings = await research({ taskDescription: prTitle + prBody, projectType })
  → Inject into review prompt

After review:
  await fileLearnings({ rawText: reviewOutput, sourceAgent: 'reviewer', ... })
```

#### New: QA Phase (optional, after Ralph loop)

Add an optional Phase 3 between Ralph loop completion and PR creation:

```typescript
// In executor.ts, after Ralph loop succeeds:
const qaResult = await runClaude(repoPath, buildQAPrompt(task, learnings));
if (!qaResult.success) {
  // Feed QA findings back into one more Ralph iteration
}
await fileLearnings({ rawText: qaResult.output, sourceAgent: 'qa', ... });
```

The QA prompt would instruct Claude to:
- Run the full test suite
- Check for common issues (security, accessibility, performance)
- Verify acceptance criteria from prd.json
- Report pass/fail with specific findings

### 5. Learning Extraction

At the end of each phase, extract learnings using a dedicated prompt:

```
You just completed a task. What specific things did you learn during this
task that would help a future agent working on a similar problem?

Be specific. Include:
- What approach worked and why
- What failed and why
- Any library/framework-specific gotchas
- Anything that contradicted your assumptions

Format each learning as a single, self-contained paragraph.
Return as a JSON array of strings.
```

This is called via `claude -p` with the agent's output as context. The extracted learnings are then passed to the Librarian's write flow.

### 6. Config Changes

```typescript
// Add to src/config.ts
OPENAI_API_KEY: z.string().optional(),           // for embeddings
LIBRARIAN_ENABLED: z.coerce.boolean().default(false),  // feature flag during rollout
```

---

## Data Flow (Updated for This Project)

```
ClickUp Webhook
  |
  v
webhook.ts (verify + enqueue)
  |
  v
executor.ts: executeTask()
  |
  +-- Librarian.research(task) ............ query learnings DB
  |
  +-- Phase 1: Kickoff (with learnings injected)
  |     |
  |     +-- Librarian.fileLearnings() ..... extract + store from kickoff output
  |
  +-- Write learnings.md into repo
  |
  +-- Phase 2: Ralph Loop (reads learnings.md)
  |     |
  |     +-- Librarian.fileLearnings() ..... extract + store from progress.txt
  |
  +-- Phase 3: QA Pass (optional)
  |     |
  |     +-- Librarian.fileLearnings() ..... extract + store from QA output
  |
  +-- Create PR
  |
  +-- Update ClickUp
```

---

## Key Design Decisions

### Why not Prefect?
The existing webhook queue in `webhook.ts` already handles sequential processing, queuing, and error recovery. Adding Prefect would mean:
- A Python dependency in a Node.js project
- A separate Prefect server to run
- Mapping between Prefect tasks and Claude CLI spawning
- No real benefit since tasks run sequentially anyway

The existing system gives us task-level retries (via ClickUp re-assignment), crash recovery (via `markStaleRunsAsFailed`), and visibility (via admin dashboard + WebSocket).

### Why not separate Docker containers per agent?
Each "agent" is just a Claude CLI call with a different prompt. There's no state isolation benefit from containers — the CLI already runs in a fresh context per invocation. The Ralph loop already achieves "fresh context per iteration" by design.

### Why SQLite for vectors instead of Qdrant?
- No new infrastructure to deploy/maintain
- Learning corpus will be small (< 10K entries)
- Cosine similarity on a few thousand 1536-dim vectors is ~10ms in-process
- Already using SQLite for everything else
- Upgrade path: swap `vectorstore.ts` implementation to use Qdrant if needed

### Category taxonomy
Start with a **fixed taxonomy** derived from project types the runner already sees:
- `nextjs`, `react`, `typescript`, `database`, `auth`, `api`, `testing`, `deployment`, `styling`, `performance`
- Allow the Librarian to propose new categories, logged for review

### Conflicting learnings
- Tag learnings with `project_type` and `source_repo` for context
- When conflicts detected, keep both with context tags rather than overwriting
- Surface conflicts to the requesting agent: "Note: conflicting learnings found for X"

---

## Suggested Build Order

### Phase A: Librarian Core (can ship independently)
1. **`src/librarian/embeddings.ts`** — OpenAI embedding wrapper
2. **`src/librarian/vectorstore.ts`** — SQLite storage + cosine similarity search
3. **`src/librarian/learnings-db.ts`** — CRUD operations on `learnings` table
4. **`src/librarian/extractor.ts`** — Claude-based learning extraction from raw text
5. **`src/librarian/index.ts`** — `research()` and `fileLearnings()` public API
6. **DB migration** — add `learnings` table to `src/db.ts`
7. **Config** — add `OPENAI_API_KEY` and `LIBRARIAN_ENABLED`

### Phase B: Integration
8. **Inject learnings into kickoff prompt** — modify `buildKickoffPrompt()` to accept learnings
9. **Inject learnings into Ralph loop** — write `learnings.md` to repo, update `CLAUDE.md` to read it
10. **Extract learnings after kickoff** — call `fileLearnings()` in `executor.ts` after Phase 1
11. **Extract learnings after Ralph loop** — read `progress.txt`, call `fileLearnings()`
12. **Inject learnings into reviews** — modify review prompt builder

### Phase C: QA Agent + Polish
13. **QA phase** — add optional Phase 3 in `executor.ts`
14. **Admin dashboard** — add learnings viewer/manager to the web UI
15. **Learning extraction prompt tuning** — iterate on quality

### Phase D: Future
17. **Librarian MCP tool** — expose `search_learnings` as an MCP tool so agents can query the Librarian mid-task (enables real back-and-forth instead of one-time context injection)
18. **Cross-repo learning transfer** — learnings from repo A help with repo B
19. **Learning quality metrics** — track which learnings agents actually used
20. **Librarian admin API** — CRUD endpoints for manual curation
21. **`sqlite-vss` or Qdrant upgrade** if corpus grows beyond SQLite comfort zone
