import { request, sessionContext, Material } from "./api";
export type Template =
  | "memory"
  | "timeshare"
  | "printer"
  | "layers"
  | "perspectives"
  | "goals"
  | "resources"
  | "roles"
  | "concurrency"
  | "race"
  | "async"
  | "history";
export const templates: Record<Template, string> = {
  memory: "空分内存分配",
  timeshare: "单核时间共享",
  printer: "虚拟打印队列",
  layers: "系统分层与请求路径",
  perspectives: "四个观察角度",
  goals: "操作系统五个目标",
  resources: "五类资源管理",
  roles: "管理员与服务员",
  concurrency: "单核/双核并发与并行",
  race: "共享变量竞争",
  async: "异步I/O事件",
  history: "系统模块与历史口径",
};
export interface SimConfig {
  template: Template;
  capacity?: number;
  allocation_a?: number;
  allocation_b?: number;
  allocation_c?: number;
  quantum?: number;
  tasks?: number;
  duration?: number;
  cores?: number;
  arrival_gap?: number;
  io_delay?: number;
  switch_cost?: number;
  initial?: number;
  locked?: boolean;
  interleaved?: boolean;
  scenario?: number;
}
export const blockKinds = {
  intro: "问题导入",
  concept: "核心概念",
  explanation: "原理精讲",
  case: "典型案例",
  mistake: "易错点",
  summary: "总结",
  text: "拓展阅读",
  interaction: "交互演示",
  image: "图片",
  chart: "数据图表",
  diagram: "知识关系图 / 流程图",
};
export interface Diagram {
  code: string;
  title: string;
  type: "relation" | "flow";
  nodes: { id: string; label: string; x: number; y: number }[];
  edges: {
    source: string;
    target: string;
    label: string;
    direction: "directed" | "undirected" | "unconfirmed";
  }[];
  note: string;
}
export interface ContentBlock {
  id: string;
  kind: keyof typeof blockKinds;
  title: string;
  text: string;
  config?: SimConfig | null;
  asset_id?: number | null;
  alt?: string;
  labels?: string[];
  values?: number[];
  unit?: string;
  diagram?: Diagram | null;
}
export interface Section {
  id: number;
  chapter_id: number;
  code: string;
  title: string;
  sort_order: number;
  published: boolean;
}
export interface Content {
  id?: number;
  chapter_id: number;
  section_id: number | null;
  code: string;
  title: string;
  summary: string;
  sort_order: number;
  minutes: number | null;
  emphasis: string;
  objectives: string;
  source_title: string;
  printed_pages: string;
  pdf_pages: string;
  source_note: string;
  blocks: ContentBlock[];
  block_kinds?: ContentBlock["kind"][];
  related_ids: number[];
  lab: boolean;
  edit_version?: number;
  revision_id?: number;
  published?: boolean;
  archived?: boolean;
  managed?: boolean;
  materials?: Material[];
  related?: { id: number; title: string; chapter_id: number }[];
}
export function newContent(): Content {
  return {
    chapter_id: 0,
    section_id: null,
    code: "",
    title: "",
    summary: "",
    sort_order: 0,
    minutes: null,
    emphasis: "",
    objectives: "",
    source_title: "",
    printed_pages: "",
    pdf_pages: "",
    source_note: "",
    blocks: [
      "intro",
      "concept",
      "explanation",
      "case",
      "mistake",
      "summary",
    ].map((kind) => ({
      id: crypto.randomUUID(),
      kind: kind as ContentBlock["kind"],
      title: blockKinds[kind as ContentBlock["kind"]],
      text: "",
    })),
    related_ids: [],
    lab: false,
  };
}
export interface Progress {
  revision_id: number;
  read_done: boolean;
  self_assessed: boolean;
  position: string;
  note: string;
  bookmarked: boolean;
  version: number;
  has_previous_version?: boolean;
  completed_blocks?: string[];
  practice_completed?: boolean;
}
export interface Frame {
  step: number;
  time: number;
  label: string;
  explanation: string;
  nodes: { name: string; state: string; value?: number }[];
}
export interface Trace {
  id: number;
  engine_version: number;
  frames: Frame[];
  config: SimConfig;
  disclaimer: string;
}
export interface Revision {
  id: number;
  body: Content;
  created_at: string;
  author_id: number;
  is_published: boolean;
}
export const digitalApi = {
  resume: () =>
    request<{
      point: number;
      chapter: number;
      title: string;
      position: string;
    } | null>("/my/learning-resume"),
  sections: (chapter?: number) =>
    request<Section[]>(`/sections${chapter ? `?chapter_id=${chapter}` : ""}`),
  saveSection: (body: Omit<Section, "id">, id?: number) =>
    request<Section>(`/teacher/sections${id ? "/" + id : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body),
    }),
  list: (chapter?: number) =>
    request<Content[]>(
      `/learning-content${chapter ? `?chapter_id=${chapter}` : ""}`,
    ),
  detail: (id: number, preview = false) =>
    request<Content>(
      `/learning-content/${id}${preview ? "?preview=true" : ""}`,
    ),
  teacherDetail: (id: number) =>
    request<Content>(`/teacher/learning-content/${id}`),
  planTitles: (
    chapter_id: number,
    section_id: number | null,
    titles: string[],
  ) =>
    request<Content[]>("/teacher/learning-outline", {
      method: "POST",
      body: JSON.stringify({ chapter_id, section_id, titles }),
    }),
  teacherList: () => request<Content[]>("/teacher/learning-content"),
  save: (content: Content) => {
    const {
      id,
      edit_version,
      revision_id,
      published,
      archived,
      managed,
      materials,
      related,
      ...body
    } = content;
    return request<Content>(`/teacher/learning-content${id ? "/" + id : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify({ ...body, expected_version: edit_version || 0 }),
    });
  },
  action: (
    id: number,
    action: "publish" | "withdraw" | "restore" | "archive",
    version: number,
    revision?: number,
  ) =>
    request<{ edit_version: number }>(
      `/teacher/learning-content/${id}/${action}`,
      {
        method: "POST",
        body: JSON.stringify({
          expected_version: version,
          revision_id: revision,
        }),
      },
    ),
  history: (id: number) =>
    request<Revision[]>(`/teacher/learning-content/${id}/history`),
  upload: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ id: number }>("/teacher/learning-assets", {
      method: "POST",
      body,
    });
  },
  progress: (id: number) =>
    request<Progress>(`/learning-content/${id}/progress`),
  saveProgress: (id: number, p: Progress) =>
    request<{ version: number }>(`/learning-content/${id}/progress`, {
      method: "PUT",
      body: JSON.stringify({
        revision_id: p.revision_id,
        expected_version: p.version,
        read_done: !!p.read_done,
        self_assessed: !!p.self_assessed,
        position: p.position,
        note: p.note,
        bookmarked: !!p.bookmarked,
      }),
    }),
  run: (
    id: number,
    revision: number,
    block: ContentBlock,
    config: SimConfig,
    preview = false,
  ) =>
    request<Trace>(
      `/learning-content/${id}/run${preview ? "?preview=true" : ""}`,
      {
        method: "POST",
        body: JSON.stringify({
          revision_id: revision,
          block_id: block.id,
          config,
        }),
      },
    ),
  complete: (id: number, step: number) =>
    request("/interaction-runs/" + id + "/complete", {
      method: "POST",
      body: JSON.stringify({ last_step: step }),
    }),
};
export const assetUrl = (id: number) =>
  `/api/learning-assets/${id}?session_context=${encodeURIComponent(sessionContext())}`;
