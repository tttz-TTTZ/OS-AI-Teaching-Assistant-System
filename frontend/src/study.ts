import { request } from "./api";
export type Answer = number | number[] | string;
export interface StudyQuestion {
  id?: number;
  chapter_id: number;
  prompt: string;
  kind: "single" | "multiple" | "boolean" | "short" | "matching";
  options: string[];
  items: string[];
  correct: Answer;
  explanation: string;
  published: boolean;
  knowledge_ids: number[];
  version?: number;
}
export interface StudyResult {
  attempt_id: number;
  score: number;
  total: number;
  ungraded: number;
  results: {
    id: number;
    selected: Answer;
    correct: boolean | null;
    answer: Answer;
    explanation: string;
    prompt: string;
    kind: StudyQuestion["kind"];
    options: string[];
    items: string[];
  }[];
}
export interface Attempt extends StudyResult {
  id: number;
  point_id: number | null;
  created_at: string;
}
export const studyApi = {
  feedback: (id: number, message: string) =>
    request(`/learning-content/${id}/feedback`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  summary: () =>
    request<{
      progress: {
        point_id: number;
        title: string;
        learners: number;
        read_count: number;
        self_assessed_count: number;
      }[];
      attempts: number;
      feedback: {
        id: number;
        title: string;
        username: string;
        message: string;
        created_at: string;
      }[];
    }>("/teacher/study/summary"),
  teacher: () => request<StudyQuestion[]>("/teacher/study/questions"),
  save: (q: StudyQuestion) => {
    const { id, version, ...body } = q;
    return request<StudyQuestion>(
      `/teacher/study/questions${id ? "/" + id : ""}`,
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify({ ...body, expected_version: version || 0 }),
      },
    );
  },
  questions: (chapter: number, point?: number) =>
    request<StudyQuestion[]>(
      `/study/questions?${point ? "knowledge_id=" + point : "chapter_id=" + chapter}`,
    ),
  submit: (
    answers: Record<number, Answer>,
    versions: Record<number, number>,
    key: string,
    point?: number,
    revision = 0,
  ) =>
    request<StudyResult>("/study/submit", {
      method: "POST",
      body: JSON.stringify({
        answers,
        versions,
        request_key: key,
        knowledge_id: point,
        revision_id: revision,
      }),
    }),
  attempts: () => request<Attempt[]>("/study/attempts"),
};
export const typeNames = {
  single: "单选",
  multiple: "多选",
  boolean: "判断",
  short: "简答",
  matching: "匹配/分类",
};
