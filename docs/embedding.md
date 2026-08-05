# Embedding AgentCanvas

AgentCanvas can issue a short-lived iframe URL for one trusted host application
and one explicitly bounded set of canvases. The iframe is the human interaction
surface. LLMs and application backends continue to read and mutate canvases
through the canonical HTTP or MCP operations.

Ordinary AgentCanvas routes remain non-frameable. Only a valid
`/embed/{token}` document receives a `frame-ancestors` policy naming the exact
`parentOrigin` from its session.

## Create an embed session

Create sessions from the host application's backend. The returned URL contains
a bearer token and must not be logged, placed in prompts, sent to analytics, or
exposed to unrelated clients.

```http
POST /api/v1/embed-sessions
Content-Type: application/json

{
  "canvasIds": ["canvas_product", "canvas_research"],
  "mode": "edit",
  "parentOrigin": "http://127.0.0.1:3000",
  "expiresInSeconds": 3600
}
```

All four fields are required:

- `canvasIds` contains 1 through 25 unique existing canvas IDs.
- `mode` is `read` or `edit`. Read mode disables browser editing; it does not
  stop an independently authorized backend or LLM from using HTTP/MCP.
- `parentOrigin` is one exact HTTP(S) origin without a path.
- `expiresInSeconds` is an integer from 60 through 86,400.

The response includes the resolved session and an iframe URL:

```json
{
  "ok": true,
  "session": {
    "id": "embed_session_...",
    "canvasIds": ["canvas_product", "canvas_research"],
    "mode": "edit",
    "parentOrigin": "http://127.0.0.1:3000",
    "createdAt": "2026-07-28T12:00:00.000Z",
    "expiresAt": "2026-07-28T13:00:00.000Z"
  },
  "url": "http://127.0.0.1:23003/embed/embed_...?canvasId=canvas_product"
}
```

Embed sessions are process-memory capabilities. They disappear on expiry,
explicit revocation, or an AgentCanvas restart. Recreate the session instead of
persisting or retrying an invalid URL.

## Host the iframe

```html
<iframe
  id="agentcanvas"
  title="Product planning canvas"
  sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
></iframe>

<script type="module">
  const iframe = document.querySelector("#agentcanvas");
  iframe.src = embedSession.url;

  window.addEventListener("message", (event) => {
    if (event.origin !== "http://127.0.0.1:23003") return;
    if (event.source !== iframe.contentWindow) return;
    const message = event.data;
    if (message?.source !== "agentcanvas.embed" || message.version !== 1) return;

    if (message.type === "ready") {
      console.log("Embedded canvas ready", message.canvasId);
    }
    if (message.type === "canvas.updated") {
      console.log("Canvas revision", message.canvasId, message.revision);
    }
  });
</script>
```

The parent must validate both `event.origin` and `event.source`. The expected
message source is `agentcanvas.embed`, version `1`.

## Navigate or refresh

The host can select another canvas from the session without receiving document
data through `postMessage`:

```js
iframe.contentWindow.postMessage(
  {
    source: "agentcanvas.host",
    version: 1,
    type: "navigate",
    canvasId: "canvas_research"
  },
  "http://127.0.0.1:23003"
);
```

Only canvas IDs in the session are accepted. The iframe replies with an
`agentcanvas.embed` `error` message when navigation is outside that set.

To reload the selected projection:

```js
iframe.contentWindow.postMessage(
  { source: "agentcanvas.host", version: 1, type: "refresh" },
  "http://127.0.0.1:23003"
);
```

The bridge deliberately has no mutation message. This prevents a second
hand-maintained editing contract. An LLM-powered application should use
AgentCanvas MCP or `/api/v1/canvases/{canvasId}/elements:batch`, retain normal
revision and idempotency behavior, and let the iframe's polling report the new
revision to the parent.

## Revoke a session

```http
DELETE /api/v1/embed-sessions/{token}
```

Revocation invalidates new loads immediately. An already-loaded iframe polls
its session and unmounts the canvas on the next refresh, normally within 1.5
seconds. The token is the final path segment of the returned embed URL.

## Deployment boundary

AgentCanvas still has no built-in user accounts. Embed sessions narrow iframe
authority; they do not authenticate the rest of the AgentCanvas API. Keep the
service on loopback, or place it behind an authenticated, TLS-terminating
reverse proxy that authorizes both session creation and canvas operations.
