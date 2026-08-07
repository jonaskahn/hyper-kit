/* Shape of the opencode HTTP/SSE API this monitor consumes. Types mirror
   opencode's PermissionV1 / QuestionV1 schemas (packages/schema/src/v1). */

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  /* Patterns that a reply of 'always' would remember going forward -- not a
     yes/no flag (confirmed against a live opencode 1.18.15 instance). */
  always: string[];
  tool?: { messageID: string; callID: string };
}

export type PermissionReply = 'once' | 'always' | 'reject';

interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: QuestionInfo[];
  tool?: { messageID: string; callID: string };
}

/* SSE envelope: every /global/event data line is this object */
export interface SseEnvelope {
  directory?: string;
  project?: string;
  workspace?: string;
  payload: {
    id?: string;
    type: string;
    properties: unknown;
  };
}

export interface InstanceTarget {
  host: string;
  port: number;
  password?: string;
}

export interface HealthInfo {
  healthy: boolean;
  version: string;
}

/* GET /session and GET /session/{id}: each opencode session carries its own
   worktree, independent of any other session the same server happens to be
   hosting (one server commonly multiplexes many unrelated projects). */
export interface SessionInfo {
  id: string;
  directory: string;
  projectID: string;
  [key: string]: unknown;
}

export function isPermissionRequest(value: unknown): value is PermissionRequest {
  const v = value as PermissionRequest;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.id === 'string' &&
    typeof v.sessionID === 'string' &&
    typeof v.permission === 'string' &&
    Array.isArray(v.patterns)
  );
}

export function isQuestionRequest(value: unknown): value is QuestionRequest {
  const v = value as QuestionRequest;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.id === 'string' &&
    typeof v.sessionID === 'string' &&
    Array.isArray(v.questions)
  );
}
