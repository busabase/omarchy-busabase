// Run: node --test test/*.test.mjs
// Model.js is a QML JavaScript library (`.pragma library`, no exports), so it is
// loaded into a vm context the same way the shell evaluates it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../Model.js", import.meta.url), "utf8").replace(/^\.pragma library\s*$/m, "");
const Model = {};
vm.runInNewContext(source, Model);

// Arrays built inside the vm belong to another realm; compare plain copies.
const plain = (x) => JSON.parse(JSON.stringify(x));
const HOUR = 3600_000;
const now = new Date(2026, 9, 21, 15, 0, 0).getTime(); // local 15:00
const iso = (ms) => new Date(ms).toISOString();

const cr = (over = {}) => ({
  id: "crq1",
  status: "merged",
  submittedBy: "me",
  submittedByUser: { id: "me", name: "Kelly" },
  mergedAt: iso(now - HOUR),
  base: { name: "Competitors" },
  primaryOperation: { operation: "record_create" },
  mergeSummary: { recordIds: ["r1", "r2", "r3"] },
  operationCount: 3,
  sourceAttribution: { displayName: "Claude Code", channel: "cli" },
  ...over,
});

test("parseEnv reads the shared credential file without sourcing it", () => {
  const env = Model.parseEnv(
    '# comment\nBUSABASE_BASE_URL=https://busabase.com\nexport BUSABASE_API_KEY="sk_1"\nBUSABASE_SPACE_ID=\'sp\'\nBROKEN\n=x\nX=$(rm -rf ~)\n',
  );
  assert.equal(env.BUSABASE_BASE_URL, "https://busabase.com");
  assert.equal(env.BUSABASE_API_KEY, "sk_1");
  assert.equal(env.BUSABASE_SPACE_ID, "sp");
  assert.equal(env.X, "$(rm -rf ~)"); // kept as inert text
  assert.equal(Object.keys(env).length, 4);
});

test("connectionKind tells cloud, local and self-hosted apart", () => {
  assert.equal(Model.connectionKind("https://busabase.com/"), "cloud");
  assert.equal(Model.connectionKind("https://acme.busabase.com"), "cloud");
  assert.equal(Model.connectionKind("http://localhost:15419"), "local");
  assert.equal(Model.connectionKind("http://127.0.0.1:3000"), "local");
  assert.equal(Model.connectionKind("http://[::1]:15419"), "local");
  assert.equal(Model.connectionKind("https://busabase.acme.internal"), "selfhosted");
  assert.equal(Model.connectionKind("https://notbusabase.com"), "selfhosted");
  assert.equal(Model.connectionKind(""), "none");
});

test("keptToday counts only my merged writes since local midnight, newest first", () => {
  const list = [
    cr({ id: "a", mergedAt: iso(now - 2 * HOUR) }),
    cr({ id: "b", mergedAt: iso(now - 0.5 * HOUR) }),
    cr({ id: "teammate", submittedBy: "leon" }),
    cr({ id: "open", status: "open" }),
    cr({ id: "yesterday", mergedAt: iso(Model.startOfDay(now) - 1000) }),
  ];
  assert.deepEqual(
    plain(Model.keptToday(list, "me", now).map((x) => x.id)),
    ["b", "a"],
  );
});

test("keptToday on an account-less local server treats every write as mine", () => {
  const list = [cr({ id: "a", submittedBy: "local" }), cr({ id: "b", submittedBy: "other" })];
  assert.equal(Model.keptToday(list, "", now).length, 2);
});

test("freshIds never animates the first poll, then reports only new ids", () => {
  const items = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(plain(Model.freshIds(null, items)), []);
  assert.deepEqual(plain(Model.freshIds(["a"], items)), ["b"]);
  assert.deepEqual(plain(Model.freshIds(["a", "b"], items)), []);
});

test("summaryOf reads like a sentence and prefers the agent's name", () => {
  assert.equal(Model.summaryOf(cr()), "Claude Code added 3 records to Competitors");
  assert.equal(
    Model.summaryOf(cr({ primaryOperation: { operation: "record_update" }, mergeSummary: { recordIds: ["r"] } })),
    "Claude Code updated 1 record in Competitors",
  );
  assert.equal(
    Model.summaryOf(cr({ sourceAttribution: null, primaryOperation: { operation: "node_create" }, base: null, node: { name: "Notes" } })),
    "Kelly created Notes",
  );
});

test("relativeTime and badgeText stay short", () => {
  assert.equal(Model.relativeTime(iso(now - 10_000), now), "just now");
  assert.equal(Model.relativeTime(iso(now - 5 * 60_000), now), "5m ago");
  assert.equal(Model.relativeTime(iso(now - 3 * HOUR), now), "3h ago");
  assert.equal(Model.relativeTime("", now), "");
  assert.equal(Model.badgeText(7), "7");
  assert.equal(Model.badgeText(120), "99+");
});

test("dashboard links point at the space's inbox", () => {
  assert.equal(
    Model.changeRequestUrl("https://busabase.com/", "sp1", "crq9"),
    "https://busabase.com/dashboard/sp1/inbox/crq9",
  );
  assert.equal(Model.dashboardUrl("http://localhost:15419", "", "inbox"), "http://localhost:15419/dashboard/inbox");
  assert.equal(Model.dashboardUrl("", "sp", "inbox"), "");
});

test("status lines name the real problem, local vs cloud", () => {
  assert.equal(Model.statusForExit(5), "unreachable");
  assert.match(Model.statusLine("unreachable", "local"), /isn't running on this computer/);
  assert.match(Model.statusLine("unreachable", "cloud"), /Offline/);
  assert.equal(Model.statusLine("ok", "cloud"), "");
});

test("the agent client beats the key name, and the key shows only when it adds something", () => {
  const withAgent = cr({ sourceAttribution: { displayName: "Kelly Agent", channel: "cli", agent: { id: "codex", name: "Codex" } } });
  assert.equal(Model.summaryOf(withAgent), "Codex added 3 records to Competitors");
  assert.equal(Model.metaOf(withAgent, now), "1h ago · key Kelly Agent");

  const keyIsAgent = cr({ sourceAttribution: { displayName: "Codex", channel: "cli", agent: { id: "codex", name: "Codex" } } });
  assert.equal(Model.metaOf(keyIsAgent, now), "1h ago");

  // Older servers send no agent: fall back to the key name and show the channel.
  const legacy = cr({ sourceAttribution: { displayName: "Kelly Agent", channel: "openapi" } });
  assert.equal(Model.summaryOf(legacy), "Kelly Agent added 3 records to Competitors");
  assert.equal(Model.metaOf(legacy, now), "1h ago · openapi");
});

test("server-provided names are clipped before they reach the shell", () => {
  const long = "x".repeat(5000);
  const row = cr({ base: { name: long }, sourceAttribution: { displayName: long, agent: { id: "a", name: long } } });
  const summary = Model.summaryOf(row);
  assert.ok(summary.length < 160, `summary is ${summary.length} chars`);
  assert.equal(Model.clip("a\n\n  b", 10), "a b");
  assert.equal(Model.clip("abcdefghijk", 5), "abcd…");
  assert.equal(Model.clip(null), "");
});


test("a finished agent session is offered once, and only if it ran long enough", () => {
  const t0 = 1_000_000;
  const live = [
    { pid: 11, agent: "codex", cwd: "/w/app", startedAt: t0 },
    { pid: 12, agent: "claude", cwd: "/w/api", startedAt: t0 + 3000 },
  ];
  let state = Model.endedSessions({}, live, t0 + 3060, 10);
  assert.equal(state.ended.length, 0); // first scan: nothing ended yet

  // Both exit. Codex ran 51 min, Claude only 2 min.
  state = Model.endedSessions(state.tracked, [], t0 + 3060 + 120 - 0, 10);
  assert.deepEqual(plain(state.ended), [{ agent: "codex", cwd: "/w/app", startedAt: t0, minutes: 53, sessionId: "" }]);
  // Forgotten after that, so it is never offered twice.
  assert.equal(Model.endedSessions(state.tracked, [], t0 + 9999, 10).ended.length, 0);
});

test("an exact session id is carried through; a Codex session sharing its directory is not guessed", () => {
  const t0 = 2_000_000;
  const start = [
    { pid: 21, agent: "claude", cwd: "/w/app", startedAt: t0, sessionId: "aaaaaaaa-1111-2222-3333-444444444444" },
    { pid: 22, agent: "claude", cwd: "/w/app", startedAt: t0 },
    { pid: 31, agent: "codex", cwd: "/w/api", startedAt: t0 },
    { pid: 32, agent: "codex", cwd: "/w/api", startedAt: t0 },
  ];
  const later = t0 + 3600;
  let state = Model.endedSessions({}, start, later, 10);
  // Claude 21 and Codex 31 end; their siblings in the same directories keep running.
  state = Model.endedSessions(state.tracked, [start[1], start[3]], later, 10);
  assert.deepEqual(plain(state.ended), [
    { agent: "claude", cwd: "/w/app", startedAt: t0, minutes: 60, sessionId: "aaaaaaaa-1111-2222-3333-444444444444" },
  ]);
  // Codex 32 shared /w/api with 31 all along, so when it ends too it is still
  // not offered: its directory holds two conversations and either could be it.
  state = Model.endedSessions(state.tracked, [start[1]], later, 10);
  assert.deepEqual(plain(state.ended), []);
});

test("two Codex sessions in one directory that end between scans are both declined", () => {
  const t0 = 3_000_000;
  const both = [
    { pid: 41, agent: "codex", cwd: "/w/api", startedAt: t0 },
    { pid: 42, agent: "codex", cwd: "/w/api", startedAt: t0 + 600 },
  ];
  let state = Model.endedSessions({}, both, t0 + 3600, 10);
  state = Model.endedSessions(state.tracked, [], t0 + 3615, 10);
  assert.deepEqual(plain(state.ended), []);
});

test("a Codex session that once shared its directory is declined even after the other left", () => {
  const t0 = 4_000_000;
  const a = { pid: 51, agent: "codex", cwd: "/w/api", startedAt: t0 };
  const b = { pid: 52, agent: "codex", cwd: "/w/api", startedAt: t0 + 60 };
  let state = Model.endedSessions({}, [a, b], t0 + 120, 10);
  state = Model.endedSessions(state.tracked, [a], t0 + 300, 10); // b ends after 4 min: too short to offer
  assert.deepEqual(plain(state.ended), []);
  state = Model.endedSessions(state.tracked, [a], t0 + 3000, 10);
  state = Model.endedSessions(state.tracked, [], t0 + 3600, 10); // a ends alone, but b wrote there too
  assert.deepEqual(plain(state.ended), []);
});

test("sessions in other directories, or of the other agent, do not count as sharing", () => {
  const t0 = 5_000_000;
  const live = [
    { pid: 61, agent: "codex", cwd: "/w/api", startedAt: t0 },
    { pid: 62, agent: "codex", cwd: "/w/web", startedAt: t0 },
    { pid: 63, agent: "claude", cwd: "/w/api", startedAt: t0 },
  ];
  let state = Model.endedSessions({}, live, t0 + 1200, 10);
  state = Model.endedSessions(state.tracked, [live[1], live[2]], t0 + 1800, 10);
  assert.deepEqual(plain(state.ended.map((e) => e.agent + ":" + e.cwd)), ["codex:/w/api"]);
});

test("a setting of 0 minutes stays 0", () => {
  assert.equal(Model.intSetting(0, 10, 0, 240), 0);
  assert.equal(Model.intSetting("0", 10, 0, 240), 0);
  assert.equal(Model.intSetting(undefined, 10, 0, 240), 10);
  assert.equal(Model.intSetting("x", 60, 15, 3600), 60);
  assert.equal(Model.intSetting(5, 60, 15, 3600), 15);
});

test("a folder the change created is named from its commit, not 'your workspace'", () => {
  const folder = cr({
    base: null,
    node: null,
    sourceAttribution: { displayName: "Kelly Agent", channel: "cli" },
    primaryOperation: { operation: "node_create", headCommit: { payload: { kind: "create", name: "Omarchy Launch Week" } } },
  });
  assert.equal(Model.summaryOf(folder), "Kelly Agent created Omarchy Launch Week");
});

