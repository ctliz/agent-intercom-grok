import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}

async function until(read, accept) {
  for (let n = 0; n < 100; n++) {
    const value = await read();
    if (accept(value)) return value;
    await delay(50);
  }
  throw new Error("Timed out waiting for Grok presence");
}

function rpc(child) {
  let buffer = "", id = 0;
  const pending = new Map();
  child.stdout.on("data", data => {
    buffer += data;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const packet = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(packet.id)?.(packet.result);
      pending.delete(packet.id);
    }
  });
  return (name, args = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("MCP RPC timeout")); }, 3000);
    pending.set(requestId, result => { clearTimeout(timer); resolve(result); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
}

test("Grok registers before a prompt, renames in place, and resumes the same native ID", { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "grok-mcp-eager-"));
  const cwd = join(dir, "workspace");
  const nativeId = "native-grok-session";
  const summary = join(dir, "sessions", encodeURIComponent(cwd), nativeId, "summary.json");
  mkdirSync(cwd);
  mkdirSync(join(dir, "sessions", encodeURIComponent(cwd), nativeId), { recursive: true });
  const title = value => writeFileSync(summary, JSON.stringify({ info: { id: nativeId, cwd }, generated_title: value }));
  title("Grok initial");
  const env = { ...process.env, PI_CODING_AGENT_DIR: dir, GROK_HOME: dir, GROK_SESSION_ID: nativeId,
    AGENT_INTERCOM_SCOPE_ID: "", AGENT_INTERCOM_SESSION_ID: "", CLAUDE_INTERCOM_SESSION_ID: "",
    CLAUDE_PEER_ID: "", CLAUDE_INTERCOM_INBOX: "" };
  const server = fileURLToPath(import.meta.resolve("@ctliz/agent-intercom-claude/dist/claude-server.mjs"));
  const brokerPath = fileURLToPath(import.meta.resolve("@ctliz/agent-intercom-claude/dist/broker.mjs"));
  const launcher = fileURLToPath(new URL("../bin/agent-intercom-grok-mcp.mjs", import.meta.url));
  const children = [];
  try {
    const broker = spawn(process.execPath, [brokerPath], { cwd, env });
    children.push(broker);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Broker startup timeout")), 5000);
      broker.stdout.on("data", data => { if (String(data).includes("Intercom broker started")) { clearTimeout(timer); resolve(); } });
      broker.once("exit", () => { clearTimeout(timer); reject(new Error("Broker exited")); });
    });
    const probe = spawn(process.execPath, [server], { cwd, env: { ...env, CLAUDE_INTERCOM_SESSION_ID: "grok-probe", CLAUDE_INTERCOM_NAME: "probe" } });
    children.push(probe);
    const request = rpc(probe);
    const list = async () => (await request("intercom_list")).structuredContent.sessions;
    const owner = spawn(process.execPath, [launcher], { cwd, env });
    children.push(owner);
    const expectedId = `grok-${nativeId}`;
    const initial = await until(list, peers => peers.some(peer => peer.id === expectedId && peer.name === "Grok initial"));
    assert.equal(initial.find(peer => peer.id === expectedId).model, "grok-build");
    // No initialize or tool request has been written to the owner's stdin.
    title("Grok renamed 🚀");
    await until(list, peers => peers.some(peer => peer.id === expectedId && peer.name === "Grok renamed 🚀"));
    assert.equal((await request("intercom_send", { to: expectedId, message: "before first prompt" })).isError, undefined);
    await stop(owner);
    await until(list, peers => !peers.some(peer => peer.id === expectedId));
    const resumed = spawn(process.execPath, [launcher], { cwd, env });
    children.push(resumed);
    await until(list, peers => peers.some(peer => peer.id === expectedId && peer.name === "Grok renamed 🚀"));
  } finally {
    for (const child of children.reverse()) await stop(child);
    rmSync(dir, { recursive: true, force: true });
  }
});
