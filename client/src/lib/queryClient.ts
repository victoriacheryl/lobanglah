import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";
const AUTH_STORAGE_KEY = "lobanglah-auth-token";

// Keep the auth token in module memory and persist it in browser storage so a
// page refresh can restore the same signed-in identity without needing to log
// in again. The browser storage is best-effort and safely ignored in SSR.
let authToken: string | null = null;

function readStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistAuthToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures (private browsing / blocked storage).
  }
}

export function setAuthToken(token: string | null) {
  authToken = token;
  persistAuthToken(token);
}

authToken = readStoredAuthToken();

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

// Fires when the server reports the current session's account was suspended
// or banned mid-session (a 403 with accountRestricted: true) — distinct from
// an ordinary 403 like a non-admin hitting an admin route. auth.tsx registers
// a handler that clears the session; queryClient.ts can't import auth.tsx
// directly (auth.tsx already imports from here), hence the indirection.
type AccountRestrictedHandler = (message: string) => void;
let onAccountRestricted: AccountRestrictedHandler | null = null;
export function setAccountRestrictedHandler(handler: AccountRestrictedHandler | null) {
  onAccountRestricted = handler;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let message = res.statusText;
    let body: any = null;
    try {
      body = await res.json();
      message = body?.message || message;
    } catch {
      // ignore non-JSON error bodies
    }
    if (res.status === 403 && body?.accountRestricted && onAccountRestricted) {
      onAccountRestricted(message);
    }
    throw new Error(message);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
    },
    body: data ? JSON.stringify(data) : undefined,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { headers: authHeaders() });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
