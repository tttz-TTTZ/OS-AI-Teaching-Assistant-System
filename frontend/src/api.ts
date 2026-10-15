export interface Material { id: number; title: string; content: string; chapter: string }
export interface ChatResult { id: number; answer: string; model: string; mode: string }
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : `请求失败（${response.status}）`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const api = {
  materials: () => request<Material[]>('/materials'),
  createMaterial: (body: Omit<Material, 'id'>) => request<Material>('/materials', {method:'POST',body:JSON.stringify(body)}),
  updateMaterial: (id: number, body: Omit<Material, 'id'>) => request<Material>(`/materials/${id}`, {method:'PUT',body:JSON.stringify(body)}),
  deleteMaterial: (id: number) => request<void>(`/materials/${id}`, {method:'DELETE'}),
  chat: (question: string, material_id?: number) => request<ChatResult>('/chat', {method:'POST',body:JSON.stringify({question, material_id})}),
};
