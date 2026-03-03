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

export interface ReviewRun {
  comment_count: number;
  cost_usd: number | null;
  error_message: string | null;
  id: number;
  pr_branch: string;
  pr_number: number;
  pr_title: string;
  pr_url: string;
  repo_full_name: string;
  review_id: number | null;
  started_at: string;
  status: string;
  updated_at: string;
}

export interface WsReviewOutputMessage {
  type: "review:output";
  reviewId: number;
  stream: "stdout" | "stderr";
  line: string;
  ts: string;
}

export interface WsReviewStatusMessage {
  type: "review:status";
  reviewId: number;
  status: string;
}

export interface WsReviewQueueMessage {
  type: "review:queue";
  running: number | null;
  queue: number[];
}

export type WsMessage =
  | WsOutputMessage
  | WsStatusMessage
  | WsQueueMessage
  | WsReviewOutputMessage
  | WsReviewStatusMessage
  | WsReviewQueueMessage;

export interface ClonedRepo {
  id: number;
  repo_url: string;
  disk_path: string;
  size_bytes: number | null;
  cloned_at: string;
  last_used_at: string;
}
