export type Workspace = {
  id: string;
  name: string;
  description?: string;
  defaultCitationStyle?: 'APA' | 'IEEE' | 'MLA' | 'Chicago';
  createdAt?: string;
  updatedAt?: string;
};
export type User = { id: string; email: string; name: string };
export type AuthResponse = { user: User; workspaces: Workspace[] };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach ScholarGraph. Check that the API server is running.',
    );
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error?.code || 'REQUEST_FAILED',
      body?.error?.message || 'Request failed.',
    );
  return body as T;
}
