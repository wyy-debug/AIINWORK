import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  captureViewportAnchor,
  getRestoredScrollTop,
  shouldAutoFillHistory,
  shouldDeferInitialScrollToBottom,
  shouldPreserveViewport,
} from './chatScrollRestore';

describe('chat scroll restoration', () => {
  it('captures the first visible message as the viewport anchor', () => {
    const anchor = captureViewportAnchor({
      containerTop: 100,
      elements: [
        { key: 'above', top: 40, bottom: 90 },
        { key: 'first-visible', top: 96, bottom: 160 },
        { key: 'later', top: 180, bottom: 240 },
      ],
    });

    expect(anchor).toEqual({
      anchorKey: 'first-visible',
      anchorOffset: -4,
    });
  });

  it('keeps the anchored message stable when streaming grows content below the viewport', () => {
    const restoredTop = getRestoredScrollTop({
      state: {
        height: 1000,
        top: 300,
        anchorKey: 'visible-message',
        anchorOffset: 24,
        fallbackMode: 'top',
      },
      current: {
        scrollHeight: 1400,
        scrollTop: 300,
        containerTop: 100,
        anchors: [{ key: 'visible-message', top: 124, bottom: 180 }],
      },
    });

    expect(restoredTop).toBe(300);
  });

  it('moves scrollTop only by the anchor displacement when older messages prepend above the viewport', () => {
    const restoredTop = getRestoredScrollTop({
      state: {
        height: 1000,
        top: 300,
        anchorKey: 'visible-message',
        anchorOffset: 24,
        fallbackMode: 'height-diff',
      },
      current: {
        scrollHeight: 1300,
        scrollTop: 300,
        containerTop: 100,
        anchors: [{ key: 'visible-message', top: 324, bottom: 380 }],
      },
    });

    expect(restoredTop).toBe(500);
  });

  it('falls back to top preservation for streaming when the anchor is unavailable', () => {
    const restoredTop = getRestoredScrollTop({
      state: {
        height: 1000,
        top: 300,
        anchorKey: 'missing',
        anchorOffset: 24,
        fallbackMode: 'top',
      },
      current: {
        scrollHeight: 1400,
        scrollTop: 300,
        containerTop: 100,
        anchors: [],
      },
    });

    expect(restoredTop).toBe(300);
  });

  it('preserves the viewport whenever the user is scrolled up, even if global auto-scroll is enabled', () => {
    expect(shouldPreserveViewport({ isUserScrolledUp: true, isNearBottom: true })).toBe(true);
    expect(shouldPreserveViewport({ isUserScrolledUp: false, isNearBottom: false })).toBe(true);
    expect(shouldPreserveViewport({ isUserScrolledUp: false, isNearBottom: true })).toBe(false);
  });

  it('auto-fills at most one history page per session without explicit scroll intent', () => {
    const base = {
      hasMoreMessages: true,
      allMessagesLoaded: false,
      isLoadingMoreMessages: false,
      isSessionLoading: false,
      hasPendingRestore: false,
      searchScrollActive: false,
      scrollHeight: 400,
      clientHeight: 500,
      maxPagesPerSession: 1,
    };

    expect(shouldAutoFillHistory({ ...base, pagesLoadedForSession: 0 })).toBe(true);
    expect(shouldAutoFillHistory({ ...base, pagesLoadedForSession: 1 })).toBe(false);
    expect(shouldAutoFillHistory({ ...base, pagesLoadedForSession: 0, scrollHeight: 700 })).toBe(false);
  });

  it('keeps initial scroll pending until the first messages render', () => {
    expect(shouldDeferInitialScrollToBottom({
      hasPendingInitialScroll: true,
      isSessionLoading: false,
      messageCount: 0,
    })).toBe(true);
    expect(shouldDeferInitialScrollToBottom({
      hasPendingInitialScroll: true,
      isSessionLoading: true,
      messageCount: 20,
    })).toBe(true);
    expect(shouldDeferInitialScrollToBottom({
      hasPendingInitialScroll: true,
      isSessionLoading: false,
      messageCount: 20,
    })).toBe(false);
  });
});

describe('ChatMessagesPane scroll container contract', () => {
  it('keeps the message pane as a constrained internal scroll container', () => {
    const currentFile = fileURLToPath(import.meta.url);
    const panePath = resolve(dirname(currentFile), '../view/subcomponents/ChatMessagesPane.tsx');
    const source = readFileSync(panePath, 'utf8');

    expect(source).toContain('min-h-0');
    expect(source).toContain('overflow-y-scroll');
    expect(source).toContain('scrollbar-gutter:stable');
  });
});
