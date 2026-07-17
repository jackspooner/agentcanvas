# AgentCanvas filesystem images extension

This optional first-party extension places local raster images on canvases without requiring a media service.

## Configure roots

Edit `plugin.config.json` in the installed extension directory before starting AgentCanvas:

```json
{
  "roots": [{ "id": "pictures", "path": "C:/Users/example/Pictures" }],
  "contentMaxBytes": 67108864,
  "resourceTtlMs": 3600000
}
```

Canvas documents store only the root ID and a slash-separated relative path. Absolute paths, traversal segments, backslashes, unsupported image types, symlink escapes, oversized files, and files outside configured roots are rejected. Root paths are never returned by the `list-roots` tool.

Supported formats are PNG, JPEG, WebP, GIF, and AVIF. Files are linked rather than copied: a fresh resource request reads the current bytes from disk. Removing access to a file leaves the node intact and reports an unavailable-resource diagnostic.

The service account running AgentCanvas must have read access to every configured root. An empty `roots` array is safe and disables placement until an administrator adds a root.
