import { describe, expect, test } from 'bun:test'

describe('OpenMythos phase adapter', () => {
  test('keeps context-loading tools available during read-only phases', async () => {
    const querySource = await Bun.file(new URL('../query.ts', import.meta.url)).text()

    expect(querySource).toContain('OPENMYTHOS_READ_ONLY_PHASE_TOOL_NAMES')
    expect(querySource).toMatch(/OPENMYTHOS_READ_ONLY_PHASE_TOOL_NAMES[\s\S]*AGENT_TOOL_NAME/)
    expect(querySource).toMatch(/OPENMYTHOS_READ_ONLY_PHASE_TOOL_NAMES[\s\S]*SKILL_TOOL_NAME/)
    expect(querySource).toMatch(/OPENMYTHOS_READ_ONLY_PHASE_TOOL_NAMES[\s\S]*DISCOVER_SKILLS_TOOL_NAME/)
  })
})
