// Run: node --test test/
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
