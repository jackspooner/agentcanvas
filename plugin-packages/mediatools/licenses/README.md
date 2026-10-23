# Bundled dependency license sources

The notice generator first reads each bundled package's own license files or
complete README license section. `manifest.json` supplies complete upstream text
only for the exact package versions listed there when the published archive omits
it. Unknown versions and changed license declarations still fail the build.
Checksums validate these checked-in copies before generating notices; builds do
not download licenses.

Workspace2's explicitly listed first-party packages retain their existing
separate handling: when an owner declares no license, notices say so instead of
assigning a license to that code. This is not a fallback for third-party packages.

- `@redocly/openapi-core@1.34.19`: the published package's npm `gitHead` points to
  [Redocly commit 11f4afd](https://github.com/Redocly/redocly-cli/tree/11f4afd7642595ca4a62ec132994930ec77fc33e).
  Its root `LICENSE.md` supplies the complete MIT notice, copied byte for byte.
- `uri-js-replace@1.0.1`: npm `gitHead`
  [3892750](https://github.com/andreinwald/uri-js-replace/tree/38927505b51a74b53444dc723be10e0d2e53823c)
  has MIT metadata but no complete notice. The maintainer accepted
  [issue #4](https://github.com/andreinwald/uri-js-replace/issues/4) and merged
  [PR #5](https://github.com/andreinwald/uri-js-replace/pull/5) specifically to
  supply that omitted file. The merged
  [LICENSE at a34c9a5](https://github.com/andreinwald/uri-js-replace/blob/a34c9a5b7a317b6039b2b3cf9d024ee8e418d281/LICENSE)
  says **MIT No Attribution (MIT-0)**, although package metadata still says MIT.
  No `src/` or `dist/` files changed between the published revision and this
  license fix. Notices retain both the metadata declaration and the exact
  upstream license text, with a provenance note. Only a terminal newline was
  added to the source license file (original source SHA-256:
  `5caace045044f8e3dd302d2a6789b9824c1dec992a3e94cc8f75f5c81bad699e`).

Sources were retrieved through Download Manager 2 on 2026-10-23. The manifest
records source revisions and SHA-256 hashes of the checked-in files. Dependency
updates must review these version-specific records against official upstream
sources; do not extend a fallback to another version without verification.
