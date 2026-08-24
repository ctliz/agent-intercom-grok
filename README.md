# Agent Intercom for Grok Build

A minimal Grok Build plugin that exposes the nine Agent Intercom MCP tools through a dedicated launcher backed by `@ctliz/agent-intercom-claude`.

## Install

Install the npm package globally so the launcher is on `PATH`:

```bash
npm install -g @ctliz/agent-intercom-grok
command -v agent-intercom-grok-mcp
```

Install the Grok plugin from its exact release tag:

```bash
grok plugin install ctliz/agent-intercom-grok@v0.1.1 --trust
```

Start a new Grok session, then call `intercom_whoami` and `intercom_list`.

For a local checkout:

```bash
npm install
grok plugin validate .
grok plugin install . --trust
```

## Identity

The plugin supplies `CLAUDE_INTERCOM_MODEL=grok-build` but deliberately does not set a session ID or name. A multi-pane supervisor must provide literal, unique values for every worker:

```text
AGENT_INTERCOM_SESSION_ID=<stable-unique-worker-id>
AGENT_INTERCOM_SESSION_NAME=<display-name>
```

`CLAUDE_INTERCOM_SESSION_ID` and `CLAUDE_INTERCOM_NAME` remain higher-priority compatibility aliases. Concurrent sessions may not share an Intercom ID. Use the same `AGENT_INTERCOM_SCOPE_ID` as intended peers, or leave it unset for the default local scope.

## Delivery behavior

This package provides an MCP integration, not a Grok wake bridge. Incoming messages remain durable but do not start a new Grok turn. Call `intercom_pending` at natural work boundaries. Use `intercom_send` for ordinary messages; use `intercom_ask` only when the receiver is actively polling and able to reply.
