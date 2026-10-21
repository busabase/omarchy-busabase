import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar face of Busabase: the mark, today's "kept" count, and — only when
// something of yours is queued for review — a small accent dot. When your
// agents keep something, the count flashes "+1" and settles. No toast:
// work your agents do on their own should be visible, not interrupting.
BarWidget {
  id: root
  moduleName: "busabase"

  Service {
    id: service
    settings: root.settings
    onKept: function(items) { root.celebrate(items.length) }
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
    if ("service" in target) target.service = service
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  // Shape contract for shell.summon/hide/toggle routing.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  function open() { if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey() }
  function close() { if (panelLoader.item && panelLoader.item.close) panelLoader.item.close() }
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  function closeForPopoutSwitch() { if (panelLoader.item) panelLoader.item.closeForPopoutSwitch() }

  readonly property bool showCount: setting("showCount", true) === true
  readonly property bool countActive: (showCount && service.connected && service.keptCount > 0) || showingPlus
  readonly property bool pendingActive: service.connected && service.pendingCount > 0
  readonly property bool dimmed: !service.connected

  // On a fresh keep the count cell shows "+N" in the accent colour for a beat,
  // then settles on the new total. It stays inside the bar: a 26px bar has no
  // room for anything to float up and out.
  property int plusAmount: 0
  property bool showingPlus: false
  readonly property string cellText: showingPlus ? "+" + plusAmount : Model.badgeText(service.keptCount)
  function celebrate(n) {
    plusAmount = n
    showingPlus = true
    mark.pulse()
    pop.restart()
    settle.restart()
  }
  Timer {
    id: settle
    interval: 1400
    onTriggered: root.showingPlus = false
  }

  readonly property string tooltip: {
    if (!service.connected) return "Busabase — " + (Model.statusLine(service.status, service.kind) || "connecting…")
    var head = service.keptCount === 0 ? "Nothing kept yet today"
      : service.keptCount + " kept today"
    if (service.pendingCount > 0) head += " · " + service.pendingCount + " waiting for review"
    var latest = service.keptItems.length > 0 ? "\n" + Model.summaryOf(service.keptItems[0]) : ""
    return head + latest
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight
  readonly property real openPanelIndicatorWidth: content.visible ? content.width : 0

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: ""
    labelVisible: false
    hasVisualContent: true
    fixedWidth: root.vertical ? -1 : Math.round(content.implicitWidth + Style.spaceReal(8.5) * 2)
    tooltipText: root.tooltip

    onPressed: function(b) {
      if (b === Qt.MiddleButton || b === Qt.RightButton) service.refresh()
      else root.togglePanel()
    }

    TextMetrics {
      id: countMetrics
      font.family: button.fontFamily
      font.pixelSize: button.fontSize
      text: root.cellText
    }

    Row {
      id: content
      anchors.centerIn: parent
      spacing: 0

      Item {
        anchors.verticalCenter: parent.verticalCenter
        width: mark.width
        height: mark.height

        BusabaseIcon {
          id: mark
          iconSize: Math.round(Style.bar.iconCanvas * 0.78)
          tint: button.foreground
          opacity: root.dimmed ? 0.5 : 1.0
        }

        // Accent dot on the mark's corner: something of yours waits for review.
        // Theme accent, not red — waiting is information, not an error.
        Rectangle {
          visible: root.pendingActive
          width: Math.max(4, Math.round(mark.iconSize * 0.36))
          height: width
          radius: width / 2
          color: Color.accent
          border.width: 1
          border.color: root.bar ? root.bar.background : Color.background
          x: mark.width - width * 0.6
          y: -height * 0.35
        }
      }

      // Count cell: collapses to nothing at zero so an idle day is just the mark.
      Item {
        anchors.verticalCenter: parent.verticalCenter
        width: root.countActive ? Math.ceil(countMetrics.advanceWidth) + Style.space(5) : 0
        height: countText.implicitHeight
        visible: width > 0 && !root.vertical

        Behavior on width { NumberAnimation { duration: 180; easing.type: Easing.OutCubic } }

        Text {
          id: countText
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: root.cellText
          color: root.showingPlus ? Color.accent : Qt.darker(button.foreground, 1.15)
          font.family: button.fontFamily
          font.pixelSize: button.fontSize
          font.bold: root.showingPlus
          transformOrigin: Item.Center

          Behavior on color { ColorAnimation { duration: 260 } }
          Behavior on text {
            SequentialAnimation {
              NumberAnimation { target: countText; property: "opacity"; to: 0; duration: 70; easing.type: Easing.InQuad }
              PropertyAction { }
              NumberAnimation { target: countText; property: "opacity"; to: 1; duration: 110; easing.type: Easing.OutQuad }
            }
          }

          // A small pop as the "+N" lands: a score, not an alert.
          SequentialAnimation {
            id: pop
            NumberAnimation { target: countText; property: "scale"; from: 0.6; to: 1.25; duration: 160; easing.type: Easing.OutBack }
            NumberAnimation { target: countText; property: "scale"; to: 1.0; duration: 220; easing.type: Easing.OutCubic }
          }
        }
      }
    }
  }
}
