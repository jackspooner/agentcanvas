import { describe, expect, it } from 'vitest';
import {
  assertDistributionArtifacts,
  assertPluginManifestStructure,
  getManifestReferencedPaths,
  validateContributionRegistrations,
  validateDistributionArtifacts,
  validatePluginManifestStructure
} from '../src/index.js';

const validManifest = {
  apiVersion: 'agentcanvas.plugin/v1',
  id: 'agentcanvas.hello-card',
  version: '0.2.0',
  displayName: 'Hello Card',
  description: 'A test plugin.',
  license: 'MIT',
  entrypoints: { server: 'dist/server.mjs', browser: 'dist/browser/entry.mjs' },
  requires: { hostApi: '^1.0.0', plugins: {}, capabilities: {} },
  provides: { capabilities: {} },
  permissions: ['canvas.read'],
  contributes: {
    elements: [{ name: 'card', schemaVersion: 1, browser: true, snapshot: 'supported' }],
    tools: ['add-card'],
    procedures: [],
    migrations: ['legacy-card-v1']
  }
};

describe('manifest validation', () => {
  it('accepts the v1 manifest shape and lists referenced files', () => {
    expect(validatePluginManifestStructure(validManifest)).toEqual({ ok: true, issues: [] });
    expect(getManifestReferencedPaths(validManifest)).toEqual(['dist/server.mjs', 'dist/browser/entry.mjs']);
    expect(() => assertPluginManifestStructure(validManifest)).not.toThrow();
  });

  it('rejects unsafe paths, duplicate contributions, and invalid schema versions', () => {
    const invalid = structuredClone(validManifest);
    invalid.entrypoints.server = '../server.mjs';
    invalid.contributes.elements[0].schemaVersion = 0;
    invalid.contributes.tools = ['add-card', 'add-card'];
    const result = validatePluginManifestStructure(invalid);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unsafe_relative_path', 'invalid_schema_version', 'duplicate_contribution'])
    );
  });
});

describe('contribution registration validation', () => {
  it('reports missing, undeclared, and duplicate activation registrations', () => {
    const result = validateContributionRegistrations(validManifest.contributes, {
      elements: ['card', 'card'],
      tools: ['another-tool'],
      procedures: [],
      migrations: []
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['duplicate_registration', 'missing_registration', 'undeclared_registration'])
    );
  });
});

describe('distribution artifact validation', () => {
  const standardFiles = ['agentcanvas.plugin.json', 'README.md', 'LICENSE', 'dist/server.mjs'];

  it('accepts standard distributions and opt-in third-party notices', () => {
    expect(validateDistributionArtifacts(standardFiles)).toEqual({ ok: true, issues: [] });
    expect(
      validateDistributionArtifacts([...standardFiles, 'THIRD_PARTY_NOTICES.md'], {
        requireThirdPartyNotices: true
      })
    ).toEqual({ ok: true, issues: [] });
  });

  it('fails when a license or required third-party notice is absent', () => {
    const missingLicense = validateDistributionArtifacts(['agentcanvas.plugin.json', 'README.md']);
    expect(missingLicense.ok).toBe(false);
    expect(missingLicense.issues).toContainEqual(
      expect.objectContaining({ path: '/LICENSE', code: 'missing_distribution_artifact' })
    );

    const missingNotice = validateDistributionArtifacts(standardFiles, { requireThirdPartyNotices: true });
    expect(missingNotice.ok).toBe(false);
    expect(missingNotice.issues).toContainEqual(
      expect.objectContaining({ path: '/THIRD_PARTY_NOTICES.md', code: 'missing_distribution_artifact' })
    );
    expect(() => assertDistributionArtifacts(standardFiles, { requireThirdPartyNotices: true })).toThrow(
      /THIRD_PARTY_NOTICES\.md/
    );
  });
});
