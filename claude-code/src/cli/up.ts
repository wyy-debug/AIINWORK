import { readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { findGitRoot } from '../utils/git.js'

/**
 * `mtl-code up` - run the "# mtl-code up" section from the nearest MTL.md.
 *
 * Walks up from CWD looking for MTL.md files, extracts the section under the
 * `# mtl-code up` heading, and executes it as a shell script.
 *
 * ANT-only command (USER_TYPE === "ant").
 */
export async function up(): Promise<void> {
  const cwd = process.cwd()
  const gitRoot = findGitRoot(cwd)
  const searchDirs = gitRoot ? [gitRoot, cwd] : [cwd]

  let upSection: string | null = null

  for (const dir of searchDirs) {
    for (const memoryFile of ['MTL.md', 'CLAUDE.md']) {
      const memoryPath = join(dir, memoryFile)
      try {
        const content = readFileSync(memoryPath, 'utf-8')
        upSection = extractUpSection(content)
        if (upSection) {
          console.log(`Found "# mtl-code up" in ${memoryPath}`)
          break
        }
      } catch {
        // File not found - continue searching.
      }
    }
    if (upSection) {
      break
    }
  }

  if (!upSection) {
    console.log(
      'No "# mtl-code up" section found in MTL.md.\n' +
        'Add a section like:\n\n' +
        '  # mtl-code up\n' +
        '  ```bash\n' +
        '  npm install\n' +
        '  npm run build\n' +
        '  ```',
    )
    return
  }

  console.log('Running:\n')
  console.log(upSection)
  console.log()

  const result = spawnSync('bash', ['-c', upSection], {
    cwd,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`\nmtl-code up failed with exit code ${result.status}`)
    process.exitCode = result.status ?? 1
  } else {
    console.log('\nmtl-code up completed successfully.')
  }
}

/**
 * Extract the content under "# mtl-code up" heading from markdown.
 * Returns the text between `# mtl-code up` and the next `#` heading (or EOF).
 * Strips fenced code block markers if present.
 */
function extractUpSection(markdown: string): string | null {
  const lines = markdown.split('\n')
  let inSection = false
  const sectionLines: string[] = []

  for (const line of lines) {
    if (/^#\s+(mtl-code|claude)\s+up\b/i.test(line)) {
      inSection = true
      continue
    }
    if (inSection && /^#\s/.test(line)) {
      break
    }
    if (inSection) {
      sectionLines.push(line)
    }
  }

  if (sectionLines.length === 0) return null

  // Strip fenced code block markers
  const content = sectionLines.join('\n').trim()
  return content
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim()
}
