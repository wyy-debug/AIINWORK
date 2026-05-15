export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long'

export function isPromptTooLongErrorText(rawMessage: string): boolean {
  const message = rawMessage.toLowerCase()
  return (
    message.includes('prompt is too long') ||
    message.includes('input exceeds the context window') ||
    message.includes('exceeds the context window') ||
    message.includes('context window exceeded') ||
    message.includes('context length exceeded') ||
    message.includes('maximum context length') ||
    message.includes('too many tokens') ||
    /tokens?\s*(?:>|exceeds?|exceeded)\s*(?:the\s*)?(?:maximum|limit|context)/i.test(
      rawMessage,
    )
  )
}
