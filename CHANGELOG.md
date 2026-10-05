# Changelog

## 0.3.0 - 2026-10-06

- Add default PostToolUse/Stop receive setup through Grok's native persistent `monitor` tool, without bypassing permission prompts or creating a second Intercom identity.
- Publish the actual MCP owner's inbox descriptor for its exact native session, retaining explicit identity/inbox overrides. Bundle a read-only helper with duplicate-listener protection, burst notifications, partial-append handling and reconnect recovery.
- Drain current unread messages on monitor-ready notifications and fetch full messages/attachments with `intercom_pending({mark_read:true})`; preserve original team and contextId/askId, and never replay historical mirror text as a task.
- Recover empty, partial and stale locks using atomically published directory claims and inode-specific retired generations; verify listener ownership before notifying. Suppress repeated setup within a native prompt ID, including the Stop fallback after a failed/unsupported attempt.
- Document the first-model-turn bootstrap requirement, session-lifetime persistence, polling fallback and delivery-vs-model-awareness distinction.
- Add opt-in leader receive mode via `AGENT_INTERCOM_GROK_LEADER_SOCKET`: the original MCP owner injects only a fixed automated notice with `_x.ai/interject`, without a user bootstrap prompt, duplicate monitor, second broker identity or permission approval. Retry known pre-admission failures, but never automatically replay ambiguous post-send failures.

## 0.2.1 - 2026-10-04

- Upgrade the shared Claude MCP runtime to 0.15.1 so shortest-path instructions are available even without loading the skill.
- Bundle a Grok-specific shortest-path Intercom skill: send directly to known peers, discover and diagnose only when needed, and keep all message/reply operations on this plugin's MCP server instead of switching to imported services. Preserve team approval and natural-boundary polling.

## 0.1.2 - 2026-09-30

- Upgrade the shared Claude MCP runtime to 0.14.1 for eager registration and named teams.
- Use Grok's native `GROK_SESSION_ID` for stable standalone identities; preserve all explicit launcher IDs.
- Synchronize startup/resumed names and `/rename` from the exact native session's bounded `summary.json`, without a prompt or a second broker owner.
- Keep incoming-message delivery polling-only; native title synchronization is not a wake bridge.

## 0.1.1 - 2026-08-24

- Publish the Grok Build plugin as `@ctliz/agent-intercom-grok`.
- Bundle a dedicated MCP launcher backed by `@ctliz/agent-intercom-claude`.
- Keep inbound delivery polling-based through `intercom_pending`.

## 0.1.0 - 2026-08-18

- Add the initial GitHub-distributed Grok Build plugin.
