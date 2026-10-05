# Agent Intercom for Grok Build

A minimal Grok Build plugin that exposes the Agent Intercom MCP tools through a dedicated launcher backed by `@ctliz/agent-intercom-claude`, with native `monitor` receive setup and an opt-in leader bridge for cold-start wake.

## Install

Install the npm package globally so the launcher is on `PATH`:

```bash
npm install -g @ctliz/agent-intercom-grok@0.3.0
command -v agent-intercom-grok-mcp
```

Install the Grok plugin from its exact release tag:

```bash
grok plugin install ctliz/agent-intercom-grok@v0.3.0 --trust
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

## Shortest calling path

The plugin bundles the `grok-intercom` skill. Use its `agent-intercom` MCP server consistently rather than switching to an imported Cursor or Claude Intercom server. For a known recipient, send directly; discover peers only for unknown, missing, or ambiguous targets, and check status only for connection errors. If the host requires tool discovery, discover only the selected tool and reuse its definition while it remains in context.

A standalone successful send does not need extra verification or a pending check. The default native inbox monitor prompts `intercom_pending({mark_read:true})` on ready/new-message notifications; without a monitor, check pending at natural work boundaries. Team approval and reply threading remain unchanged. Reinstall or update the Grok plugin and start a new session to load its hooks and skill; updating only the global npm launcher does not update installed plugin components.

## Task teams

The shared Claude MCP runtime supports additive task teams. When delegating to named peers, ask once for user approval, discover peers, then use `intercom_join({ name: "launch", create: true, members: ["front", "writer"], work: "Current task" })`. Explicit create/join requests are already approval; reuse an approved team for the same task. Joining preserves previous memberships and roles. Include `team` on task sends/asks, especially with multiple shared teams. Initial contact without a shared team remains ungrouped by omitting `team`. Replies use `askId`/`contextId` from `intercom_pending` and inherit the original team; never replace it with a mutable current team.

## Delivery behavior

The persistent MCP owner publishes a private, exact-native-session inbox descriptor. The plugin's PostToolUse hook asks the model to start one read-only native `monitor`; a Stop hook provides a one-round fallback for a tool-free turn. The helper emits a ready notification to drain existing unread messages and then one short notification per new-message burst. The model reads full text, attachments and reply selectors with `intercom_pending({mark_read:true})` on this plugin's original MCP server. The helper never creates a second broker identity, consumes MCP messages, or places peer text in hook instructions.

A live helper suppresses repeated setup, and duplicate helpers exit. Setup is offered once per native prompt ID, so a failed/denied attempt does not cause repeated PostToolUse reminders or an extra Stop continuation in that turn. Fully initialized directory locks and inode-specific stale generations allow crash recovery without removing a concurrent live listener's lock. If the helper exits, a subsequent model turn can re-arm it. Monitoring follows the actual MCP inbox, including explicit ID/path overrides and reconnections. Only this session is watched; workspace recency is never used to guess another session's inbox. Old JSONL history is not replayed; ready drains the current MCP runtime's unread messages, not historical messages lost across an MCP restart. The inbox mirror is append-only; external rotation/replacement is not supported.

### Leader receive mode (cold-start wake)

For a leader-hosted session, set `AGENT_INTERCOM_GROK_LEADER_SOCKET` **when the leader starts**, then launch/resume through that same socket:

```bash
AGENT_INTERCOM_GROK_LEADER_SOCKET="$HOME/.grok/leader-intercom.sock" \
  grok --leader --leader-socket "$HOME/.grok/leader-intercom.sock"
# To resume, append: --resume <exact-native-session-id>
```

Use a new socket when testing; do not kill a shared leader or load the same native session while its original process still owns the Intercom identity. An already-running leader will not inherit an environment variable from a later client: configure the environment at leader startup, then reconnect the plugin's updated MCP launcher. This mode is opt-in; ordinary in-process Grok sessions keep native monitor setup.

The original MCP owner checks its non-consuming, in-memory unread snapshot every 500 ms. A new-message burst opens a short-lived leader connection and sends `_x.ai/interject` for the exact `GROK_SESSION_ID`. It does not send `initialize`, create/load a session, answer permission dialogs, or keep a permanent subscription. No user prompt or model-created monitor is needed. The hook suppresses monitor setup in this mode, avoiding duplicate receive paths.

Only a fixed inbox notification enters the interjection channel, explicitly labelled as automated and not human approval. Peer text, attachments, teams and reply selectors are fetched from the same MCP server. The bridge never marks messages read, creates a second broker identity, or replays historical JSONL. Reconnects and unread messages arriving during startup are covered by the current runtime snapshot; unread memory lost with an old MCP process is not restored.

Missing sockets and explicit `session not found` rejections are retried. A missing response after sending is ambiguous and is **not** replayed automatically; inspect stderr and check pending manually before recovering. `queued` is host admission, not proof of model handling. To disable leader receive mode, unset its environment variable at leader startup and reconnect the MCP server; disabling `/hooks` alone does not disable the bridge.

**Host limits:** targets Grok Build 1.0.46. In-process/native-monitor mode still requires the first model turn: ordinary plugin hooks cannot directly register a native monitor or wake an untouched idle session. SessionStart stdout is ignored, so it is not used as a fake wake bridge. `persistent: true` covers the current session, not guaranteed restoration across process restarts. Model compliance, monitor permissions and host notification delivery are still required. If monitoring is denied or unavailable, use natural-boundary pending checks; disable the plugin's wake hooks in `/hooks` to opt out. A delivery acknowledgement does not prove the model handled the message. Use `intercom_send` for ordinary messages and `intercom_ask` only when the recipient has an active receive path.

For manual recovery, load `/grok-intercom` and follow the hook's exact monitor parameters. The installed helper also accepts `agent-intercom-grok-wake monitor <native-session-id>` as the native monitor's command; do not run it as an ordinary background task, which does not stream wake notifications. Reinstall/reload the plugin **and reconnect its MCP server** when upgrading so both the hook/helper and the descriptor-producing owner run the same version.
