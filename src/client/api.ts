import type { ApiErrorBody } from "../shared/types.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, "We couldn't reach the server. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = data as ApiErrorBody | null;
    throw new ApiError(
      res.status,
      err?.error ?? "Something went wrong. Please try again.",
      err?.fields,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}

export function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? err.fields : {};
}
