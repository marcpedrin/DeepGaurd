/**
 * DeepGuard — Lip Sync Analyzer
 *
 * Compares mouth-open ratio (from face mesh) to audio RMS level
 * to detect mismatches that indicate a pre-recorded or dubbed video.
 */

import {
  MOUTH_OPEN_RATIO_THRESHOLD,
  AUDIO_RMS_THRESHOLD,
  LIP_SYNC_HISTORY_SIZE,
} from '../shared/constants';
import type { LipSyncResult, ParticipantId } from '../shared/types';

interface LipSyncSample {
  mouthOpen: boolean;
  audioActive: boolean;
  timestamp: number;
}

export class LipSyncAnalyzer {
  /** Per-participant audio levels (latest RMS value) */
  private audioLevels = new Map<ParticipantId, number>();
  /** Per-participant sample history */
  private history = new Map<ParticipantId, LipSyncSample[]>();

  updateAudioLevel(participantId: ParticipantId, rms: number): void {
    this.audioLevels.set(participantId, rms);
  }

  analyze(
    participantId: ParticipantId,
    mouthOpenRatio: number,
    timestamp: number,
  ): LipSyncResult {
    const audioRms = this.audioLevels.get(participantId) ?? 0;
    const audioAvailable = this.audioLevels.has(participantId);

    const mouthOpen   = mouthOpenRatio > MOUTH_OPEN_RATIO_THRESHOLD;
    const audioActive = audioRms > AUDIO_RMS_THRESHOLD;

    // Record sample
    if (!this.history.has(participantId)) {
      this.history.set(participantId, []);
    }
    const samples = this.history.get(participantId)!;
    samples.push({ mouthOpen, audioActive, timestamp });
    if (samples.length > LIP_SYNC_HISTORY_SIZE) samples.shift();

    if (!audioAvailable || samples.length < 3) {
      // Not enough data — return neutral
      return {
        lipSyncConfidence: 0.75,
        audioAvailable,
        mouthOpenRatio,
        audioRms,
      };
    }

    // Count agreements vs mismatches in history
    let agreements = 0;
    let mismatches = 0;

    for (const sample of samples) {
      if (sample.mouthOpen === sample.audioActive) {
        agreements++;
      } else {
        mismatches++;
      }
    }

    const total = agreements + mismatches;
    const agreementRate = agreements / total;

    // Penalty for persistent mismatch (mouth moving but no audio, or vice versa)
    const hasPersistentMismatch = mismatches >= Math.floor(total * 0.6);
    const penalty = hasPersistentMismatch ? 0.3 : 0;

    const lipSyncConfidence = Math.max(0, Math.min(1, agreementRate - penalty));

    return {
      lipSyncConfidence,
      audioAvailable,
      mouthOpenRatio,
      audioRms,
    };
  }

  clearParticipant(participantId: ParticipantId): void {
    this.audioLevels.delete(participantId);
    this.history.delete(participantId);
  }

  clearAll(): void {
    this.audioLevels.clear();
    this.history.clear();
  }
}
