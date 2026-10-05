import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const plugin = JSON.parse(await readFile(new URL("../.grok-plugin/plugin.json", import.meta.url), "utf8"));
const mcp = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));

test("package and Grok plugin metadata stay aligned", () => {
  assert.equal(manifest.name, "@ctliz/agent-intercom-grok");
  assert.equal(plugin.version, manifest.version);
  assert.equal(mcp.mcpServers["agent-intercom"].command, "agent-intercom-grok-mcp");
  assert.equal(manifest.bin["agent-intercom-grok-wake"], "bin/agent-intercom-grok-wake.mjs");
  assert.ok(manifest.files.includes("hooks/**/*"));
  assert.equal(manifest.dependencies["@ctliz/agent-intercom-claude"], "0.15.1");
  assert.deepEqual(mcp.mcpServers["agent-intercom"].env, { CLAUDE_INTERCOM_MODEL: "grok-build" });
});

test("package ships a Grok-specific shortest-path skill", async () => {
  assert.ok(manifest.files.includes("skills/**/*"));
  const skill = await readFile(new URL("../skills/grok-intercom/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /name: grok-intercom/);
  assert.match(skill, /Use this plugin's `agent-intercom` MCP server/);
  assert.match(skill, /For a known recipient, call `intercom_send` directly/);
  assert.match(skill, /as routine preflight checks/);
  assert.match(skill, /natural work boundaries when expecting a response or handling inbound messages/);
  assert.match(skill, /ask once for approval before creating a team or adding peers/);
  assert.match(skill, /Inherit the original message's team/);
  const example = JSON.parse(skill.match(/```json\n([^`]+)\n```/)[1]);
  assert.deepEqual(Object.keys(example).sort(), ["message", "to"]);
  assert.ok(example.to && example.message);
});

test("plugin ships native receive hooks and a same-session, read-once skill", async () => {
  const hooks = JSON.parse(await readFile(new URL("../hooks/hooks.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ["PostToolUse", "Stop"]);
  for (const groups of Object.values(hooks.hooks)) {
    assert.match(groups[0].hooks[0].command, /GROK_PLUGIN_ROOT.*agent-intercom-grok-wake\.mjs/);
    assert.equal(groups[0].hooks[0].timeout, 5);
  }
  const skill = await readFile(new URL("../skills/grok-intercom/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /persistent: true/);
  assert.match(skill, /intercom_pending\(\{mark_read:true\}\)/);
  assert.match(skill, /untouched idle session/);
  assert.match(skill, /denied, disabled, or unsupported/);
  assert.match(skill, /AGENT_INTERCOM_GROK_LEADER_SOCKET/);
  const launcher = await readFile(new URL("../bin/agent-intercom-grok-mcp.mjs", import.meta.url), "utf8");
  assert.match(launcher, /runGrokLeaderWake\(runtime, process\.env, wake\.signal\)/);
});

test("packaged launcher exposes all annotated Intercom tools", async t => {
  const agentDir = await mkdtemp(join(tmpdir(), "grok-mcp-tools-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await mkdir(join(agentDir, "intercom"));
  await writeFile(join(agentDir, "intercom/config.json"), JSON.stringify({ enabled: false }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/agent-intercom-grok-mcp.mjs", import.meta.url))], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, GROK_SESSION_ID: "", AGENT_INTERCOM_SCOPE_ID: "", AGENT_INTERCOM_GROK_LEADER_SOCKET: "" },
  });
  child.stdin.end('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n{"jsonrpc":"2.0","id":2,"method":"initialize"}\n');
  const output = await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("MCP launcher timed out"));
    }, 10000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(stdout) : reject(new Error(stderr || `launcher exited ${code}`));
    });
  });
  const responses = String(output).trim().split("\n").map(line => JSON.parse(line));
  const tools = responses.find(response => response.id === 1).result.tools;
  const instructions = responses.find(response => response.id === 2).result.instructions;
  assert.match(instructions, /Wait for approval/);
  assert.match(instructions, /For a known recipient, call intercom_send directly/);
  assert.match(instructions, /as routine preflight checks/);
  assert.match(instructions, /natural work boundaries when expecting a response or handling inbound messages/);
  const properties = name => tools.find(tool => tool.name === name).inputSchema.properties;
  assert.ok(properties("intercom_join").members);
  assert.ok(properties("intercom_join").work);
  for (const name of ["intercom_team", "intercom_send", "intercom_ask", "intercom_reply"]) assert.ok(properties(name).team);
  assert.ok(properties("intercom_reply").askId);
  assert.ok(properties("intercom_reply").contextId);
  assert.equal(tools.length, 10);
  assert.ok(tools.some(tool => tool.name === "intercom_join"));
  for (const tool of tools) {
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof tool.annotations[hint], "boolean");
    }
  }
});
