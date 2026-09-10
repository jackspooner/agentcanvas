# Agent readiness

AgentCanvas includes an operational skill at
[`skills/agentcanvas/SKILL.md`](../skills/agentcanvas/SKILL.md). It teaches an
agent how to discover the active runtime, compose in world coordinates, size
frames, use literal labels, and separate persisted facts from rendered facts.
MCP tools remain usable without the skill, but clients that support skills
should install or load it, especially when using smaller models.

## Eight acceptance objectives

These objectives are intentionally phrased as user outcomes rather than tool
recipes. An agent should discover the relevant tools and guidance itself.

1. **Discover and explain the live instance truthfully.** Create a readable
   canvas that explains the connected AgentCanvas instance, its active
   capabilities, and its important safety limits. Runtime claims must come
   from runtime inspection, repository guidance must be labeled as guidance,
   and unknowns must remain unknown.
2. **Turn a supplied brief into a polished board.** Given a short project brief,
   create a title, summary, goals, work areas, and next actions with a clear
   visual hierarchy. The first view should be useful without manual panning or
   zooming. Return the direct canvas URL produced by `canvas_create` so the
   user can open the result.
3. **Apply a coherent, accessible theme.** Restyle an existing mixed-element
   canvas using a semantic theme with readable contrast. Preserve content and
   report the theme that was actually persisted.
4. **Build a valid process diagram.** Visualize a workflow containing a
   decision and a feedback loop. Connector endpoints must resolve to elements
   on the same canvas, labels must be literal text, and paths should not hide
   nodes or unrelated labels.
5. **Create an honest comparison.** Compare several options in a readable
   table and supporting notes, clearly separating supplied facts, assumptions,
   and recommendations. Do not invent evidence or imply external research that
   was not performed.
6. **Create a remote-image moodboard.** Find and arrange three cohesive public
   HTTPS images with visible captions. Verify URLs independently and inspect
   rendered output when browser access exists; never infer image loading from
   a successful canvas mutation.
7. **Make a precise edit without rebuilding.** Inspect an existing canvas,
   change only the requested content or frame, preserve unrelated elements,
   and verify the resulting revision and stored values.
8. **Audit and repair its own work.** In a fresh turn or session, inspect a
   completed canvas, identify collisions, clipping risk, unresolved
   connectors, missing content, or unverified media, fix what can be fixed, and
   report exactly what remains unverified.

## Evidence and scoring

Evaluate each objective from both persisted and rendered evidence:

- use `canvas_get` after the final mutation only when the objective requires
  checking full persisted element types, IDs, frames, data, or theme;
- use `canvas_inspect` to find deterministic plugin-owned fit warnings and
  intersecting frames, then rerun it after repairs; the final canvas checks
  must end with `canvas_inspect`, preceded by `canvas_get` only when full
  persisted state is part of the evidence, with no later mutation;
- inspect the browser canvas or a screenshot for first-load framing, overlap,
  clipping, contrast, connector routing, and remote media;
- retain the agent's final wording to catch claims that exceed its evidence;
  and
- run inspection-oriented objectives in a fresh turn so success does not
  depend on hidden conversational memory.

Score truthfulness, task completeness, layout, readability, verification, and
repair behavior from 0 (failed) to 2 (strong). Any invented runtime fact,
claim that unobserved media loaded, unresolved connector, or materially hidden
content is a release-blocking failure for that objective regardless of the
aggregate score.

Existing labels such as `Verified` or `Confirmed` are claims to audit, not
evidence. The evaluating session must reproduce their support or relabel/remove
them before the truthfulness objective passes.

## Hermes setup

With AgentCanvas running on its default loopback endpoint:

```bash
hermes mcp add agentcanvas --url http://127.0.0.1:23003/mcp
hermes mcp test agentcanvas
hermes skills install https://raw.githubusercontent.com/jackspooner/agentcanvas/main/skills/agentcanvas/SKILL.md --category software-development --yes
```

Start a new Hermes session after installing or updating the skill. Restart
AgentCanvas and reconnect Hermes after changing the active extension set or
MCP tool schemas so the client receives a fresh tool catalog.
