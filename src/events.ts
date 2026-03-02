import type { ChildProcess } from "node:child_process";

import { EventEmitter } from "node:events";

export interface TaskEvents {
  "output": { line: string; runId: number; stream: "stderr" | "stdout" };
  "queue:changed": { queue: string[]; runningTaskId: null | string };
  "status:changed": { runId: number; status: string };
}

class TaskEventBus extends EventEmitter {
  emit<K extends keyof TaskEvents>(event: K, data: TaskEvents[K]): boolean {
    return super.emit(event, data);
  }

  off<K extends keyof TaskEvents>(
    event: K,
    listener: (data: TaskEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }

  on<K extends keyof TaskEvents>(
    event: K,
    listener: (data: TaskEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }
}

export const taskEvents = new TaskEventBus();

/** Map<runId, ChildProcess> for cancellation */
export const activeProcesses = new Map<number, ChildProcess>();

/** Map<runId, string[]> — ring buffer of last 1000 lines per runId */
const OUTPUT_BUFFER_SIZE = 1000;
export const outputBuffer = new Map<number, string[]>();

export function appendOutput(runId: number, line: string): void {
  let buffer = outputBuffer.get(runId);
  if (!buffer) {
    buffer = [];
    outputBuffer.set(runId, buffer);
  }
  buffer.push(line);
  if (buffer.length > OUTPUT_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - OUTPUT_BUFFER_SIZE);
  }
}

export function emitSystemLine(runId: number, message: string): void {
  const line = `[system] ${message}`;
  appendOutput(runId, line);
  taskEvents.emit("output", { line, runId, stream: "stdout" });
}

/** Set of runIds that have been cancelled */
export const cancelledRuns = new Set<number>();
