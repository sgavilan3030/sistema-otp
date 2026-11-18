const AUTH_TOKEN_KEY = 'ast_auth_token';
let interceptorInstalled = false;

export function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  try {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {}
}

export function clearAuthToken(): void {
  try {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {}
}

export function appendAuthTokenToUrl(url: string): string {
  const token = getAuthToken();
  if (!token || !url || !url.startsWith('/api/')) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

const nativeFetchRef: typeof window.fetch | null =
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : null;

export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const runner =
    nativeFetchRef ||
    (typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? window.fetch.bind(window)
      : fetch.bind(globalThis));

  const urlStr = typeof input === 'string'
    ? input
    : input instanceof URL
    ? input.toString()
    : input.url;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const isSameOriginApi =
    urlStr.startsWith('/api/') ||
    (origin ? urlStr.startsWith(`${origin}/api/`) : false);

  const isLoginEndpoint = urlStr.includes('/api/auth/login');
  const token = getAuthToken();

  let nextInit = init;
  if (isSameOriginApi && !isLoginEndpoint && token) {
    const headers = new Headers(
      init?.headers || (input instanceof Request ? input.headers : undefined)
    );
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    nextInit = { ...init, headers };
  }

  const response = await runner(input, nextInit);

  if (
    typeof window !== 'undefined' &&
    isSameOriginApi &&
    !isLoginEndpoint &&
    !urlStr.includes('/api/auth/me') &&
    response.status === 401
  ) {
    clearAuthToken();
    window.dispatchEvent(new CustomEvent('ast:unauthorized'));
  }

  return response;
}

export function installAuthFetchInterceptor(): void {
  if (interceptorInstalled || typeof window === 'undefined') return;
  interceptorInstalled = true;

  if (!nativeFetchRef) return;

  try {
    const winDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (!winDesc || winDesc.configurable) {
      Object.defineProperty(window, 'fetch', {
        value: authFetch,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else if (winDesc.writable) {
      (window as any).fetch = authFetch;
    } else if (typeof Window !== 'undefined' && Window.prototype) {
      const protoDesc = Object.getOwnPropertyDescriptor(Window.prototype, 'fetch');
      if (!protoDesc || protoDesc.configurable) {
        Object.defineProperty(Window.prototype, 'fetch', {
          value: authFetch,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    }
  } catch {
    try {
      const globalDesc = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
      if (!globalDesc || globalDesc.configurable) {
        Object.defineProperty(globalThis, 'fetch', {
          value: authFetch,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    } catch {
      // Runtime locked window.fetch; components importing authFetch still authenticate properly
    }
  }
}
