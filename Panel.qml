import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Model.js" as Model

// The Busabase panel: what you and your agents kept today, anything of yours
// waiting for review, and the switch that teaches your agents Busabase.
// Every row is one list so the keyboard walks it top to bottom.
Panel {
  id: root
  moduleName: "busabase"
  ipcTarget: "busabase"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root

  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property color urgent: bar ? bar.urgent : Commons.Color.urgent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property int maxItems: 8
  property int cursor: -1

  function openFromHotkey() {
    cursor = 0
    root.open()
    if (service) service.refresh()
  }

  // ---------------------------------------------------------------- rows

  readonly property var rows: {
    var s = service
    var out = []
    if (!s) return out
    if (!s.connected) {
      if (s.status === "not-configured" || s.status === "auth-rejected" || s.status === "loading")
        out.push({ key: "signin", icon: "", title: "Sign in to Busabase",
                   meta: "Opens busabase-cli login — approve it in your browser", act: "signin" })
      if (s.localServerAvailable && s.kind !== "local")
        out.push({ key: "local", icon: "", title: "Use Busabase on this computer",
                   meta: "Found a server at localhost:15419 — no account needed", act: "local" })
      if (s.status === "unreachable" && s.kind === "local")
        out.push({ key: "start", icon: "", title: "Start Busabase",
                   meta: "Run `busabase server`, then press r", act: "retry" })
      if (s.status === "unreachable" || s.status === "error")
        out.push({ key: "retry", icon: "", title: "Try again", meta: "", act: "retry" })
    } else {
      if (s.pendingCount > 0)
        out.push({ key: "pending", icon: "",
                   title: s.pendingCount + (s.pendingCount === 1 ? " change" : " changes") + " of yours waiting for review",
                   meta: "Queued because the key or Base asks for review", act: "inbox" })
      var items = s.keptItems
      for (var i = 0; i < Math.min(items.length, root.maxItems); i++) {
        var cr = items[i]
        out.push({ key: "cr:" + cr.id, icon: "", title: Model.summaryOf(cr),
                   meta: Model.metaOf(cr, s.nowMs), act: "change", cr: cr })
      }
      out.push({ key: "all", icon: "",
                 title: items.length > root.maxItems ? "See all " + items.length + " in Busabase" : "Open Busabase",
                 meta: s.inboxCount > 0 ? s.inboxCount + " in the space's review inbox" : "", act: "dashboard" })
    }
    out.push({ key: "skills", icon: "", title: "Teach my agents Busabase", meta: root.skillsMeta, act: "skills" })
    if (s.connected) {
      out.push({ key: "capture", icon: "\uf0c5", title: "Keep what I selected",
                 meta: "Your agent files it in Busabase · bind Super+Alt+B, see README", act: "capture" })
      out.push({ key: "sessions", icon: "\uf017", title: "Offer to keep finished sessions",
                 meta: s.keepSessions ? "On · asks after Claude Code or Codex sessions of " + s.keepSessionsMinMinutes + "+ min"
                                      : "Off · when an agent session ends, one click saves what it found", act: "sessions" })
    }
    return out
  }

  readonly property string skillsMeta: {
    if (!service) return ""
    var agents = service.skillsAgents.length > 0 ? service.skillsAgents.join(", ") : "your agents"
    if (service.skillsState === "linked") return "On for " + agents + " — restart an open agent to pick it up"
    if (service.skillsState === "yours") return "You installed the skill yourself — left as is"
    if (service.skillsState === "partial") return "On for some agents — switch on to finish"
    return "Adds the Busabase skill to " + agents
  }

  readonly property bool skillsOn: service ? (service.skillsState === "linked" || service.skillsState === "partial") : false

  function activate(row) {
    if (!row || !service) return
    if (row.act === "signin") service.signIn()
    else if (row.act === "local") service.useLocalServer()
    else if (row.act === "retry") service.refresh()
    else if (row.act === "inbox") service.openInbox()
    else if (row.act === "change") service.openChange(row.cr)
    else if (row.act === "dashboard") service.openDashboard()
    else if (row.act === "capture") service.capture()
    else if (row.act === "sessions") {
      service.setSetting("keepSessions", !service.keepSessions)
      return
    }
    else if (row.act === "skills") {
      if (service.skillsState !== "yours") service.setSkillsLinked(!root.skillsOn)
      return
    }
    if (row.act !== "retry") root.close()
  }

  function moveCursor(dy) {
    if (rows.length === 0) return
    if (cursor < 0) { cursor = 0; return }
    cursor = Math.max(0, Math.min(rows.length - 1, cursor + dy))
  }

  onRowsChanged: if (cursor >= rows.length) cursor = rows.length - 1

  // ---------------------------------------------------------------- ipc

  // Plain Quickshell IpcHandler: works on every Omarchy 4.x (ShellIpc is newer).
  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.openFromHotkey() }
    function close(): void { root.close() }
    function show(): void { root.openFromHotkey() }
    function hide(): void { root.close() }
    function toggle(): void { if (root.opened) root.close(); else root.openFromHotkey() }
    function refresh(): string { if (root.service) root.service.refresh(); return "ok" }
    // Bind a key to this: omarchy-shell busabase capture
    function capture(): string { if (root.service) root.service.capture(); return "ok" }
    // One line for scripts and remote debugging; never includes the key.
    function status(): string {
      var s = root.service
      if (!s) return "no-service"
      return JSON.stringify({ status: s.status, kind: s.kind, space: s.spaceName, kept: s.keptCount,
                              pending: s.pendingCount, inbox: s.inboxCount, skills: s.skillsState,
                              serverFiltersMine: s.serverFiltersMine, error: s.lastError,
                              keepSessions: s.keepSessions, trackedSessions: Object.keys(s._trackedSessions).length,
                              sessionsScans: s.sessionsScans })
    }
  }

  // ---------------------------------------------------------------- ui

  readonly property string heroMeta: {
    var s = service
    if (!s) return ""
    if (!s.connected) return Model.statusLine(s.status, s.kind) || "Connecting…"
    var count = s.keptCount === 0 ? "Nothing kept yet today" : s.keptCount + " kept today"
    return count + " · " + (s.spaceName || Model.connectionLabel(s.kind))
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(560))

    // Children, not the newer lazy `content:` slot, so 4.0.x shells load it too.
    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { root.moveCursor(dy) }
      onActivateRequested: root.activate(root.rows[root.cursor])
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "j") root.moveCursor(1)
        else if (t === "k") root.moveCursor(-1)
        else if ((t === "r" || t === "R") && root.service) root.service.refresh()
        else if ((t === "o" || t === "O") && root.service) { root.service.openDashboard(); root.close() }
      }

      Flickable {
        id: flick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: flick.width
          spacing: Style.space(10)

          PanelHero {
            width: parent.width
            title: "Busabase"
            meta: root.heroMeta
            foreground: root.foreground
            fontFamily: root.fontFamily
            iconOpacity: root.service && root.service.connected ? 1.0 : 0.5
            iconComponent: Component {
              BusabaseIcon {
                iconSize: Math.round(Style.font.display * 0.8)
                tint: root.foreground
              }
            }
          }

          Text {
            textFormat: Text.PlainText
            visible: !!root.service && !root.service.connected && root.service.lastError !== ""
            width: parent.width
            text: root.service ? root.service.lastError : ""
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.WordWrap
            maximumLineCount: 3
            elide: Text.ElideRight
          }

          Text {
            textFormat: Text.PlainText
            visible: !!root.service && root.service.connected && root.service.keptCount === 0
            width: parent.width
            text: "When your agents save something to Busabase, it shows up here."
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Column {
            id: rowColumn
            width: parent.width
            spacing: Style.space(4)

            Repeater {
              model: root.rows
              ActionRow {
                required property var modelData
                required property int index
                width: rowColumn.width
                row: modelData
                rowIndex: index
              }
            }
          }
        }
      }
    }
  }

  component ActionRow: CursorSurface {
    id: rowItem
    property var row: null
    property int rowIndex: 0
    readonly property bool isSkills: row && row.key === "skills"
    readonly property bool isSessions: row && row.key === "sessions"

    hasCursor: root.cursor === rowIndex
    foreground: root.foreground
    implicitHeight: rowLayout.implicitHeight + Style.spacing.rowPaddingX

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: root.cursor = rowItem.rowIndex
      onClicked: root.activate(rowItem.row)
    }

    RowLayout {
      id: rowLayout
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      spacing: Style.space(8)

      Text {
        textFormat: Text.PlainText
        text: rowItem.row ? rowItem.row.icon : ""
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.icon
        Layout.alignment: Qt.AlignVCenter
        Layout.preferredWidth: Style.space(18)
        horizontalAlignment: Text.AlignHCenter
      }

      ColumnLayout {
        Layout.fillWidth: true
        spacing: Style.space(1)

        Text {
          textFormat: Text.PlainText
          Layout.fillWidth: true
          text: rowItem.row ? rowItem.row.title : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          elide: Text.ElideRight
        }

        Text {
          textFormat: Text.PlainText
          Layout.fillWidth: true
          visible: text !== ""
          text: rowItem.row ? rowItem.row.meta : ""
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          // Two lines before eliding: these hints are the instructions.
          wrapMode: Text.WordWrap
          maximumLineCount: 2
          elide: Text.ElideRight
        }
      }

      ToggleSwitch {
        visible: rowItem.isSessions
        checked: !!root.service && root.service.keepSessions
        foreground: root.foreground
        Layout.alignment: Qt.AlignVCenter
        onToggled: root.activate(rowItem.row)
      }

      ToggleSwitch {
        visible: rowItem.isSkills
        checked: root.skillsOn
        interactive: !!root.service && root.service.skillsState !== "yours"
        foreground: root.foreground
        Layout.alignment: Qt.AlignVCenter
        onToggled: root.activate(rowItem.row)
      }
    }
  }
}
