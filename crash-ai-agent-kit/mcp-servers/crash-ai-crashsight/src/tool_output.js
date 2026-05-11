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
    '- 直接使用本工具响应中的 CRASH_AI_DIRECT_REPORT 和 CRASH_AI_AGENT_CONTEXT_JSON。',
    '- 不要运行 Python、PowerShell、Read 或 shell 命令反读本地保存的工具结果文件。',
    '- 最终报告必须保留事实表的每一行；不要用范围行、合并行、概括行替代低频 Crash。',
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
    redmineLinks: row.redmineLinks,
    redmineStatus: row.redmineStatus,
    redmineOwner: row.redmineOwner,
  };
}
