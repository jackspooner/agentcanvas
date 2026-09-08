import { type ElementTypeDescriptor, isSnapshotTimeoutMs } from '@agentcanvas/plugin-sdk';
import type {
  ContributionDeclarations,
  ContributionRegistrations,
  TestkitIssue,
  TestkitValidationResult
} from './types.js';

type ContributionKind = 'elements' | 'commands' | 'tools' | 'procedures' | 'migrations';

/** Checks the optional renderer deadline using the host's shared constraint. */
export function validateElementSnapshotTimeout(
  descriptor: Pick<ElementTypeDescriptor, 'snapshotTimeoutMs'>
): TestkitValidationResult {
  const valid = descriptor.snapshotTimeoutMs === undefined || isSnapshotTimeoutMs(descriptor.snapshotTimeoutMs);
  return {
    ok: valid,
    issues: valid
      ? []
      : [
          {
            path: '/snapshotTimeoutMs',
            code: 'invalid_snapshot_timeout',
            message: 'snapshotTimeoutMs must be an integer from 1 through 30000.'
          }
        ]
  };
}

function declaredNames(declarations: ContributionDeclarations, kind: ContributionKind): readonly string[] {
  if (kind === 'elements') return declarations.elements.map((element) => element.name);
  return declarations[kind] ?? [];
}

export function validateContributionRegistrations(
  declarations: ContributionDeclarations,
  registrations: ContributionRegistrations
): TestkitValidationResult {
  const issues: TestkitIssue[] = [];
  for (const kind of ['elements', 'commands', 'tools', 'procedures', 'migrations'] as const) {
    if (kind === 'commands' && registrations.commands === undefined) continue;
    const declared = declaredNames(declarations, kind);
    const registered = registrations[kind] ?? [];
    const declaredSet = new Set(declared);
    const registeredSet = new Set(registered);

    for (const name of declaredSet) {
      if (!registeredSet.has(name)) {
        issues.push({
          path: `/contributes/${kind}/${name}`,
          code: 'missing_registration',
          message: `Manifest declares ${kind} contribution ${name}, but activation did not register it.`
        });
      }
    }
    for (const name of registeredSet) {
      if (!declaredSet.has(name)) {
        issues.push({
          path: `/registrations/${kind}/${name}`,
          code: 'undeclared_registration',
          message: `Activation registered undeclared ${kind} contribution ${name}.`
        });
      }
    }
    registered.forEach((name, index) => {
      if (registered.indexOf(name) !== index) {
        issues.push({
          path: `/registrations/${kind}/${index}`,
          code: 'duplicate_registration',
          message: `Activation registered ${kind} contribution ${name} more than once.`
        });
      }
    });
  }
  return { ok: issues.length === 0, issues };
}

export function assertContributionRegistrations(
  declarations: ContributionDeclarations,
  registrations: ContributionRegistrations
): void {
  const result = validateContributionRegistrations(declarations, registrations);
  if (!result.ok) {
    const detail = result.issues.map((issue) => `${issue.path} [${issue.code}] ${issue.message}`).join('\n');
    throw new Error(`AgentCanvas plugin registrations do not match the manifest:\n${detail}`);
  }
}
