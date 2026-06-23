/**
 * DeepGuard — Google Meet DOM Observer (v2)
 *
 * Uses a video-element-first strategy to discover participants.
 * Google Meet uses obfuscated class names and jsname attributes —
 * NOT data-participant-id — so we scan for active <video> elements directly.
 */

import { MIN_VIDEO_DIMENSION } from '../shared/constants';
import type { Participant, ParticipantId } from '../shared/types';

type ParticipantCallback = (participant: Participant) => void;
type ParticipantIdCallback = (participantId: ParticipantId) => void;

export class MeetObserver {
  private observer: MutationObserver | null = null;
  private participants = new Map<ParticipantId, Participant>();
  private onJoin: ParticipantCallback;
  private onLeave: ParticipantIdCallback;
  private scanInterval: ReturnType<typeof setInterval> | null = null;

  constructor(onJoin: ParticipantCallback, onLeave: ParticipantIdCallback) {
    this.onJoin  = onJoin;
    this.onLeave = onLeave;
  }

  start(): void {
    console.log('[MeetObserver] Starting observation (v2 — video-first)');

    // Initial scan after a brief delay to let Meet render
    setTimeout(() => this.scanForParticipants(), 1000);
    setTimeout(() => this.scanForParticipants(), 3000);

    // MutationObserver for DOM changes
    this.observer = new MutationObserver(() => {
      this.scanForParticipants();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    // Periodic scan — Meet's SPA updates can miss MutationObserver
    this.scanInterval = setInterval(() => {
      this.scanForParticipants();
    }, 2000);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.participants.clear();
    console.log('[MeetObserver] Stopped');
  }

  getParticipant(id: ParticipantId): Participant | undefined {
    return this.participants.get(id);
  }

  getAllParticipants(): Participant[] {
    return Array.from(this.participants.values());
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private scanForParticipants(): void {
    const found = new Set<ParticipantId>();

    // Find ALL video elements on the page
    const videos = document.querySelectorAll<HTMLVideoElement>('video');

    videos.forEach((video, index) => {
      // Must have a real video stream
      if (!this.isVideoUsable(video)) return;

      const id = this.stableVideoId(video, index);
      found.add(id);

      if (!this.participants.has(id)) {
        const displayName = this.extractDisplayName(video, index);
        const isLocal = this.isLocalVideo(video);

        const participant: Participant = {
          id,
          displayName,
          videoElement: video,
          isLocal,
        };

        this.participants.set(id, participant);
        console.log(`[MeetObserver] Joined: ${displayName} (local=${isLocal}, ${video.videoWidth}x${video.videoHeight})`);
        this.onJoin(participant);
      } else {
        // Keep video reference fresh (Meet re-creates elements)
        const existing = this.participants.get(id)!;
        if (existing.videoElement !== video) {
          existing.videoElement = video;
        }
      }
    });

    // Remove participants whose video is gone
    this.participants.forEach((_, id) => {
      if (!found.has(id)) {
        this.participants.delete(id);
        console.log(`[MeetObserver] Left: ${id}`);
        this.onLeave(id);
      }
    });
  }

  /**
   * A video is usable if it has real pixels (width/height > 0)
   * and is not completely hidden (display:none / visibility:hidden).
   * We do NOT require !paused because Meet's self-view can be paused.
   */
  private isVideoUsable(video: HTMLVideoElement): boolean {
    if (video.videoWidth < MIN_VIDEO_DIMENSION || video.videoHeight < MIN_VIDEO_DIMENSION) {
      return false;
    }

    // Skip if the video or any ancestor is display:none
    if (!video.offsetParent && !this.isFixedOrAbsolute(video)) {
      return false;
    }

    // Must have at least HAVE_CURRENT_DATA
    if (video.readyState < 2) return false;

    return true;
  }

  private isFixedOrAbsolute(el: HTMLElement): boolean {
    let current: HTMLElement | null = el;
    while (current) {
      const pos = getComputedStyle(current).position;
      if (pos === 'fixed' || pos === 'absolute') return true;
      current = current.parentElement;
    }
    return false;
  }

  /**
   * Build a stable ID from the video element's position in the DOM.
   * This survives Meet's SPA navigations as long as the tile isn't removed.
   */
  private stableVideoId(video: HTMLVideoElement, fallbackIndex: number): string {
    // Prefer any jsname/data attribute on a nearby ancestor
    const tile = video.closest('[jsname], [data-ssrc], [data-requested-participant-id]');
    if (tile) {
      const jsname = tile.getAttribute('jsname');
      const ssrc   = tile.getAttribute('data-ssrc');
      const reqId  = tile.getAttribute('data-requested-participant-id');
      const key    = ssrc ?? reqId ?? jsname ?? '';
      if (key) return `meet_${key}`;
    }

    // Fall back to DOM path hash
    const path = getElementPath(video);
    return `vid_${simpleHash(path)}_${fallbackIndex}`;
  }

  /**
   * Extract participant name from Meet's DOM using multiple strategies.
   * Meet renders the participant name as a text overlay at the bottom-left
   * of each video tile.
   */
  private extractDisplayName(video: HTMLVideoElement, index: number): string {
    // Walk up ancestors looking for name signals
    let el: HTMLElement | null = video.parentElement;
    for (let depth = 0; depth < 12 && el; depth++) {
      // aria-label on the tile often contains the name (e.g. "Marc Pedrin's camera")
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.length < 80 && !ariaLabel.toLowerCase().includes('video')) {
        // Strip trailing " (you)" / " (host)" / "'s camera"
        const cleaned = ariaLabel.replace(/'s camera$/i, '').replace(/\s*\(.*\)\s*$/, '').trim();
        if (cleaned.length > 0) return cleaned;
      }

      // data-display-name / data-participant-name
      const dataName = el.getAttribute('data-display-name') ??
                       el.getAttribute('data-participant-name') ??
                       el.getAttribute('data-self-name');
      if (dataName && dataName.length < 80) return dataName;

      // Meet renders the participant name as a span with dir="auto" at the
      // bottom of each tile — look for it among children
      const spans = el.querySelectorAll<HTMLElement>('span[dir="auto"], [class*="name"], [class*="Name"]');
      for (const span of Array.from(spans)) {
        const text = span.textContent?.trim();
        if (text && text.length > 0 && text.length < 60 && !/^\d+$/.test(text)) {
          return text;
        }
      }

      el = el.parentElement;
    }

    // Last resort — don't use "You" unless we're sure it's local
    return `Participant ${index + 1}`;
  }

  /**
   * Heuristic: Meet tags the local participant container with specific attributes.
   * We do NOT use video.muted as a fallback — Meet mutes ALL video elements
   * (remote and local) due to autoplay policy, so muted is not a reliable signal.
   */
  private isLocalVideo(video: HTMLVideoElement): boolean {
    let el: HTMLElement | null = video.parentElement;
    for (let depth = 0; depth < 10 && el; depth++) {
      if (
        el.hasAttribute('data-self-participant') ||
        el.getAttribute('data-is-self') === 'true' ||
        el.getAttribute('data-is-local') === 'true' ||
        el.getAttribute('data-allocation-index') === '0' // Meet's local tile
      ) {
        return true;
      }
      el = el.parentElement;
    }
    // Never fall back to video.muted — that flag is set on remote videos too
    return false;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getElementPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(
          (c) => c.tagName === current!.tagName
        )
      : [];
    const idx = siblings.indexOf(current);
    parts.unshift(`${tag}[${idx}]`);
    current = current.parentElement;
  }
  return parts.join('>');
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash).toString(36);
}
