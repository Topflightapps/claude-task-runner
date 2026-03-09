import { existsSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";

async function clickupApi<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    ...options,
    headers: { Authorization: token, ...options.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ClickUp API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

interface Team {
  id: string;
  members: Array<{ user: { email: string; id: number; username: string } }>;
  name: string;
}

interface Space {
  id: string;
  name: string;
}

interface CustomField {
  id: string;
  name: string;
  type: string;
}

function onCancel() {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

async function main() {
  p.intro("Claude Task Runner — Setup");

  const env: Record<string, string> = {};

  // ClickUp API Token
  const clickupToken = await p.text({
    message: "Enter your ClickUp API token",
    placeholder: "pk_...",
    validate: (v) => (!v ? "API token is required" : undefined),
  });
  if (p.isCancel(clickupToken)) return onCancel();
  env.CLICKUP_API_TOKEN = clickupToken;

  // Fetch teams
  const s = p.spinner();
  s.start("Fetching your ClickUp teams...");
  const { teams } = await clickupApi<{ teams: Team[] }>("/team", clickupToken);
  s.stop("Teams loaded");

  if (teams.length === 0) {
    p.log.error("No teams found. Check your API token.");
    process.exit(1);
  }

  // Select team
  let team: Team;
  if (teams.length === 1) {
    team = teams[0];
    p.log.info(`Using team: ${team.name} (${team.id})`);
  } else {
    const teamId = await p.select({
      message: "Select your ClickUp team",
      options: teams.map((t) => ({ value: t.id, label: t.name, hint: t.id })),
    });
    if (p.isCancel(teamId)) return onCancel();
    team = teams.find((t) => t.id === teamId)!;
  }
  env.CLICKUP_TEAM_ID = team.id;

  // Select Claude user
  const members = team.members.map((m) => m.user);
  const claudeUserId = await p.select({
    message:
      'Which user is the "Claude" user? (tasks assigned to this user get processed)',
    options: members.map((u) => ({
      value: String(u.id),
      label: u.username,
      hint: u.email,
    })),
  });
  if (p.isCancel(claudeUserId)) return onCancel();
  env.CLICKUP_CLAUDE_USER_ID = claudeUserId;

  const selectedUser = members.find((u) => String(u.id) === claudeUserId)!;
  p.log.info(`Selected: ${selectedUser.username} (ID: ${selectedUser.id})`);

  // Fetch spaces to find the GitHub Repo custom field
  s.start("Scanning spaces for custom fields...");
  const { spaces } = await clickupApi<{ spaces: Space[] }>(
    `/team/${team.id}/space?archived=false`,
    clickupToken,
  );

  let repoFieldId = "";

  for (const space of spaces) {
    try {
      const { fields } = await clickupApi<{ fields: CustomField[] }>(
        `/space/${space.id}/field`,
        clickupToken,
      );

      for (const field of fields) {
        if (
          (field.name.toLowerCase().includes("repo") ||
            field.name.toLowerCase().includes("github")) &&
          field.type === "url" &&
          !repoFieldId
        ) {
          repoFieldId = field.id;
        }
      }
    } catch {
      // skip spaces we can't read
    }
  }

  if (repoFieldId) {
    s.stop(`Auto-detected "GitHub Repo" field: ${repoFieldId}`);
  } else {
    s.stop("Could not auto-detect GitHub Repo field");
    const manualId = await p.text({
      message: 'Enter the "GitHub Repo" custom field ID',
      validate: (v) => (!v ? "Field ID is required" : undefined),
    });
    if (p.isCancel(manualId)) return onCancel();
    repoFieldId = manualId;
  }
  env.CLICKUP_REPO_FIELD_ID = repoFieldId;

  // Deployment URL + webhook registration
  const baseUrl = await p.text({
    message: "Enter your deployment URL",
    placeholder: "https://your-app.up.railway.app",
  });
  if (p.isCancel(baseUrl)) return onCancel();

  if (baseUrl) {
    const webhookUrl = baseUrl.replace(/\/+$/, "") + "/webhook";
    s.start(`Registering webhook at ${webhookUrl}...`);
    try {
      const webhook = await clickupApi<{
        id: string;
        webhook: { id: string; secret: string };
      }>(`/team/${team.id}/webhook`, clickupToken, {
        body: JSON.stringify({
          endpoint: webhookUrl,
          events: ["taskAssigneeUpdated"],
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const webhookSecret = webhook.webhook?.secret;
      if (webhookSecret) {
        env.WEBHOOK_SECRET = webhookSecret;
        s.stop("Webhook registered! Secret saved.");
      } else {
        s.stop("Webhook registered but no secret returned.");
        const manualSecret = await p.text({
          message: "Enter your webhook secret manually",
          validate: (v) => (!v ? "Secret is required" : undefined),
        });
        if (p.isCancel(manualSecret)) return onCancel();
        env.WEBHOOK_SECRET = manualSecret;
      }
    } catch {
      s.stop("Failed to register webhook.");
      p.log.warn("You can register it manually later.");
      const manualSecret = await p.text({
        message: "Enter your webhook secret manually (or leave blank for now)",
      });
      if (p.isCancel(manualSecret)) return onCancel();
      if (manualSecret) env.WEBHOOK_SECRET = manualSecret;
    }
  } else {
    const manualSecret = await p.text({
      message: "Enter your webhook secret (register webhook manually later)",
      validate: (v) => (!v ? "Secret is required" : undefined),
    });
    if (p.isCancel(manualSecret)) return onCancel();
    env.WEBHOOK_SECRET = manualSecret;
  }

  // GitHub
  const githubToken = await p.text({
    message: "Enter your GitHub token",
    placeholder: "ghp_...",
    validate: (v) => (!v ? "GitHub token is required" : undefined),
  });
  if (p.isCancel(githubToken)) return onCancel();
  env.GITHUB_TOKEN = githubToken;

  const githubUsername = await p.text({
    message: "Enter your GitHub username",
    validate: (v) => (!v ? "Username is required" : undefined),
  });
  if (p.isCancel(githubUsername)) return onCancel();
  env.GITHUB_USERNAME = githubUsername;

  const githubPrAssignee = await p.text({
    message: "GitHub username to auto-assign PRs to",
    defaultValue: githubUsername,
    placeholder: githubUsername,
  });
  if (p.isCancel(githubPrAssignee)) return onCancel();
  env.GITHUB_PR_ASSIGNEE = githubPrAssignee || githubUsername;

  // Admin dashboard password
  const adminPassword = await p.password({
    message: "Set an admin dashboard password (optional, Enter to skip)",
  });
  if (p.isCancel(adminPassword)) return onCancel();
  if (adminPassword) env.ADMIN_PASSWORD = adminPassword;

  // Optional: Figma
  const figmaToken = await p.text({
    message: "Figma MCP token (optional, Enter to skip)",
    placeholder: "press Enter to skip",
  });
  if (p.isCancel(figmaToken)) return onCancel();
  if (figmaToken) env.FIGMA_MCP_TOKEN = figmaToken;

  // Defaults
  env.WEBHOOK_PORT = "3000";
  env.DB_PATH = "/data/db/task-runner.db";
  env.WORK_DIR = "/data/repos";
  env.CLAUDE_MAX_TURNS = "10";
  env.LIBRARIAN_ENABLED = "false";

  // Write .env file
  const envContent = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const envPath = ".env";
  if (existsSync(envPath)) {
    const overwrite = await p.confirm({
      message: ".env file already exists. Overwrite?",
      initialValue: false,
    });
    if (p.isCancel(overwrite)) return onCancel();
    if (!overwrite) {
      p.log.info("Aborted. Here's your generated config:");
      p.note(envContent, "Generated .env");
      p.outro("Done");
      return;
    }
  }

  writeFileSync(envPath, envContent + "\n");

  p.note(
    `1. Review the .env file and adjust any values
2. Paste these variables into Railway
3. Run: pnpm dev`,
    "Next steps",
  );

  p.outro(".env file written successfully!");
}

main().catch((err) => {
  p.log.error(`Setup failed: ${err}`);
  process.exit(1);
});
