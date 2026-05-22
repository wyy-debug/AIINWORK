export type WorkflowArtifactGalleryItem = {
  id: string;
  title: string;
  type: string;
  nodeTitle: string;
  path: string;
  summary: string;
  createdAt?: unknown;
};

type WorkflowArtifactGalleryProps = {
  artifacts: WorkflowArtifactGalleryItem[];
  onCopyArtifactReference: (artifact: WorkflowArtifactGalleryItem) => void;
  onAttachArtifactEvidence: (artifact: WorkflowArtifactGalleryItem) => void;
};

export function WorkflowArtifactGallery({
  artifacts,
  onCopyArtifactReference,
  onAttachArtifactEvidence,
}: WorkflowArtifactGalleryProps) {
  return (
    <div className="rounded border border-border p-2" data-testid="workflow-artifact-gallery">
      {artifacts.length > 0 ? (
        <div className="space-y-2">
          {artifacts.map((artifact) => (
            <div key={artifact.id} className="rounded border border-border bg-background/70 p-2" data-testid="workflow-artifact-gallery-row">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">{artifact.title}</span>
                  <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">{artifact.type} · {artifact.nodeTitle}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                    data-testid="workflow-artifact-copy-path"
                    onClick={() => onCopyArtifactReference(artifact)}
                  >
                    Copy path
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                    data-testid="workflow-artifact-attach-evidence"
                    onClick={() => onAttachArtifactEvidence(artifact)}
                  >
                    Attach evidence
                  </button>
                </div>
              </div>
              <p className="mt-1 truncate text-muted-foreground">{artifact.path || artifact.summary || artifact.id}</p>
            </div>
          ))}
        </div>
      ) : (
        <span>No artifacts yet.</span>
      )}
    </div>
  );
}
