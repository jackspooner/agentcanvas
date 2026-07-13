import type { JsonObject, OpaqueResourceHandle } from '@agentcanvas/plugin-sdk';

export function resourceProjection(resource: OpaqueResourceHandle): JsonObject {
  return {
    handle: resource.handle,
    url: resource.url,
    mimeType: resource.mimeType,
    ...(resource.byteLength !== undefined ? { byteLength: resource.byteLength } : {}),
    ...(resource.width !== undefined ? { width: resource.width } : {}),
    ...(resource.height !== undefined ? { height: resource.height } : {}),
    ...(resource.sha256 !== undefined ? { sha256: resource.sha256 } : {})
  };
}
