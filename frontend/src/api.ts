export interface Material {
  id: number;
  title: string;
  content: string;
  chapter: string;
  category: string;
  file_type: string | null;
  file_size: number | null;
  original_name: string | null;
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
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  if (!response.ok) {
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
}
export interface Knowledge {
  id: number;
  chapter_id: number;
  title: string;
  content: string;
  lab_path: string | null;
  materials?: { id: number; title: string }[];
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
    data.append("chapter", chapter);
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
