import type { TestkitIssue, TestkitValidationResult } from './types.js';

export interface DistributionArtifactValidationOptions {
  requireThirdPartyNotices?: boolean;
}

const requiredRootArtifacts = ['agentcanvas.plugin.json', 'README.md', 'LICENSE'] as const;

function normalizeArtifactPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Validates the human- and license-facing files that must accompany an installable plugin distribution.
 * Entrypoint and configuration containment remain the responsibility of manifest validation and the host.
 */
export function validateDistributionArtifacts(
  artifactPaths: readonly string[],
  options: DistributionArtifactValidationOptions = {}
): TestkitValidationResult {
  const artifacts = new Set(artifactPaths.map(normalizeArtifactPath));
  const required = [...requiredRootArtifacts, ...(options.requireThirdPartyNotices ? ['THIRD_PARTY_NOTICES.md'] : [])];
  const issues: TestkitIssue[] = [];
  for (const artifact of required) {
    if (!artifacts.has(artifact)) {
      issues.push({
        path: `/${artifact}`,
        code: 'missing_distribution_artifact',
        message: `Distribution must include ${artifact}.`
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function assertDistributionArtifacts(
  artifactPaths: readonly string[],
  options: DistributionArtifactValidationOptions = {}
): void {
  const result = validateDistributionArtifacts(artifactPaths, options);
  if (!result.ok) {
    const detail = result.issues.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join('\n');
    throw new Error(`Incomplete AgentCanvas plugin distribution:\n${detail}`);
  }
}
