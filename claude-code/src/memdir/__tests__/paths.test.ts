import { afterEach, describe, expect, test } from 'bun:test'
import { setIsInteractive } from '../../bootstrap/state'
import { isAutoMemoryEnabled, isExtractModeActive } from '../paths'

const savedAutoMemoryExtraction = process.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION
const savedDisableAutoMemoryExtraction = process.env.MTL_CODE_DISABLE_AUTO_MEMORY_EXTRACTION
const savedObsidianPrimaryMemory = process.env.MTL_CODE_OBSIDIAN_MEMORY_PRIMARY
const savedObsidianNativeMemorySync = process.env.MTL_CODE_OBSIDIAN_NATIVE_MEMORY_SYNC

afterEach(() => {
  if (savedAutoMemoryExtraction === undefined) {
    delete process.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION
  } else {
    process.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION = savedAutoMemoryExtraction
  }
  if (savedDisableAutoMemoryExtraction === undefined) {
    delete process.env.MTL_CODE_DISABLE_AUTO_MEMORY_EXTRACTION
  } else {
    process.env.MTL_CODE_DISABLE_AUTO_MEMORY_EXTRACTION = savedDisableAutoMemoryExtraction
  }
  if (savedObsidianPrimaryMemory === undefined) {
    delete process.env.MTL_CODE_OBSIDIAN_MEMORY_PRIMARY
  } else {
    process.env.MTL_CODE_OBSIDIAN_MEMORY_PRIMARY = savedObsidianPrimaryMemory
  }
  if (savedObsidianNativeMemorySync === undefined) {
    delete process.env.MTL_CODE_OBSIDIAN_NATIVE_MEMORY_SYNC
  } else {
    process.env.MTL_CODE_OBSIDIAN_NATIVE_MEMORY_SYNC = savedObsidianNativeMemorySync
  }
  setIsInteractive(true)
})

describe('isExtractModeActive', () => {
  test('keeps non-interactive sessions disabled unless explicitly enabled', () => {
    delete process.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION
    setIsInteractive(false)

    expect(isExtractModeActive()).toBe(false)
  })

  test('allows Argus SDK sessions to opt into automatic memory extraction', () => {
    process.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION = '1'
    setIsInteractive(false)

    expect(isExtractModeActive()).toBe(true)
  })

  test('lets Obsidian primary memory disable only background extraction', () => {
    process.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION = '1'
    process.env.MTL_CODE_DISABLE_AUTO_MEMORY_EXTRACTION = '1'
    setIsInteractive(false)

    expect(isExtractModeActive()).toBe(false)
  })
})

describe('isAutoMemoryEnabled', () => {
  test('disables native auto-memory when Obsidian is the primary memory backend', () => {
    process.env.MTL_CODE_OBSIDIAN_MEMORY_PRIMARY = '1'
    delete process.env.MTL_CODE_OBSIDIAN_NATIVE_MEMORY_SYNC

    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('keeps native auto-memory enabled when Obsidian primary is only taking over sync and readback', () => {
    process.env.MTL_CODE_OBSIDIAN_MEMORY_PRIMARY = '1'
    process.env.MTL_CODE_OBSIDIAN_NATIVE_MEMORY_SYNC = '1'

    expect(isAutoMemoryEnabled()).toBe(true)
  })
})
