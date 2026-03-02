import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

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

async function main() {
  console.log("\n🤖 Claude Task Runner — Setup\n");
  console.log("This script will help you configure the .env file.\n");

  const env: Record<string, string> = {};

  // ClickUp API Token
  const clickupToken = await ask("Enter your ClickUp API token (pk_...): ");
  env.CLICKUP_API_TOKEN = clickupToken;

  // Fetch teams
  console.log("\nFetching your ClickUp teams...");
  const { teams } = await clickupApi<{ teams: Team[] }>("/team", clickupToken);

  if (teams.length === 0) {
    console.error("No teams found. Check your API token.");
    process.exit(1);
  }

  let team: Team;
  if (teams.length === 1) {
    team = teams[0];
    console.log(`Using team: ${team.name} (${team.id})`);
  } else {
    console.log("\nAvailable teams:");
    teams.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} (${t.id})`));
    const teamIdx = parseInt(await ask("\nSelect team number: ")) - 1;
    team = teams[teamIdx];
  }
  env.CLICKUP_TEAM_ID = team.id;

  // Find the Claude user
  console.log("\nTeam members:");
  const members = team.members.map((m) => m.user);
  members.forEach((u, i) =>
    console.log(`  ${i + 1}. ${u.username} (${u.email}) — ID: ${u.id}`),
  );
  const userIdx =
    parseInt(
      await ask(
        '\nWhich user is the "Claude" user (tasks assigned to this user will be processed)? Enter number: ',
      ),
    ) - 1;
  env.CLICKUP_CLAUDE_USER_ID = String(members[userIdx].id);
  console.log(
    `Selected user: ${members[userIdx].username} (ID: ${members[userIdx].id})`,
  );

  // Fetch spaces to find the GitHub Repo custom field
  console.log("\nFetching spaces to find custom fields...");
  const { spaces } = await clickupApi<{ spaces: Space[] }>(
    `/team/${team.id}/space?archived=false`,
    clickupToken,
  );

  let repoFieldId = "";

  for (const space of spaces) {
    console.log(`\nChecking space: ${space.name}...`);
    try {
      const { fields } = await clickupApi<{ fields: CustomField[] }>(
        `/space/${space.id}/field`,
        clickupToken,
      );

      for (const field of fields) {
        console.log(
          `  Found field: "${field.name}" (${field.type}) — ID: ${field.id}`,
        );

        if (
          (field.name.toLowerCase().includes("repo") ||
            field.name.toLowerCase().includes("github")) &&
          field.type === "url" &&
          !repoFieldId
        ) {
          repoFieldId = field.id;
          console.log(`    → Auto-detected as GitHub Repo field`);
        }
      }
    } catch {
      console.log(`  Could not fetch fields for this space`);
    }
  }

  if (!repoFieldId) {
    repoFieldId = await ask(
      '\nCould not auto-detect "GitHub Repo" field. Enter the field ID manually: ',
    );
  }
  env.CLICKUP_REPO_FIELD_ID = repoFieldId;

  // Webhook secret
  const generatedSecret = randomBytes(32).toString("hex");
  console.log(`\nGenerated webhook secret: ${generatedSecret}`);
  const useGenerated = await ask("Use this secret? (Y/n): ");
  if (useGenerated.toLowerCase() === "n") {
    env.WEBHOOK_SECRET = await ask("Enter your webhook secret: ");
  } else {
    env.WEBHOOK_SECRET = generatedSecret;
  }

  // Webhook port
  const port = await ask("Webhook port (default 3000): ");
  env.WEBHOOK_PORT = port || "3000";

  // Register webhook with ClickUp
  const baseUrl = await ask(
    "\nEnter the public base URL where the webhook server will be reachable (e.g., https://your-server.com): ",
  );

  if (baseUrl) {
    const webhookUrl = baseUrl.replace(/\/+$/, "") + "/webhook";
    console.log(`\nRegistering webhook at: ${webhookUrl}`);
    try {
      const webhook = await clickupApi<{ id: string; webhook: { id: string } }>(
        `/team/${team.id}/webhook`,
        clickupToken,
        {
          body: JSON.stringify({
            endpoint: webhookUrl,
            events: ["taskAssigneeUpdated"],
            secret: env.WEBHOOK_SECRET,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      console.log(`✅ Webhook registered! ID: ${webhook.id || webhook.webhook?.id}`);
    } catch (err) {
      console.error(
        "⚠️ Failed to register webhook. You can register it manually later.",
        err,
      );
    }
  }

  // GitHub and Anthropic tokens
  const githubToken = await ask("\nEnter your GitHub token (ghp_...): ");
  env.GITHUB_TOKEN = githubToken;

  // Optional: Figma
  const figmaToken = await ask(
    "Enter Figma MCP token (optional, press Enter to skip): ",
  );
  if (figmaToken) {
    env.FIGMA_MCP_TOKEN = figmaToken;
  }

  // Write .env file
  const envContent = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const envPath = ".env";
  if (existsSync(envPath)) {
    const overwrite = await ask(
      "\n.env file already exists. Overwrite? (y/N): ",
    );
    if (overwrite.toLowerCase() !== "y") {
      console.log("Aborted. Your generated config:\n");
      console.log(envContent);
      rl.close();
      return;
    }
  }

  writeFileSync(envPath, envContent + "\n");
  console.log(`\n✅ .env file written successfully!\n`);
  console.log("Next steps:");
  console.log("  1. Review the .env file and adjust any values");
  console.log(
    '  2. Ensure a "GitHub Repo" (URL) custom field exists in ClickUp',
  );
  console.log(
    '  3. Create a dedicated "Claude" user in ClickUp (or use an existing one)',
  );
  console.log("  4. Run: pnpm dev");

  rl.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  rl.close();
  process.exit(1);
});
