export type InlineFileReference = {
  path: string;
  line: number | null;
  column: number | null;
};

const LINE_COLUMN_SUFFIX_RE = /:(\d+)(?::(\d+))?$/;
const BASENAME_FILE_RE = /^(?:[A-Za-z0-9_.@+~ -]+|\.[A-Za-z0-9_.@+~ -]+)\.[A-Za-z0-9]{1,12}$/;
const SPECIAL_FILE_RE = /^(?:README|LICENSE|CHANGELOG|Dockerfile|Makefile|Gemfile|Rakefile)(?:\.[A-Za-z0-9]{1,12})?$/i;

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

export function parseInlineFileReference(rawValue: string): InlineFileReference | null {
  const value = stripWrappingQuotes(rawValue);
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
