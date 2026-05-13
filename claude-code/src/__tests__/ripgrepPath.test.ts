import { describe, expect, test } from 'bun:test'
import path from 'path'
import { resolveVendoredRipgrepConfig } from '../utils/ripgrep.js'

describe('resolveVendoredRipgrepConfig', () => {
  test('prefers packaged resources when Bun compiled module paths are virtual', () => {
    const resourcesDir = 'E:\\AIINWORK\\workspace\\vendor\\debug\\Argus-Debug-1.30.9\\resources'
    const expected = path.resolve(
      resourcesDir,
      'mtl-code',
      'dist',
      'vendor',
      'ripgrep',
      'x64-win32',
      'rg.exe',
    )
    const config = resolveVendoredRipgrepConfig({
      moduleDir: 'B:\\~BUN\\root',
      execPath: path.join(resourcesDir, 'mtl-code', 'mtl-code.exe'),
      resourcesDir,
      platform: 'win32',
      arch: 'x64',
      exists: candidate => candidate === expected,
    })

    expect(config?.mode).toBe('builtin')
    expect(config?.command).toBe(expected)
    expect(config?.args).toEqual([])
  })

  test('falls back to the module-relative vendor path in development', () => {
    const moduleDir = 'E:\\AIINWORK\\claude-code\\src\\utils'
    const expected = path.resolve(moduleDir, 'vendor', 'ripgrep', 'x64-win32', 'rg.exe')
    const config = resolveVendoredRipgrepConfig({
      moduleDir,
      execPath: 'E:\\runtime\\node.exe',
      resourcesDir: '',
      platform: 'win32',
      arch: 'x64',
      exists: candidate => candidate === expected,
    })

    expect(config?.command).toBe(expected)
  })
})
