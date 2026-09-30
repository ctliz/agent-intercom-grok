import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export function grokSessionId(env = process.env) {
  const id = env.GROK_SESSION_ID?.trim();
  if (id && !/^[A-Za-z0-9_-]{1,120}$/.test(id)) {
    throw new Error("Invalid GROK_SESSION_ID");
  }
  return id || undefined;
}

// Grok supplies the exact session ID to stdio MCP children. Never select the
// newest session in a directory: multiple panes can share the same workspace.
export function readGrokSession(env = process.env, cwd = process.cwd()) {
  const id = grokSessionId(env);
  if (!id) return undefined;
  const sessions = join(env.GROK_HOME || join(homedir(), ".grok"), "sessions");
  function* paths() {
    yield join(sessions, encodeURIComponent(cwd), id, "summary.json");
    try {
      for (const entry of readdirSync(sessions, { withFileTypes: true })) {
        if (entry.isDirectory()) yield join(sessions, entry.name, id, "summary.json");
      }
    } catch { /* A new session may not have persisted its summary yet. */ }
  }
  let found;
  const preferred = join(sessions, encodeURIComponent(cwd), id, "summary.json");
  for (const path of paths()) {
    try {
      if (statSync(path).size > 64 * 1024) continue;
      const summary = JSON.parse(readFileSync(path, "utf8"));
      if (summary.info?.id !== id) continue;
      const title = typeof summary.generated_title === "string" && summary.generated_title.trim()
        ? summary.generated_title.trim()
        : typeof summary.session_summary === "string" ? summary.session_summary.trim() : "";
      if (path === preferred) return { id, title };
      // A copied session can exist in multiple workspaces. Without an exact
      // cwd match, ambiguity must not rename the peer from another copy.
      if (found) return { id, title: "" };
      found = { id, title };
    } catch { /* Missing files and racing/partial writes are not title updates. */ }
  }
  return found || { id, title: "" };
}

export function prepareGrokIdentity(env = process.env, cwd = process.cwd()) {
  env.CLAUDE_INTERCOM_MODEL ??= "grok-build";
  const session = readGrokSession(env, cwd);
  if (![env.CLAUDE_INTERCOM_SESSION_ID, env.CLAUDE_PEER_ID, env.AGENT_INTERCOM_SESSION_ID].some(value => value?.trim())) {
    env.AGENT_INTERCOM_SESSION_ID = `grok-${session?.id || process.pid}`;
  }
  if (!env.AGENT_INTERCOM_SESSION_NAME?.trim()) {
    env.AGENT_INTERCOM_SESSION_NAME = `grok-${basename(cwd)}-${session?.id.slice(0, 8) || process.pid}`;
  }
  if (session?.title) env.CLAUDE_INTERCOM_NAME = session.title;
}

export async function syncGrokTitle(runtime, env = process.env, cwd = process.cwd()) {
  const title = readGrokSession(env, cwd)?.title;
  if (title && title !== runtime.getIdentity().name) {
    await runtime.syncSession({ ...runtime.getIdentity(), name: title });
  }
}
