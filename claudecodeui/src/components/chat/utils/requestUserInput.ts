import type { PendingPermissionRequest, Question } from '../types/types';

type RequestUserInputPayload = {
  questions?: Question[];
  answers?: Record<string, string>;
  [key: string]: unknown;
};

const REQUEST_USER_INPUT_TOOL_NAMES = new Set(['request_user_input', 'AskUserQuestion']);

function toRequestUserInputPayload(input: unknown): RequestUserInputPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }
  return input as RequestUserInputPayload;
}

export function isRequestUserInputToolName(toolName: string | null | undefined): boolean {
  return REQUEST_USER_INPUT_TOOL_NAMES.has(typeof toolName === 'string' ? toolName.trim() : '');
}

export function buildFreeformRequestUserInputAnswer(
  request: PendingPermissionRequest,
  answerText: string,
): RequestUserInputPayload | null {
  if (!isRequestUserInputToolName(request.toolName)) {
    return null;
  }

  const trimmedAnswer = answerText.trim();
  if (!trimmedAnswer) {
    return null;
  }

  const input = toRequestUserInputPayload(request.input);
  const questions = Array.isArray(input?.questions) ? input.questions : [];
  if (questions.length !== 1) {
    return null;
  }

  const question = questions[0];
  const answerKey = (typeof question?.id === 'string' && question.id.trim())
    ? question.id.trim()
    : (typeof question?.question === 'string' ? question.question.trim() : '');
  if (!answerKey) {
    return null;
  }

  return {
    ...(input || {}),
    answers: {
      [answerKey]: trimmedAnswer,
    },
  };
}

export function findAutoAnswerableRequestUserInput(
  requests: PendingPermissionRequest[],
  answerText: string,
): { request: PendingPermissionRequest; updatedInput: RequestUserInputPayload } | null {
  const candidates = requests
    .map((request) => ({
      request,
      updatedInput: buildFreeformRequestUserInputAnswer(request, answerText),
    }))
    .filter((entry): entry is { request: PendingPermissionRequest; updatedInput: RequestUserInputPayload } => Boolean(entry.updatedInput));

  if (candidates.length !== 1) {
    return null;
  }

  return candidates[0];
}
