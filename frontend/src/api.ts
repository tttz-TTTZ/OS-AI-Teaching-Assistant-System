import { sessionContext, sessionReady, freshSessionContext } from "./session";
export { sessionContext } from "./session";
export function fileUrl(id: number, download = false) {
  return `/api/materials/${id}/file?session_context=${encodeURIComponent(sessionContext())}${download ? "&download=true" : ""}`;
}
let csrfToken = "";
let authRevision = 0;
export function invalidateAuthRequests() {
  authRevision += 1;
  csrfToken = "";
}
function checkRevision(revision: number, context: string) {
  if (revision !== authRevision || context !== sessionContext())
    throw new DOMException("登录状态已变化，已忽略旧请求", "AbortError");
}
export function setCsrfToken(value: string) {
  csrfToken = value;
}
export interface Material {
  id: number;
  title: string;
  content: string;
  category: string;
  file_type: string | null;
  file_size: number | null;
  original_name: string | null;
  owner_id: number | null;
  published: boolean;
  summary: string;
  source_title: string;
  source_url: string;
  deleted_at: string | null;
  sha256: string | null;
  published_at: string | null;
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  await sessionReady;
  const revision = authRevision;
  const context = sessionContext();
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "X-Session-Context": context,
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  checkRevision(revision, context);
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
  const result =
    response.status === 204 ? (undefined as T) : await response.json();
  checkRevision(revision, context);
  return result;
}
// Upload progress includes transfer only; onload confirms server validation/storage.
export async function uploadFile<T>(
  path: string,
  body: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  if (!onProgress) return request<T>(path, { method: "POST", body });
  await sessionReady;
  const revision = authRevision,
    context = sessionContext();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Session-Context", context);
    if (csrfToken) xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "上传连接中断，请确认网络后重试；如不确定是否已保存，先刷新资料列表。",
        ),
      );
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.onload = () => {
      try {
        checkRevision(revision, context);
        let data: any;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          if (xhr.status >= 200 && xhr.status < 300)
            throw new Error(
              "上传服务未返回有效结果，请确认后端和代理配置，再刷新资料列表检查是否已保存。",
            );
          data = {};
        }
        if (xhr.status === 401) window.dispatchEvent(new Event("auth-expired"));
        if (xhr.status < 200 || xhr.status >= 300) {
          const detail =
            typeof data.detail === "string"
              ? data.detail
              : Array.isArray(data.detail)
                ? data.detail.map((e: { msg: string }) => e.msg).join("；")
                : xhr.status === 413
                  ? "上传被服务器拒绝：文件过大，请检查应用或反向代理的上传上限"
                  : `上传失败（${xhr.status}）`;
          reject(new Error(detail));
          return;
        }
        resolve(data as T);
      } catch (e) {
        reject(e);
      }
    };
    xhr.send(body);
  });
}
export interface Health {
  status: string;
  database: string;
  personal_ai_configured: boolean;
  platform_revision?: string;
}
export const getHealth = () => request<Health>("/health");

export interface User {
  id: number;
  username: string;
  role: "teacher" | "student";
  csrf_token: string;
  is_admin: boolean;
}
export const authApi = {
  register: (username: string, password: string) =>
    request<{ id: number; username: string; role: "student" }>(
      "/auth/register",
      {
        method: "POST",
        body: JSON.stringify({ username, password }),
      },
    ),
  me: () => request<User>("/auth/me"),
  login: async (
    username: string,
    password: string,
    expected_role?: "teacher" | "student",
  ) => {
    await sessionReady;
    // 每次登录独占新 Cookie，哪怕浏览器复制了标签存储也不会覆盖别的账号。
    invalidateAuthRequests();
    await freshSessionContext();
    return request<User>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password, expected_role }),
    });
  },
  logout: () => request<void>("/auth/logout", { method: "POST" }),
};

function save<T>(path: string, body: unknown, id?: number) {
  return request<T>(id ? `${path}/${id}` : path, {
    method: id ? "PUT" : "POST",
    body: JSON.stringify(body),
  });
}
export const teacherApi = {
  saveDocument: (
    id: number,
    body: {
      title: string;
          published: boolean;
      summary?: string;
      source_title?: string;
      source_url?: string;
    },
  ) => save<Material>("/teacher/documents", body, id),
  uploadPublic: (
    file: File,
    onProgress?: (percent: number) => void,
  ) => {
    const data = new FormData();
    data.append("file", file);
    data.append("category", "public");
    return uploadFile<Material>("/materials/upload", data, onProgress);
  },

};

export interface Account {
  id: number;
  username: string;
  role: "teacher" | "student";
  active: boolean;
  is_admin: boolean;
  created_at: string;
}
export interface DocumentFilter {
  q?: string;
  trash?: boolean;
  published?: boolean;
  offset?: number;
  category?: string;
}
function filters(options: DocumentFilter) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return params.toString();
}
export const documentApi = {
  detail: (id: number) => request<Material>(`/materials/${id}`),
  remove: (id: number) => request<void>(`/materials/${id}`, { method: "DELETE" }),
  upload: (file: File, onProgress?: (percent: number) => void) => {
    const data = new FormData();
    data.append("file", file);
    return uploadFile<Material>("/materials/upload", data, onProgress);
  },
  list: (teacher: boolean, options: DocumentFilter = {}) =>
    request<Material[]>(
      `${teacher ? "/teacher/documents" : "/materials"}?${filters(options)}`,
    ),
  restore: (id: number) =>
    request<Material>(`/materials/${id}/restore`, { method: "POST" }),
  replace: (id: number, file: File, onProgress?: (percent: number) => void) => {
    const data = new FormData();
    data.append("file", file);
    return uploadFile<Material>(`/materials/${id}/replace`, data, onProgress);
  },
  versions: (id: number) =>
    request<{ id: number; original_name: string; created_at: string }[]>(
      `/materials/${id}/versions`,
    ),
};
export const accountApi = {
  list: (q = "") =>
    request<Account[]>(
      `/teacher/accounts?q=${encodeURIComponent(q)}&limit=100`,
    ),
  create: (username: string, password: string, role: string) =>
    request<Account>("/teacher/accounts", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    }),
  active: (id: number, active: boolean) =>
    request<Account>(`/teacher/accounts/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ active }),
    }),
  reset: (id: number, password: string) =>
    request<void>(`/teacher/accounts/${id}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  password: (current_password: string, new_password: string) =>
    request<void>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),
};
