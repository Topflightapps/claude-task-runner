export interface ClaudeReviewOutput {
  comments: ReviewComment[];
  summary: string;
}

export interface GitHubPullRequestEvent {
  action: string;
  assignee?: {
    login: string;
  };
  number: number;
  pull_request: {
    head: {
      ref: string;
    };
    html_url: string;
    number: number;
    title: string;
    user: {
      login: string;
    };
  };
  repository: {
    full_name: string;
  };
  requested_reviewer?: {
    login: string;
  };
}

export interface GitHubPullRequestReviewEvent {
  action: string;
  pull_request: {
    number: number;
  };
  repository: {
    full_name: string;
  };
  review: {
    id: number;
    state: string;
  };
}

export interface PendingReviewResponse {
  id: number;
}

export interface ReviewComment {
  body: string;
  line: number;
  path: string;
  side?: "LEFT" | "RIGHT";
}
