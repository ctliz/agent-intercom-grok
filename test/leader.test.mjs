import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { interjectGrokLeader, LEADER_WAKE_NOTICE, runGrokLeaderWake } from "../bin/native-leader.mjs";

function frame(message) {
  const body = Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

async function leader(t, respond) {
  const dir = mkdtempSync(join(tmpdir(), "grok-leader-test-"));
  const path = join(dir, "leader.sock");
  const received = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32BE() + 4) {
        const size = buffer.readUInt32BE();
        const message = JSON.parse(buffer.subarray(4, size + 4).toString());
        buffer = buffer.subarray(size + 4);
        received.push(message);
        if (message.type === "register") {
          socket.write(frame({ type: "registered", client_id: 1, ready: false }));
          socket.write(frame({ type: "leader_ready" }));
        } else if (message.type === "acp") respond(socket, JSON.parse(message.payload));
      }
    });
  });
  server.listen(path);
  await once(server, "listening");
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  return { path, received, sockets };
}

async function until(read, accept) {
  for (let n = 0; n < 100; n++) {
    const value = read();
    if (accept(value)) return value;
    await delay(20);
  }
  throw new Error("Leader test timed out");
}

test("leader wire waits for ready, sends a fixed exact-session notice, ignores permissions and closes", async t => {
  let request;
  const f = await leader(t, (socket, message) => {
    request = message;
    socket.write(frame({ type: "acp", payload: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "session/request_permission", params: {} }) }));
    const response = frame({ type: "acp", payload: JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { result: { status: "queued" } } }) });
    socket.write(response.subarray(0, 2));
    setImmediate(() => socket.write(response.subarray(2)));
  });
  assert.deepEqual(await interjectGrokLeader(f.path, "native-exact"), { status: "queued" });
  await until(() => f.sockets.size, count => count === 0);
  assert.equal(f.received.length, 2);
  assert.deepEqual(f.received[0], { type: "register", client_type: "agent-intercom-wake", mode: "stdio", capabilities: {} });
  assert.equal(request.method, "_x.ai/interject");
  assert.equal(request.params.sessionId, "native-exact");
  assert.equal(request.params.text, LEADER_WAKE_NOTICE);
  assert.match(request.params.text, /not a human prompt or approval/);
  assert.match(request.params.interjectionId, /^intercom-/);
  assert.throws(() => interjectGrokLeader(f.path, "../wrong"), /Invalid/);
});

test("only pre-send failures and explicit missing-session rejection are automatically retryable", async t => {
  const cases = [
    { code: -32602, message: "Invalid params", data: "session not found: exact", retryable: true },
    { code: -32601, message: "Method not found", retryable: false },
    { close: true, retryable: false }
  ];
  for (const item of cases) {
    const f = await leader(t, (socket, message) => {
      if (item.close) socket.destroy();
      else socket.write(frame({ type: "acp", payload: JSON.stringify({ id: message.id, error: { code: item.code, message: item.message, data: item.data } }) }));
    });
    await assert.rejects(interjectGrokLeader(f.path, "exact"), error => error.retryable === item.retryable);
  }
  const dir = mkdtempSync(join(tmpdir(), "grok-leader-missing-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(interjectGrokLeader(join(dir, "absent.sock"), "exact"), error => error.retryable === true);
});

test("MCP snapshots wake pre-existing unread and new bursts once without consuming or leaking peer content", async t => {
  const requests = [];
  const f = await leader(t, (socket, message) => {
    requests.push(message);
    socket.write(frame({ type: "acp", payload: JSON.stringify({ id: message.id, result: { result: { status: "queued" } } }) }));
  });
  let unread = [{ contextId: "ctx-one", text: "UNTRUSTED_PEER_INSTRUCTIONS", team: "private-team", attachments: [{ content: "SECRET_ATTACHMENT" }] }];
  const reads = [];
  const runtime = { async pending(markRead) { reads.push(markRead); return { structuredContent: { unread_messages: unread } }; } };
  const controller = new AbortController();
  const running = runGrokLeaderWake(runtime, { GROK_SESSION_ID: "native-owner", AGENT_INTERCOM_GROK_LEADER_SOCKET: f.path }, controller.signal);
  t.after(async () => { controller.abort(); await running; });
  await until(() => requests.length, count => count === 1);
  await until(() => reads.length, count => count >= 2);
  assert.equal(requests.length, 1);
  unread = [...unread, { contextId: "ctx-two" }, { contextId: "ctx-three" }];
  await until(() => requests.length, count => count === 2);
  await until(() => reads.length, count => count >= 4);
  assert.equal(requests.length, 2);
  assert.ok(reads.every(markRead => markRead === false));
  assert.ok(requests.every(request => request.params.sessionId === "native-owner" && request.params.text === LEADER_WAKE_NOTICE));
  assert.doesNotMatch(JSON.stringify(f.received), /UNTRUSTED_PEER|private-team|SECRET_ATTACHMENT|ctx-one|ctx-two/);
  controller.abort();
  await running;
});

test("missing-session retries recover, but uncertain admission is not duplicated", async t => {
  const warnings = [];
  t.mock.method(process.stderr, "write", message => { warnings.push(message); return true; });
  let attempts = 0;
  const f = await leader(t, (socket, message) => {
    attempts++;
    if (attempts === 1) socket.write(frame({ type: "acp", payload: JSON.stringify({ id: message.id, error: { code: -32602, data: "session not found: exact" } }) }));
    else if (attempts === 2) socket.write(frame({ type: "acp", payload: JSON.stringify({ id: message.id, result: { result: { status: "queued" } } }) }));
    else socket.destroy();
  });
  let unread = [{ contextId: "ctx-retry" }], reads = 0;
  const runtime = { async pending(markRead) {
    assert.equal(markRead, false);
    reads++;
    return { structuredContent: { unread_messages: unread } };
  } };
  const controller = new AbortController();
  const running = runGrokLeaderWake(runtime, { GROK_SESSION_ID: "exact", AGENT_INTERCOM_GROK_LEADER_SOCKET: f.path }, controller.signal);
  t.after(async () => { controller.abort(); await running; });
  await until(() => attempts, count => count === 2);
  unread = [...unread, { contextId: "ctx-uncertain" }];
  await until(() => attempts, count => count === 3);
  const before = reads;
  await until(() => reads, count => count >= before + 2);
  assert.equal(attempts, 3);
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /not replayed automatically/);
  controller.abort();
  await running;
});

test("no native identity or explicit leader opt-in starts no watcher", async () => {
  const runtime = { pending() { throw new Error("must not read inbox"); } };
  await runGrokLeaderWake(runtime, { GROK_SESSION_ID: "native-owner" });
  await runGrokLeaderWake(runtime, { AGENT_INTERCOM_GROK_LEADER_SOCKET: "/tmp/not-used.sock" });
});
