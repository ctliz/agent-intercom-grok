# Agent Intercom for Grok Build

A minimal Grok Build plugin that starts `claude-intercom-mcp` as a standard MCP
server. It exposes the Agent Intercom tools, including `intercom_whoami`,
`intercom_list`, `intercom_send`, and `intercom_pending`.

## Requirement

Install `@ctliz/agent-intercom-claude` so its MCP executable is on `PATH`:

```bash
command -v claude-intercom-mcp
```

For a source checkout instead, register the built
`dist/claude-server.mjs` through `grok mcp add` as documented by
`agent-intercom-claude`.

## Install

```bash
grok plugin validate /Users/tsiji/Documents/intercom/agent-intercom-grok
grok plugin install /Users/tsiji/Documents/intercom/agent-intercom-grok --trust
```

Start a new Grok session, then call `intercom_whoami` and `intercom_list`.

## Identity and delivery

The plugin's supplied ID, `grok-worker`, is static. Change its
`AGENT_INTERCOM_SESSION_ID` and `AGENT_INTERCOM_SESSION_NAME` before running a
second live Grok worker; concurrent sessions may not share an Intercom ID.

This is an MCP integration, not a Grok wake bridge. An inbound
`intercom_send` is retained until Grok calls `intercom_pending`; it does not
create a new Grok turn automatically. Use `intercom_send` for ordinary
messages and poll `intercom_pending` at natural work boundaries.
