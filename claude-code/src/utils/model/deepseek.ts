export function isDeepSeekModel(model: string | undefined): boolean {
  return typeof model === 'string' && model.toLowerCase().includes('deepseek')
}

export function isDeepSeekBaseUrl(
  baseUrl: string | undefined = process.env.ANTHROPIC_BASE_URL,
): boolean {
  if (!baseUrl) {
    return false
  }

  try {
    const url = new URL(baseUrl)
    return url.hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return baseUrl.toLowerCase().includes('api.deepseek.com')
  }
}

export function isDeepSeekAnthropicRuntime(
  model: string | undefined,
): boolean {
  return isDeepSeekModel(model) || isDeepSeekBaseUrl()
}
