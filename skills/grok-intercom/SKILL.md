---
name: grok-intercom
description: |
  Use this skill when coordinating with local coding-agent sessions from Grok
  Build through the agent-intercom-grok plugin. Send messages, discover peers
  only when needed, and handle queued replies with the same MCP session.
---

# Grok Intercom: shortest calling path

Use this plugin's `agent-intercom` MCP server (or the host's qualified plugin name). Do not switch to an imported Cursor or Claude Intercom server mid-conversation: sends, pending reads, and replies must use the same sender identity.

- For a known recipient, call `intercom_send` directly for assignments, coordination, progress/status requests, notifications, and follow-ups. Do not run `intercom_whoami`, `intercom_team`, `intercom_list`, or `intercom_status` as routine preflight checks.
- If the host requires tool discovery, discover only the selected tool and reuse its definition while it remains in context. Do not browse tool-definition directories or read unrelated definitions.
- Discover peers only when the recipient is unknown, missing, or ambiguous: use `intercom_team` for managed or approved teammates, otherwise `intercom_list`. Use `intercom_status` only for connection errors; publish `intercom_set_summary` only for role discovery or meaningful status changes.
- A standalone successful send needs no extra identity/status/pending checks or resending. Delivery is not task completion; diagnose uncertain delivery before retrying to avoid duplicates.
- Use `intercom_ask` only when your next step genuinely depends on the answer; keep only one unresolved ask per recipient. Grok does not wake on incoming messages. Check `intercom_pending` at natural work boundaries when expecting a response or handling inbound messages, never in a tight loop.
- When delegating to named peers without an approved task team, ask once for approval before creating a team or adding peers. Explicit create/join requests are approval. Initial ungrouped contact may omit `team`; unrelated memberships do not block it. Reuse approved task teams and include `team` when required, especially with multiple shared teams.
- Reply with `intercom_reply` using `askId` or `contextId` from `intercom_pending`. Inherit the original message's team; never override it with a current team or mix reply contexts.

Example: send directly to a known peer with `intercom_send`:

```json
{"to":"front","message":"I will modify this component. Please share the relevant context and avoid concurrent edits."}
```

Include the approved task's `team` if applicable. Discover the peer only if the target cannot be resolved.
