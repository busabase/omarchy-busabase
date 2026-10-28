// Run: node --test test/*.test.mjs
// `busabase-sessions resolve` against a throwaway HOME full of session files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const script = new URL("../bin/busabase-sessions", import.meta.url).pathname;
const homes = [];
after(() => homes.forEach((h) => rmSync(h, { recursive: true, force: true })));

const T0 = 1_800_000_000; // the session under test started here
const id = (n) => `01a18030-308d-76d0-bbe7-${String(n).padStart(12, "0")}`;

function home() {
  const h = mkdtempSync(join(tmpdir(), "busabase-sessions-"));
  homes.push(h);
  return h;
}

// One Codex rollout file whose first line is the session metadata, last written at `mtime`.
function codex(h, n, { cwd = "/w/api", source = "vscode", originator = "codex-tui", parent, mtime = T0 + 600 } = {}) {
  const dir = join(h, ".codex/sessions/2027/01/15");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `rollout-2027-01-15T10-00-00-${id(n)}.jsonl`);
  const payload = { id: id(n), session_id: id(n), cwd, originator, source, ...(parent ? { parent_thread_id: parent } : {}) };
  writeFileSync(file, `${JSON.stringify({ type: "session_meta", payload })}\n{"type":"event"}\n`);
  utimesSync(file, mtime, mtime);
}

function claude(h, n, { cwd = "/w/api", mtime = T0 + 600 } = {}) {
  const dir = join(h, ".claude/projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id(n)}.jsonl`);
  writeFileSync(file, "{}\n");
  utimesSync(file, mtime, mtime);
}

function resolve(h, agent, cwd = "/w/api") {
  const r = spawnSync("bash", [script, "resolve", agent, cwd, String(T0)], {
    env: { ...process.env, HOME: h },
    encoding: "utf8",
  });
  return { ok: r.status === 0, id: r.stdout.trim() };
}

test("the one Codex conversation in the directory is found", () => {
  const h = home();
  codex(h, 1);
  codex(h, 2, { cwd: "/w/web" }); // another directory
  codex(h, 3, { mtime: T0 - 60 }); // last written before this session started
  assert.deepEqual(resolve(h, "codex"), { ok: true, id: id(1) });
});

test("two Codex conversations in the directory are declined, not resolved to the newest", () => {
  const h = home();
  codex(h, 1, { mtime: T0 + 600 });
  codex(h, 2, { mtime: T0 + 900 });
  assert.deepEqual(resolve(h, "codex"), { ok: false, id: "" });
});

test("subagent threads and headless exec runs in the directory are not the conversation", () => {
  const h = home();
  codex(h, 1, { mtime: T0 + 600 });
  codex(h, 2, { source: { subagent: { thread_spawn: { parent_thread_id: id(1) } } }, parent: id(1), mtime: T0 + 900 });
  codex(h, 3, { source: { subagent: { other: "guardian" } }, mtime: T0 + 950 }); // guardian is codex-tui too
  codex(h, 4, { source: "exec", originator: "codex_exec", mtime: T0 + 990 });
  assert.deepEqual(resolve(h, "codex"), { ok: true, id: id(1) });
});

test("a conversation an editor or agent manager drives through app-server is not a terminal session", () => {
  const h = home();
  codex(h, 1, { mtime: T0 + 600 });
  codex(h, 2, { originator: "codex_cli_rs", source: "vscode", mtime: T0 + 900 });
  assert.deepEqual(resolve(h, "codex"), { ok: true, id: id(1) });
  // Source "cli" alone also marks a terminal session.
  const old = home();
  codex(old, 3, { originator: "codex_cli_rs", source: "cli" });
  assert.deepEqual(resolve(old, "codex"), { ok: true, id: id(3) });
});

test("no Codex conversation means no offer", () => {
  const h = home();
  codex(h, 1, { source: "exec", originator: "codex_exec" });
  assert.deepEqual(resolve(h, "codex"), { ok: false, id: "" });
});

test("Claude Code without a recorded id: one transcript is found, two are declined", () => {
  const h = home();
  claude(h, 1);
  claude(h, 2, { mtime: T0 - 60 });
  assert.deepEqual(resolve(h, "claude"), { ok: true, id: id(1) });
  claude(h, 3, { mtime: T0 + 900 });
  assert.deepEqual(resolve(h, "claude"), { ok: false, id: "" });
});
