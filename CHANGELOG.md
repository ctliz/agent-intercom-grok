# Changelog

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
