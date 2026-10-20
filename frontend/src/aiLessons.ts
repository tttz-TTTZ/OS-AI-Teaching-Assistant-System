import { request } from "./api";
import { SourcePick, SourcePreview, AIJobSummary } from "./aiQuestions";
export const lessonKinds = {
  intro: "问题导入",
  concept: "核心概念",
  explanation: "原理精讲",
  case: "典型案例",
  mistake: "易错辨析",
  summary: "总结与练习指引",
  text: "补充正文",
};
export interface LessonBlock {
  kind: keyof typeof lessonKinds;
  title: string;
  text: string;
}
export interface LessonPoint {
  title: string;
  summary: string;
  objectives: string;
  blocks: LessonBlock[];
  source_ref: string;
  source_quote: string;
  teaching_note: string;
}
export interface LessonSection {
  section_id: number | null;
  code: string;
  title: string;
  points: LessonPoint[];
}
export interface LessonPlan {
  chapter_id: number;
  sections: LessonSection[];
}
export interface LessonJob extends AIJobSummary {
  version: number;
  plan: LessonPlan;
  sources: SourcePreview;
  imported: { id: number; title: string; section_id: number }[];
}
export const aiLessonApi = {
  jobs: () => request<AIJobSummary[]>("/teacher/ai-lessons/jobs"),
  job: (id: number) => request<LessonJob>(`/teacher/ai-lessons/jobs/${id}`),
  generate: (body: {
    sources: SourcePick[];
    fingerprint: string;
    chapter_id: number;
    max_points: number;
    instructions: string;
    request_key: string;
  }) =>
    request<LessonJob>("/teacher/ai-lessons/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  save: (job: LessonJob, plan: LessonPlan) =>
    request<LessonJob>(`/teacher/ai-lessons/jobs/${job.id}`, {
      method: "PUT",
      body: JSON.stringify({ plan, expected_version: job.version }),
    }),
  import: (job: LessonJob, plan: LessonPlan, reviewed: boolean) =>
    request<LessonJob>(`/teacher/ai-lessons/jobs/${job.id}/import`, {
      method: "POST",
      body: JSON.stringify({ plan, expected_version: job.version, reviewed }),
    }),
};
