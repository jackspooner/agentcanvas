import { isIP } from 'node:net';

export interface AgentCanvasSecurityConfig {
  allowRemote: boolean;
  allowedHosts: string[];
  allowedOrigins: string[];
}

export interface SecurityDefaultsInput {
  host: string;
  port: number;
  publicBaseUrl: string;
}

export class SecurityPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 403
  ) {
    super(message);
    this.name = 'SecurityPolicyError';
  }
}

function parseBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`expected true or false, received ${value}`);
}

function splitList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const items = (Array.isArray(value) ? value : value.split(',')).map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizedHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || /[\s/@\\?#]/.test(trimmed)) throw new Error(`invalid allowed host: ${value}`);
  try {
    return new URL(`http://${trimmed}`).host.toLowerCase();
  } catch {
    throw new Error(`invalid allowed host: ${value}`);
  }
}

function normalizedHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} must be an HTTP(S) URL without embedded credentials`);
  }
  url.hash = '';
  url.search = '';
  return url;
}

function normalizedOrigin(value: string): string {
  const url = normalizedHttpUrl(value, 'allowed origin');
  if (url.pathname !== '/') throw new Error('allowed origin must not include a path');
  return url.origin.toLowerCase();
}

export function normalizeAllowedOrigin(value: string): string {
  try {
    return normalizedOrigin(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'parent origin is invalid';
    throw new SecurityPolicyError('invalid_parent_origin', message, 400);
  }
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') return true;
  return isIP(normalized) === 4 && normalized.split('.')[0] === '127';
}

function loopbackHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

function hostWithPort(host: string, port: number): string {
  const trimmed = host.trim().replace(/^\[|\]$/g, '');
  return trimmed.includes(':') ? `[${trimmed}]:${port}` : `${trimmed}:${port}`;
}

export function loadSecurityConfig(
  input: SecurityDefaultsInput,
  overrides: Partial<AgentCanvasSecurityConfig> = {}
): AgentCanvasSecurityConfig {
  const publicUrl = normalizedHttpUrl(input.publicBaseUrl, 'AGENT_CANVAS_PUBLIC_BASE_URL');
  const allowRemote = parseBoolean(process.env.AGENT_CANVAS_ALLOW_REMOTE ?? overrides.allowRemote, false);

  if (!isLoopbackHost(input.host) && !allowRemote) {
    throw new Error(
      `AGENT_CANVAS_HOST=${input.host} is not loopback; set AGENT_CANVAS_ALLOW_REMOTE=true only for an intentional trusted-network deployment`
    );
  }

  const defaultHosts = [publicUrl.host, normalizedHost(hostWithPort(input.host, input.port))];
  if (isLoopbackHost(input.host)) defaultHosts.push(...loopbackHosts(input.port));
  const allowedHosts = unique(
    (splitList(process.env.AGENT_CANVAS_ALLOWED_HOSTS ?? overrides.allowedHosts) ?? defaultHosts).map(normalizedHost)
  );

  const defaultOrigins = [publicUrl.origin];
  if (isLoopbackHost(input.host)) {
    defaultOrigins.push(...loopbackHosts(input.port).map((host) => `${publicUrl.protocol}//${host}`));
  }
  const allowedOrigins = unique(
    (splitList(process.env.AGENT_CANVAS_ALLOWED_ORIGINS ?? overrides.allowedOrigins) ?? defaultOrigins).map(
      normalizedOrigin
    )
  );
  return {
    allowRemote,
    allowedHosts,
    allowedOrigins
  };
}

export function assertTrustedRequest(headers: Headers, config: AgentCanvasSecurityConfig): void {
  const host = headers.get('host');
  let checkedHost: string | null = null;
  try {
    checkedHost = host ? normalizedHost(host) : null;
  } catch {
    checkedHost = null;
  }
  if (!checkedHost || !config.allowedHosts.includes(checkedHost)) {
    throw new SecurityPolicyError('untrusted_host', 'request Host is not allowed');
  }
  const origin = headers.get('origin');
  if (origin) {
    let checkedOrigin: string | null = null;
    try {
      checkedOrigin = normalizedOrigin(origin);
    } catch {
      checkedOrigin = null;
    }
    if (!checkedOrigin || !config.allowedOrigins.includes(checkedOrigin)) {
      throw new SecurityPolicyError('untrusted_origin', 'request Origin is not allowed');
    }
  }
}

const CONTENT_SECURITY_POLICY_PREFIX =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' http: https: blob:; media-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'";

export function securityResponseHeaders(frameAncestors: readonly string[] = []): Readonly<Record<string, string>> {
  const normalizedAncestors = frameAncestors.map(normalizeAllowedOrigin);
  return {
    'content-security-policy': `${CONTENT_SECURITY_POLICY_PREFIX}; frame-ancestors ${
      normalizedAncestors.length ? normalizedAncestors.join(' ') : "'none'"
    }; form-action 'self'`,
    'cross-origin-resource-policy': normalizedAncestors.length ? 'cross-origin' : 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...(normalizedAncestors.length ? {} : { 'x-frame-options': 'DENY' })
  };
}

export const SECURITY_RESPONSE_HEADERS: Readonly<Record<string, string>> = securityResponseHeaders();

/*
 * The default remains non-frameable. Embed documents opt into one validated
 * parent origin through securityResponseHeaders; no route may relax this globally.
 */
export function applySecurityHeaders(headers: Headers, frameAncestors: readonly string[] = []): void {
  for (const [name, value] of Object.entries(securityResponseHeaders(frameAncestors))) headers.set(name, value);
}
