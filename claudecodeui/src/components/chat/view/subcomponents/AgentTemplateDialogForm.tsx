import type { AgentTemplateDialogField, AgentTemplateDialogSchema } from '../../../../types/agent';
import {
  collectDialogAnswersWithPreset,
  getDefaultDialogPresetId,
  hasDialogFields,
  hasDialogInteraction,
  hasDialogPresets,
  type DialogAnswers,
  type DialogAnswerValue,
} from '../../utils/agentTemplateDialogs';

type AgentTemplateDialogFormProps = {
  schema?: AgentTemplateDialogSchema;
  answers: DialogAnswers;
  selectedPresetId?: string;
  titleFallback?: string;
  onAnswersChange: (answers: DialogAnswers) => void;
  onPresetChange?: (presetId: string) => void;
};

function renderDialogField(
  field: AgentTemplateDialogField,
  value: DialogAnswerValue | undefined,
  onChange: (fieldId: string, value: DialogAnswerValue) => void,
) {
  const baseClass = 'h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary';
  const stringValue = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  if (field.type === 'textarea') {
    return (
      <textarea
        value={stringValue}
        placeholder={field.placeholder}
        onChange={(event) => onChange(field.id, event.target.value)}
        className="min-h-20 min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
      />
    );
  }
  if (field.type === 'select' || field.type === 'mcpServer' || field.type === 'skill' || field.type === 'modelProfile') {
    return (
      <select
        value={stringValue}
        onChange={(event) => onChange(field.id, event.target.value)}
        className={baseClass}
      >
        <option value="">{field.placeholder || 'Select value'}</option>
        {(field.options || []).map((option) => (
          <option key={`${field.id}:${option}`} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="flex min-w-0 flex-wrap gap-2">
        {(field.options || []).map((option) => {
          const checked = selected.includes(option);
          return (
            <label key={`${field.id}:${option}`} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option]
                    : selected.filter((item) => item !== option);
                  onChange(field.id, next);
                }}
              />
              <span className="min-w-0 break-words">{option}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (field.type === 'boolean') {
    return (
      <label className="inline-flex min-w-0 items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(field.id, event.target.checked)}
        />
        <span className="min-w-0 break-words">{field.placeholder || 'Enabled'}</span>
      </label>
    );
  }
  return (
    <input
      type={field.type === 'number' ? 'number' : 'text'}
      value={stringValue}
      placeholder={field.placeholder}
      onChange={(event) => onChange(field.id, field.type === 'number' ? Number(event.target.value) : event.target.value)}
      className={baseClass}
    />
  );
}

export default function AgentTemplateDialogForm({
  schema,
  answers,
  selectedPresetId,
  titleFallback = 'Template configuration',
  onAnswersChange,
  onPresetChange,
}: AgentTemplateDialogFormProps) {
  if (!hasDialogInteraction(schema)) return null;

  const effectivePresetId = selectedPresetId || getDefaultDialogPresetId(schema);
  const updateAnswer = (fieldId: string, value: DialogAnswerValue) => {
    onAnswersChange({
      ...answers,
      [fieldId]: value,
    });
  };
  const selectPreset = (presetId: string) => {
    onPresetChange?.(presetId);
    onAnswersChange(collectDialogAnswersWithPreset(schema, presetId));
  };

  return (
    <div className="mt-5 rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-3">
        <h4 className="break-words text-sm font-semibold text-foreground">{schema?.title || titleFallback}</h4>
        {schema?.description && (
          <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{schema.description}</p>
        )}
      </div>
      {hasDialogPresets(schema) && (
        <label className="mb-3 grid gap-2 sm:grid-cols-[132px_1fr] sm:items-center">
          <span className="min-w-0 text-sm font-medium text-foreground">Preset</span>
          <select
            value={effectivePresetId}
            onChange={(event) => selectPreset(event.target.value)}
            className="h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
          >
            {schema!.presets!.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>
      )}
      {hasDialogFields(schema) && (
        <div className="grid gap-3">
          {schema!.fields.map((field) => (
            <label key={field.id} className="grid min-w-0 gap-2 sm:grid-cols-[132px_1fr] sm:items-start">
              <span className="min-w-0 break-words text-sm font-medium text-foreground">
                {field.label}
                {field.required && <span className="ml-1 text-red-500">*</span>}
              </span>
              <span className="grid min-w-0 gap-1">
                {renderDialogField(field, answers[field.id], updateAnswer)}
                {field.description && <span className="break-words text-[11px] leading-4 text-muted-foreground">{field.description}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
