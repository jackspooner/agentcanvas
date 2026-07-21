import { describe, expect, it } from 'vitest';
import { applySecurityHeaders, assertTrustedRequest, loadSecurityConfig } from '../src/security';

const defaults = {
  host: '127.0.0.1',
  port: 23003,
  publicBaseUrl: 'http://127.0.0.1:23003'
};

describe('local security policy', () => {
  it('refuses a non-loopback bind unless remote access is explicit', () => {
    expect(() => loadSecurityConfig({ ...defaults, host: '0.0.0.0' })).toThrow(/ALLOW_REMOTE=true/);
    expect(() => loadSecurityConfig({ ...defaults, host: '127.attacker.test' })).toThrow(/ALLOW_REMOTE=true/);
    expect(loadSecurityConfig({ ...defaults, host: '0.0.0.0' }, { allowRemote: true }).allowRemote).toBe(true);
  });

  it('allows loopback aliases and rejects untrusted Host and Origin headers', () => {
    const config = loadSecurityConfig(defaults);
    expect(() =>
      assertTrustedRequest(new Headers({ host: 'localhost:23003', origin: 'http://127.0.0.1:23003' }), config)
    ).not.toThrow();
    expect(() => assertTrustedRequest(new Headers({ host: 'attacker.test' }), config)).toThrowError(
      expect.objectContaining({ code: 'untrusted_host' })
    );
    expect(() =>
      assertTrustedRequest(new Headers({ host: '127.0.0.1:23003', origin: 'https://attacker.test' }), config)
    ).toThrowError(expect.objectContaining({ code: 'untrusted_origin' }));
    expect(() =>
      assertTrustedRequest(new Headers({ host: '127.0.0.1:23003', origin: 'not a valid origin' }), config)
    ).toThrowError(expect.objectContaining({ code: 'untrusted_origin' }));
  });

  it('adds a restrictive browser security header set', () => {
    const headers = new Headers();
    applySecurityHeaders(headers);
    expect(headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(headers.get('content-security-policy')).toContain("'wasm-unsafe-eval'");
    expect(headers.get('content-security-policy')).toContain("img-src 'self' http: https: blob:");
    expect(headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(headers.get('content-security-policy')).not.toContain('data:');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-frame-options')).toBe('DENY');
  });
});
