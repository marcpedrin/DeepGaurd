/**
 * DeepGuard — Overlay Manager
 *
 * Injects React overlay cards next to each participant video tile.
 * Uses Shadow DOM to isolate styles from Google Meet's stylesheet.
 */

import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { TrustCard } from '../ui/components/TrustCard';
import type { Participant, ParticipantId, TrustReport } from '../shared/types';

interface OverlayEntry {
  container: HTMLDivElement;
  shadowRoot: ShadowRoot;
  reactRoot: ReturnType<typeof createRoot>;
  participant: Participant;
  latestReport: TrustReport | null;
  positionInterval: ReturnType<typeof setInterval>;
}

export class OverlayManager {
  private overlays = new Map<ParticipantId, OverlayEntry>();

  addOverlay(participant: Participant): void {
    if (this.overlays.has(participant.id)) {
      this.updateParticipant(participant);
      return;
    }

    const container = document.createElement('div');
    container.className = 'deepguard-overlay-root';
    container.setAttribute('data-deepguard-id', participant.id);
    container.style.cssText = `
      position: absolute;
      z-index: 9999;
      pointer-events: none;
      top: 0;
      left: 0;
    `;

    // Shadow DOM for CSS isolation
    const shadowRoot = container.attachShadow({ mode: 'open' });

    // Inject Tailwind + overlay styles into shadow root
    const style = document.createElement('style');
    style.textContent = getOverlayStyles();
    shadowRoot.appendChild(style);

    // Mount point
    const mountPoint = document.createElement('div');
    mountPoint.style.cssText = 'pointer-events: auto;';
    shadowRoot.appendChild(mountPoint);

    document.body.appendChild(container);

    const reactRoot = createRoot(mountPoint);
    reactRoot.render(
      createElement(TrustCard, {
        participant,
        report: null,
        key: participant.id,
      })
    );

    const entry: OverlayEntry = {
      container,
      shadowRoot,
      reactRoot,
      participant,
      latestReport: null,
      positionInterval: setInterval(() => {
        this.repositionOverlay(participant.id);
      }, 500),
    };

    this.overlays.set(participant.id, entry);
    this.repositionOverlay(participant.id);

    console.log(`[OverlayManager] Overlay created for: ${participant.displayName}`);
  }

  removeOverlay(participantId: ParticipantId): void {
    const entry = this.overlays.get(participantId);
    if (!entry) return;

    clearInterval(entry.positionInterval);
    entry.reactRoot.unmount();
    entry.container.remove();
    this.overlays.delete(participantId);

    console.log(`[OverlayManager] Overlay removed: ${participantId}`);
  }

  updateReport(report: TrustReport): void {
    const entry = this.overlays.get(report.participantId);
    if (!entry) return;

    entry.latestReport = report;
    entry.reactRoot.render(
      createElement(TrustCard, {
        participant: entry.participant,
        report,
        key: report.participantId,
      })
    );
  }

  updateParticipant(participant: Participant): void {
    const entry = this.overlays.get(participant.id);
    if (!entry) return;
    entry.participant = participant;
  }

  removeAll(): void {
    this.overlays.forEach((_, id) => this.removeOverlay(id));
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private repositionOverlay(participantId: ParticipantId): void {
    const entry = this.overlays.get(participantId);
    if (!entry) return;

    const video = entry.participant.videoElement;
    const videoRect = video.getBoundingClientRect();

    if (videoRect.width === 0 || videoRect.height === 0) return;

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Position overlay at top-left corner of the video tile
    entry.container.style.transform = `translate(${videoRect.left + scrollX}px, ${videoRect.top + scrollY}px)`;
    entry.container.style.width  = `${videoRect.width}px`;
    entry.container.style.height = `${videoRect.height}px`;
  }
}

// ─── Inline Styles ────────────────────────────────────────────────────────────

function getOverlayStyles(): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .dg-card {
      font-family: 'Inter', system-ui, sans-serif;
      position: absolute;
      top: 8px;
      left: 8px;
      width: 220px;
      background: linear-gradient(135deg, rgba(17,24,39,0.95) 0%, rgba(10,14,26,0.98) 100%);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(59,130,246,0.2);
      border-radius: 12px;
      padding: 12px 14px;
      color: #f9fafb;
      box-shadow: 0 4px 24px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.4);
      pointer-events: auto;
      transition: all 0.3s ease;
      cursor: pointer;
      overflow: hidden;
      animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
    }

    .dg-card:hover {
      border-color: rgba(59,130,246,0.4);
      box-shadow: 0 8px 32px rgba(0,0,0,0.7), 0 0 20px rgba(59,130,246,0.15);
    }

    .dg-card.collapsed .dg-details {
      display: none;
    }

    .dg-card.collapsed {
      width: auto;
      min-width: 120px;
    }

    /* Scan line animation */
    .dg-card::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, rgba(59,130,246,0.6), transparent);
      animation: scan 3s linear infinite;
    }

    @keyframes scan {
      0%   { top: 0; }
      100% { top: 100%; }
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateY(8px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* Header */
    .dg-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .dg-name {
      font-size: 12px;
      font-weight: 600;
      color: #e5e7eb;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100px;
    }

    /* Status badge */
    .dg-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .dg-badge.real {
      background: linear-gradient(135deg, #059669, #10b981);
      color: #fff;
      box-shadow: 0 0 12px rgba(16,185,129,0.4);
    }

    .dg-badge.suspicious {
      background: linear-gradient(135deg, #d97706, #f59e0b);
      color: #fff;
      box-shadow: 0 0 12px rgba(245,158,11,0.4);
    }

    .dg-badge.synthetic {
      background: linear-gradient(135deg, #dc2626, #ef4444);
      color: #fff;
      box-shadow: 0 0 12px rgba(239,68,68,0.4);
    }

    .dg-badge.analyzing {
      background: linear-gradient(135deg, #4b5563, #6b7280);
      color: #fff;
    }

    .dg-badge.no-face {
      background: linear-gradient(135deg, #374151, #4b5563);
      color: #9ca3af;
    }

    .dg-badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(255,255,255,0.8);
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.6; transform: scale(0.8); }
    }

    /* Trust score */
    .dg-score-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
    }

    .dg-score-label {
      font-size: 10px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .dg-score-value {
      font-size: 22px;
      font-weight: 700;
      line-height: 1;
    }

    .dg-score-value.real       { color: #10b981; }
    .dg-score-value.suspicious { color: #f59e0b; }
    .dg-score-value.synthetic  { color: #ef4444; }
    .dg-score-value.analyzing  { color: #6b7280; }

    /* Radial gauge */
    .dg-gauge {
      position: relative;
      width: 56px;
      height: 56px;
      flex-shrink: 0;
    }

    .dg-gauge svg {
      transform: rotate(-90deg);
    }

    .dg-gauge-track {
      fill: none;
      stroke: rgba(255,255,255,0.08);
      stroke-width: 4;
    }

    .dg-gauge-fill {
      fill: none;
      stroke-width: 4;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.4s ease;
    }

    .dg-gauge-text {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
    }

    /* Details panel */
    .dg-details {
      margin-top: 10px;
      border-top: 1px solid rgba(255,255,255,0.08);
      padding-top: 10px;
      animation: fadeIn 0.2s ease;
    }

    .dg-sub-score {
      display: flex;
      flex-direction: column;
      gap: 3px;
      margin-bottom: 8px;
    }

    .dg-sub-score:last-child {
      margin-bottom: 0;
    }

    .dg-sub-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .dg-sub-name {
      font-size: 10px;
      color: #9ca3af;
    }

    .dg-sub-value {
      font-size: 10px;
      font-weight: 600;
      color: #d1d5db;
    }

    .dg-bar-track {
      height: 3px;
      background: rgba(255,255,255,0.08);
      border-radius: 999px;
      overflow: hidden;
    }

    .dg-bar-fill {
      height: 100%;
      border-radius: 999px;
      transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Flags */
    .dg-flags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255,255,255,0.06);
    }

    .dg-flag {
      font-size: 9px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(239,68,68,0.15);
      color: #fca5a5;
      border: 1px solid rgba(239,68,68,0.3);
    }

    /* Latency badge */
    .dg-latency {
      margin-top: 6px;
      font-size: 9px;
      color: #4b5563;
      text-align: right;
    }

    /* Analyzing state */
    .dg-analyzing-pulse {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }

    .dg-pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #3b82f6;
    }

    .dg-pulse-dot:nth-child(1) { animation: pulseDot 1.2s ease-in-out 0s infinite; }
    .dg-pulse-dot:nth-child(2) { animation: pulseDot 1.2s ease-in-out 0.2s infinite; }
    .dg-pulse-dot:nth-child(3) { animation: pulseDot 1.2s ease-in-out 0.4s infinite; }

    @keyframes pulseDot {
      0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
      40%            { opacity: 1;   transform: scale(1.2); }
    }
  `;
}
