type NativeNotificationOptions = {
  title: string;
  body?: string;
  tag?: string;
  urgency?: 'normal' | 'critical';
};

type AgentCompletionNotification = {
  provider?: string | null;
  projectName?: string | null;
  sessionName?: string | null;
  sessionId?: string | null;
  exitCode?: number | null;
  aborted?: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
};

const recentNativeNotificationTags = new Map<string, number>();
const NATIVE_NOTIFICATION_DEDUPE_MS = 5000;

const normalizePart = (value?: string | null, fallback = '') => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
};

const providerLabel = (provider?: string | null) => {
  const normalized = normalizePart(provider).toLowerCase();
  return PROVIDER_LABELS[normalized] || normalizePart(provider, 'Agent');
};

const shouldSuppressDuplicate = (tag: string) => {
  const now = Date.now();
  const previous = recentNativeNotificationTags.get(tag) || 0;
  recentNativeNotificationTags.set(tag, now);
  return now - previous < NATIVE_NOTIFICATION_DEDUPE_MS;
};

async function showNativeNotification(options: NativeNotificationOptions) {
  if (!options.title.trim()) return;
  const tag = options.tag || options.title;
  if (shouldSuppressDuplicate(tag)) return;

  const desktopNotify = window.argusDesktop?.notify;
  if (desktopNotify) {
    try {
      await desktopNotify(options);
    } catch (error) {
      console.warn('Native notification failed:', error);
    }
    return;
  }

  const WebNotification = window.Notification;
  if (!WebNotification || WebNotification.permission !== 'granted') {
    return;
  }

  new WebNotification(options.title, {
    body: options.body,
    tag,
    silent: false,
  });
}

export async function notifyAgentCompletion({
  provider,
  projectName,
  sessionName,
  sessionId,
  exitCode,
  aborted,
}: AgentCompletionNotification) {
  if (aborted || typeof window === 'undefined') {
    return;
  }

  const providerText = providerLabel(provider);
  const success = exitCode == null || exitCode === 0;
  const projectText = normalizePart(projectName, '当前项目');
  const sessionText = normalizePart(sessionName);
  const title = success ? 'Argus：任务已完成' : 'Argus：任务已结束';
  const suffix = success ? `${providerText} 已完成回复` : `${providerText} 已结束，退出码 ${exitCode}`;
  const body = [projectText, sessionText, suffix].filter(Boolean).join(' · ');
  const tag = `argus-run-complete:${normalizePart(provider, 'agent')}:${projectText}:${sessionId || sessionText || 'session'}`;

  await showNativeNotification({
    title,
    body,
    tag,
    urgency: success ? 'normal' : 'critical',
  });
}
