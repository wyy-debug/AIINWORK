export async function call(): Promise<{ type: 'text'; value: string }> {
  return {
    type: 'text',
    value:
      'Native Claude extra usage is disabled. Argus uses the configured custom model runtime.',
  }
}
