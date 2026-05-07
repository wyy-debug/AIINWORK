import { feature } from 'bun:bundle'
import { getAllowedChannels } from 'src/bootstrap/state.js'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'

export const REQUEST_USER_INPUT_TOOL_NAME = 'request_user_input'

const optionSchema = lazySchema(() =>
  z.object({
    label: z
      .string()
      .describe(
        'User-facing option label. Keep this short, normally 1-5 words.',
      ),
    description: z
      .string()
      .describe(
        'One short sentence explaining the effect or tradeoff of choosing this option.',
      ),
  }),
)

const questionSchema = lazySchema(() =>
  z.object({
    header: z
      .string()
      .describe('Short chip label shown in the UI, 12 characters or fewer.'),
    id: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .describe('Stable snake_case identifier used to map the user answer.'),
    question: z.string().describe('The concrete question to ask the user.'),
    options: z
      .array(optionSchema())
      .min(2)
      .max(3)
      .describe(
        'Two or three mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not add an Other option; the UI provides one automatically.',
      ),
  }),
)

const inputSchema = lazySchema(() =>
  z.strictObject({
    questions: z
      .array(questionSchema())
      .min(1)
      .max(3)
      .describe('Questions to show the user. Prefer one and never exceed three.'),
    answers: z
      .record(z.string(), z.string())
      .optional()
      .describe('User answers collected by the permission component, keyed by question id.'),
  }),
)

const outputSchema = lazySchema(() =>
  z.object({
    questions: z.array(questionSchema()),
    answers: z
      .record(z.string(), z.string())
      .describe('User answers keyed by question id.'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const RequestUserInputTool = buildTool({
  name: REQUEST_USER_INPUT_TOOL_NAME,
  searchHint: 'ask the user multiple-choice questions in Codex-style plan mode',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return 'Request user input with one to three short multiple-choice questions. This is the Codex-style Plan Mode question tool.'
  },
  async prompt() {
    return `Use request_user_input in Plan Mode when a decision materially changes the plan, confirms an important assumption, or chooses between meaningful tradeoffs.

Usage rules:
- Ask only questions that cannot be answered by inspecting the repo or environment.
- Prefer one question and never ask more than three.
- Provide two or three mutually exclusive options.
- Put the recommended option first and suffix its label with "(Recommended)".
- Do not include an "Other" option; the UI adds free-form Other automatically.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    if (
      (feature('KAIROS') || feature('KAIROS_CHANNELS')) &&
      getAllowedChannels().length > 0
    ) {
      return false
    }
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.questions.map(q => q.question).join(' | ')
  },
  requiresUserInteraction() {
    return true
  },
  async checkPermissions(input) {
    return {
      behavior: 'ask' as const,
      message: 'Answer questions?',
      updatedInput: input,
    }
  },
  renderToolUseMessage() {
    return null
  },
  renderToolUseProgressMessage() {
    return null
  },
  renderToolResultMessage() {
    return null
  },
  renderToolUseRejectedMessage() {
    return null
  },
  renderToolUseErrorMessage() {
    return null
  },
  async call({ questions, answers = {} }, _context) {
    return {
      data: { questions, answers },
    }
  },
  mapToolResultToToolResultBlockParam({ answers }: Output, toolUseID) {
    const answersText = Object.entries(answers)
      .map(([id, answer]) => `"${id}"="${answer}"`)
      .join(', ')

    return {
      type: 'tool_result',
      content: `User has answered your questions: ${answersText}. Continue with the user's answers in mind.`,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
