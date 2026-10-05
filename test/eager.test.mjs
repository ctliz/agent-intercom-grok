import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { LEADER_WAKE_NOTICE } from "../bin/native-leader.mjs";
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
    CLAUDE_PEER_ID: "", CLAUDE_INTERCOM_INBOX: "", AGENT_INTERCOM_GROK_LEADER_SOCKET: "" };
  const server = fileURLToPath(import.meta.resolve("@ctliz/agent-intercom-claude/dist/claude-server.mjs"));
  const brokerPath = fileURLToPath(import.meta.resolve("@ctliz/agent-intercom-claude/dist/broker.mjs"));
  const launcher = fileURLToPath(new URL("../bin/agent-intercom-grok-mcp.mjs", import.meta.url));
  const children = [];
  let leaderServer;
  const leaderSockets = new Set();
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
    const wakeScript = fileURLToPath(new URL("../bin/agent-intercom-grok-wake.mjs", import.meta.url));
    const monitor = spawn(process.execPath, [wakeScript, "monitor", nativeId], { cwd, env });
    children.push(monitor);
    let wakeOutput = "", wakeErrors = "";
    monitor.stdout.on("data", data => { wakeOutput += data; });
    monitor.stderr.on("data", data => { wakeErrors += data; });
    await until(() => wakeOutput, text => text.includes("monitor ready"));
    const ownerRequest = rpc(owner);
    const early = (await ownerRequest("intercom_pending", { mark_read: true })).structuredContent;
    assert.equal(early.unread_messages[0].text, "before first prompt");
    const team = "wake-test-team";
    assert.equal((await request("intercom_join", { name: team, create: true, members: [expectedId], work: "Local wake test only" })).isError, undefined);
    const attachments = [{ type: "snippet", name: "diagnostic", content: "No business authorization", language: "text" }];
    assert.equal((await request("intercom_send", { to: expectedId, team, message: "team wake probe", attachments })).isError, undefined);
    await until(() => wakeOutput, text => text.includes("1 new inbound"));
    const inbound = (await ownerRequest("intercom_pending", { mark_read: true })).structuredContent.unread_messages;
    assert.equal(inbound.length, 1);
    assert.equal(inbound[0].team, team);
    assert.deepEqual(inbound[0].attachments, attachments);
    assert.equal((await ownerRequest("intercom_reply", { contextId: inbound[0].contextId, message: "ACK" })).isError, undefined);
    const reply = (await request("intercom_pending", { mark_read: true })).structuredContent.unread_messages;
    assert.equal(reply[0].text, "ACK");
    assert.equal(reply[0].team, team);
    assert.equal((await ownerRequest("intercom_pending", { mark_read: true })).structuredContent.unread_messages.length, 0);
    const asked = request("intercom_ask", { to: expectedId, team, message: "ask wake probe", timeout_ms: 2000 });
    const question = await until(async () => (await ownerRequest("intercom_pending")).structuredContent.pending_asks,
      entries => entries.length === 1);
    assert.equal(question[0].team, team);
    assert.ok(question[0].askId);
    assert.equal((await ownerRequest("intercom_reply", { askId: question[0].askId, message: "ASK_ACK" })).isError, undefined);
    assert.equal((await asked).structuredContent.reply.content.text, "ASK_ACK");
    assert.equal(wakeErrors, "");
    await stop(owner);
    await until(list, peers => !peers.some(peer => peer.id === expectedId));
    await stop(monitor);
    const leaderPath = join(dir, "leader.sock"), interjections = [];
    const sendFrame = (socket, message) => {
      const body = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      socket.write(Buffer.concat([header, body]));
    };
    leaderServer = createServer(socket => {
      leaderSockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => leaderSockets.delete(socket));
      let buffer = Buffer.alloc(0);
      socket.on("data", data => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE() + 4) {
          const size = buffer.readUInt32BE();
          const message = JSON.parse(buffer.subarray(4, size + 4));
          buffer = buffer.subarray(size + 4);
          if (message.type === "register") sendFrame(socket, { type: "registered", ready: true, client_id: 1 });
          else if (message.type === "acp") {
            const request = JSON.parse(message.payload);
            interjections.push(request);
            sendFrame(socket, { type: "acp", payload: JSON.stringify({ id: request.id, result: { result: { status: "queued" } } }) });
          }
        }
      });
    });
    leaderServer.listen(leaderPath);
    await once(leaderServer, "listening");
    const resumed = spawn(process.execPath, [launcher], { cwd, env: { ...env, AGENT_INTERCOM_GROK_LEADER_SOCKET: leaderPath } });
    children.push(resumed);
    await until(list, peers => peers.some(peer => peer.id === expectedId && peer.name === "Grok renamed 🚀"));
    assert.equal((await request("intercom_send", { to: expectedId, team, message: "cold leader wake", attachments })).isError, undefined);
    // No initialize, model prompt or tool call is sent to the resumed owner.
    await until(() => interjections, entries => entries.length === 1);
    assert.equal(interjections[0].method, "_x.ai/interject");
    assert.equal(interjections[0].params.sessionId, nativeId);
    assert.equal(interjections[0].params.text, LEADER_WAKE_NOTICE);
    const resumedRequest = rpc(resumed);
    const cold = (await resumedRequest("intercom_pending", { mark_read: true })).structuredContent.unread_messages;
    assert.equal(cold.length, 1);
    assert.equal(cold[0].text, "cold leader wake");
    assert.equal(cold[0].team, team);
    assert.deepEqual(cold[0].attachments, attachments);
    assert.equal((await resumedRequest("intercom_reply", { contextId: cold[0].contextId, message: "COLD_ACK" })).isError, undefined);
    assert.equal((await request("intercom_pending", { mark_read: true })).structuredContent.unread_messages[0].text, "COLD_ACK");
    assert.equal((await resumedRequest("intercom_pending", { mark_read: true })).structuredContent.unread_messages.length, 0);
    assert.equal((await list()).filter(peer => peer.id === expectedId).length, 1);
  } finally {
    for (const child of children.reverse()) await stop(child);
    for (const socket of leaderSockets) socket.destroy();
    if (leaderServer) await new Promise(resolve => leaderServer.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
