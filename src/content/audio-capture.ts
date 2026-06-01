/**
 * DeepGuard — Audio Capture
 *
 * Requests microphone access and uses the Web Audio API to measure
 * local audio RMS level for lip-sync analysis.
 */

import { AUDIO_RMS_THRESHOLD } from '../shared/constants';

export type AudioLevelCallback = (rms: number) => void;

export class AudioCapture {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private onLevel: AudioLevelCallback;
  private dataArray: Float32Array | null = null;

  constructor(onLevel: AudioLevelCallback) {
    this.onLevel = onLevel;
  }

  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.source.connect(this.analyser);

      this.dataArray = new Float32Array(this.analyser.fftSize);

      // Poll audio level at 10 Hz
      this.pollInterval = setInterval(() => this.measureLevel(), 100);

      console.log('[AudioCapture] Started');
      return true;
    } catch (err) {
      console.warn('[AudioCapture] Could not access microphone:', err);
      return false;
    }
  }

  stop(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();

    this.audioContext  = null;
    this.analyser      = null;
    this.source        = null;
    this.stream        = null;
    this.dataArray     = null;
    this.pollInterval  = null;

    console.log('[AudioCapture] Stopped');
  }

  private measureLevel(): void {
    if (!this.analyser || !this.dataArray) return;

    this.analyser.getFloatTimeDomainData(this.dataArray);

    let sumSquares = 0;
    for (const sample of this.dataArray) {
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / this.dataArray.length);

    this.onLevel(rms);
  }

  get isActive(): boolean {
    return this.audioContext !== null;
  }
}
