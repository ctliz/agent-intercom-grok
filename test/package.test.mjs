import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const plugin = JSON.parse(await readFile(new URL("../.grok-plugin/plugin.json", import.meta.url), "utf8"));
const mcp = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));

test("package and Grok plugin metadata stay aligned", () => {
  assert.equal(manifest.name, "@ctliz/agent-intercom-grok");
  assert.equal(plugin.version, manifest.version);
  assert.equal(mcp.mcpServers["agent-intercom"].command, "agent-intercom-grok-mcp");
  assert.equal(manifest.dependencies["@ctliz/agent-intercom-claude"], "0.13.0-connect.7");
});

test("packaged launcher exposes all annotated Intercom tools", async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/agent-intercom-grok-mcp.mjs", import.meta.url))], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });
  child.stdin.end('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
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
  const tools = JSON.parse(String(output).trim()).result.tools;
  assert.equal(tools.length, 9);
  for (const tool of tools) {
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof tool.annotations[hint], "boolean");
    }
  }
});
