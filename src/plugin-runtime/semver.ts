import { createRequire } from 'node:module';

interface SemverApi {
  valid(version: string): string | null;
  validRange(range: string): string | null;
  satisfies(version: string, range: string, options?: { includePrerelease?: boolean }): boolean;
}

const semver = createRequire(import.meta.url)('semver') as SemverApi;

export function isVersion(value: string): boolean {
  return semver.valid(value) !== null;
}

export function isVersionRange(value: string): boolean {
  return semver.validRange(value) !== null;
}

export function satisfies(version: string, range: string): boolean {
  return semver.satisfies(version, range, { includePrerelease: true });
}
