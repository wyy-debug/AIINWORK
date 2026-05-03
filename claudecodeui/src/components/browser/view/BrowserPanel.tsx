import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Globe2, MessageSquarePlus, RefreshCw } from 'lucide-react';

import type { Project } from '../../../types/app';
import { apiFetch } from '../../../utils/api';
import { Button, Input, ScrollArea } from '../../../shared/view/ui';

type BrowserPanelProps = {
  selectedProject: Project;
  sessionId?: string | null;
};

type VisualComment = {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  body: string;
};

const isLocalUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    ) || url.protocol === 'file:';
  } catch {
    return false;
  }
};

export default function BrowserPanel({ selectedProject, sessionId }: BrowserPanelProps) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState('http://127.0.0.1:5173');
  const [activeUrl, setActiveUrl] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [pendingTarget, setPendingTarget] = useState<{ x: number; y: number; width?: number; height?: number } | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [comments, setComments] = useState<VisualComment[]>([]);
  const [commentMode, setCommentMode] = useState(false);
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState('');

  const canRenderFrame = useMemo(() => activeUrl && isLocalUrl(activeUrl), [activeUrl]);
  const projectPath = selectedProject.fullPath || selectedProject.path || '';

  const getPreviewBounds = useCallback(() => {
    const element = previewRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, []);

  const attachBrowser = useCallback(async (targetUrl = activeUrl || url) => {
    const bounds = getPreviewBounds();
    if (!bounds || !targetUrl || !window.argusDesktop?.browserAttach) return;
    const result = await window.argusDesktop.browserAttach({
      url: targetUrl,
      projectPath,
      bounds,
    });
    if (result?.error) throw new Error(result.error);
    if (result?.url && isLocalUrl(result.url)) {
      setUrl(result.url);
      setActiveUrl(result.url);
    }
  }, [activeUrl, getPreviewBounds, projectPath, url]);

  const resizeBrowser = useCallback(() => {
    const bounds = getPreviewBounds();
    if (!bounds || !activeUrl) return;
    void window.argusDesktop?.browserResize?.({ bounds });
  }, [activeUrl, getPreviewBounds]);

  useEffect(() => {
    if (!activeUrl || commentMode) return;
    void attachBrowser(activeUrl).catch((error) => setMessage(error instanceof Error ? error.message : 'Browser attach failed'));
  }, [activeUrl, attachBrowser, commentMode]);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return undefined;
    const resizeObserver = new ResizeObserver(resizeBrowser);
    resizeObserver.observe(element);
    window.addEventListener('resize', resizeBrowser);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', resizeBrowser);
      void window.argusDesktop?.browserDetach?.();
    };
  }, [resizeBrowser]);

  const appendToChat = (text: string) => {
    window.dispatchEvent(new CustomEvent('argus-attach-context', {
      detail: { source: 'preview', text },
    }));
    window.dispatchEvent(new CustomEvent('argus-append-chat-input', {
      detail: { text },
    }));
  };

  const openUrl = async () => {
    setMessage('');
    if (!isLocalUrl(url)) {
      setMessage('Browser v1 only allows localhost, 127.0.0.1, ::1, or file:// URLs.');
      return;
    }
	    setActiveUrl(url);
      await attachBrowser(url);
	  };

  useEffect(() => {
    const handleOpenPreview = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail || {};
      if (!detail.url || !isLocalUrl(detail.url)) {
        return;
      }
      setUrl(detail.url);
      setActiveUrl(detail.url);
      void attachBrowser(detail.url).catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Preview failed to open');
      });
    };

    const pendingUrl = sessionStorage.getItem('argus-preview-url') || '';
    if (pendingUrl && isLocalUrl(pendingUrl)) {
      sessionStorage.removeItem('argus-preview-url');
      setUrl(pendingUrl);
      setActiveUrl(pendingUrl);
      void attachBrowser(pendingUrl).catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Preview failed to open');
      });
    }

    window.addEventListener('argus-open-preview', handleOpenPreview);
    window.addEventListener('argus-open-panel', handleOpenPreview);
    return () => {
      window.removeEventListener('argus-open-preview', handleOpenPreview);
      window.removeEventListener('argus-open-panel', handleOpenPreview);
    };
  }, [attachBrowser]);

  const navigatePreview = async (direction: 'back' | 'forward' | 'refresh') => {
    setMessage('');
    try {
      const result = direction === 'back'
        ? await window.argusDesktop?.browserBack?.()
        : direction === 'forward'
          ? await window.argusDesktop?.browserForward?.()
          : await window.argusDesktop?.browserRefresh?.();
      if (result?.error) {
        throw new Error(result.error);
      }
	      if (result?.url && isLocalUrl(result.url)) {
	        setUrl(result.url);
	        setActiveUrl(result.url);
          await attachBrowser(result.url);
	      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Browser navigation failed');
    }
	  };

  const beginCommentMode = async () => {
    setCommentMode((value) => !value);
    if (commentMode) {
      await attachBrowser(activeUrl || url).catch(() => undefined);
      return;
    }
    if (!activeUrl && !url) return;
    try {
      const result = await window.argusDesktop?.browserScreenshot?.({
        url: activeUrl || url,
        projectPath,
      });
      if (result?.dataUrl) {
        setScreenshot(result.dataUrl);
        await window.argusDesktop?.browserDetach?.();
      }
    } catch {
      // Comment mode can still work over the visible placeholder if screenshot fails.
    }
  };

  const captureScreenshot = async () => {
    setMessage('');
    try {
      const result = await window.argusDesktop?.browserScreenshot?.({
        url: activeUrl || url,
        projectPath: selectedProject.fullPath || selectedProject.path || '',
      });
      if (!result || result.error) {
        throw new Error(result?.error || 'Desktop browser screenshot is unavailable.');
      }
      if (result.dataUrl) {
        setScreenshot(result.dataUrl);
        await apiFetch('/api/artifacts', {
          method: 'POST',
          body: JSON.stringify({
            kind: 'browser-screenshot',
            title: `Browser screenshot ${new Date().toLocaleString()}`,
            projectName: selectedProject.name,
            sessionId,
            content: result.dataUrl,
            metadata: { source: 'browser', url: activeUrl || url },
          }),
        });
        window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
        appendToChat(`Browser screenshot captured for ${activeUrl || url}. See the latest browser-screenshot artifact.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to capture screenshot');
    }
  };

  const saveVisualComment = async () => {
    if (!pendingTarget || !commentDraft.trim()) {
      return;
    }
    const comment = {
      id: `visual_${Date.now()}`,
      x: pendingTarget.x,
      y: pendingTarget.y,
      width: pendingTarget.width,
      height: pendingTarget.height,
      body: commentDraft.trim(),
    };
    setComments((previous) => [comment, ...previous]);
    setCommentDraft('');
    setPendingTarget(null);
    await apiFetch('/api/artifacts', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'visual-comment',
        title: `Visual comment on ${activeUrl || url}`,
        projectName: selectedProject.name,
        sessionId,
        content: `${comment.body}\n\nURL: ${activeUrl || url}\nTarget: ${comment.x}, ${comment.y}${comment.width && comment.height ? `, ${comment.width}x${comment.height}` : ''}`,
        metadata: {
          source: 'browser',
          url: activeUrl || url,
          x: comment.x,
          y: comment.y,
          width: comment.width,
          height: comment.height,
        },
      }),
    }).catch(() => undefined);
      window.dispatchEvent(new CustomEvent('argus-refresh-workflow-counts'));
	    appendToChat(`Visual comment: ${comment.body}\nURL: ${activeUrl || url}\nTarget: ${comment.x}, ${comment.y}${comment.width && comment.height ? `, ${comment.width}x${comment.height}` : ''}`);
      await attachBrowser(activeUrl || url).catch(() => undefined);
	  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-[64px] items-center gap-3 border-b border-border/70 px-5 py-3">
        <Globe2 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">Preview</span>
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void openUrl();
          }}
          placeholder="http://127.0.0.1:5173"
        />
        <Button variant="outline" size="sm" onClick={openUrl}>
          <RefreshCw className="h-4 w-4" />
          Open
        </Button>
        <Button variant="ghost" size="icon" onClick={() => navigatePreview('back')} disabled={!activeUrl}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => navigatePreview('forward')} disabled={!activeUrl}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => navigatePreview('refresh')} disabled={!activeUrl}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={captureScreenshot} disabled={!activeUrl && !url}>
          <Camera className="h-4 w-4" />
          Screenshot
        </Button>
	        <Button variant={commentMode ? 'default' : 'outline'} size="sm" onClick={() => void beginCommentMode()}>
          <MessageSquarePlus className="h-4 w-4" />
          Comment
        </Button>
      </div>

      {message && (
        <div className="border-b border-border/70 px-5 py-2 text-sm text-muted-foreground">{message}</div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_340px]">
	        <div ref={previewRef} className="relative min-h-0 bg-muted/20">
	          {canRenderFrame ? (
	            <>
                {commentMode && screenshot ? (
                  <img src={screenshot} alt="Browser comment target" className="h-full w-full object-contain bg-background" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Browser view attached to {activeUrl}
                  </div>
                )}
	              <div
                role="button"
                tabIndex={0}
                className={`absolute inset-0 cursor-crosshair bg-transparent ${commentMode ? '' : 'pointer-events-none'}`}
                aria-label="Add visual comment"
                onPointerDown={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setDragStart({
                    x: Math.round(event.clientX - rect.left),
                    y: Math.round(event.clientY - rect.top),
                  });
                }}
                onPointerUp={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const end = {
                    x: Math.round(event.clientX - rect.left),
                    y: Math.round(event.clientY - rect.top),
                  };
                  const start = dragStart || end;
                  const width = Math.abs(end.x - start.x);
                  const height = Math.abs(end.y - start.y);
                  setPendingTarget(width > 8 && height > 8
                    ? {
                      x: Math.min(start.x, end.x),
                      y: Math.min(start.y, end.y),
                      width,
                      height,
                    }
                    : end);
                  setDragStart(null);
                  setCommentMode(false);
                }}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Open a local URL to preview and comment.
            </div>
          )}

          {comments.map((comment) => (
            <div
              key={comment.id}
              className={comment.width && comment.height
                ? 'pointer-events-none absolute rounded border-2 border-primary bg-primary/10 shadow'
                : 'pointer-events-none absolute flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow'}
              style={comment.width && comment.height
                ? { left: comment.x, top: comment.y, width: comment.width, height: comment.height }
                : { left: comment.x, top: comment.y, transform: 'translate(-50%, -50%)' }}
            >
              {comment.width && comment.height ? null : '!'}
            </div>
          ))}
        </div>

        <aside className="flex min-h-0 flex-col border-l border-border/70">
          <div className="border-b border-border/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Visual comments</h3>
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-3">
              {pendingTarget && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="mb-2 text-xs text-muted-foreground">
                    Target {pendingTarget.x}, {pendingTarget.y}
                    {pendingTarget.width && pendingTarget.height ? `, ${pendingTarget.width}x${pendingTarget.height}` : ''}
                  </div>
                  <textarea
                    className="min-h-24 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="Leave a visual note for Argus..."
                  />
                  <Button className="mt-2" size="sm" onClick={saveVisualComment}>
                    Save comment
                  </Button>
                </div>
              )}
              {screenshot && (
                <img src={screenshot} alt="Browser screenshot" className="rounded-md border border-border/70" />
              )}
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Click or drag on the preview to place a visual comment.</p>
              ) : comments.map((comment) => (
                <div key={comment.id} className="rounded-md border border-border/70 bg-card p-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    Target {comment.x}, {comment.y}
                    {comment.width && comment.height ? `, ${comment.width}x${comment.height}` : ''}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-foreground">{comment.body}</div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
