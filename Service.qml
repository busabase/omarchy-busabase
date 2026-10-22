import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "Model.js" as Model

// Headless state for the widget: who am I, what did I (and my agents) keep
// today, is anything of mine waiting for review, are the skills linked.
// Every network call goes through bin/busabase-fetch; nothing here holds the key.
Item {
  id: root

  property var settings: ({})

  // Emitted with the change requests that merged since the previous poll.
  // Never emitted for the first poll after start, so a restart doesn't
  // replay the whole day as "+1"s.
  signal kept(var items)

  readonly property string pluginDir: decodeURIComponent(Qt.resolvedUrl(".").toString().replace(/^file:\/\//, "")).replace(/\/$/, "")
  readonly property string fetchPath: pluginDir + "/bin/busabase-fetch"
  readonly property string skillsPath: pluginDir + "/bin/busabase-skills"

  // ---------------------------------------------------------------- settings

  function setting(name, fallback) {
    var value = settings ? settings[name] : undefined
    return value === undefined || value === null ? fallback : value
  }
  readonly property int refreshIntervalSec: Math.max(15, Math.min(3600, parseInt(setting("refreshIntervalSec", 60), 10) || 60))

  // ---------------------------------------------------------------- state

  property string status: "loading"     // loading | ok | not-configured | auth-rejected | unreachable | error
  property string baseUrl: ""
  property string spaceId: ""
  property string spaceName: ""
  property string userId: ""
  property string userName: ""
  readonly property string kind: Model.connectionKind(baseUrl)
  readonly property bool connected: status === "ok"
  property bool localServerAvailable: false

  property var keptItems: []            // today's, newest first
  property var pendingItems: []         // mine, not merged yet, recent
  property int inboxCount: 0            // whole-space review tab
  readonly property int keptCount: keptItems.length
  readonly property int pendingCount: pendingItems.length
  property var _previousIds: null
  property double nowMs: Date.now()

  // Servers before the `mine` query fix reject `mine=true`; remember that and
  // page through the space instead (bounded), filtering on submittedBy here.
  property bool serverFiltersMine: true
  property bool refreshing: false
  property string lastError: ""

  property var skills: ({ skills: [], targets: [] })
  readonly property string skillsState: {
    var t = skills.targets || []
    if (t.length === 0) return "unknown"
    var ours = 0, yours = 0, absent = 0
    for (var i = 0; i < t.length; i++) {
      for (var name in t[i].skills) {
        var s = t[i].skills[name]
        if (s === "ours") ours++
        else if (s === "yours") yours++
        else absent++
      }
    }
    if (absent === 0 && ours === 0 && yours > 0) return "yours"
    if (absent === 0) return "linked"
    if (ours === 0 && yours === 0) return "off"
    return "partial"
  }
  readonly property var skillsAgents: {
    var t = skills.targets || []
    var out = []
    for (var i = 0; i < t.length; i++) if (t[i].agent !== "Any agent") out.push(t[i].agent)
    return out
  }

  // ---------------------------------------------------------------- processes

  component Fetch: Process {
    id: proc
    property var callback: null
    running: false
    command: []
    stdout: StdioCollector { waitForEnd: true }
    stderr: StdioCollector { waitForEnd: true }
    function call(args, cb) {
      callback = cb
      command = [root.fetchPath].concat(args)
      running = true
    }
    onExited: function(exitCode) {
      var cb = callback
      callback = null
      if (cb) cb(exitCode, stdout.text, stderr.text)
    }
  }

  Fetch { id: connectionProc }
  Fetch { id: authProc }
  Fetch { id: listProc }
  Fetch { id: pendingProc }
  Fetch { id: countsProc }
  Fetch { id: probeProc }

  Process {
    id: skillsProc
    property var callback: null
    running: false
    command: []
    stdout: StdioCollector { waitForEnd: true }
    onExited: function(exitCode) {
      var cb = callback
      callback = null
      if (cb) cb(exitCode, stdout.text)
    }
  }

  // ---------------------------------------------------------------- refresh

  function fail(exitCode, stderrText) {
    status = Model.statusForExit(exitCode)
    lastError = String(stderrText || "").trim()
    refreshing = false
    if (status === "not-configured" || status === "unreachable") probeLocal()
  }

  function refresh() {
    if (refreshing) return
    refreshing = true
    nowMs = Date.now()
    connectionProc.call(["connection"], function(code, out) {
      var c = Model.parseJson(out, {})
      if (Model.normalizeBaseUrl(c.baseUrl) !== root.baseUrl) {
        // Switched account or server: forget who we were and the "+1" baseline.
        root.userId = ""
        root._previousIds = null
        root.serverFiltersMine = true
      }
      root.baseUrl = Model.normalizeBaseUrl(c.baseUrl)
      if (root.baseUrl === "") { root.fail(3, ""); return }
      root.loadIdentity()
    })
  }

  function loadIdentity() {
    authProc.call(["GET", "/auth"], function(code, out, err) {
      if (code !== 0) { root.fail(code, err); return }
      var a = Model.parseJson(out, {})
      // A local open-source server is single-user, and its API writes are
      // attributed to a different local identity than /auth reports, so
      // "mine" would match nothing there: count the whole space instead.
      root.userId = root.kind !== "local" && a.user && a.user.id ? String(a.user.id) : ""
      root.userName = a.user && a.user.name ? String(a.user.name) : ""
      root.spaceId = a.space && a.space.id ? String(a.space.id) : ""
      root.spaceName = a.space && a.space.name ? String(a.space.name) : ""
      root.status = "ok"
      root.lastError = ""
      loadKept()
      loadPending()
      loadCounts()
    })
  }

  function listPath(statuses, cursor) {
    var q = []
    for (var i = 0; i < statuses.length; i++) q.push("status[]=" + statuses[i])
    q.push("limit=100")
    if (root.serverFiltersMine && root.userId !== "") q.push("mine=true")
    if (cursor) q.push("cursor=" + encodeURIComponent(cursor))
    return "/change-requests?" + q.join("&")
  }

  function isMineRejected(code, err) {
    return code === 1 && /"mine"/.test(String(err || "")) && /boolean/.test(String(err || ""))
  }

  function loadKept() {
    var since = Model.startOfDay(Date.now())
    var acc = []
    var pages = 0
    var step = function(cursor) {
      listProc.call(["GET", root.listPath(["merged"], cursor)], function(code, out, err) {
        if (root.isMineRejected(code, err)) {
          root.serverFiltersMine = false
          acc = []
          pages = 0
          step("")
          return
        }
        if (code !== 0) { root.fail(code, err); return }
        var page = Model.parseJson(out, {})
        var list = page.changeRequests || []
        for (var i = 0; i < list.length; i++) acc.push(list[i])
        pages++
        var last = list.length > 0 ? list[list.length - 1] : null
        var olderThanToday = last && Model.timeOf(last.mergedAt || last.updatedAt) < since
        if (page.nextCursor && !olderThanToday && pages < 5) { step(page.nextCursor); return }
        root.applyKept(Model.keptToday(acc, root.userId, Date.now()))
      })
    }
    step("")
  }

  function applyKept(items) {
    var fresh = Model.freshIds(_previousIds, items)
    keptItems = items
    _previousIds = Model.idsOf(items)
    refreshing = false
    if (fresh.length > 0) {
      var freshItems = []
      for (var i = 0; i < items.length; i++) if (fresh.indexOf(items[i].id) !== -1) freshItems.push(items[i])
      kept(freshItems)
    }
  }

  function loadPending() {
    pendingProc.call(["GET", root.listPath(["in_review", "changes_requested", "approved"], "")], function(code, out) {
      if (code !== 0) return
      var list = Model.parseJson(out, {}).changeRequests || []
      var weekAgo = Date.now() - 7 * 24 * 3600 * 1000
      var mine = []
      for (var i = 0; i < list.length; i++) {
        var cr = list[i]
        if (!Model.isMine(cr, root.userId)) continue
        if (Model.timeOf(cr.createdAt) < weekAgo) continue
        mine.push(cr)
      }
      root.pendingItems = mine
    })
  }

  function loadCounts() {
    countsProc.call(["GET", "/change-requests/counts"], function(code, out) {
      if (code !== 0) return
      var c = Model.parseJson(out, {})
      root.inboxCount = Number(c.review) || 0
    })
  }

  function probeLocal() {
    probeProc.call(["probe", Model.LOCAL_BASE_URL], function(code, out) {
      var p = Model.parseJson(out, {})
      root.localServerAvailable = code === 0 && p.reachable === true
    })
  }

  // ---------------------------------------------------------------- actions

  function openUrl(url) {
    if (url) Qt.openUrlExternally(url)
  }

  function openDashboard() { openUrl(Model.dashboardUrl(baseUrl, spaceId, "")) }
  function openInbox() { openUrl(Model.dashboardUrl(baseUrl, spaceId, "inbox")) }
  function openChange(cr) { if (cr) openUrl(Model.changeRequestUrl(baseUrl, spaceId, cr.id)) }

  // Sign-in is busabase-cli's job: one flow for the CLI, the skill and this
  // widget. Device sign-in prints a short code and opens the browser.
  readonly property string signinPath: pluginDir + "/bin/busabase-signin"

  function signIn() {
    Util.execDetached("omarchy-launch-floating-terminal-with-presentation " + Util.shellQuote(Util.shellQuote(signinPath)))
  }

  // An account-less local server needs no sign-in, only its address.
  function useLocalServer() {
    // umask first, so a freshly created ~/.busabase is 0700 and .env 0600.
    Util.execDetached("umask 077 && mkdir -p \"$HOME/.busabase\" && "
      + "f=\"$HOME/.busabase/.env\"; touch \"$f\"; "
      + "grep -v '^BUSABASE_BASE_URL=' \"$f\" > \"$f.tmp\" || true; "
      + "printf 'BUSABASE_BASE_URL=%s\\n' " + Util.shellQuote(Model.LOCAL_BASE_URL) + " >> \"$f.tmp\"; "
      + "mv \"$f.tmp\" \"$f\"")
    retrySoon.restart()
  }

  function loadSkills() {
    skillsProc.callback = function(code, out) { if (code === 0) root.skills = Model.parseJson(out, root.skills) }
    skillsProc.command = [root.skillsPath, "status"]
    skillsProc.running = true
  }

  function setSkillsLinked(on) {
    skillsProc.callback = function() { root.loadSkills() }
    skillsProc.command = [root.skillsPath, on ? "link" : "unlink"]
    skillsProc.running = true
  }

  // ---------------------------------------------------------------- timers

  Timer {
    id: retrySoon
    interval: 1200
    onTriggered: root.refresh()
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: root.status !== "auth-rejected"
    repeat: true
    onTriggered: root.refresh()
  }

  // Not signed in yet: watch for busabase-cli writing the credential file.
  FileView {
    path: Quickshell.env("HOME") + "/.busabase/.env"
    watchChanges: true
    printErrors: false
    onFileChanged: retrySoon.restart()
  }

  // Midnight: the day's count starts over without waiting for a poll.
  Timer {
    interval: 60000
    running: true
    repeat: true
    onTriggered: {
      var before = Model.startOfDay(root.nowMs)
      root.nowMs = Date.now()
      if (Model.startOfDay(root.nowMs) !== before) {
        root._previousIds = null
        root.refresh()
      }
    }
  }

  Component.onCompleted: {
    loadSkills()
    refresh()
  }
}
