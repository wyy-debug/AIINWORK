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
  return (first === last && (first === '"' || first === '\'' || first === '`'))
    ? trimmed.slice(1, -1).trim()
    : trimmed;
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

export function formatInlineFileReferenceLabel(reference: InlineFileReference) {
  const basename = getBasename(reference.path);
  if (reference.line) {
    return `${basename}:${reference.line}${reference.column ? `:${reference.column}` : ''}`;
  }
  return basename;
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
  const value = repairDecodedWindowsPathEscapes(stripWrappingQuotes(rawValue));
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
