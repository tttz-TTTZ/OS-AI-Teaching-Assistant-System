import { request } from "./api";
import { StudyQuestion } from "./study";
export interface SourcePick {
  document_id: number;
  start_page: number;
  end_page: number;
}
export interface SourceChunk {
  ref: string;
  document_id: number;
  title: string;
  page: number;
  total_pages: number;
  text: string;
  file_sha256?: string;
}
export interface SourcePreview {
  chunks: SourceChunk[];
  warnings: string[];
  characters: number;
  fingerprint: string;
}
export interface AIDraft {
  id: number;
  job_id?: number;
  question: StudyQuestion;
  source_ref: string;
  source_quote: string;
  status: string;
  version: number;
  question_id?: number;
  source?: SourceChunk;
  model?: string;
}
export interface AIJobSummary {
  id: number;
  status: string;
  error: string;
  model: string;
  created_at: string;
}
export interface AIJob extends AIJobSummary {
  warnings: string[];
  drafts: AIDraft[];
  sources: SourcePreview;
  config: GenerationConfig;
}
export interface GenerationConfig {
  sources: SourcePick[];
  chapter_id: number;
  knowledge_ids: number[];
  kinds: StudyQuestion["kind"][];
  count: number;
  difficulty: string;
  focus: string;
  fingerprint: string;
  request_key?: string;
}
export const aiQuestionApi = {
  status: () =>
    request<{
      configured: boolean;
      model: string;
      max_count: number;
      max_characters: number;
    }>("/teacher/ai-questions/status"),
  preview: (sources: SourcePick[]) =>
    request<SourcePreview>("/teacher/ai-questions/sources/preview", {
      method: "POST",
      body: JSON.stringify({ sources }),
    }),
  generate: (body: GenerationConfig) =>
    request<AIJob>("/teacher/ai-questions/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  jobs: () => request<AIJobSummary[]>("/teacher/ai-questions/jobs"),
  job: (id: number) => request<AIJob>(`/teacher/ai-questions/jobs/${id}`),
  draft: (id: number) => request<AIDraft>(`/teacher/ai-questions/drafts/${id}`),
  save: (draft: AIDraft, question: StudyQuestion) =>
    request<{ version: number }>(`/teacher/ai-questions/drafts/${draft.id}`, {
      method: "PUT",
      body: JSON.stringify({ question, expected_version: draft.version }),
    }),
  import: (draft: AIDraft, question: StudyQuestion, reviewed: boolean) =>
    request<StudyQuestion>(`/teacher/ai-questions/drafts/${draft.id}/import`, {
      method: "POST",
      body: JSON.stringify({
        question,
        expected_version: draft.version,
        reviewed,
      }),
    }),
  reject: (draft: AIDraft) =>
    request(`/teacher/ai-questions/drafts/${draft.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ expected_version: draft.version }),
    }),
};
