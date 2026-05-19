export type InlineFileReference = {
  path: string;
  line: number | null;
  column: number | null;
};

export type LocalFileOpenToolStatus = {
  id?: string;
  kind?: string;
  available?: boolean;
};

export type FileOpenToolId = 'vscode' | 'visualstudio' | 'cursor' | 'antigravity';

export const DEFAULT_FILE_OPEN_TOOL: FileOpenToolId = 'vscode';
export const FILE_OPEN_TOOL_ORDER: FileOpenToolId[] = ['vscode', 'visualstudio', 'cursor', 'antigravity'];

const LINE_COLUMN_SUFFIX_RE = /:(\d+)(?::(\d+))?$/;
const BASENAME_FILE_RE = /^(?:[A-Za-z0-9_.@+~ -]+|\.[A-Za-z0-9_.@+~ -]+)\.[A-Za-z0-9]{1,12}$/;
const SPECIAL_FILE_RE = /^(?:README|LICENSE|CHANGELOG|Dockerfile|Makefile|Gemfile|Rakefile)(?:\.[A-Za-z0-9]{1,12})?$/i;
const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:[\\/]/;
const WINDOWS_CONTROL_ESCAPE_RE = /[\t\b\f\v]/g;
const WINDOWS_CONTROL_ESCAPE_REPLACEMENTS: Record<string, string> = {
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
  '\v': '\\v',
};

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  const inner = trimmed.slice(1, -1);
  return (first === last && (first === '"' || first === '\'' || first === '`') && !inner.includes(first))
    ? trimmed.slice(1, -1).trim()
    : trimmed;
}

function stripTrailingInlinePunctuation(value: string) {
  return value.trim().replace(/[;,]+$/g, '').trim();
}

function extractAssignmentPathCandidate(value: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }
  if (WINDOWS_DRIVE_PATH_RE.test(value)) {
    return value;
  }

  const assignmentMatch = value.match(/^\s*[^=:\r\n]{1,100}\s*=\s*(.+)$/);
  if (assignmentMatch?.[1] && /[\\/]/.test(assignmentMatch[1])) {
    return stripWrappingQuotes(stripTrailingInlinePunctuation(assignmentMatch[1]));
  }

  const propertyMatch = value.match(/^\s*["'`]?[A-Za-z0-9_. -]{1,100}["'`]?\s*:\s*(.+)$/);
  if (propertyMatch?.[1] && /[\\/]/.test(propertyMatch[1])) {
    return stripWrappingQuotes(stripTrailingInlinePunctuation(propertyMatch[1]));
  }

  return value;
}

function hasFileLikeBasename(filePath: string) {
  const basename = filePath.split(/[\\/]/).pop() || filePath;
  return BASENAME_FILE_RE.test(basename) || SPECIAL_FILE_RE.test(basename);
}

function repairDecodedWindowsPathEscapes(value: string) {
  if (!WINDOWS_DRIVE_PATH_RE.test(value)) {
    return value;
  }

  return value.replace(
    WINDOWS_CONTROL_ESCAPE_RE,
    (controlCharacter) => WINDOWS_CONTROL_ESCAPE_REPLACEMENTS[controlCharacter] || controlCharacter,
  );
}

function getBasename(filePath: string) {
  return filePath.split(/[\\/]/).pop() || filePath;
}

function formatPathWithContext(filePath: string, maxSegments = 3) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const hasSeparator = normalizedPath.includes('/');
  if (!hasSeparator) {
    return getBasename(filePath);
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= maxSegments + 1) {
    return normalizedPath;
  }

  return `.../${segments.slice(-maxSegments).join('/')}`;
}

export function formatInlineFileReferenceLabel(reference: InlineFileReference) {
  const label = formatPathWithContext(reference.path);
  if (reference.line) {
    return `${label}:${reference.line}${reference.column ? `:${reference.column}` : ''}`;
  }
  return label;
}

export function selectDefaultFileOpenTool(tools: LocalFileOpenToolStatus[] = []): FileOpenToolId {
  if (tools.length === 0) {
    return DEFAULT_FILE_OPEN_TOOL;
  }

  const statusById = new Map(tools.map((tool) => [String(tool.id || '').toLowerCase(), tool]));
  const availableEditor = FILE_OPEN_TOOL_ORDER.find((toolId) => {
    const status = statusById.get(toolId);
    return status?.kind === 'editor' && status.available === true;
  });

  return availableEditor || DEFAULT_FILE_OPEN_TOOL;
}

export function parseInlineFileReference(rawValue: string): InlineFileReference | null {
  const value = repairDecodedWindowsPathEscapes(extractAssignmentPathCandidate(stripWrappingQuotes(rawValue)));
  if (!value || /[\r\n]/.test(value)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  if (/[(){}[\]]/.test(value)) return null;

  let path = value;
  let line: number | null = null;
  let column: number | null = null;
  const suffixMatch = value.match(LINE_COLUMN_SUFFIX_RE);
  if (suffixMatch?.index && suffixMatch.index > 0) {
    path = value.slice(0, suffixMatch.index);
    line = Number(suffixMatch[1]);
    column = suffixMatch[2] ? Number(suffixMatch[2]) : null;
  }

  path = path.trim();
  if (!path || path.endsWith(':')) return null;

  const hasPathSeparator = /[\\/]/.test(path);
  const looksFileLike = hasFileLikeBasename(path);

  if (!looksFileLike) return null;
  if (!hasPathSeparator && !BASENAME_FILE_RE.test(path) && !SPECIAL_FILE_RE.test(path)) return null;
  if (!hasPathSeparator && /\s/.test(path)) return null;

  const validLine = Number.isFinite(line) && line !== null && line > 0 ? line : null;
  const validColumn = Number.isFinite(column) && column !== null && column > 0 ? column : null;

  return {
    path,
    line: validLine,
    column: validColumn,
  };
}
