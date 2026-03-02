import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { getConfig } from "../config.js";
import { activeProcesses, appendOutput, taskEvents } from "../events.js";
import { createChildLogger } from "../logger.js";

const execFileAsync = promisify(execFile);
const log = createChildLogger("claude");

const KICKOFF_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes for kickoff
const RALPH_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes for ralph loop

export interface ClaudeResult {
  costUsd?: number;
  output: string;
  success: boolean;
}

/**
 * Internal: spawn a Claude Code process and collect output.
 */
// stream-json events are loosely typed — we parse what we recognize

/**
 * Run Claude Code headlessly with a prompt string.
 * Used for the kickoff phase (generating prd.json).
 */
export async function runClaude(
  repoPath: string,
  prompt: string,
  timeoutMs = KICKOFF_TIMEOUT_MS,
  runId?: number,
): Promise<ClaudeResult> {
  const config = getConfig();

  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--max-turns",
    String(config.CLAUDE_MAX_TURNS),
    "--append-system-prompt",
    "When you have fully completed the task and verified everything works, output exactly: TASK_COMPLETE",
  ];

  log.info(
    { maxTurns: config.CLAUDE_MAX_TURNS, repoPath },
    "Starting Claude Code (kickoff)",
  );

  return spawnClaudeProcess(repoPath, args, timeoutMs, runId);
}

/**
 * Copy the ralph loop files into the target repo and run ralph.sh.
 * The loop spawns fresh Claude instances per iteration.
 */
export async function runRalphLoop(
  repoPath: string,
  maxIterations: number,
  runId?: number,
): Promise<ClaudeResult> {
  const ralphDir = join(repoPath, "scripts", "ralph");

  // Ensure the ralph directory exists in the target repo
  mkdirSync(ralphDir, { recursive: true });

  // Copy CLAUDE.md into target repo (ralph.sh reads it via stdin)
  // Only copy if not already present (the kickoff phase may have created prd.json there already)
  const templateDir = resolve(
    import.meta.dirname,
    "..",
    "..",
    "scripts",
    "ralph",
  );
  const claudeMdDest = join(ralphDir, "CLAUDE.md");
  if (!existsSync(claudeMdDest)) {
    copyFileSync(join(templateDir, "CLAUDE.md"), claudeMdDest);
  }

  // Verify prd.json exists
  const prdPath = join(ralphDir, "prd.json");
  if (!existsSync(prdPath)) {
    return {
      output:
        "prd.json not found at scripts/ralph/prd.json. Kickoff phase failed to generate it.",
      success: false,
    };
  }

  // Copy ralph.sh into target repo
  const ralphShDest = join(ralphDir, "ralph.sh");
  copyFileSync(join(templateDir, "ralph.sh"), ralphShDest);
  await execFileAsync("chmod", ["+x", ralphShDest]);

  log.info({ maxIterations, repoPath }, "Starting Ralph loop");

  return new Promise<ClaudeResult>((resolve) => {
    const child = spawn("bash", [ralphShDest, String(maxIterations)], {
      cwd: repoPath,
      env: {
        ...process.env,
        RALPH_MAX_ITERATIONS: String(maxIterations),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (runId !== undefined) {
      activeProcesses.set(runId, child);
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      for (const line of chunk.split("\n").filter(Boolean)) {
        log.info({ line: line.slice(0, 500) }, "Ralph output");
        if (runId !== undefined) {
          appendOutput(runId, line);
          taskEvents.emit("output", { line, runId, stream: "stdout" });
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      for (const line of chunk.split("\n").filter(Boolean)) {
        log.debug({ line: line.slice(0, 500) }, "Ralph stderr");
        if (runId !== undefined) {
          appendOutput(runId, line);
          taskEvents.emit("output", { line, runId, stream: "stderr" });
        }
      }
    });

    const timeout = setTimeout(() => {
      log.error("Ralph loop timed out, killing process");
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, RALPH_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (runId !== undefined) {
        activeProcesses.delete(runId);
      }

      const output = stdout + stderr;
      const success = code === 0;

      log.info(
        { code, outputLength: output.length, success },
        "Ralph loop finished",
      );

      resolve({
        output,
        success,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if (runId !== undefined) {
        activeProcesses.delete(runId);
      }
      log.error(err, "Failed to spawn Ralph loop");
      resolve({
        output: `Failed to spawn Ralph loop: ${err.message}`,
        success: false,
      });
    });
  });
}

function extractStreamLine(event: Record<string, unknown>): null | string {
  const type = typeof event.type === "string" ? event.type : "";

  // assistant — extract text content from message
  if (type === "assistant") {
    const msg = event.message as undefined | { content?: { text?: string; type?: string; name?: string }[] };
    if (msg?.content) {
      const parts: string[] = [];
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          parts.push(block.text);
        } else if (block.type === "tool_use" && block.name) {
          parts.push(`[tool: ${block.name}]`);
        }
      }
      if (parts.length) return parts.join("");
    }
    return null;
  }

  // content block delta
  if (type === "content_block_delta") {
    const block = event.content_block as undefined | { text?: string };
    if (block?.text) return block.text;
  }

  // result
  if (type === "result") {
    return typeof event.result === "string" ? event.result : null;
  }

  // system messages
  if (type === "system") {
    const msg = typeof event.message === "string" ? event.message : null;
    if (msg) return `[system] ${msg}`;
    return null;
  }

  // user messages (tool results) — skip, not useful in output
  if (type === "user") return null;

  // rate limit events — skip
  if (type === "rate_limit_event") return null;

  return null;
}

function spawnClaudeProcess(
  cwd: string,
  args: string[],
  timeoutMs: number,
  runId?: number,
): Promise<ClaudeResult> {
  return new Promise<ClaudeResult>((resolve) => {
    // Strip Claude session env vars to avoid nested-session issues
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_SESSION;

    log.info({ args, cwd, runId }, "Spawning claude process");
    const child = spawn("claude", args, {
      cwd,
      env: cleanEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    log.info({ pid: child.pid, runId }, "Claude process spawned");

    // Close stdin immediately — claude -p doesn't need it and may hang waiting for it
    child.stdin.end();

    child.on("spawn", () => {
      log.info({ pid: child.pid, runId }, "Claude process spawn event confirmed");
    });

    if (runId !== undefined) {
      activeProcesses.set(runId, child);
    }

    let stdout = "";
    let stderr = "";
    let costUsd: number | undefined;
    let resultText = "";
    let lineBuf = "";

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      log.info({ bytes: data.length, runId }, "stdout data received");
      stdout += chunk;

      // stream-json outputs newline-delimited JSON
      lineBuf += chunk;
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() ?? "";

      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed) as Record<string, unknown>;

          if (typeof event.cost_usd === "number") {
            costUsd = event.cost_usd;
          }
          if (event.type === "result" && typeof event.result === "string") {
            resultText = event.result;
          }

          const display = extractStreamLine(event);
          if (runId !== undefined) {
            // Always emit something — either the parsed display or the event type
            const evtType = typeof event.type === "string" ? event.type : "event";
            const evtSub = typeof event.subtype === "string" ? `:${event.subtype}` : "";
            const line = display ?? `[${evtType}${evtSub}]`;
            for (const l of line.split("\n").filter(Boolean)) {
              log.debug({ line: l.slice(0, 500) }, "Claude output");
              appendOutput(runId, l);
              taskEvents.emit("output", { line: l, runId, stream: "stdout" });
            }
          }
        } catch {
          // Not valid JSON — emit raw line
          if (trimmed && runId !== undefined) {
            log.debug({ line: trimmed.slice(0, 500) }, "Claude output");
            appendOutput(runId, trimmed);
            taskEvents.emit("output", { line: trimmed, runId, stream: "stdout" });
          }
        }
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString();
      log.info({ bytes: data.length, runId }, "stderr data received");
      stderr += chunk;
      for (const line of chunk.split("\n").filter(Boolean)) {
        log.debug({ line: line.slice(0, 500) }, "Claude stderr");
        if (runId !== undefined) {
          appendOutput(runId, line);
          taskEvents.emit("output", { line, runId, stream: "stderr" });
        }
      }
    });

    const timeout = setTimeout(() => {
      log.error({ timeoutMs }, "Claude timed out, killing process");
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (runId !== undefined) {
        activeProcesses.delete(runId);
      }

      if (code !== 0) {
        log.error(
          { code, stderr: stderr.slice(0, 2000) },
          "Claude exited with error",
        );
        resolve({
          output: stderr || stdout,
          success: false,
        });
        return;
      }

      const parsedOutput = resultText || stdout;
      const success = parsedOutput.includes("TASK_COMPLETE");
      log.info(
        { costUsd, outputLength: parsedOutput.length, success },
        "Claude finished",
      );

      resolve({
        costUsd,
        output: parsedOutput,
        success,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if (runId !== undefined) {
        activeProcesses.delete(runId);
      }
      log.error(err, "Failed to spawn Claude");
      resolve({
        output: `Failed to spawn Claude: ${err.message}`,
        success: false,
      });
    });
  });
}
