/**
 * DeepGuard — Google Meet DOM Observer
 *
 * Uses MutationObserver to discover participant video tiles
 * using attribute-based and structural heuristics (not brittle class names).
 */

import { MEET_SELECTORS, MIN_VIDEO_DIMENSION } from '../shared/constants';
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
    console.log('[MeetObserver] Starting observation');

    // Initial scan
    this.scanForParticipants();

    // MutationObserver for DOM changes (participants joining/leaving)
    this.observer = new MutationObserver(() => {
      this.scanForParticipants();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    // Periodic scan as backup (Meet sometimes updates without triggering MutationObserver)
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

    // Strategy 1: data-participant-id attribute (most stable)
    const attrElements = document.querySelectorAll<HTMLElement>(
      MEET_SELECTORS.PARTICIPANT_BY_DATA_ATTR
    );

    attrElements.forEach((el) => {
      const participantId = el.getAttribute('data-participant-id') ?? '';
      if (!participantId) return;

      found.add(participantId);

      const video = el.querySelector<HTMLVideoElement>('video[autoplay]');
      if (!video || !this.isVideoActive(video)) return;

      if (!this.participants.has(participantId)) {
        const displayName = this.extractDisplayName(el, participantId);
        const participant: Participant = {
          id: participantId,
          displayName,
          videoElement: video,
          isLocal: this.isLocalParticipant(el),
        };
        this.participants.set(participantId, participant);
        this.onJoin(participant);
      } else {
        // Update video element reference if it changed
        const existing = this.participants.get(participantId)!;
        if (existing.videoElement !== video) {
          existing.videoElement = video;
        }
      }
    });

    // Strategy 2: Fallback — raw video elements (for Meet layouts without data-participant-id)
    if (attrElements.length === 0) {
      const videos = document.querySelectorAll<HTMLVideoElement>(
        MEET_SELECTORS.VIDEO_ELEMENTS
      );
      videos.forEach((video, index) => {
        if (!this.isVideoActive(video)) return;

        const fallbackId = this.generateVideoId(video, index);
        found.add(fallbackId);

        if (!this.participants.has(fallbackId)) {
          const container = video.closest('[class]') ?? video.parentElement;
          const displayName = container
            ? this.extractDisplayName(container as HTMLElement, fallbackId)
            : `Participant ${index + 1}`;

          const participant: Participant = {
            id: fallbackId,
            displayName,
            videoElement: video,
            isLocal: false,
          };
          this.participants.set(fallbackId, participant);
          this.onJoin(participant);
        }
      });
    }

    // Remove departed participants
    this.participants.forEach((_, id) => {
      if (!found.has(id)) {
        this.participants.delete(id);
        this.onLeave(id);
      }
    });
  }

  private isVideoActive(video: HTMLVideoElement): boolean {
    return (
      !video.paused &&
      video.readyState >= 2 &&
      video.videoWidth >= MIN_VIDEO_DIMENSION &&
      video.videoHeight >= MIN_VIDEO_DIMENSION &&
      !video.hidden
    );
  }

  private extractDisplayName(container: HTMLElement, fallback: string): string {
    // Try data-self-name / data-display-name attributes
    const nameEl = container.querySelector<HTMLElement>(
      '[data-self-name], [data-display-name], [data-participant-name]'
    );
    if (nameEl) {
      const name = nameEl.getAttribute('data-self-name') ??
                   nameEl.getAttribute('data-display-name') ??
                   nameEl.textContent?.trim();
      if (name) return name;
    }

    // Try common Meet text selectors for the name overlay
    const textSelectors = [
      '[class*="name"]',
      '[class*="Name"]',
      '[aria-label*="participant"]',
      'span[dir="auto"]',
    ];

    for (const sel of textSelectors) {
      const el = container.querySelector<HTMLElement>(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 0 && text.length < 60) {
        return text;
      }
    }

    return `Participant ${fallback.slice(0, 6)}`;
  }

  private isLocalParticipant(el: HTMLElement): boolean {
    return (
      el.hasAttribute('data-self-participant') ||
      el.getAttribute('data-is-self') === 'true' ||
      el.closest('[data-is-self="true"]') !== null
    );
  }

  private generateVideoId(video: HTMLVideoElement, index: number): string {
    // Use a stable hash based on video element's position in DOM
    const path = getElementPath(video);
    return `vid_${simpleHash(path)}_${index}`;
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
