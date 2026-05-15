import { afterEach, describe, expect, test } from 'bun:test'
import { setIsInteractive } from '../../bootstrap/state'
import { isExtractModeActive } from '../paths'

const savedAutoMemoryExtraction = process.env.MTL_CODE_ENABLE_AUTO_MEMORY_EXTRACTION
const savedDisableAutoMemoryExtraction = process.env.MTL_CODE_DISABLE_AUTO_MEMORY_EXTRACTION

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
