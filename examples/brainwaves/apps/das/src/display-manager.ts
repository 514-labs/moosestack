import { BrainwaveData } from "./types.js";

// Initialize data arrays for the chart
const dataPoints = 100;
const alphaData = new Array(dataPoints).fill(0);
const betaData = new Array(dataPoints).fill(0);
const deltaData = new Array(dataPoints).fill(0);
const thetaData = new Array(dataPoints).fill(0);
const gammaData = new Array(dataPoints).fill(0);

export class DisplayManager {
  private screen: any;
  private line: any;
  private table: any;
  private bpmBox: any;
  private lastRenderTime: number;
  private renderInterval: number;
  private bpm: number | null = null;

  constructor(
    screen: any,
    line: any,
    table: any,
    bpmBox: any,
    legendBox?: any,
    renderInterval: number = 16,
  ) {
    this.screen = screen;
    this.line = line;
    this.table = table;
    this.bpmBox = bpmBox;
    this.lastRenderTime = Date.now();
    this.renderInterval = renderInterval;

    this.line.options.numYLabels = 6;
    this.line.options.legend.width = 8;
  }

  updateChart(msg: BrainwaveData): void {
    // Update raw data arrays
    [alphaData, betaData, deltaData, thetaData, gammaData].forEach((arr) =>
      arr.shift(),
    );
    alphaData.push(msg.alpha);
    betaData.push(msg.beta);
    deltaData.push(msg.delta);
    thetaData.push(msg.theta);
    gammaData.push(msg.gamma);

    // Calculate minY and maxY dynamically
    const allData = [
      ...alphaData,
      ...betaData,
      ...deltaData,
      ...thetaData,
      ...gammaData,
    ];
    const minY = Math.min(...allData);
    const maxY = Math.max(...allData);

    // Update chart options
    this.line.options.minY = minY;
    this.line.options.maxY = maxY;

    this.line.setData([
      {
        title: "Alpha",
        x: [...Array(dataPoints).keys()],
        y: alphaData,
        style: { line: "yellow" },
      },
      {
        title: "Beta",
        x: [...Array(dataPoints).keys()],
        y: betaData,
        style: { line: "red" },
      },
      {
        title: "Delta",
        x: [...Array(dataPoints).keys()],
        y: deltaData,
        style: { line: "green" },
      },
      {
        title: "Theta",
        x: [...Array(dataPoints).keys()],
        y: thetaData,
        style: { line: "blue" },
      },
      {
        title: "Gamma",
        x: [...Array(dataPoints).keys()],
        y: gammaData,
        style: { line: "magenta" },
      },
    ]);

    this.renderIfNeeded();
  }

  updateTable(document: BrainwaveData): void {
    this.table.setData({
      headers: [
        "Band",
        "AccX",
        "AccY",
        "AccZ",
        "GyroX",
        "GyroY",
        "GyroZ",
        "Alpha",
        "Beta",
        "Delta",
        "Gamma",
        "Theta",
      ],
      data: [
        [
          document.bandOn ? "ON" : "OFF",
          document.acc.x.toFixed(2),
          document.acc.y.toFixed(2),
          document.acc.z.toFixed(2),
          document.gyro.x.toFixed(2),
          document.gyro.y.toFixed(2),
          document.gyro.z.toFixed(2),
          document.alpha.toFixed(2),
          document.beta.toFixed(2),
          document.delta.toFixed(2),
          document.gamma.toFixed(2),
          document.theta.toFixed(2),
        ],
      ],
    });

    this.renderIfNeeded();
  }

  updateBPM(bpm: number | null): void {
    this.bpm = bpm;
    if (bpm && bpm > 0) {
      this.bpmBox.setContent(`{bold}${bpm.toFixed(1)}{/bold}`);
    } else {
      this.bpmBox.setContent("---");
    }
    this.renderIfNeeded();
  }

  private renderIfNeeded(): void {
    const currentTime = Date.now();
    if (currentTime - this.lastRenderTime >= this.renderInterval) {
      this.screen.render();
      this.lastRenderTime = currentTime;
    }
  }
}
