import { z } from "zod";

const configSchema = z
  .object({
    ADMIN_PASSWORD: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    CLAUDE_MAX_TURNS: z.coerce.number().default(50),
    CLICKUP_API_TOKEN: z.string().min(1),
    CLICKUP_CLAUDE_USER_ID: z.string().min(1),
    CLICKUP_REPO_FIELD_ID: z.string().min(1),

    CLICKUP_TEAM_ID: z.string().min(1),
    DB_PATH: z.string().default("./data/task-runner.db"),

    FIGMA_MCP_TOKEN: z.string().optional(),
    GITHUB_PR_ASSIGNEE: z.string().optional(),
    GITHUB_TOKEN: z.string().min(1),
    GITHUB_USERNAME: z.string().optional(),
    GITHUB_WEBHOOK_SECRET: z.string().optional(),

    // Railway injects PORT; fall back to WEBHOOK_PORT or 3000
    PORT: z.coerce.number().optional(),

    REVIEW_TIMEOUT_MS: z.coerce.number().default(15 * 60 * 1000),
    SLACK_BOT_TOKEN: z.string().optional(),
    SLACK_USER_ID: z.string().optional(),

    WEBHOOK_PORT: z.coerce.number().optional(),
    WEBHOOK_SECRET: z.string().min(1),
    WORK_DIR: z.string().default("/tmp/claude-task-runner/repos"),
  })
  .transform((c) => ({
    ...c,
    WEBHOOK_PORT: c.PORT ?? c.WEBHOOK_PORT ?? 3000,
  }));

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) throw new Error("Config not loaded. Call loadConfig() first.");
  return _config;
}

export function loadConfig(): Config {
  if (_config) return _config;
  _config = configSchema.parse(process.env);
  return _config;
}
