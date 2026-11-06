export class RequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(data.error || `服务暂时不可用（${response.status}）`, response.status);
  return data;
}

export const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
