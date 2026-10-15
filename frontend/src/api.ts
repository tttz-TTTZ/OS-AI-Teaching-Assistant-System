let csrfToken = "";
export function setCsrfToken(value: string) {
  csrfToken = value;
}
export interface Material {
  id: number;
  title: string;
  content: string;
  chapter: string;
  category: string;
  file_type: string | null;
  file_size: number | null;
  original_name: string | null;
  owner_id: number | null;
  chapter_id: number | null;
  course_id: number;
  published: boolean;
  knowledge_ids?: number[];
}
export interface ChatResult {
  id: number;
  answer: string;
  model: string;
  mode: string;
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login")
      window.dispatchEvent(new Event("auth-expired"));
    const error = await response.json().catch(() => ({}));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : Array.isArray(error.detail)
          ? error.detail.map((e: { msg: string }) => e.msg).join("；")
          : `请求失败（${response.status}）`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const api = {
  material: (id: number) => request<Material>(`/materials/${id}`),
  materials: (offset = 0, category = "all") =>
    request<Material[]>(
      `/materials?limit=50&offset=${offset}${category === "all" ? "" : `&category=${category}`}`,
    ),
  createMaterial: (body: Pick<Material, "title" | "content" | "chapter">) =>
    request<Material>("/materials", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMaterial: (
    id: number,
    body: Pick<Material, "title" | "content" | "chapter">,
  ) =>
    request<Material>(`/materials/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteMaterial: (id: number) =>
    request<void>(`/materials/${id}`, { method: "DELETE" }),
  chat: (question: string, material_id?: number) =>
    request<ChatResult>("/chat", {
      method: "POST",
      body: JSON.stringify({ question, material_id }),
    }),
};

export interface Chapter {
  id: number;
  title: string;
  description: string;
  course_id: number;
  sort_order: number;
  published: boolean;
}
export interface Knowledge {
  id: number;
  chapter_id: number;
  title: string;
  content: string;
  lab_path: string | null;
  published: boolean;
  materials?: Material[];
}
export interface Health {
  status: string;
  database: string;
  llm_mode: string;
  ai_configured: boolean;
}
export interface Process {
  pid: string;
  arrival: number;
  burst: number;
}
export interface Schedule {
  results: (Process & {
    start: number;
    completion: number;
    waiting: number;
    turnaround: number;
  })[];
  timeline: { pid: string; start: number; end: number; idle: boolean }[];
  average_waiting: number;
  average_turnaround: number;
}
export interface Question {
  id: number;
  chapter_id: number;
  prompt: string;
  options: string[];
}
export interface Grade {
  score: number;
  total: number;
  results: {
    id: number;
    selected: number;
    correct: boolean;
    answer: number;
    explanation: string;
  }[];
}
export const courseApi = {
  chapters: () => request<Chapter[]>("/chapters"),
  knowledge: (id: number) =>
    request<Knowledge[]>(`/knowledge?chapter_id=${id}`),
  detail: (id: number) => request<Knowledge>(`/knowledge/${id}`),
  health: () => request<Health>("/health"),
  upload: (file: File, chapter: string) => {
    const data = new FormData();
    data.append("file", file);
    if (chapter) data.append("chapter_id", chapter);
    return request<Material>("/materials/upload", {
      method: "POST",
      body: data,
    });
  },
  fcfs: (processes: Process[]) =>
    request<Schedule>("/labs/fcfs", {
      method: "POST",
      body: JSON.stringify({ processes }),
    }),
  questions: (id: number) => request<Question[]>(`/questions?chapter_id=${id}`),
  submit: (answers: Record<number, number>) =>
    request<Grade>("/practice/submit", {
      method: "POST",
      body: JSON.stringify({ answers }),
    }),
};

export interface User {
  id: number;
  username: string;
  role: "teacher" | "student";
  csrf_token: string;
}
export const authApi = {
  me: () => request<User>("/auth/me"),
  login: (username: string, password: string) =>
    request<User>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
};

export type ChapterInput = Pick<
  Chapter,
  "title" | "description" | "sort_order" | "published" | "course_id"
>;
export type KnowledgeInput = Pick<
  Knowledge,
  "chapter_id" | "title" | "content" | "lab_path" | "published"
>;
export interface ManagedQuestion extends Question {
  answer: number;
  explanation: string;
  published: boolean;
}
export interface Course {
  id: number;
  title: string;
  description: string;
  published: boolean;
  is_demo: boolean;
}
function save<T>(path: string, body: unknown, id?: number) {
  return request<T>(id ? `${path}/${id}` : path, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(body),
  });
}
export const teacherApi = {
  chapters: () => request<Chapter[]>("/teacher/chapters"),
  saveChapter: (body: ChapterInput, id?: number) =>
    save<Chapter>("/teacher/chapters", body, id),
  deleteChapter: (id: number) =>
    request<void>(`/teacher/chapters/${id}`, { method: "DELETE" }),
  knowledge: () => request<Knowledge[]>("/teacher/knowledge"),
  saveKnowledge: (body: KnowledgeInput, id?: number) =>
    save<Knowledge>("/teacher/knowledge", body, id),
  documents: () => request<Material[]>("/teacher/documents"),
  saveDocument: (
    id: number,
    body: {
      title: string;
      chapter_id: number | null;
      knowledge_ids: number[];
      published: boolean;
    },
  ) => save<Material>("/teacher/documents", body, id),
  uploadPublic: (file: File, chapter_id: number | null) => {
    const data = new FormData();
    data.append("file", file);
    data.append("category", "public");
    if (chapter_id !== null) data.append("chapter_id", String(chapter_id));
    return request<Material>("/materials/upload", {
      method: "POST",
      body: data,
    });
  },
  questions: () => request<ManagedQuestion[]>("/teacher/questions"),
  saveQuestion: (body: Omit<ManagedQuestion, "id">, id?: number) =>
    save<ManagedQuestion>("/teacher/questions", body, id),
};
export const courses = () => request<Course[]>("/courses");
