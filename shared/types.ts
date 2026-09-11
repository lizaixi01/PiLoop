export interface Feedback {
  id: string;
  text: string;
  scope: string;
  createdAt: string;
  active: boolean;
  sourceTaskId?: string;
  supersedes?: string;
}
export interface Project {
  id: string;
  name: string;
  source: string;
  entry: string;
  activeRevision: string;
  createdAt: string;
  feedback: Feedback[];
}
export interface Evidence {
  writeVersion?: number;
  id: string;
  url: string;
  screenshot: string;
  width: number;
  height: number;
  title: string;
  overflow: boolean;
  consoleErrors: string[];
  actions: string[];
  checks: { label: string; passed: boolean }[];
  createdAt: string;
}
export interface Change {
  path: string;
  kind: "added" | "modified" | "deleted";
  before: string;
  after: string;
}
export interface Task {
  writeVersion?: number;
  id: string;
  projectId: string;
  prompt: string;
  provider: string;
  modelId: string;
  status:
    "running" | "ready" | "failed" | "cancelled" | "interrupted" | "adopted";
  baseRevision: string;
  revision: string;
  createdAt: string;
  endedAt?: string;
  recalled: Feedback[];
  events: { at: string; kind: string; text: string }[];
  evidence: Evidence[];
  changes: Change[];
  result: string;
  error?: string;
}
export interface State {
  projects: Project[];
  tasks: Task[];
}
