import QtQuick
import qs.Commons

// The Busabase mark without its tile: three rounded bars, the middle one
// shorter. Monochrome so it takes the bar's foreground in every theme.
// pulse() stretches the middle bar to full length and back — a row being
// filled in — and is what plays when something new is kept.
Item {
  id: root

  property color tint: Color.foreground
  property real iconSize: Style.font.display

  implicitWidth: iconSize
  implicitHeight: iconSize

  // Proportions of the official 1024px mark, measured on its bar block.
  readonly property real barHeight: iconSize * 0.24
  readonly property real gap: (iconSize - barHeight * 3) / 2
  readonly property real shortRatio: 0.746
  property real middleRatio: shortRatio

  function pulse() { stretch.restart() }

  SequentialAnimation {
    id: stretch
    NumberAnimation { target: root; property: "middleRatio"; to: 1.0; duration: 220; easing.type: Easing.OutCubic }
    PauseAnimation { duration: 260 }
    NumberAnimation { target: root; property: "middleRatio"; to: root.shortRatio; duration: 420; easing.type: Easing.InOutCubic }
  }

  Rectangle {
    x: 0; y: 0
    width: root.iconSize; height: root.barHeight
    radius: height / 2
    color: root.tint
  }

  Rectangle {
    x: 0; y: root.barHeight + root.gap
    width: root.iconSize * root.middleRatio; height: root.barHeight
    radius: height / 2
    color: root.tint
  }

  Rectangle {
    x: 0; y: (root.barHeight + root.gap) * 2
    width: root.iconSize; height: root.barHeight
    radius: height / 2
    color: root.tint
  }
}
