#!/usr/bin/env node
import { prepareGrokIdentity, syncGrokTitle } from "./native-session.mjs";
import { registerGrokWake } from "./native-wake.mjs";
import { runGrokLeaderWake } from "./native-leader.mjs";

prepareGrokIdentity();
const { runtimeReady } = await import("@ctliz/agent-intercom-claude/dist/claude-server.mjs");
const runtime = await runtimeReady;
registerGrokWake(runtime);
const wake = new AbortController();
void runGrokLeaderWake(runtime, process.env, wake.signal).catch(error => {
  process.stderr.write(`grok-intercom: leader wake stopped: ${error.message}\n`);
  registerGrokWake(runtime, { ...process.env, AGENT_INTERCOM_GROK_LEADER_SOCKET: "" });
});
await syncGrokTitle(runtime);
const timer = setInterval(() => {
  void syncGrokTitle(runtime).catch(error => {
    process.stderr.write(`grok-intercom: ${error.message}\n`);
  });
}, 250);
timer.unref();
function stop() { clearInterval(timer); wake.abort(); }
process.stdin.once("end", stop);
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("exit", stop);
