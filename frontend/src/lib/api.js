export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('The server returned an unreadable response.', {
      status: response.status,
    });
  }
  if (!response.ok) {
    throw new ApiError(payload.error?.message ?? 'Request failed.', {
      code: payload.error?.code,
      status: response.status,
      details: payload.error?.details,
    });
  }
  return payload.data;
}

export function jsonBody(value) {
  return JSON.stringify(value);
}

export function businessCreationKey() {
  const storageKey = 'your-appointment:pending-business-creation';
  let key = sessionStorage.getItem(storageKey);
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
  }
  return {
    key,
    clear: () => sessionStorage.removeItem(storageKey),
  };
}
