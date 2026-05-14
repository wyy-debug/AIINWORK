import React, {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';
import { Code2, Copy, ExternalLink, FolderOpen, type LucideIcon } from 'lucide-react';

import { cn } from '../../../../lib/utils';
import { api } from '../../../../utils/api';
import { normalizeInlineCodeFences } from '../../utils/chatFormatting';
import {
  formatInlineFileReferenceLabel,
  parseInlineFileReference,
  selectDefaultFileOpenTool,
  type InlineFileReference as ParsedInlineFileReference,
  type LocalFileOpenToolStatus,
} from '../../utils/markdownFileReferences';
import { copyTextToClipboard } from '../../../../utils/clipboard';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  projectName?: string;
};

type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  projectName?: string;
};

type InlineFileReferenceProps = {
  label: string;
  reference: ParsedInlineFileReference;
  className?: string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  projectName?: string;
};

type InlineFileMenuAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void | Promise<unknown>;
  showDividerBefore?: boolean;
};

const INLINE_FILE_CONTEXT_MENU_WIDTH = 224;
const INLINE_FILE_CONTEXT_MENU_HEIGHT = 176;
const INLINE_FILE_CONTEXT_MENU_PADDING = 10;
const INLINE_FILE_MENU_LABELS = {
  menu: '\u6587\u4ef6\u64cd\u4f5c',
  open: '\u6253\u5f00',
  openInVSCode: '\u5728 VS Code \u4e2d\u6253\u5f00',
  copyPath: '\u590d\u5236\u8def\u5f84',
  revealInExplorer: '\u5728\u8d44\u6e90\u7ba1\u7406\u5668\u4e2d\u6253\u5f00',
};

const openLocalToolFile = api.openLocalToolFile as (payload: {
  tool?: string;
  filePath: string;
  projectName?: string;
  line?: number | null;
  column?: number | null;
}) => Promise<Response>;

let defaultFileOpenToolPromise: Promise<string> | null = null;

async function getDefaultFileOpenTool() {
  if (!defaultFileOpenToolPromise) {
    defaultFileOpenToolPromise = api.localTools()
      .then(async (response: Response) => {
        if (!response.ok) {
          return selectDefaultFileOpenTool();
        }
        const data = await response.json().catch(() => ({}));
        return selectDefaultFileOpenTool(Array.isArray(data?.tools) ? data.tools as LocalFileOpenToolStatus[] : []);
      })
      .catch(() => selectDefaultFileOpenTool());
  }

  return defaultFileOpenToolPromise;
}

function getInlineFileExtension(filePath: string) {
  const basename = filePath.split(/[\\/]/).pop() || filePath;
  const match = basename.match(/\.([A-Za-z0-9]+)$/);
  return (match?.[1] || 'file').slice(0, 2).toUpperCase();
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function reportInlineFileOpenError(error: unknown) {
  const message = getErrorMessage(error, 'Failed to open file');
  console.error('Inline file action failed:', error);
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(message);
  }
}

function calculateInlineFileMenuPosition(clientX: number, clientY: number) {
  const safeX =
    clientX + INLINE_FILE_CONTEXT_MENU_WIDTH > window.innerWidth
      ? window.innerWidth - INLINE_FILE_CONTEXT_MENU_WIDTH - INLINE_FILE_CONTEXT_MENU_PADDING
      : clientX;
  const safeY =
    clientY + INLINE_FILE_CONTEXT_MENU_HEIGHT > window.innerHeight
      ? window.innerHeight - INLINE_FILE_CONTEXT_MENU_HEIGHT - INLINE_FILE_CONTEXT_MENU_PADDING
      : clientY;

  return {
    x: Math.max(INLINE_FILE_CONTEXT_MENU_PADDING, safeX),
    y: Math.max(INLINE_FILE_CONTEXT_MENU_PADDING, safeY),
  };
}

function FileReferenceIcon({ filePath }: { filePath: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[3px] bg-blue-600 px-[2px] font-sans text-[7px] font-bold leading-none text-white shadow-sm dark:bg-blue-500"
    >
      {getInlineFileExtension(filePath)}
    </span>
  );
}

function InlineFileReference({
  label,
  reference,
  className,
  onFileOpen,
  projectName,
}: InlineFileReferenceProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const displayLabel = formatInlineFileReferenceLabel(reference);

  const openInApp = useCallback(() => {
    onFileOpen?.(reference.path);
  }, [onFileOpen, reference.path]);

  const openWithLocalTool = useCallback(async (tool: string) => {
    const response = await openLocalToolFile({
      tool,
      filePath: reference.path,
      projectName: projectName || '',
      line: reference.line,
      column: reference.column,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `Failed to open file: ${response.status}`);
    }
  }, [projectName, reference.column, reference.line, reference.path]);

  const openInDefaultLocalEditor = useCallback(async () => {
    try {
      await openWithLocalTool(await getDefaultFileOpenTool());
    } catch (error) {
      if (onFileOpen) {
        openInApp();
        return;
      }
      throw error;
    }
  }, [onFileOpen, openInApp, openWithLocalTool]);

  const openInVSCode = useCallback(() => openWithLocalTool('vscode'), [openWithLocalTool]);

  const revealInExplorer = useCallback(async () => {
    const response = await api.openLocalPath({
      filePath: reference.path,
      projectName: projectName || '',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `Failed to open path: ${response.status}`);
    }
  }, [projectName, reference.path]);

  const closeContextMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  const runMenuActionAndClose = useCallback(
    (action: () => void | Promise<unknown>) => {
      closeContextMenu();
      void Promise.resolve(action()).catch((error) => {
        reportInlineFileOpenError(error);
      });
    },
    [closeContextMenu],
  );

  const runInlineFileAction = useCallback(
    (action: () => void | Promise<unknown>) => {
      void Promise.resolve(action()).catch((error) => {
        reportInlineFileOpenError(error);
      });
    },
    [],
  );

  const openContextMenuAtCursor = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuPosition(calculateInlineFileMenuPosition(event.clientX, event.clientY));
    setIsMenuOpen(true);
  }, []);

  const menuActions = useMemo<InlineFileMenuAction[]>(
    () => [
      {
        key: 'open',
        label: INLINE_FILE_MENU_LABELS.open,
        icon: Code2,
        onSelect: openInDefaultLocalEditor,
      },
      {
        key: 'openInVSCode',
        label: INLINE_FILE_MENU_LABELS.openInVSCode,
        icon: ExternalLink,
        onSelect: openInVSCode,
      },
      {
        key: 'copyPath',
        label: INLINE_FILE_MENU_LABELS.copyPath,
        icon: Copy,
        onSelect: () => copyTextToClipboard(reference.path),
        showDividerBefore: true,
      },
      {
        key: 'revealInExplorer',
        label: INLINE_FILE_MENU_LABELS.revealInExplorer,
        icon: FolderOpen,
        onSelect: revealInExplorer,
      },
    ],
    [openInDefaultLocalEditor, openInVSCode, reference.path, revealInExplorer],
  );

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleOutsideMouseDown = (event: MouseEvent) => {
      const menuElement = menuRef.current;
      if (menuElement && !menuElement.contains(event.target as Node)) {
        closeContextMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    };

    document.addEventListener('mousedown', handleOutsideMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu, isMenuOpen]);

  const title = reference.line
    ? `${reference.path}:${reference.line}${reference.column ? `:${reference.column}` : ''}`
    : reference.path;

  return (
    <>
      <button
        type="button"
        title={title}
        onClick={() => runInlineFileAction(openInDefaultLocalEditor)}
        onContextMenu={openContextMenuAtCursor}
        className={cn(
          'inline-flex max-w-[220px] cursor-pointer items-center gap-1 align-baseline font-sans text-[0.95em] font-semibold text-blue-600 transition-colors hover:text-blue-700 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 dark:text-blue-400 dark:hover:text-blue-300 sm:max-w-[280px]',
          className,
        )}
      >
        <FileReferenceIcon filePath={reference.path} />
        <span className="truncate">{displayLabel || label}</span>
      </button>

      {isMenuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={INLINE_FILE_MENU_LABELS.menu}
          style={{ position: 'fixed', left: menuPosition.x, top: menuPosition.y, zIndex: 9999 }}
          className="min-w-[210px] rounded-lg border border-border bg-popover px-1 py-1 text-popover-foreground shadow-lg"
        >
          {menuActions.map((action) => (
            <Fragment key={action.key}>
              {action.showDividerBefore && <div className="mx-2 my-1 h-px bg-border" />}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
                onClick={() => runMenuActionAndClose(action.onSelect)}
              >
                <action.icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1">{action.label}</span>
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}

const CodeBlock = ({ node, inline, className, children, onFileOpen, projectName, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const inlineDetected = inline || (node && node.type === 'inlineCode');
  const shouldInline = inlineDetected || !looksMultiline;

  if (shouldInline) {
    const inlineFileReference = parseInlineFileReference(raw);

    if (inlineFileReference) {
      return (
        <InlineFileReference
          label={raw}
          reference={inlineFileReference}
          className={className}
          onFileOpen={onFileOpen}
          projectName={projectName}
        />
      );
    }

    return (
      <code
        className={`whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-gray-900 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-100 ${className || ''
          }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : 'text';

  return (
    <div className="group relative my-2">
      {language && language !== 'text' && (
        <div className="absolute left-3 top-2 z-10 text-xs font-medium uppercase text-gray-400">{language}</div>
      )}

      <button
        type="button"
        onClick={() =>
          copyTextToClipboard(raw).then((success) => {
            if (success) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          })
        }
        className="absolute right-2 top-2 z-10 rounded-md border border-gray-600 bg-gray-700/80 px-2 py-1 text-xs text-white opacity-0 transition-opacity hover:bg-gray-700 focus:opacity-100 active:opacity-100 group-hover:opacity-100"
        title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('codeBlock.copied')}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
            {t('codeBlock.copy')}
          </span>
        )}
      </button>

      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

const baseMarkdownComponents = {
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-2 border-l-4 border-gray-300 pl-4 italic text-gray-600 dark:border-gray-600 dark:text-gray-400">
      {children}
    </blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border border-gray-200 px-3 py-2 text-left text-sm font-semibold dark:border-gray-700">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border border-gray-200 px-3 py-2 align-top text-sm dark:border-gray-700">{children}</td>
  ),
};

export function Markdown({ children, className, onFileOpen, projectName }: MarkdownProps) {
  const content = normalizeInlineCodeFences(String(children ?? ''));
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);
  const markdownComponents = useMemo(
    () => ({
      ...baseMarkdownComponents,
      code: (props: CodeBlockProps) => (
        <CodeBlock
          {...props}
          onFileOpen={onFileOpen}
          projectName={projectName}
        />
      ),
    }),
    [onFileOpen, projectName],
  );

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
