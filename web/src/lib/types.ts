export type CallStatus =
  | "pending" | "downloaded" | "transcribed" | "done" | "error" | "failed";

export interface Call {
  id: string;
  job_id: string | null;
  source_row: number | null;
  drive_link: string | null;
  status: CallStatus | string;
  language: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Score {
  id: string;
  call_id: string;
  rubric_id: string | null;
  parameter: string;
  score: number;
  max_score: number;
  reasoning: string | null;
}

export interface RubricParameter {
  name: string;
  description: string;
  max_score: number;
}

export interface Rubric {
  id: string;
  name: string;
  parameters: RubricParameter[];
  is_active: boolean;
  created_at: string;
}

export interface IngestionJob {
  id: string;
  sheet_name: string;
  link_column: string;
  row_start: number;
  row_end: number;
  total_rows: number;
  status: string;
  error: string | null;
  created_at: string;
}

export interface ProcessUpdate {
  index: number;
  total: number;
  sheet_row: number;
  stage: string;
  message: string;
  call_id?: string | null;
  error?: string | null;
}
