export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers: { 'content-type': 'application/json', ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { message: `请求失败 (${response.status})` } }));
    throw new ApiError(response.status, body.error?.message ?? `请求失败 (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
