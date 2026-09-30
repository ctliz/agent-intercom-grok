import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grokSessionId, prepareGrokIdentity, readGrokSession, syncGrokTitle } from "../bin/native-session.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "grok-native-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, "project");
  const env = { GROK_HOME: dir, GROK_SESSION_ID: "native-session-a" };
  const root = join(dir, "sessions", encodeURIComponent(cwd), env.GROK_SESSION_ID);
  mkdirSync(root, { recursive: true });
  const path = join(root, "summary.json");
  const save = (title, id = env.GROK_SESSION_ID) => writeFileSync(path, JSON.stringify({
    info: { id, cwd }, generated_title: title, session_summary: "fallback",
  }));
  return { cwd, env, path, save };
}

test("native and resumed Grok sessions get stable identities and their persisted title", t => {
  const f = fixture(t); f.save("审查助手 🚀");
  prepareGrokIdentity(f.env, f.cwd);
  assert.equal(f.env.AGENT_INTERCOM_SESSION_ID, "grok-native-session-a");
  assert.equal(f.env.CLAUDE_INTERCOM_NAME, "审查助手 🚀");
  assert.equal(f.env.CLAUDE_INTERCOM_MODEL, "grok-build");
});

test("launcher identities retain precedence over native Grok IDs", t => {
  const f = fixture(t); f.save("native name");
  for (const key of ["CLAUDE_INTERCOM_SESSION_ID", "CLAUDE_PEER_ID", "AGENT_INTERCOM_SESSION_ID"]) {
    const env = { ...f.env, [key]: "pane-42" };
    prepareGrokIdentity(env, f.cwd);
    assert.equal(env[key], "pane-42");
    if (key !== "AGENT_INTERCOM_SESSION_ID") assert.equal(env.AGENT_INTERCOM_SESSION_ID, undefined);
  }
});

test("rename updates the same runtime owner without changing its ID or cwd", async t => {
  const f = fixture(t); f.save("first");
  let identity = { sessionId: "pane-42", name: "first", cwd: f.cwd, model: "grok-build", startedAt: 12 };
  const updates = [];
  const runtime = { getIdentity: () => identity, syncSession: async value => { updates.push(value); identity = value; } };
  f.save("renamed");
  await syncGrokTitle(runtime, f.env, f.cwd);
  await syncGrokTitle(runtime, f.env, f.cwd);
  assert.equal(updates.length, 1);
  assert.deepEqual(identity, { sessionId: "pane-42", name: "renamed", cwd: f.cwd, model: "grok-build", startedAt: 12 });
});

test("another session, partial writes and huge summaries cannot override identity", t => {
  const f = fixture(t); f.save("wrong", "other-session");
  assert.equal(readGrokSession(f.env, f.cwd).title, "");
  writeFileSync(f.path, "{");
  assert.equal(readGrokSession(f.env, f.cwd).title, "");
  writeFileSync(f.path, "x".repeat(65537));
  assert.equal(readGrokSession(f.env, f.cwd).title, "");
  assert.equal(grokSessionId({}), undefined);
  assert.throws(() => grokSessionId({ GROK_SESSION_ID: "../escape" }), /Invalid/);
});

test("copied native IDs in multiple workspaces fail closed instead of choosing the newest", t => {
  const f = fixture(t); f.save("original");
  const duplicate = join(f.env.GROK_HOME, "sessions", "other-workspace", f.env.GROK_SESSION_ID);
  mkdirSync(duplicate, { recursive: true });
  writeFileSync(join(duplicate, "summary.json"), JSON.stringify({ info: { id: f.env.GROK_SESSION_ID }, generated_title: "copied" }));
  assert.equal(readGrokSession(f.env, join(f.cwd, "plugin-root")).title, "");
  assert.equal(readGrokSession(f.env, f.cwd).title, "original");
});

test("MCP working-directory differences still resolve only the exact native session", t => {
  const f = fixture(t); f.save("native workspace");
  assert.equal(readGrokSession(f.env, join(f.cwd, "plugin-root")).title, "native workspace");
});
