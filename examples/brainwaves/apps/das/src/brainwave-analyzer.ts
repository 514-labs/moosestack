import { BrainwaveData } from "./types.js";
import { Logger } from "./logger.js";
import { levenbergMarquardt } from "ml-levenberg-marquardt";

// Constants for movement analysis
const ACCELERATION_THRESHOLD = 1.8;
const GYRO_THRESHOLD = 20.0;
const MOVEMENT_WARNING_COOLDOWN = 2000; // 2 seconds between warnings
const SMOOTHING_WINDOW = 5;

// Buffers for movement analysis
const accBuffer: number[] = [];
const gyroBuffer: number[] = [];
let lastMovementWarning = 0;

// Constants for relaxation analysis
const RELAXATION_WEIGHTS = {
  alpha: 0.4, // Alpha is most important for relaxation
  theta: 0.3, // Theta also indicates relaxation
  beta: -0.2, // High beta indicates mental activity/stress
  gamma: -0.1, // High gamma can indicate active processing
};

export interface RelaxationState {
  isRelaxed: boolean;
  score: number;
}

export function checkExcessiveMovement(msg: BrainwaveData): void {
  const accMagnitude = Math.sqrt(
    Math.pow(msg.acc.x, 2) + Math.pow(msg.acc.y, 2) + Math.pow(msg.acc.z, 2),
  );

  const gyroMagnitude = Math.sqrt(
    Math.pow(msg.gyro.x, 2) + Math.pow(msg.gyro.y, 2) + Math.pow(msg.gyro.z, 2),
  );

  accBuffer.push(accMagnitude);
  gyroBuffer.push(gyroMagnitude);

  if (accBuffer.length > SMOOTHING_WINDOW) accBuffer.shift();
  if (gyroBuffer.length > SMOOTHING_WINDOW) gyroBuffer.shift();

  const smoothedAcc = accBuffer.reduce((a, b) => a + b, 0) / accBuffer.length;
  const smoothedGyro =
    gyroBuffer.reduce((a, b) => a + b, 0) / gyroBuffer.length;

  const now = Date.now();
  if (
    (smoothedAcc > ACCELERATION_THRESHOLD || smoothedGyro > GYRO_THRESHOLD) &&
    now - lastMovementWarning > MOVEMENT_WARNING_COOLDOWN
  ) {
    Logger.warn(
      `Excessive head movement detected (Acc: ${smoothedAcc.toFixed(2)}, Gyro: ${smoothedGyro.toFixed(2)})`,
    );
    lastMovementWarning = now;
  }
}

export function analyzeRelaxationState(data: BrainwaveData): RelaxationState {
  const score =
    data.alpha * RELAXATION_WEIGHTS.alpha +
    data.theta * RELAXATION_WEIGHTS.theta +
    (1 - data.beta) * RELAXATION_WEIGHTS.beta +
    (1 - data.gamma) * RELAXATION_WEIGHTS.gamma;

  const normalizedScore = Math.max(0, Math.min(1, score));

  return {
    isRelaxed: normalizedScore > 0.6,
    score: normalizedScore,
  };
}

// Add a simple FFT implementation (Cooley-Tukey, radix-2)
function fft(input: number[]): { re: number[]; im: number[] } {
  const N = input.length;
  if (N <= 1) return { re: input.slice(), im: new Array(N).fill(0) };
  if ((N & (N - 1)) !== 0)
    throw new Error("FFT input length must be a power of 2");
  // Bit-reversal permutation
  const rev = (x: number, bits: number) => {
    let y = 0;
    for (let i = 0; i < bits; i++) y = (y << 1) | ((x >> i) & 1);
    return y;
  };
  const bits = Math.log2(N);
  const re = new Array(N);
  const im = new Array(N);
  for (let i = 0; i < N; i++) {
    re[rev(i, bits)] = input[i];
    im[rev(i, bits)] = 0;
  }
  for (let s = 1; s <= bits; s++) {
    const m = 1 << s;
    const m2 = m >> 1;
    const theta = (-2 * Math.PI) / m;
    const wpr = Math.cos(theta);
    const wpi = Math.sin(theta);
    for (let k = 0; k < N; k += m) {
      let wr = 1,
        wi = 0;
      for (let j = 0; j < m2; j++) {
        const tRe = wr * re[k + j + m2] - wi * im[k + j + m2];
        const tIm = wr * im[k + j + m2] + wi * re[k + j + m2];
        re[k + j + m2] = re[k + j] - tRe;
        im[k + j + m2] = im[k + j] - tIm;
        re[k + j] += tRe;
        im[k + j] += tIm;
        const wtmp = wr;
        wr = wtmp * wpr - wi * wpi;
        wi = wtmp * wpi + wi * wpr;
      }
    }
  }
  return { re, im };
}

// Define the structure for multi-channel PPG data input
interface PpgSample {
  timestamp: number;
  values: [number, number, number]; // For 3 channels
}

function estimateHeartRateFromPPG_FFT(
  ppgChannelData: { timestamp: number; value: number }[], // Processes a single channel
  sampleRate: number,
): number | null {
  // Bandpass filter as before
  const values = ppgChannelData.map((d) => d.value);
  function movingAverage(arr: number[], window: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      let start = Math.max(0, i - Math.floor(window / 2));
      let end = Math.min(arr.length, i + Math.ceil(window / 2));
      let avg =
        arr.slice(start, end).reduce((a, b) => a + b, 0) / (end - start);
      result.push(avg);
    }
    return result;
  }
  const lowpass = movingAverage(values, 3);
  const highpass = movingAverage(values, 50);
  const bandpassed = lowpass.map((v, i) => v - highpass[i]);
  Logger.info(
    `[HR-FFT] Sample rate: ${sampleRate.toFixed(2)} Hz, Bandpassed first10=[${bandpassed
      .slice(0, 10)
      .map((v) => v.toFixed(2))
      .join(", ")}], last10=[${bandpassed
      .slice(-10)
      .map((v) => v.toFixed(2))
      .join(", ")}]`,
  );

  // Zero-pad to next power of 2
  let N = bandpassed.length;
  let pow2 = 1;
  while (pow2 < N) pow2 <<= 1;
  const padded = bandpassed.concat(new Array(pow2 - N).fill(0));

  // Remove mean
  const mean = padded.reduce((a, b) => a + b, 0) / padded.length;
  const detrended = padded.map((v) => v - mean);

  // FFT
  const { re, im } = fft(detrended);
  const mags = re.map((r, i) => Math.sqrt(r * r + im[i] * im[i]));

  // Frequency bin resolution
  const freqRes = sampleRate / mags.length;
  // Heart rate band: 0.8–1.3 Hz (narrowed further)
  const minBin = Math.ceil(0.8 / freqRes);
  const maxBin = Math.floor(1.3 / freqRes);
  let maxMag = 0;
  let maxIdx = -1;
  for (let i = minBin; i <= maxBin; i++) {
    if (mags[i] > maxMag) {
      maxMag = mags[i];
      maxIdx = i;
    }
  }
  if (maxIdx === -1) return null;
  const freq = maxIdx * freqRes;
  const bpm = freq * 60;
  Logger.info(
    `[HR-FFT] Dominant freq=${freq.toFixed(3)}Hz, BPM=${bpm.toFixed(1)}, power=${maxMag.toFixed(1)}`,
  );
  if (bpm < 40 || bpm > 180) return null;
  return bpm;
}

// Simple peak detection estimator for heart rate
function estimateHeartRateFromPPG_Peaks(
  ppgChannelData: { timestamp: number; value: number }[], // Processes a single channel
  sampleRate: number,
): number | null {
  const values = ppgChannelData.map((d) => d.value);
  function movingAverage(arr: number[], window: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      let start = Math.max(0, i - Math.floor(window / 2));
      let end = Math.min(arr.length, i + Math.ceil(window / 2));
      let avg =
        arr.slice(start, end).reduce((a, b) => a + b, 0) / (end - start);
      result.push(avg);
    }
    return result;
  }
  const lowpass = movingAverage(values, 3);
  const highpass = movingAverage(values, 50);
  const bandpassed = lowpass.map((v, i) => v - highpass[i]);
  // Peak detection
  const threshold = 0.2 * Math.max(...bandpassed.map(Math.abs));
  let lastPeak = null;
  let intervals: number[] = [];
  for (let i = 1; i < bandpassed.length - 1; i++) {
    if (
      bandpassed[i] > threshold &&
      bandpassed[i] > bandpassed[i - 1] &&
      bandpassed[i] > bandpassed[i + 1]
    ) {
      if (lastPeak !== null) {
        intervals.push(ppgChannelData[i].timestamp - lastPeak);
      }
      lastPeak = ppgChannelData[i].timestamp;
    }
  }
  Logger.info(`[HR-Peaks] Detected peaks: ${intervals.length + 1}`);
  if (intervals.length < 2) return null;
  const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const bpm = 60 / meanInterval;
  Logger.info(
    `[HR-Peaks] Intervals: [${intervals.map((x) => x.toFixed(3)).join(", ")}], meanInterval=${meanInterval.toFixed(3)}, BPM=${bpm.toFixed(1)}`,
  );
  if (bpm < 48 || bpm > 78) return null;
  return bpm;
}

export function estimateHeartRateFromPPG(
  ppgMultiChannelData: PpgSample[],
  minSeconds = 6,
): number | null {
  // Static buffer for last N BPMs and previous stable BPM (now per channel)
  const N = 7;
  if (!(estimateHeartRateFromPPG as any).bpmBuffers) {
    (estimateHeartRateFromPPG as any).bpmBuffers = [[], [], []]; // One buffer for each of the 3 channels
  }
  if (!("prevBPMs" in (estimateHeartRateFromPPG as any))) {
    (estimateHeartRateFromPPG as any).prevBPMs = [null, null, null]; // prevBPM for each channel
  }
  const bpmBuffers: number[][] = (estimateHeartRateFromPPG as any).bpmBuffers;
  let prevBPMs: (number | null)[] = (estimateHeartRateFromPPG as any).prevBPMs;

  if (ppgMultiChannelData.length < 32) {
    Logger.info(`[HR-Multi] Not enough samples: ${ppgMultiChannelData.length}`);
    // Return an aggregate or the most stable of prevBPMs if available, for now, just the first one
    return prevBPMs[0]; // Simplified for now, consider a more robust way to return previous BPM
  }
  const duration =
    ppgMultiChannelData[ppgMultiChannelData.length - 1].timestamp -
    ppgMultiChannelData[0].timestamp;
  if (duration < minSeconds) {
    Logger.info(`[HR-Multi] Window too short: ${duration.toFixed(2)}s`);
    return prevBPMs[0]; // Simplified for now
  }
  const sampleRate = (ppgMultiChannelData.length - 1) / duration;

  const channelBPMs_fft: (number | null)[] = [];
  const channelBPMs_peaks: (number | null)[] = [];
  const finalChannelBPMs: (number | null)[] = [];

  for (let i = 0; i < 3; i++) {
    // Assuming 3 channels
    const singleChannelData = ppgMultiChannelData.map((d) => ({
      timestamp: d.timestamp,
      value: d.values[i],
    }));

    const bpm_fft_channel = estimateHeartRateFromPPG_FFT(
      singleChannelData,
      sampleRate,
    );
    const bpm_peaks_channel = estimateHeartRateFromPPG_Peaks(
      singleChannelData,
      sampleRate,
    );
    Logger.info(
      `[HR Ch-${i}] FFT BPM: ${bpm_fft_channel?.toFixed(1) ?? "null"}, Peaks BPM: ${bpm_peaks_channel?.toFixed(1) ?? "null"}`,
    );

    let currentChannelBPM = bpm_fft_channel;
    const currentBpmBuffer = bpmBuffers[i];
    let currentPrevBPM = prevBPMs[i];

    if (currentChannelBPM == null && bpm_peaks_channel != null) {
      Logger.info(
        `[HR Ch-${i}] Using Peaks BPM: ${bpm_peaks_channel!.toFixed(1)}`,
      );
      currentChannelBPM = bpm_peaks_channel;
    }

    if (currentChannelBPM != null) {
      currentBpmBuffer.push(currentChannelBPM);
      if (currentBpmBuffer.length > N) currentBpmBuffer.shift();
      const sortedChannel = [...currentBpmBuffer].sort((a, b) => a - b);
      const medianChannelBPM =
        sortedChannel[Math.floor(sortedChannel.length / 2)];

      if (currentPrevBPM !== null) {
        if (Math.abs(medianChannelBPM - currentChannelBPM) > 2) {
          Logger.info(
            `[HR Ch-${i}] Waiting for stable BPM (median ${medianChannelBPM.toFixed(1)} vs current ${currentChannelBPM.toFixed(1)})`,
          );
          finalChannelBPMs.push(currentPrevBPM); // Use previous if not stable
        } else {
          prevBPMs[i] = medianChannelBPM;
          finalChannelBPMs.push(medianChannelBPM);
          Logger.info(
            `[HR Ch-${i}] Accepted: ${medianChannelBPM.toFixed(1)} BPM`,
          );
        }
      } else {
        prevBPMs[i] = medianChannelBPM;
        finalChannelBPMs.push(medianChannelBPM);
        Logger.info(
          `[HR Ch-${i}] Accepted (initial): ${medianChannelBPM.toFixed(1)} BPM`,
        );
      }
    } else {
      finalChannelBPMs.push(currentPrevBPM); // No new BPM, use previous
      Logger.info(`[HR Ch-${i}] No plausible heart rate for this channel.`);
    }
  }

  // Combine results from channels
  // const validBPMs = finalChannelBPMs.filter(bpm => bpm !== null && bpm >= 48 && bpm <= 130) as number[]; // Wider range for general use

  // New strategy: Prioritize higher, consistent BPMs
  const plausibleChannelBPMs = finalChannelBPMs.filter(
    (bpm) => bpm !== null && bpm >= 55 && bpm <= 130,
  ) as number[];

  if (plausibleChannelBPMs.length === 0) {
    Logger.info(
      `[HR-Multi] No plausible heart rate (55-130 BPM) from any channel.`,
    );
    const overallPrevBPMs = prevBPMs.filter((bpm) => bpm !== null) as number[];
    if (overallPrevBPMs.length > 0) {
      const sortedOverallPrev = [...overallPrevBPMs].sort((a, b) => a - b);
      return sortedOverallPrev[Math.floor(sortedOverallPrev.length / 2)];
    }
    return null;
  }

  plausibleChannelBPMs.sort((a, b) => b - a); // Sort descending

  let combinedBPM: number;

  if (plausibleChannelBPMs.length === 1) {
    combinedBPM = plausibleChannelBPMs[0];
    Logger.info(
      `[HR-Multi] Using single plausible channel BPM: ${combinedBPM.toFixed(1)}`,
    );
  } else if (plausibleChannelBPMs.length >= 2) {
    const highestBPM = plausibleChannelBPMs[0];
    const secondHighestBPM = plausibleChannelBPMs[1];
    // Check if second highest is close to highest (e.g., within 10 BPM)
    if (Math.abs(highestBPM - secondHighestBPM) <= 10) {
      combinedBPM = (highestBPM + secondHighestBPM) / 2;
      Logger.info(
        `[HR-Multi] Averaging two highest consistent BPMs: [${highestBPM.toFixed(1)}, ${secondHighestBPM.toFixed(1)}] -> ${combinedBPM.toFixed(1)}`,
      );
    } else {
      combinedBPM = highestBPM; // Use only the highest if others are not close
      Logger.info(
        `[HR-Multi] Using highest BPM as others are not close: ${combinedBPM.toFixed(1)}`,
      );
    }
  } else {
    // Should not happen due to plausibleChannelBPMs.length === 0 check, but as a fallback:
    Logger.warn("[HR-Multi] Unexpected state in BPM combination logic.");
    return prevBPMs[0]; // Fallback to a previous BPM
  }

  Logger.info(`[HR-Multi] Final combined BPM: ${combinedBPM.toFixed(1)}`);

  // It might be beneficial to update one of the prevBPMs (e.g., prevBPMs[0]) with this combinedBPM
  // for better stability if all channels fail in the next cycle.
  // For now, per-channel prevBPMs are updated individually based on their own stability.

  return combinedBPM;
}

// Initialize static properties
(estimateHeartRateFromPPG as any).bpmBuffers = [[], [], []];
(estimateHeartRateFromPPG as any).prevBPMs = [null, null, null];
