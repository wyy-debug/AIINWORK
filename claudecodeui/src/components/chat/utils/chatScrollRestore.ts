export type ScrollRestoreFallbackMode = 'height-diff' | 'top';

export interface ScrollRestoreState {
  height: number;
  top: number;
  anchorKey?: string | null;
  anchorOffset?: number;
  attemptsLeft?: number;
  fallbackMode?: ScrollRestoreFallbackMode;
}

export interface ScrollAnchorBox {
  key: string;
  top: number;
  bottom: number;
}

export function captureViewportAnchor({
  containerTop,
  elements,
  visibilityMargin = 8,
}: {
  containerTop: number;
  elements: ScrollAnchorBox[];
  visibilityMargin?: number;
}): { anchorKey: string | null; anchorOffset?: number } {
  const anchor = elements.find((element) => element.bottom >= containerTop + visibilityMargin);
  if (!anchor) {
    return { anchorKey: null };
  }

  return {
    anchorKey: anchor.key,
    anchorOffset: anchor.top - containerTop,
  };
}

export function getRestoredScrollTop({
  state,
  current,
}: {
  state: ScrollRestoreState;
  current: {
    scrollHeight: number;
    scrollTop: number;
    containerTop: number;
    anchors: ScrollAnchorBox[];
  };
}): number {
  if (state.anchorKey) {
    const anchor = current.anchors.find((element) => element.key === state.anchorKey);
    if (anchor) {
      const currentOffset = anchor.top - current.containerTop;
      return Math.max(0, current.scrollTop + currentOffset - (state.anchorOffset || 0));
    }
  }

  if (state.fallbackMode === 'height-diff') {
    return Math.max(0, state.top + (current.scrollHeight - state.height));
  }

  return Math.max(0, state.top);
}

export function shouldPreserveViewport({
  isUserScrolledUp,
  isNearBottom,
}: {
  isUserScrolledUp: boolean;
  isNearBottom: boolean;
}): boolean {
  return isUserScrolledUp || !isNearBottom;
}

export function shouldAutoFillHistory({
  hasMoreMessages,
  allMessagesLoaded,
  isLoadingMoreMessages,
  isSessionLoading,
  hasPendingRestore,
  searchScrollActive,
  pagesLoadedForSession,
  maxPagesPerSession,
  scrollHeight,
  clientHeight,
  slack = 24,
}: {
  hasMoreMessages: boolean;
  allMessagesLoaded: boolean;
  isLoadingMoreMessages: boolean;
  isSessionLoading: boolean;
  hasPendingRestore: boolean;
  searchScrollActive: boolean;
  pagesLoadedForSession: number;
  maxPagesPerSession: number;
  scrollHeight: number;
  clientHeight: number;
  slack?: number;
}): boolean {
  if (!hasMoreMessages || allMessagesLoaded) return false;
  if (isLoadingMoreMessages || isSessionLoading || hasPendingRestore || searchScrollActive) return false;
  if (pagesLoadedForSession >= maxPagesPerSession) return false;
  return scrollHeight <= clientHeight + slack;
}
