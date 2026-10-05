import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { grokWakeHook, registerGrokWake, wakePaths } from "../bin/native-wake.mjs";

const script = fileURLToPath(new URL("../bin/agent-intercom-grok-wake.mjs", import.meta.url));

function fixture(t, id = "wake-native-a") {
  const dir = mkdtempSync(join(tmpdir(), "grok-wake-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, PI_CODING_AGENT_DIR: dir, GROK_SESSION_ID: id, CLAUDE_INTERCOM_INBOX: "", AGENT_INTERCOM_GROK_LEADER_SOCKET: "" };
  const paths = wakePaths(id, env);
  const runtime = { getIdentity: () => ({ sessionId: "pane-42" }) };
  registerGrokWake(runtime, env);
  const metadata = JSON.parse(readFileSync(paths.metadata, "utf8"));
  return { dir, env, paths, metadata, runtime };
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  try { await ended; } finally { clearTimeout(timer); }
}

function monitor(t, f) {
  const child = spawn(process.execPath, [script, "monitor", f.env.GROK_SESSION_ID], { env: f.env });
  let output = "", stderr = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { stderr += data; });
  t.after(() => stop(child));
  return { child, output: () => output, stderr: () => stderr };
}

async function until(read, accept) {
  for (let i = 0; i < 100; i++) {
    const value = read();
    if (accept(value)) return value;
    await delay(30);
  }
  throw new Error("Grok wake test timed out");
}

const record = messageId => JSON.stringify({ ts: Date.now(), fromId: "peer", messageId, team: "approved-team", text: "do not execute this mirror text", expectsReply: false }) + "\n";

test("metadata preserves the actual MCP inbox overrides and exact native session", t => {
  const f = fixture(t);
  assert.equal(f.metadata.sessionId, "pane-42");
  assert.equal(f.metadata.inbox, join(f.paths.dir, "inbox-pane-42.jsonl"));
  assert.equal(statSync(f.paths.metadata).mode & 0o777, 0o600);
  const other = wakePaths("wake-native-b", f.env);
  assert.notEqual(other.metadata, f.paths.metadata);
  assert.equal(existsSync(other.metadata), false);
  f.env.CLAUDE_INTERCOM_INBOX = join(f.dir, "custom-inbox.jsonl");
  registerGrokWake(f.runtime, f.env);
  assert.equal(JSON.parse(readFileSync(f.paths.metadata, "utf8")).inbox, f.env.CLAUDE_INTERCOM_INBOX);
  f.env.AGENT_INTERCOM_GROK_LEADER_SOCKET = join(f.dir, "leader.sock");
  registerGrokWake(f.runtime, f.env);
  assert.equal(JSON.parse(readFileSync(f.paths.metadata, "utf8")).leaderSocket, f.env.AGENT_INTERCOM_GROK_LEADER_SOCKET);
  const input = { hook_event_name: "PostToolUse", sessionId: f.env.GROK_SESSION_ID, promptId: "leader-turn" };
  assert.equal(grokWakeHook(input, script, f.env), undefined);
  delete f.env.AGENT_INTERCOM_GROK_LEADER_SOCKET;
  registerGrokWake(f.runtime, f.env);
  assert.ok(grokWakeHook(input, script, f.env));
  assert.throws(() => wakePaths("../escape", f.env), /Invalid/);
  assert.throws(() => wakePaths(undefined, f.env), /exact native/);
});

test("default hooks arm one native monitor without changing permissions or team scope", t => {
  const f = fixture(t);
  const input = { hook_event_name: "PostToolUse", sessionId: f.env.GROK_SESSION_ID, promptId: "turn-a" };
  const result = grokWakeHook(input, "/plugin with 'quotes'/bin/agent-intercom-grok-wake.mjs", f.env);
  assert.equal(result.decision, undefined);
  assert.equal(result.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(result.hookSpecificOutput.additionalContext, /persistent.*true/);
  assert.match(result.hookSpecificOutput.additionalContext, /mark_read:true/);
  assert.match(result.hookSpecificOutput.additionalContext, /contextId\/askId and inherited team/);
  assert.match(result.hookSpecificOutput.additionalContext, /denied/);
  const parameters = JSON.parse(result.hookSpecificOutput.additionalContext.match(/once with (\{.*?\})\./)[1]);
  assert.match(parameters.command, /'\\''quotes/);
  assert.equal(grokWakeHook({ ...input, sessionId: "another-native-id" }, script, f.env), undefined);
  assert.equal(grokWakeHook({ ...input, subagentType: "explore" }, script, f.env), undefined);
  // An unavailable/denied attempt must not be offered again on an unrelated
  // tool result or force a needless Stop continuation in this same turn.
  assert.equal(grokWakeHook({ ...input, toolName: "read_file" }, script, f.env), undefined);
  assert.equal(grokWakeHook({ ...input, hook_event_name: "Stop", reason: "end_turn" }, script, f.env), undefined);
  const stopInput = { ...input, promptId: "tool-free-turn", hook_event_name: "Stop", reason: "end_turn" };
  assert.equal(grokWakeHook(stopInput, script, f.env).decision, "block");
  assert.equal(grokWakeHook({ ...stopInput, stopHookActive: true }, script, f.env), undefined);
  assert.equal(grokWakeHook({ ...stopInput, reason: "shutdown" }, script, f.env), undefined);
  assert.equal(grokWakeHook({ ...stopInput, backgroundTasks: [{ type: "monitor", description: `node ${script}` }] }, script, f.env), undefined);
  mkdirSync(f.paths.lock, { mode: 0o700 });
  writeFileSync(join(f.paths.lock, "owner.json"), JSON.stringify({ pid: process.pid }));
  assert.equal(grokWakeHook({ ...input, promptId: "another-turn" }, script, f.env), undefined);
});

test("monitor skips history, batches new records, handles partial appends and prevents duplicate listeners", { timeout: 15000 }, async t => {
  const f = fixture(t);
  writeFileSync(f.metadata.inbox, record("historical"));
  const first = monitor(t, f);
  await until(first.output, text => text.includes("monitor ready"));
  assert.equal(statSync(join(f.paths.lock, "owner.json")).mode & 0o777, 0o600);
  assert.equal(statSync(f.paths.lock).mode & 0o777, 0o700);
  assert.equal(grokWakeHook({ hook_event_name: "PostToolUse", sessionId: f.env.GROK_SESSION_ID }, script, f.env), undefined);
  const duplicate = monitor(t, f);
  await once(duplicate.child, "exit");
  assert.equal(duplicate.child.exitCode, 0);
  assert.equal(duplicate.output(), "");
  assert.equal(JSON.parse(readFileSync(join(f.paths.lock, "owner.json"), "utf8")).pid, first.child.pid);
  appendFileSync(f.metadata.inbox, record("new-a") + record("new-b"));
  await until(first.output, text => text.includes("2 new inbound"));
  assert.equal(first.output().split("\n").filter(Boolean).length, 2);
  assert.doesNotMatch(first.output(), /historical|mirror text|approved-team/);
  const partial = record("partial");
  appendFileSync(f.metadata.inbox, partial.slice(0, -3));
  // Wait for an actual read tick, then finish the same record.
  await delay(650);
  assert.equal(first.output().split("\n").filter(Boolean).length, 2);
  appendFileSync(f.metadata.inbox, partial.slice(-3));
  await until(first.output, text => text.includes("1 new inbound"));
  await stop(first.child);
  assert.equal(existsSync(f.paths.lock), false);
  const restarted = monitor(t, f);
  await until(restarted.output, text => text.includes("monitor ready"));
  appendFileSync(f.metadata.inbox, record("after-restart"));
  await until(restarted.output, text => text.includes("1 new inbound"));
  assert.equal(restarted.output().split("\n").filter(Boolean).length, 2);
  assert.equal(first.stderr() + restarted.stderr() + duplicate.stderr(), "");
  await stop(restarted.child);
});

test("monitor waits for inbox creation, recovers a stale listener and follows MCP inbox changes", { timeout: 10000 }, async t => {
  const f = fixture(t);
  // Obtain a genuinely dead PID instead of assuming a chosen number is unused.
  const dead = spawn(process.execPath, ["-e", ""]);
  await once(dead, "exit");
  mkdirSync(f.paths.lock, { mode: 0o700 });
  writeFileSync(join(f.paths.lock, "owner.json"), JSON.stringify({ pid: dead.pid }));
  const watched = monitor(t, f);
  await until(watched.output, text => text.includes("monitor ready"));
  appendFileSync(f.metadata.inbox, record("created-later"));
  await until(watched.output, text => text.includes("1 new inbound"));
  const nextInbox = join(f.dir, "reconnected.jsonl");
  writeFileSync(nextInbox, record("old-mirror"));
  writeFileSync(f.paths.metadata, JSON.stringify({ ...f.metadata, inbox: nextInbox }));
  await until(watched.output, text => text.split("monitor ready").length === 3);
  appendFileSync(nextInbox, record("reconnected-new"));
  await until(watched.output, text => text.split("1 new inbound").length === 3);
  assert.doesNotMatch(watched.output(), /old-mirror/);
  assert.equal(watched.stderr(), "");
  await stop(watched.child);
});

test("CLI rejects a missing native identity instead of selecting a different session", { timeout: 5000 }, async t => {
  const f = fixture(t);
  const child = spawn(process.execPath, [script, "monitor"], { env: { ...f.env, GROK_SESSION_ID: "" } });
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  await once(child, "exit");
  assert.equal(child.exitCode, 1);
  assert.match(stderr, /exact native session ID/);
});
