import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('system prompt dump CLI', () => {
  test('keeps --dump-system-prompt available in packaged builds', async () => {
    const cliSource = await readFile(
      resolve(repoRoot, 'src', 'entrypoints', 'cli.tsx'),
      'utf8',
    )

    expect(cliSource).toContain("args[0] === '--dump-system-prompt'")
    expect(cliSource).not.toContain(
      "feature('DUMP_SYSTEM_PROMPT') && args[0] === '--dump-system-prompt'",
    )
  })
})
