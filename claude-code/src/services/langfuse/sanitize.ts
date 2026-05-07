const MAX_OUTPUT_LENGTH = 500
const REDACTED_FILE_TOOLS = new Set(['FileReadTool', 'FileWriteTool', 'FileEditTool'])
const REDACTED_SHELL_TOOLS = new Set(['BashTool', 'PowerShellTool'])
const SENSITIVE_OUTPUT_TOOLS = new Set(['ConfigTool', 'MCPTool'])

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const HOME_DIR_PATTERNS = [
  process.env.HOME,
  process.env.USERPROFILE,
]
  .filter((value): value is string => Boolean(value))
  .map(value => new RegExp(escapeRegExp(value), 'g'))

const FALLBACK_HOME_DIR_PATTERN = /\/Users\/[^/\\]+|\/home\/[^/\\]+/g

const SENSITIVE_KEY_PATTERN = /(?:api_?key|token|secret|password|credential|auth_header)/i

export function sanitizeGlobal(data: unknown): unknown {
  if (typeof data === 'string') {
    return sanitizeHomeDir(data)
  }
  if (typeof data === 'object' && data !== null) {
    return sanitizeObject(data as Record<string, unknown>)
  }
  return data
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'string') {
      result[key] = sanitizeHomeDir(value)
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

export function sanitizeToolInput(toolName: string, input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input
  const obj = { ...(input as Record<string, unknown>) }

  for (const key of Object.keys(obj)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      obj[key] = '[REDACTED]'
    }
  }

  for (const key of ['file_path', 'path', 'directory'] as const) {
    if (key in obj && typeof obj[key] === 'string') {
      obj[key] = sanitizeHomeDir(obj[key] as string)
    }
  }
  return obj
}

function sanitizeHomeDir(value: string): string {
  let result = value
  for (const pattern of HOME_DIR_PATTERNS) {
    result = result.replace(pattern, '~')
  }
  return result.replace(FALLBACK_HOME_DIR_PATTERN, '~')
}

export function sanitizeToolOutput(toolName: string, output: string): string {
  if (REDACTED_FILE_TOOLS.has(toolName)) {
    return `[file content redacted, ${output.length} chars]`
  }
  if (REDACTED_SHELL_TOOLS.has(toolName)) {
    if (output.length > MAX_OUTPUT_LENGTH) {
      return output.slice(0, MAX_OUTPUT_LENGTH) + '\n[truncated]'
    }
  }
  if (SENSITIVE_OUTPUT_TOOLS.has(toolName)) {
    return `[${toolName} output redacted, ${output.length} chars]`
  }
  return output
}
