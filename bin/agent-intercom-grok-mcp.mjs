#!/usr/bin/env node
import { prepareGrokIdentity, syncGrokTitle } from "./native-session.mjs";

prepareGrokIdentity();
const { runtimeReady } = await import("@ctliz/agent-intercom-claude/dist/claude-server.mjs");
const runtime = await runtimeReady;
await syncGrokTitle(runtime);
const timer = setInterval(() => {
  void syncGrokTitle(runtime).catch(error => {
    process.stderr.write(`grok-intercom: ${error.message}\n`);
  });
}, 250);
timer.unref();
process.stdin.once("end", () => clearInterval(timer));
process.once("SIGTERM", () => clearInterval(timer));
process.once("exit", () => clearInterval(timer));
