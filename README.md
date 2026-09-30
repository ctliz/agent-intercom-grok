# Agent Intercom for Grok Build

A minimal Grok Build plugin that exposes the Agent Intercom MCP tools through a dedicated launcher backed by `@ctliz/agent-intercom-claude`.

## Install

Install the npm package globally so the launcher is on `PATH`:

```bash
npm install -g @ctliz/agent-intercom-grok
command -v agent-intercom-grok-mcp
```

Install the Grok plugin from its exact release tag:

```bash
grok plugin install ctliz/agent-intercom-grok@v0.1.2 --trust
```

Start a new Grok session. The persistent MCP server registers immediately, without a prompt or tool call. Use `intercom_whoami` and `intercom_list` to verify it.

For a local checkout:

```bash
npm install
grok plugin validate .
grok plugin install . --trust
```

## Identity

The plugin supplies `CLAUDE_INTERCOM_MODEL=grok-build` and uses the native `GROK_SESSION_ID` supplied by Grok to derive `grok-<native-id>`. Native startup/resumed titles and `/rename` are synchronized from that exact session's `summary.json`; it never guesses the newest session in a workspace. Older hosts that do not supply a native ID get a unique process identity instead.

A multi-pane supervisor may provide literal, unique values for every worker; these IDs retain precedence over the native ID:

```text
AGENT_INTERCOM_SESSION_ID=<stable-unique-worker-id>
AGENT_INTERCOM_SESSION_NAME=<display-name>
```

`CLAUDE_INTERCOM_SESSION_ID` remains a higher-priority compatibility alias; configured names are initial fallbacks until a native title is available. A rename changes presence, not the stable Intercom ID. Concurrent sessions may not share an Intercom ID. Use the same `AGENT_INTERCOM_SCOPE_ID` as intended peers, or leave it unset for the default local scope.

## Delivery behavior

This package provides an MCP integration, not a Grok wake bridge. Incoming messages remain durable but do not start a new Grok turn. Call `intercom_pending` at natural work boundaries. Use `intercom_send` for ordinary messages; use `intercom_ask` only when the receiver is actively polling and able to reply.
