import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { registerGrokWake, wakePaths } from "../bin/native-wake.mjs";

const script = fileURLToPath(new URL("../bin/agent-intercom-grok-wake.mjs", import.meta.url));

async function until(read, accept) {
  for (let i = 0; i < 150; i++) {
    const value = read();
    if (accept(value)) return value;
    await delay(20);
  }
  throw new Error("Concurrent monitor recovery timed out");
}

for (const abandoned of ["empty", "partial", "dead"]) {
  test(`concurrent monitor startup recovers a ${abandoned} lock without duplicate listeners`, { timeout: 10000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "grok-lock-race-"));
    const env = { ...process.env, PI_CODING_AGENT_DIR: dir, GROK_SESSION_ID: "lock-test", CLAUDE_INTERCOM_INBOX: "", AGENT_INTERCOM_GROK_LEADER_SOCKET: "" };
    const paths = wakePaths(env.GROK_SESSION_ID, env);
    registerGrokWake({ getIdentity: () => ({ sessionId: "lock-owner" }) }, env);
    const inbox = JSON.parse(readFileSync(paths.metadata, "utf8")).inbox;
    // A crash before PID write leaves only this private, unpublished claim.
    mkdtempSync(`${paths.lock}.claim-`);
    mkdirSync(paths.lock, { mode: 0o700 });
    if (abandoned === "partial") writeFileSync(join(paths.lock, "owner.json"), "{\"pid\":");
    if (abandoned === "dead") {
      const dead = spawn(process.execPath, ["-e", ""]);
      await once(dead, "exit");
      writeFileSync(join(paths.lock, "owner.json"), JSON.stringify({ pid: dead.pid }));
    }
    const children = [];
    const outputs = [];
    let errors = "";
    try {
      for (let i = 0; i < 8; i++) {
        const child = spawn(process.execPath, [script, "monitor", env.GROK_SESSION_ID], { env });
        children.push(child);
        outputs.push("");
        child.stdout.on("data", data => { outputs[i] += data; });
        child.stderr.on("data", data => { errors += data; });
      }
      await until(() => children.filter(child => child.exitCode !== null).length, count => count === 7);
      assert.equal(outputs.join("").match(/monitor ready/g)?.length, 1);
      for (const child of children.filter(child => child.exitCode !== null)) assert.equal(child.exitCode, 0);
      const owner = JSON.parse(readFileSync(join(paths.lock, "owner.json"), "utf8"));
      assert.equal(owner.pid, children.find(child => child.exitCode === null).pid);
      appendFileSync(inbox, JSON.stringify({ messageId: "race-probe" }) + "\n");
      await until(() => outputs.join(""), text => text.includes("1 new inbound"));
      assert.equal(outputs.join("").match(/1 new inbound/g)?.length, 1);
      assert.equal(errors, "");
    } finally {
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
        try { await exited; } finally { clearTimeout(timer); }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("normal shutdown protects a replacement from a delayed old-generation reclaimer", { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "grok-lock-shutdown-"));
  const env = { ...process.env, PI_CODING_AGENT_DIR: dir, GROK_SESSION_ID: "shutdown-test", CLAUDE_INTERCOM_INBOX: "", AGENT_INTERCOM_GROK_LEADER_SOCKET: "" };
  const paths = wakePaths(env.GROK_SESSION_ID, env);
  registerGrokWake({ getIdentity: () => ({ sessionId: "shutdown-owner" }) }, env);
  const inbox = JSON.parse(readFileSync(paths.metadata, "utf8")).inbox;
  const children = [];
  const start = () => {
    const child = spawn(process.execPath, [script, "monitor", env.GROK_SESSION_ID], { env });
    children.push(child);
    let output = "";
    child.stdout.on("data", data => { output += data; });
    return { child, output: () => output };
  };
  try {
    const old = start();
    await until(old.output, text => text.includes("monitor ready"));
    // A paused contender captured this inode before the holder began exit.
    const generation = statSync(paths.lock, { bigint: true });
    const retired = `${paths.lock}.stale-${generation.dev}-${generation.ino}`;
    const exited = once(old.child, "exit");
    old.child.kill("SIGTERM");
    await exited;
    assert.equal(JSON.parse(readFileSync(join(retired, "owner.json"), "utf8")).pid, old.child.pid);
    const replacement = start();
    await until(replacement.output, text => text.includes("monitor ready"));
    // The delayed operation cannot rename the new live directory over the
    // nonempty retired generation, even though its old owner read was missing.
    assert.throws(() => renameSync(paths.lock, retired), error => ["EEXIST", "ENOTEMPTY"].includes(error.code));
    assert.equal(JSON.parse(readFileSync(join(paths.lock, "owner.json"), "utf8")).pid, replacement.child.pid);
    appendFileSync(inbox, JSON.stringify({ messageId: "shutdown-race-probe" }) + "\n");
    await until(replacement.output, text => text.includes("1 new inbound"));
    assert.equal(replacement.output().match(/monitor ready/g)?.length, 1);
  } finally {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
      try { await exited; } finally { clearTimeout(timer); }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
