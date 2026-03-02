import type { ClickUpTask } from "./types.js";

const FIGMA_URL_REGEX =
  /https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/[^\s)]+/g;

/**
 * Builds a simple direct-implementation prompt for tasks that don't
 * need the Ralph loop (single-story tasks).
 */
export function buildDirectPrompt(task: ClickUpTask): string {
  const figmaUrls = extractFigmaUrls(task);

  const sections: string[] = [
    `# Task: ${task.name}`,
    "",
    `ClickUp Task: ${task.url}`,
    "",
  ];

  if (task.description) {
    sections.push("## Description\n");
    sections.push(task.description);
    sections.push("");
  }

  const checklists = formatChecklists(task);
  if (checklists) {
    sections.push(checklists);
    sections.push("");
  }

  if (figmaUrls.length > 0) {
    sections.push("## Design Reference\n");
    sections.push("Use the Figma MCP to inspect these designs:");
    for (const url of figmaUrls) {
      sections.push(`- ${url}`);
    }
    sections.push(
      "\nExtract exact colors, spacing, typography, and layout from the Figma file. Match the design precisely.",
    );
    sections.push("");
  }

  sections.push("## Instructions\n");
  sections.push(
    `1. Read the project's CLAUDE.md file first for coding standards and patterns.`,
  );
  sections.push(
    `2. Follow existing code patterns and conventions in the codebase.`,
  );
  sections.push(`3. This is a Next.js project. Follow Next.js best practices.`);
  sections.push(`4. Implement the task as described above.`);
  sections.push(
    `5. Use Playwright MCP to verify your changes work correctly in the browser.`,
  );
  sections.push(
    `6. Make sure all existing tests pass and add tests if appropriate.`,
  );
  sections.push(
    `7. Commit your changes with a clear, descriptive commit message.`,
  );
  sections.push(
    `8. When you have fully completed the task and verified it works, output exactly: TASK_COMPLETE`,
  );

  return sections.join("\n");
}

/**
 * Builds a kickoff prompt that tells Claude to analyze the ClickUp task
 * and generate a prd.json file for the Ralph loop to execute.
 */
export function buildKickoffPrompt(
  task: ClickUpTask,
  branchName: string,
): string {
  const figmaUrls = extractFigmaUrls(task);

  const sections: string[] = [
    `# Kickoff: Generate prd.json from ClickUp Task`,
    "",
    `You are an autonomous agent. Your job is to read this ClickUp task and generate a structured \`scripts/ralph/prd.json\` file that breaks the task into small, ordered user stories for autonomous execution.`,
    "",
    `---`,
    "",
    `## ClickUp Task Details`,
    "",
    `**Title:** ${task.name}`,
    `**URL:** ${task.url}`,
    `**Branch:** ${branchName}`,
    "",
  ];

  if (task.description) {
    sections.push(`### Description\n`);
    sections.push(task.description);
    sections.push("");
  }

  const checklists = formatChecklists(task);
  if (checklists) {
    sections.push(checklists);
    sections.push("");
  }

  if (figmaUrls.length > 0) {
    sections.push(`### Figma Designs\n`);
    for (const url of figmaUrls) {
      sections.push(`- ${url}`);
    }
    sections.push("");
  }

  sections.push(`---`);
  sections.push("");
  sections.push(`## Your Instructions`);
  sections.push("");
  sections.push(
    `1. **Read the project's CLAUDE.md** to understand the codebase, patterns, and conventions.`,
  );
  sections.push(
    `2. **Explore the codebase** to understand the project structure, existing patterns, and what already exists.`,
  );
  sections.push(
    `3. **Analyze the task** above and determine what needs to be built.`,
  );
  sections.push(
    `4. **Break it down** into small, ordered user stories. Each story must be completable in ONE context window (one focused session).`,
  );
  sections.push(
    `5. **Write \`scripts/ralph/prd.json\`** with the structured stories.`,
  );
  sections.push("");
  sections.push(`## prd.json Format`);
  sections.push("");
  sections.push("```json");
  sections.push(`{`);
  sections.push(`  "project": "[Project Name from package.json]",`);
  sections.push(`  "branchName": "${branchName}",`);
  sections.push(
    `  "description": "[Feature description derived from the task]",`,
  );
  sections.push(`  "userStories": [`);
  sections.push(`    {`);
  sections.push(`      "id": "US-001",`);
  sections.push(`      "title": "[Short descriptive title]",`);
  sections.push(
    `      "description": "As a [user], I want [feature] so that [benefit]",`,
  );
  sections.push(`      "acceptanceCriteria": [`);
  sections.push(`        "Specific verifiable criterion",`);
  sections.push(`        "Typecheck passes"`);
  sections.push(`      ],`);
  sections.push(`      "priority": 1,`);
  sections.push(`      "passes": false,`);
  sections.push(`      "notes": ""`);
  sections.push(`    }`);
  sections.push(`  ]`);
  sections.push(`}`);
  sections.push("```");
  sections.push("");
  sections.push(`## Story Rules`);
  sections.push("");
  sections.push(
    `- **Right-sized:** Each story must fit in one context window. "Add a DB column" is good. "Build entire dashboard" is too big — split it.`,
  );
  sections.push(
    `- **Dependency order:** Schema/migrations first, then backend logic, then UI components. No story should depend on a later one.`,
  );
  sections.push(
    `- **Verifiable criteria:** Every acceptance criterion must be checkable, not vague. "Typecheck passes" must be included in every story.`,
  );
  sections.push(
    `- **UI stories:** Include "Verify in browser using Playwright MCP" as a criterion for any story that changes UI.`,
  );

  if (figmaUrls.length > 0) {
    sections.push(
      `- **Figma designs:** Reference the Figma URLs in relevant UI stories' acceptance criteria.`,
    );
  }

  sections.push("");
  sections.push(
    `## Important: Do NOT implement anything. Only generate prd.json.`,
  );
  sections.push("");
  sections.push(
    `Make sure \`scripts/ralph/\` directory exists (create it if needed), then write \`scripts/ralph/prd.json\`.`,
  );
  sections.push("");
  sections.push(
    `When you have written the prd.json file, output: TASK_COMPLETE`,
  );

  return sections.join("\n");
}

function extractFigmaUrls(task: ClickUpTask): string[] {
  const urls = new Set<string>();

  if (task.description) {
    for (const match of task.description.matchAll(FIGMA_URL_REGEX)) {
      urls.add(match[0]);
    }
  }

  for (const field of task.custom_fields) {
    if (typeof field.value === "string" && FIGMA_URL_REGEX.test(field.value)) {
      urls.add(field.value);
    }
  }

  return Array.from(urls);
}

function formatChecklists(task: ClickUpTask): string {
  if (!task.checklists.length) return "";

  const lines = ["\n## Acceptance Criteria\n"];
  for (const checklist of task.checklists) {
    for (const item of checklist.items) {
      const check = item.resolved ? "[x]" : "[ ]";
      lines.push(`- ${check} ${item.name}`);
    }
  }
  return lines.join("\n");
}
