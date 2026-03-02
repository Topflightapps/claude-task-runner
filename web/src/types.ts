export interface TaskRun {
  branch_name: string | null;
  clickup_id: string;
  cost_usd: number | null;
  error_message: string | null;
  id: number;
  pr_url: string | null;
  repo_url: string | null;
  started_at: string;
  status: string;
  updated_at: string;
}

export interface WsOutputMessage {
  type: "output";
  runId: number;
  stream: "stdout" | "stderr";
  line: string;
  ts: string;
}

export interface WsStatusMessage {
  type: "status";
  runId: number;
  status: string;
}

export interface WsQueueMessage {
  type: "queue";
  running: string | null;
  queue: string[];
}

export type WsMessage = WsOutputMessage | WsStatusMessage | WsQueueMessage;

export interface ClonedRepo {
  id: number;
  repo_url: string;
  disk_path: string;
  size_bytes: number | null;
  cloned_at: string;
  last_used_at: string;
}
