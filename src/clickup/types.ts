export interface ClickUpChecklist {
  id: string;
  items: {
    id: string;
    name: string;
    resolved: boolean;
  }[];
  name: string;
}

export interface ClickUpCustomField {
  id: string;
  name: string;
  type: string;
  value?: unknown;
}

export interface ClickUpFolder {
  id: string;
  lists: ClickUpList[];
  name: string;
}

export interface ClickUpList {
  id: string;
  name: string;
}

export interface ClickUpSpace {
  id: string;
  name: string;
}

export interface ClickUpTask {
  assignees: { id: number; username: string }[];
  checklists: ClickUpChecklist[];
  custom_fields: ClickUpCustomField[];
  date_created: string;
  description: string;
  id: string;
  name: string;
  status: {
    status: string;
    type: string;
  };
  url: string;
}

export interface ClickUpTasksResponse {
  tasks: ClickUpTask[];
}

export interface ClickUpTeam {
  id: string;
  name: string;
}

export interface ClickUpTeamsResponse {
  teams: ClickUpTeam[];
}

export interface ClickUpUser {
  email: string;
  id: number;
  username: string;
}

export interface ClickUpWebhookPayload {
  event: string;
  history_items: {
    after: {
      email: string;
      id: number;
      username: string;
    };
    field: string;
  }[];
  task_id: string;
  webhook_id: string;
}
