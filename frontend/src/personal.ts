import { request } from "./api";
import { SimConfig, Trace } from "./digital";
export const modeNames = {
  explain: "通俗讲解",
  deep: "深入分析",
  map: "思维导图",
  code: "代码讲解",
  animation: "动画理解",
  summary: "复习总结",
  flashcards: "知识闪卡",
};
export type Mode = keyof typeof modeNames;
export interface PersonalSource {
  document_id: number;
  start_page: number;
  end_page: number | null;
}
export interface Evidence {
  chunks: {
    ref: string;
    title: string;
    document_id: number;
    page: number;
    text: string;
  }[];
  fingerprint: string;
  characters: number;
  indexed_chunks: number;
  method: string;
  warnings: string[];
  pilot_plan?: {
    selected_pages: number;
    text_chunks: number;
    batches: number;
    cached_batches: number;
    estimated_calls: number;
    scope: string;
    excluded: {
      ref: string;
      document_id: number;
      page: number;
      reason: string;
    }[];
    unreadable_pages: { document_id: number; page: number }[];
  };
}
export interface PersonalConfig {
  chapter_id: number;
  section_id: number | null;
  sources: PersonalSource[];
  topic: string;
  source_overview?: boolean;
  analysis_mode?: "quick" | "section";
  analysis_confirmed?: boolean;
  weakness: string;
  level: string;
  kind: "learning" | "practice";
  modes: Mode[];
  question_kinds: string[];
  count: number;
  parent_id: number | null;
}
export interface LearningModule {
  mode: Mode;
  title: string;
  text: string;
  source_ref: string;
  source_quote: string;
  nodes: {
    id: string;
    label: string;
    parent: string | null;
    fact_ids?: string[];
  }[];
  code: string;
  language: string;
  simulation: SimConfig | null;
  frames: { label: string; explanation: string; nodes: string[] }[];
  cards?: { front: string; back: string; fact_ids?: string[] }[];
}
export interface PersonalQuestion {
  prompt: string;
  kind: string;
  options: string[];
  items: string[];
  source_ref: string;
  source_quote: string;
}
export interface PilotAnalysis {
  plan: NonNullable<Evidence["pilot_plan"]>;
  stage: string;
  calls_used: number;
  cached_batches: number;
  facts: {
    id: string;
    title: string;
    statement: string;
    evidence: { ref: string; quote: string }[];
  }[];
  concepts: { id: string; title: string; fact_ids: string[] }[];
  metrics: {
    processed_chunks: number;
    selected_chunks: number;
    facts: number;
    concepts: number;
    artifact_fact_coverage: number;
    duplicate_questions: number | null;
  };
}
export interface PersonalJob {
  id: number;
  chapter_id: number;
  kind: string;
  status: string;
  error: string;
  model: string;
  created_at: string;
  note: string;
  bookmarked: boolean;
  version: number;
  body: {
    title: string;
    modules?: LearningModule[];
    questions?: PersonalQuestion[];
    requested_count?: number;
    pilot?: PilotAnalysis;
    answer?: string;
    basis?: "general" | "selected_sources";
    conversation?: { role: "user" | "assistant"; content: string }[];
    citations?: { source_ref: string; source_quote: string }[];
  };
  sources: Evidence;
  config: PersonalConfig;
}
export interface PersonalSummary {
  id: number;
  kind: string;
  status: string;
  created_at: string;
  bookmarked: boolean;
  config_json: string;
}
export interface PersonalGrade {
  id?: number;
  score: number;
  total: number;
  ungraded: number;
  results: {
    index: number;
    prompt: string;
    correct: boolean | null;
    selected: unknown;
    answer: unknown;
    explanation: string;
  }[];
}
export const personalApi = {
  ask: (
    question: string,
    chapter_id: number,
    parent_id: number | null,
    sources: PersonalSource[],
    use_sources: boolean,
    key: string,
  ) =>
    request<PersonalJob>("/student/personal/ask", {
      method: "POST",
      body: JSON.stringify({
        question,
        chapter_id: chapter_id || null,
        parent_id,
        sources,
        use_sources,
        request_key: key,
      }),
    }),
  progress: (key: string) =>
    request<{
      stage: string;
      completed_batches: number;
      total_batches: number;
      calls_used: number;
    }>(`/student/personal/progress/${encodeURIComponent(key)}`),
  status: () =>
    request<{ configured: boolean; model: string; daily_limit: number }>(
      "/student/personal/status",
    ),
  preview: (body: PersonalConfig) =>
    request<Evidence>("/student/personal/sources/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  generate: (body: PersonalConfig, evidence: Evidence, key: string) =>
    request<PersonalJob>("/student/personal/generate", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        fingerprint: evidence.fingerprint,
        request_key: key,
      }),
    }),
  jobs: () => request<PersonalSummary[]>("/student/personal/jobs"),
  job: (id: number) => request<PersonalJob>(`/student/personal/jobs/${id}`),
  note: (job: PersonalJob, note: string, bookmarked: boolean) =>
    request<PersonalJob>(`/student/personal/jobs/${job.id}/note`, {
      method: "PUT",
      body: JSON.stringify({ note, bookmarked, expected_version: job.version }),
    }),
  simulate: (id: number, module: number, config: SimConfig) =>
    request<Trace>(`/student/personal/jobs/${id}/simulate`, {
      method: "POST",
      body: JSON.stringify({ module, config }),
    }),
  submit: (id: number, answers: Record<number, unknown>, request_key: string) =>
    request<PersonalGrade>(`/student/personal/jobs/${id}/submit`, {
      method: "POST",
      body: JSON.stringify({ answers, request_key }),
    }),
  attempts: (id: number) =>
    request<PersonalGrade[]>(`/student/personal/jobs/${id}/attempts`),
};
