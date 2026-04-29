import { FileIcon, XIcon } from 'lucide-react';

interface FileAttachmentProps {
  file: File;
  onRemove: () => void;
  error?: string;
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / (1024 ** exponent);
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

const FileAttachment = ({ file, onRemove, error }: FileAttachmentProps) => {
  return (
    <div
      className="group flex h-12 min-w-0 max-w-[260px] items-center gap-2 rounded-lg border border-border/70 bg-background px-2.5 py-2 shadow-sm"
      title={error || `${file.name} (${formatFileSize(file.size)})`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <FileIcon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{file.name}</span>
        <span className={error ? 'block truncate text-[11px] text-destructive' : 'block truncate text-[11px] text-muted-foreground'}>
          {error || formatFileSize(file.size)}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-100 transition-colors hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Remove file"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

export default FileAttachment;
