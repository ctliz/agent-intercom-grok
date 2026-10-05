#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { grokSessionId } from "./native-session.mjs";
import { grokWakeHook, runGrokMonitor } from "./native-wake.mjs";

try {
  if (process.argv[2] === "hook") {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const output = grokWakeHook(JSON.parse(input), fileURLToPath(import.meta.url));
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } else if (process.argv[2] === "monitor") {
    const controller = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => controller.abort());
    await runGrokMonitor(process.argv[3] || grokSessionId(), process.env, controller.signal);
  } else {
    throw new Error("Usage: agent-intercom-grok-wake hook | monitor [native-session-id]");
  }
} catch (error) {
  process.stderr.write(`grok-intercom-wake: ${error.message}\n`);
  process.exitCode = 1;
}
