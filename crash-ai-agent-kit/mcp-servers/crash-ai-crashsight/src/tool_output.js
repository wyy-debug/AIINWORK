export function formatCrashAiReportText(value = {}) {
  const { markdown = '', rows = [], summary = {}, redmine = [], errors = [], timingMs = {} } = value || {};
  const context = {
    summary,
    rowsCount: Array.isArray(rows) ? rows.length : 0,
    rowFacts: Array.isArray(rows) ? rows.map(toRowFact) : [],
    redmine,
    errors,
    timingMs,
  };
  return [
    'CRASH_AI_DIRECT_REPORT',
    markdown,
    '',
    'CRASH_AI_AGENT_CONTEXT_JSON',
    JSON.stringify(context),
    '',
    'CRASH_AI_OUTPUT_RULES',
    '- Use CRASH_AI_AGENT_CONTEXT_JSON directly from this tool response.',
    '- 不要运行 Python、PowerShell、Read 或 shell 命令反读本地保存的工具结果文件。',
    '- 最终只输出「目前存在问题」和「遗漏未开单问题」两段，按 android、pc、iOS 分组。',
    '- rowFacts.redmineRefs 非空的条目归入「目前存在问题」；为空的条目归入「遗漏未开单问题」。',
  ].join('\n');
}

export function asCrashAiReport(value = {}) {
  return {
    content: [{
      type: 'text',
      text: formatCrashAiReportText(value),
    }],
  };
}

function toRowFact(row = {}) {
  return {
    id: row.id,
    platform: row.platform,
    crashSightLink: row.crashSightLink,
    totalCrashNum: row.totalCrashNum,
    totalAffectedDevices: row.totalAffectedDevices,
    firstSeenTime: row.firstSeenTime,
    latestUploadTime: row.latestUploadTime,
    firstSeenVersion: row.firstSeenVersion,
    applicationVersion: row.applicationVersion,
    continuedVersionCount: row.continuedVersionCount,
    tags: row.tags,
    redmineRefs: row.redmineRefs,
    redmineLinks: row.redmineLinks,
    redmineStatus: row.redmineStatus,
    redmineOwner: row.redmineOwner,
  };
}
