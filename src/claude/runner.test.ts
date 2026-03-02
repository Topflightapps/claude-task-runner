import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { appendOutput, outputBuffer, taskEvents } from "../events.js";

// ─── extractStreamLine tests ───────────────────────────────────────────────

// We need to test the parsing logic directly. Since extractStreamLine is not
// exported, we replicate the logic here for unit testing, then test the
// integration via a real spawned process.

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

  if (type === "content_block_delta") {
    const block = event.content_block as undefined | { text?: string };
    if (block?.text) return block.text;
  }

  if (type === "result") {
    return typeof event.result === "string" ? event.result : null;
  }

  if (type === "system") {
    const msg = typeof event.message === "string" ? event.message : null;
    if (msg) return `[system] ${msg}`;
    return null;
  }

  if (type === "user") return null;
  if (type === "rate_limit_event") return null;

  return null;
}

describe("extractStreamLine", () => {
  it("extracts text from assistant message", () => {
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello world" }],
      },
    };
    expect(extractStreamLine(event)).toBe("Hello world");
  });

  it("extracts tool use from assistant message content", () => {
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read" }],
      },
    };
    expect(extractStreamLine(event)).toBe("[tool: Read]");
  });

  it("extracts mixed text and tool use", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me read that. " },
          { type: "tool_use", name: "Read" },
        ],
      },
    };
    expect(extractStreamLine(event)).toBe("Let me read that. [tool: Read]");
  });

  it("extracts text from content_block_delta", () => {
    const event = {
      type: "content_block_delta",
      content_block: { text: "partial output" },
    };
    expect(extractStreamLine(event)).toBe("partial output");
  });

  it("extracts result text", () => {
    const event = {
      type: "result",
      result: "TASK_COMPLETE",
    };
    expect(extractStreamLine(event)).toBe("TASK_COMPLETE");
  });

  it("returns null for result without string result", () => {
    const event = { type: "result", result: 42 };
    expect(extractStreamLine(event)).toBeNull();
  });

  it("extracts system message", () => {
    const event = {
      type: "system",
      message: "Starting up",
    };
    expect(extractStreamLine(event)).toBe("[system] Starting up");
  });

  it("returns null for user events", () => {
    expect(extractStreamLine({ type: "user" })).toBeNull();
  });

  it("returns null for rate_limit_event", () => {
    expect(extractStreamLine({ type: "rate_limit_event" })).toBeNull();
  });

  it("returns null for unknown event types", () => {
    expect(extractStreamLine({ type: "unknown_event" })).toBeNull();
    expect(extractStreamLine({ type: "init" })).toBeNull();
    expect(extractStreamLine({})).toBeNull();
  });

  it("handles missing fields gracefully", () => {
    expect(
      extractStreamLine({ type: "assistant" }),
    ).toBeNull();
    expect(
      extractStreamLine({
        type: "assistant",
        message: {},
      }),
    ).toBeNull();
    expect(
      extractStreamLine({
        type: "assistant",
        message: { content: [] },
      }),
    ).toBeNull();
  });
});

// ─── Event bus integration tests ────────────────────────────────────────────

describe("taskEvents output pipeline", () => {
  it("emits output events that can be subscribed to", () => {
    const received: { line: string; runId: number; stream: string }[] = [];
    const handler = (data: {
      line: string;
      runId: number;
      stream: "stderr" | "stdout";
    }) => {
      received.push(data);
    };
    taskEvents.on("output", handler);

    taskEvents.emit("output", {
      line: "test line",
      runId: 1,
      stream: "stdout",
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      line: "test line",
      runId: 1,
      stream: "stdout",
    });

    taskEvents.off("output", handler);
  });

  it("appendOutput stores lines in buffer", () => {
    outputBuffer.delete(999);
    appendOutput(999, "line 1");
    appendOutput(999, "line 2");

    const buf = outputBuffer.get(999);
    expect(buf).toEqual(["line 1", "line 2"]);

    outputBuffer.delete(999);
  });
});

// ─── Child process stdout streaming test ────────────────────────────────────
// This is the critical test: verify that spawning a process with stdio pipes
// actually receives streaming stdout data events (not buffered until close).

describe("child process streaming", () => {
  it("receives stdout data events in real-time from a piped process", async () => {
    const dataTimestamps: number[] = [];

    await new Promise<void>((resolve, reject) => {
      // Script that outputs lines with 100ms delays
      const child = spawn(
        "bash",
        [
          "-c",
          'for i in 1 2 3; do echo "line $i"; sleep 0.1; done',
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      child.stdout.on("data", () => {
        dataTimestamps.push(Date.now());
      });

      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Process exited with code ${code}`));
          return;
        }
        resolve();
      });

      child.on("error", reject);

      setTimeout(() => {
        child.kill();
        reject(new Error("Timeout"));
      }, 5000);
    });

    // We should have received multiple data events, not just one
    expect(dataTimestamps.length).toBeGreaterThanOrEqual(2);

    // And they should be spread out in time (not all at once)
    if (dataTimestamps.length >= 2) {
      const span =
        dataTimestamps[dataTimestamps.length - 1]! - dataTimestamps[0]!;
      expect(span).toBeGreaterThan(50); // at least 50ms spread
    }
  });

  it("receives NDJSON lines and can parse them individually", async () => {
    const parsed: Record<string, unknown>[] = [];
    let lineBuf = "";

    await new Promise<void>((resolve, reject) => {
      // Simulate stream-json: output NDJSON lines with delays
      const script = [
        'echo \'{"type":"system","message":"init"}\'',
        "sleep 0.1",
        'echo \'{"type":"assistant","subtype":"message","message":{"content":[{"type":"text","text":"Hello"}]}}\'',
        "sleep 0.1",
        'echo \'{"type":"result","result":"done","cost_usd":0.05}\'',
      ].join("; ");

      const child = spawn("bash", ["-c", script], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      child.stdout.on("data", (data: Buffer) => {
        lineBuf += data.toString();
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";

        for (const rawLine of lines) {
          const trimmed = rawLine.trim();
          if (!trimmed) continue;
          try {
            parsed.push(JSON.parse(trimmed) as Record<string, unknown>);
          } catch {
            // skip
          }
        }
      });

      child.on("close", () => {
        // Process remaining buffer
        if (lineBuf.trim()) {
          try {
            parsed.push(
              JSON.parse(lineBuf.trim()) as Record<string, unknown>,
            );
          } catch {
            // skip
          }
        }
        resolve();
      });

      child.on("error", reject);

      setTimeout(() => {
        child.kill();
        reject(new Error("Timeout"));
      }, 5000);
    });

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ type: "system" });
    expect(parsed[1]).toMatchObject({ type: "assistant", subtype: "message" });
    expect(parsed[2]).toMatchObject({
      type: "result",
      result: "done",
      cost_usd: 0.05,
    });

    // Verify extractStreamLine works on each
    expect(extractStreamLine(parsed[0]!)).toBe("[system] init");
    expect(extractStreamLine(parsed[1]!)).toBe("Hello");
    expect(extractStreamLine(parsed[2]!)).toBe("done");
  });
});

// ─── Real Claude CLI stream-json test ───────────────────────────────────────
// Only runs if Claude CLI is available and we're NOT inside a Claude session.

describe("claude CLI stream-json", () => {
  const isNestedSession = !!process.env.CLAUDECODE;

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  (isNestedSession ? it.skip : it)("claude --output-format stream-json produces NDJSON events", async () => {
      const events: Record<string, unknown>[] = [];
      const dataChunks: string[] = [];
      let lineBuf = "";

      const tmpDir = mkdtempSync(join(tmpdir(), "claude-test-"));

      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          "claude",
          [
            "-p",
            "Reply with exactly: TEST_OK",
            "--output-format",
            "stream-json",
            "--verbose",
            "--dangerously-skip-permissions",
            "--max-turns",
            "1",
          ],
          {
            cwd: tmpDir,
            env: { ...process.env },
            stdio: ["pipe", "pipe", "pipe"],
          },
        );

        child.stdout.on("data", (data: Buffer) => {
          const chunk = data.toString();
          dataChunks.push(chunk);

          lineBuf += chunk;
          const lines = lineBuf.split("\n");
          lineBuf = lines.pop() ?? "";

          for (const rawLine of lines) {
            const trimmed = rawLine.trim();
            if (!trimmed) continue;
            try {
              events.push(JSON.parse(trimmed) as Record<string, unknown>);
            } catch {
              // Not JSON
            }
          }
        });

        child.on("close", () => {
          if (lineBuf.trim()) {
            try {
              events.push(
                JSON.parse(lineBuf.trim()) as Record<string, unknown>,
              );
            } catch {
              // skip
            }
          }
          resolve();
        });

        child.on("error", reject);

        setTimeout(() => {
          child.kill();
          reject(new Error("Claude timed out after 60s"));
        }, 60_000);
      });

      // Should have received at least one data chunk
      expect(dataChunks.length).toBeGreaterThan(0);

      // Should have parsed at least one JSON event
      expect(events.length).toBeGreaterThan(0);

      // Log what we got for debugging
      console.log(
        "Received event types:",
        events.map((e) => `${String(e.type)}${e.subtype ? `:${String(e.subtype)}` : ""}`),
      );
      console.log("Total data chunks:", dataChunks.length);
      console.log("Total parsed events:", events.length);

      // Should have a result event
      const resultEvent = events.find((e) => e.type === "result");
      expect(resultEvent).toBeDefined();
    });
});
