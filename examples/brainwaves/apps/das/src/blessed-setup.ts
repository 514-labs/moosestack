import blessed from "blessed";
import * as contrib from "blessed-contrib";

interface ScreenComponents {
  screen: any;
  grid: any;
  line: any;
  table: any;
  log: any;
  bpmBox: any;
}

export function createScreen(): ScreenComponents {
  const screen = blessed.screen();
  const grid = new contrib.grid({ rows: 20, cols: 1, screen: screen });

  const bpmBox = grid.set(0, 0, 2, 1, blessed.box, {
    top: 0,
    right: 0,
    width: "25%",
    height: 3,
    label: "Heart Rate (BPM)",
    tags: true,
    border: { type: "line" },
    style: {
      fg: "white",
      border: { fg: "cyan" },
      label: { fg: "cyan" },
    },
    content: "---",
  });

  const line = grid.set(2, 0, 7, 1, contrib.line, {
    showLegend: true,
    wholeNumbersOnly: false,
    label: "DAS - Brainwave Activity Monitor",
    padding: { top: 1, bottom: 0 },
  });

  const table = grid.set(9, 0, 4, 1, contrib.table, {
    keys: true,
    interactive: false,
    label: "Raw Data",
    columnSpacing: 2,
    columnWidth: [5, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
  });

  const log = grid.set(13, 0, 7, 1, contrib.log, {
    fg: "green",
    selectedFg: "green",
    label: "System Log",
    interactive: true,
  });

  screen.on("resize", () => {
    line.emit("attach");
    table.emit("attach");
    log.emit("attach");
    bpmBox.emit("attach");
  });

  return { screen, grid, line, table, log, bpmBox };
}
