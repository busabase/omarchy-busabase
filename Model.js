.pragma library

// Pure helpers for the Busabase widget. No QML, no I/O — everything here is
// exercised by `node test/model.test.mjs`.

var LOCAL_BASE_URL = "http://localhost:15419"

// Names come from the server and are drawn inside the shared shell: keep each
// one short enough that a hostile or broken server can't blow up layout.
var MAX_NAME = 60

function clip(value, max) {
  var text = String(value === undefined || value === null ? "" : value).replace(/\s+/g, " ").trim()
  var limit = max || MAX_NAME
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text
}

// A whole-number setting, clamped. 0 is a real value, not "unset" — a bare
// `parseInt(x) || fallback` would turn a deliberate 0 into the fallback.
function intSetting(value, fallback, min, max) {
  var n = parseInt(String(value), 10)
  if (!isFinite(n)) n = fallback
  return Math.max(min, Math.min(max, n))
}

function parseJson(text, fallback) {
  try {
    var value = JSON.parse(String(text || ""))
    return value === null || value === undefined ? fallback : value
  } catch (e) {
    return fallback
  }
}

// `~/.busabase/.env` is shared with busabase-cli and the skill. It is parsed,
// never sourced: a value is only ever data.
function parseEnv(text) {
  var out = {}
  var lines = String(text || "").split(/\r?\n/)
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim()
    if (line === "" || line.charAt(0) === "#") continue
    if (line.indexOf("export ") === 0) line = line.slice(7).trim()
    var eq = line.indexOf("=")
    if (eq <= 0) continue
    var key = line.slice(0, eq).trim()
    var value = line.slice(eq + 1).trim()
    var quote = value.charAt(0)
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.charAt(value.length - 1) === quote)
      value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

function normalizeBaseUrl(url) {
  var value = String(url || "").trim().replace(/\/+$/, "")
  return value === "" ? "" : value
}

function isLocalUrl(url) {
  var match = /^https?:\/\/(\[[^\]]+\]|[^/:]+)/i.exec(String(url || ""))
  if (!match) return false
  var host = match[1].toLowerCase()
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /^127\./.test(host)
}

// "cloud" | "local" | "selfhosted" | "none"
function connectionKind(baseUrl) {
  var url = normalizeBaseUrl(baseUrl)
  if (url === "") return "none"
  if (isLocalUrl(url)) return "local"
  if (/^https:\/\/([a-z0-9-]+\.)*busabase\.com$/i.test(url)) return "cloud"
  return "selfhosted"
}

function connectionLabel(kind) {
  if (kind === "cloud") return "Busabase Cloud"
  if (kind === "local") return "On this computer"
  if (kind === "selfhosted") return "Self-hosted"
  return "Not connected"
}

// Local midnight, so "today" means the user's day, not UTC's.
function startOfDay(ms) {
  var d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function timeOf(iso) {
  var t = Date.parse(String(iso || ""))
  return isFinite(t) ? t : 0
}

// A change request counts as "kept by me" when it merged and was submitted
// with my credential — that covers my agents, which write as me.
// `myUserId` empty means a no-account local server: everything there is mine.
function isMine(cr, myUserId) {
  if (!cr) return false
  if (!myUserId) return true
  return String(cr.submittedBy || "") === String(myUserId)
}

function keptToday(changeRequests, myUserId, nowMs) {
  var since = startOfDay(nowMs)
  var list = changeRequests || []
  var out = []
  for (var i = 0; i < list.length; i++) {
    var cr = list[i]
    if (!cr || cr.status !== "merged") continue
    if (!isMine(cr, myUserId)) continue
    if (timeOf(cr.mergedAt || cr.updatedAt) < since) continue
    out.push(cr)
  }
  out.sort(function(a, b) { return timeOf(b.mergedAt || b.updatedAt) - timeOf(a.mergedAt || a.updatedAt) })
  return out
}

// Ids present now that were not seen on the previous poll. The very first
// poll has no baseline (`previousIds === null`) and must never animate.
function freshIds(previousIds, items) {
  if (previousIds === null || previousIds === undefined) return []
  var seen = {}
  for (var i = 0; i < previousIds.length; i++) seen[previousIds[i]] = true
  var out = []
  for (var j = 0; j < (items || []).length; j++) {
    var id = items[j] && items[j].id
    if (id && !seen[id]) out.push(id)
  }
  return out
}

function idsOf(items) {
  var out = []
  for (var i = 0; i < (items || []).length; i++) if (items[i] && items[i].id) out.push(items[i].id)
  return out
}

var VERBS = {
  record_create: "added",
  record_update: "updated",
  record_delete: "archived",
  record_restore: "restored",
  field_create: "added a field to",
  field_update: "changed a field in",
  field_delete: "removed a field from",
  view_create: "added a view to",
  view_update: "changed a view in",
  file_create: "added",
  file_update: "edited",
  file_delete: "removed",
  node_create: "created",
  node_update: "updated",
  node_move: "moved",
  node_archive: "archived"
}

function verbFor(operation) {
  var op = String(operation || "")
  if (VERBS[op]) return VERBS[op]
  if (/_create$/.test(op)) return "added"
  if (/_delete$|_archive$/.test(op)) return "removed"
  return "changed"
}

// Who wrote it, in the order a person recognises it: the agent client that
// made the call ("Codex", reported by busabase-cli), then the API key's name
// (people often name keys after agents), then the account.
function agentOf(cr) {
  var attribution = cr && cr.sourceAttribution
  var agent = attribution && attribution.agent
  return agent && agent.name ? clip(agent.name, 40) : ""
}

function keyNameOf(cr) {
  var attribution = cr && cr.sourceAttribution
  return attribution && attribution.displayName ? clip(attribution.displayName, 40) : ""
}

function authorOf(cr) {
  var agent = agentOf(cr)
  if (agent) return agent
  var key = keyNameOf(cr)
  if (key) return key
  var user = cr && cr.submittedByUser
  if (user && user.name) return clip(user.name, 40)
  return "Someone"
}

// Second line of a feed row: when, then the key — but only when it adds
// something the first line didn't already say.
function metaOf(cr, nowMs) {
  var parts = []
  var when = relativeTime(cr && (cr.mergedAt || cr.updatedAt), nowMs)
  if (when) parts.push(when)
  var key = keyNameOf(cr)
  var agent = agentOf(cr)
  if (agent && key && key.toLowerCase() !== agent.toLowerCase()) parts.push("key " + key)
  var channel = cr && cr.sourceAttribution && cr.sourceAttribution.channel
  if (channel && !agent) parts.push(clip(channel, 20))
  return parts.join(" · ")
}

function targetOf(cr) {
  if (cr && cr.base && cr.base.name) return clip(cr.base.name)
  if (cr && cr.node && cr.node.name) return clip(cr.node.name)
  // A node the change itself created (a folder, a doc) is not hydrated on the
  // change request yet; its name is in the operation's own commit.
  var payload = cr && cr.primaryOperation && cr.primaryOperation.headCommit && cr.primaryOperation.headCommit.payload
  if (payload && payload.name) return clip(payload.name)
  return "your workspace"
}

function countOf(cr) {
  var n = cr && cr.mergeSummary && cr.mergeSummary.recordIds ? cr.mergeSummary.recordIds.length : 0
  if (!n) n = cr && cr.operationCount ? Number(cr.operationCount) : 1
  return n > 0 ? n : 1
}

function isRecordOp(operation) {
  return /^record_/.test(String(operation || ""))
}

// One line a person can read at a glance: "Claude Code added 3 records to Competitors".
function summaryOf(cr) {
  var op = cr && cr.primaryOperation ? cr.primaryOperation.operation : ""
  var verb = verbFor(op)
  var n = countOf(cr)
  var target = targetOf(cr)
  if (isRecordOp(op)) {
    var noun = n === 1 ? "record" : "records"
    var prep = verb === "added" ? " to " : " in "
    return authorOf(cr) + " " + verb + " " + n + " " + noun + prep + target
  }
  return authorOf(cr) + " " + verb + " " + target
}

function relativeTime(iso, nowMs) {
  var t = timeOf(iso)
  if (!t) return ""
  var s = Math.max(0, Math.round((nowMs - t) / 1000))
  if (s < 45) return "just now"
  var m = Math.round(s / 60)
  if (m < 60) return m + "m ago"
  var h = Math.round(m / 60)
  if (h < 24) return h + "h ago"
  var d = Math.round(h / 24)
  return d + "d ago"
}

function dashboardUrl(baseUrl, spaceId, path) {
  var base = normalizeBaseUrl(baseUrl)
  if (base === "") return ""
  var tail = String(path || "").replace(/^\/+/, "")
  if (!spaceId) return base + "/dashboard" + (tail ? "/" + tail : "")
  return base + "/dashboard/" + encodeURIComponent(spaceId) + (tail ? "/" + tail : "")
}

function changeRequestUrl(baseUrl, spaceId, crId) {
  return dashboardUrl(baseUrl, spaceId, "inbox/" + encodeURIComponent(String(crId || "")))
}

// The bar badge: "99+" past two digits so the cell width stays bounded.
function badgeText(n) {
  var count = Number(n) || 0
  return count > 99 ? "99+" : String(count)
}

// busabase-fetch exit codes → what the person should see.
function statusForExit(code) {
  if (code === 0) return "ok"
  if (code === 3) return "not-configured"
  if (code === 4) return "auth-rejected"
  if (code === 5) return "unreachable"
  return "error"
}

function statusLine(status, kind) {
  if (status === "not-configured") return "Not connected yet"
  if (status === "auth-rejected") return "Sign-in expired — sign in again"
  if (status === "unreachable")
    return kind === "local" ? "Busabase isn't running on this computer" : "Offline — can't reach Busabase"
  if (status === "error") return "Something went wrong — press r to retry"
  return ""
}

function sameAgentStillIn(live, agent, cwd) {
  for (var i = 0; i < live.length; i++)
    if (live[i] && live[i].agent === agent && live[i].cwd === cwd) return true
  return false
}

// Session watching. `tracked` maps pid → {agent, cwd, startedAt} from the
// previous scan; `live` is this scan. A session ends when its pid disappears;
// only sessions that ran at least `minMinutes` are worth an offer (a quick
// question to an agent is not work to keep).
function endedSessions(tracked, live, nowSec, minMinutes) {
  var next = {}
  var stillHere = {}
  var list = live || []
  for (var i = 0; i < list.length; i++) {
    var s = list[i]
    if (!s || !s.pid) continue
    stillHere[s.pid] = true
    next[s.pid] = { agent: String(s.agent), cwd: String(s.cwd), startedAt: Number(s.startedAt) || 0,
                    sessionId: s.sessionId ? String(s.sessionId) : "" }
  }
  var ended = []
  var min = Math.max(0, Number(minMinutes) || 0)
  for (var pid in (tracked || {})) {
    if (stillHere[pid]) continue
    var t = tracked[pid]
    var minutes = Math.floor((nowSec - t.startedAt) / 60)
    if (!(t.startedAt > 0 && minutes >= min)) continue
    // Without an exact session id (Codex), the session is found by directory
    // afterwards — ambiguous while another session of that agent still runs
    // there, so skip rather than risk keeping the wrong conversation.
    if (!t.sessionId && sameAgentStillIn(list, t.agent, t.cwd)) continue
    ended.push({ agent: t.agent, cwd: t.cwd, startedAt: t.startedAt, minutes: minutes, sessionId: t.sessionId || "" })
  }
  return { tracked: next, ended: ended }
}
