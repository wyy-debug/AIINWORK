import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, KeyboardEvent, RefObject, SetStateAction } from 'react';
import { api } from '../../../utils/api';
import { escapeRegExp } from '../utils/chatFormatting';
import type { Project } from '../../../types/app';

export interface MentionableFile {
  name: string;
  path: string;
  relativePath?: string;
  type?: 'file' | 'directory';
}

interface UseFileMentionsOptions {
  selectedProject: Project | null;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

const FILE_MENTION_RESULT_LIMIT = 60;

const getActiveMention = (value: string, cursorPosition: number) => {
  const textBeforeCursor = value.slice(0, cursorPosition);
  const atSymbolPosition = textBeforeCursor.lastIndexOf('@');

  if (atSymbolPosition === -1) {
    return null;
  }

  const previousCharacter = textBeforeCursor[atSymbolPosition - 1];
  if (previousCharacter && !/[\s(\[{"':]/.test(previousCharacter)) {
    return null;
  }

  const query = textBeforeCursor.slice(atSymbolPosition + 1);
  if (/\s/.test(query)) {
    return null;
  }

  return {
    atSymbolPosition,
    query,
  };
};

export function useFileMentions({ selectedProject, input, setInput, textareaRef }: UseFileMentionsOptions) {
  const [fileMentions, setFileMentions] = useState<string[]>([]);
  const [filteredFiles, setFilteredFiles] = useState<MentionableFile[]>([]);
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [isLoadingFileMentions, setIsLoadingFileMentions] = useState(false);
  const [fileMentionError, setFileMentionError] = useState<string | null>(null);
  const [fileMentionQuery, setFileMentionQuery] = useState('');
  const [selectedFileIndex, setSelectedFileIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [atSymbolPosition, setAtSymbolPosition] = useState(-1);
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    const activeMention = getActiveMention(input, cursorPosition);
    const projectName = selectedProject?.name;
    if (!activeMention || !projectName) {
      searchRequestIdRef.current += 1;
      setShowFileDropdown(false);
      setAtSymbolPosition(-1);
      setFilteredFiles([]);
      setIsLoadingFileMentions(false);
      setFileMentionError(null);
      return;
    }

    const abortController = new AbortController();
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    const isCurrentRequest = () => searchRequestIdRef.current === requestId && !abortController.signal.aborted;
    const debounce = window.setTimeout(async () => {
      setIsLoadingFileMentions(true);
      setFileMentionError(null);

      try {
        const response = await api.searchFiles(projectName, activeMention.query, FILE_MENTION_RESULT_LIMIT, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`File search failed (${response.status})`);
        }

        const data = (await response.json()) as { files?: MentionableFile[] };
        if (!isCurrentRequest()) {
          return;
        }
        setFilteredFiles(Array.isArray(data.files) ? data.files : []);
        setSelectedFileIndex(0);
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError' || !isCurrentRequest()) {
          return;
        }
        console.error('Error searching project files:', error);
        setFilteredFiles([]);
        setFileMentionError(error instanceof Error ? error.message : 'File search failed');
      } finally {
        if (isCurrentRequest()) {
          setIsLoadingFileMentions(false);
        }
      }
    }, 120);

    setAtSymbolPosition(activeMention.atSymbolPosition);
    setFileMentionQuery(activeMention.query);
    setShowFileDropdown(true);
    setFilteredFiles([]);

    return () => {
      window.clearTimeout(debounce);
      abortController.abort();
    };
  }, [input, cursorPosition, selectedProject?.name]);

  const activeFileMentions = useMemo(() => {
    if (!input || fileMentions.length === 0) {
      return [];
    }
    return fileMentions.filter((path) => input.includes(path));
  }, [fileMentions, input]);

  const sortedFileMentions = useMemo(() => {
    if (activeFileMentions.length === 0) {
      return [];
    }
    const uniqueMentions = Array.from(new Set(activeFileMentions));
    return uniqueMentions.sort((mentionA, mentionB) => mentionB.length - mentionA.length);
  }, [activeFileMentions]);

  const fileMentionRegex = useMemo(() => {
    if (sortedFileMentions.length === 0) {
      return null;
    }
    const pattern = sortedFileMentions.map(escapeRegExp).join('|');
    return new RegExp(`(${pattern})`, 'g');
  }, [sortedFileMentions]);

  const fileMentionSet = useMemo(() => new Set(sortedFileMentions), [sortedFileMentions]);

  const renderInputWithMentions = useCallback(
    (text: string) => {
      if (!text) {
        return '';
      }
      if (!fileMentionRegex) {
        return text;
      }

      const parts = text.split(fileMentionRegex);
      return parts.map((part, index) =>
        fileMentionSet.has(part) ? (
          <span
            key={`mention-${index}`}
            className="-ml-0.5 rounded-md bg-blue-200/70 box-decoration-clone px-0.5 text-transparent dark:bg-blue-300/40"
          >
            {part}
          </span>
        ) : (
          <span key={`text-${index}`}>{part}</span>
        ),
      );
    },
    [fileMentionRegex, fileMentionSet],
  );

  const selectFile = useCallback(
    (file: MentionableFile) => {
      const textBeforeAt = input.slice(0, atSymbolPosition);
      const textAfterAtQuery = input.slice(atSymbolPosition);
      const spaceIndex = textAfterAtQuery.indexOf(' ');
      const textAfterQuery = spaceIndex !== -1 ? textAfterAtQuery.slice(spaceIndex) : '';
      const mentionText = `@${file.relativePath || file.path}`;

      const newInput = `${textBeforeAt}${mentionText} ${textAfterQuery}`;
      const newCursorPosition = textBeforeAt.length + mentionText.length + 1;

      if (textareaRef.current && !textareaRef.current.matches(':focus')) {
        textareaRef.current.focus();
      }

      setInput(newInput);
      setCursorPosition(newCursorPosition);
      setFileMentions((previousMentions) =>
        previousMentions.includes(mentionText) ? previousMentions : [...previousMentions, mentionText],
      );

      setShowFileDropdown(false);
      setAtSymbolPosition(-1);

      if (!textareaRef.current) {
        return;
      }

      requestAnimationFrame(() => {
        if (!textareaRef.current) {
          return;
        }
        textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
        if (!textareaRef.current.matches(':focus')) {
          textareaRef.current.focus();
        }
      });
    },
    [input, atSymbolPosition, textareaRef, setInput],
  );

  const handleFileMentionsKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showFileDropdown) {
        return false;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setShowFileDropdown(false);
        return true;
      }

      if (filteredFiles.length === 0) {
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedFileIndex((previousIndex) =>
          previousIndex < filteredFiles.length - 1 ? previousIndex + 1 : 0,
        );
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedFileIndex((previousIndex) =>
          previousIndex > 0 ? previousIndex - 1 : filteredFiles.length - 1,
        );
        return true;
      }

      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault();
        if (selectedFileIndex >= 0) {
          selectFile(filteredFiles[selectedFileIndex]);
        } else if (filteredFiles.length > 0) {
          selectFile(filteredFiles[0]);
        }
        return true;
      }

      return false;
    },
    [showFileDropdown, filteredFiles, selectedFileIndex, selectFile],
  );

  return {
    showFileDropdown,
    filteredFiles,
    fileMentionQuery,
    isLoadingFileMentions,
    fileMentionError,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    setCursorPosition,
    handleFileMentionsKeyDown,
  };
}
