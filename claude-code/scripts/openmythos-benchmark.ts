import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  buildOpenMythosRuntimeCard,
  createOpenMythosRuntimeState,
  shouldEnforceOpenMythosLoopBudget,
} from '../src/utils/openmythosRuntime.js'

type Fixture = {
  name: string
  prompt: string
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, 'fixtures', 'openmythos-benchmark.json')
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture[]

const scenarios = [
  {
    name: 'default-enforced',
    env: {
      MTL_CODE_OPENMYTHOS_LOOP_CONTROL: 'enforced',
      MTL_CODE_OPENMYTHOS_PHASE_ADAPTER: '1',
      MTL_CODE_OPENMYTHOS_EXPERT_ROUTING: '1',
    },
  },
  {
    name: 'advisory-no-experts',
    env: {
      MTL_CODE_OPENMYTHOS_LOOP_CONTROL: 'advisory',
      MTL_CODE_OPENMYTHOS_PHASE_ADAPTER: '1',
      MTL_CODE_OPENMYTHOS_EXPERT_ROUTING: '0',
    },
  },
  {
    name: 'flat-runtime',
    env: {
      MTL_CODE_OPENMYTHOS_LOOP_CONTROL: 'advisory',
      MTL_CODE_OPENMYTHOS_PHASE_ADAPTER: '0',
      MTL_CODE_OPENMYTHOS_EXPERT_ROUTING: '0',
    },
  },
] as const

const originalEnv = { ...process.env }
const rows: Array<Record<string, string | number | boolean>> = []

for (const scenario of scenarios) {
  process.env = { ...originalEnv, ...scenario.env }
  for (const fixture of fixtures) {
    const card = buildOpenMythosRuntimeCard(fixture.prompt)
    if (!card) {
      rows.push({
        scenario: scenario.name,
        fixture: fixture.name,
        enabled: false,
      })
      continue
    }
    const state = createOpenMythosRuntimeState(card)
    rows.push({
      scenario: scenario.name,
      fixture: fixture.name,
      enabled: true,
      effort: card.effort,
      riskScore: card.riskScore,
      loopBudget: card.loopBudget,
      enforced: shouldEnforceOpenMythosLoopBudget(state),
      phasePlan: card.phasePlan.join(' -> '),
      experts: card.expertRoutes.map(route => route.kind).join(', ') || 'none',
    })
  }
}

process.env = originalEnv

console.table(rows)

if (process.env.OPENMYTHOS_LIVE_BENCHMARK === '1') {
  console.warn('OPENMYTHOS_LIVE_BENCHMARK=1 is reserved for future live task runners; this script is offline by default.')
}
