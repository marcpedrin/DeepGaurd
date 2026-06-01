/**
 * DeepGuard — Frame Capturer
 *
 * Captures video frames from participant video elements at the configured FPS.
 * Uses OffscreenCanvas.drawImage() for zero-copy pixel extraction.
 */

import { FRAME_INTERVAL_MS, MIN_VIDEO_DIMENSION } from '../shared/constants';
import type { Participant, ParticipantId, SerializedFrameData } from '../shared/types';

type FrameCallback = (frame: SerializedFrameData) => void;

interface CaptureJob {
  participant: Participant;
  intervalId: ReturnType<typeof setInterval>;
  frameIndex: number;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

export class FrameCapturer {
  private jobs = new Map<ParticipantId, CaptureJob>();
  private onFrame: FrameCallback;
  private intervalMs: number;

  constructor(onFrame: FrameCallback, fps: 1 | 2 = 1) {
    this.onFrame   = onFrame;
    this.intervalMs = Math.round(1000 / fps);
  }

  addParticipant(participant: Participant): void {
    if (this.jobs.has(participant.id)) {
      this.updateParticipant(participant);
      return;
    }

    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d', {
      willReadFrequently: true,
      alpha: false,
    }) as OffscreenCanvasRenderingContext2D;

    const job: CaptureJob = {
      participant,
      frameIndex: 0,
      canvas,
      ctx,
      intervalId: setInterval(() => {
        this.captureFrame(job);
      }, this.intervalMs),
    };

    this.jobs.set(participant.id, job);
    console.log(`[FrameCapturer] Started capturing: ${participant.displayName}`);
  }

  updateParticipant(participant: Participant): void {
    const job = this.jobs.get(participant.id);
    if (job) {
      job.participant = participant;
    }
  }

  removeParticipant(participantId: ParticipantId): void {
    const job = this.jobs.get(participantId);
    if (job) {
      clearInterval(job.intervalId);
      this.jobs.delete(participantId);
      console.log(`[FrameCapturer] Stopped capturing: ${participantId}`);
    }
  }

  stopAll(): void {
    this.jobs.forEach((job) => clearInterval(job.intervalId));
    this.jobs.clear();
  }

  setFps(fps: 1 | 2): void {
    this.intervalMs = Math.round(1000 / fps);
    // Restart all intervals
    this.jobs.forEach((job, id) => {
      clearInterval(job.intervalId);
      job.intervalId = setInterval(() => this.captureFrame(job), this.intervalMs);
    });
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private captureFrame(job: CaptureJob): void {
    const { participant, canvas, ctx } = job;
    const video = participant.videoElement;

    // Bail if video not ready
    if (!this.isVideoReady(video)) return;

    const { videoWidth: w, videoHeight: h } = video;

    // Resize canvas if needed
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }

    try {
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);

      job.frameIndex++;

      // Serialise: transfer the underlying ArrayBuffer (zero-copy via transferable)
      const frame: SerializedFrameData = {
        participantId: participant.id,
        buffer: imageData.data.buffer.slice(0), // slice for safe transfer
        width: w,
        height: h,
        timestamp: Date.now(),
        frameIndex: job.frameIndex,
      };

      this.onFrame(frame);
    } catch (err) {
      // Video may be in a cross-origin state temporarily — skip frame
      if (!(err instanceof DOMException && err.name === 'SecurityError')) {
        console.warn(`[FrameCapturer] drawImage failed for ${participant.id}:`, err);
      }
    }
  }

  private isVideoReady(video: HTMLVideoElement): boolean {
    return (
      video.readyState >= 2 &&
      !video.paused &&
      video.videoWidth  >= MIN_VIDEO_DIMENSION &&
      video.videoHeight >= MIN_VIDEO_DIMENSION
    );
  }
}
