#!/usr/bin/env node

process.env.CLAUDE_INTERCOM_MODEL ??= "grok-build";
await import("@ctliz/agent-intercom-claude/dist/claude-server.mjs");
