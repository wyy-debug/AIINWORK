import { describe, expect, test } from 'bun:test'
import { FileReadTool } from '../FileReadTool.js'

describe('FileReadTool pages input', () => {
  test('treats empty pages parameter as omitted', () => {
    const parsed = FileReadTool.inputSchema.safeParse({
      file_path: '/tmp/report.pdf',
      pages: '',
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.pages).toBeUndefined()
    }
  })

  test('trims non-empty pages parameter', () => {
    const parsed = FileReadTool.inputSchema.safeParse({
      file_path: '/tmp/report.pdf',
      pages: ' 1-3 ',
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.pages).toBe('1-3')
    }
  })
})
