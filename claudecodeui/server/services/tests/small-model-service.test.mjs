import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SMALL_MODEL_RUNTIME_CONFIG,
  completeSmallModelJson,
  normalizeSmallModelRuntimeConfig,
  refineWikiReadbackContext,
  resolveSmallModelRuntimeConfig,
  classifyKnowledgeWithSmallModel,
} from '../small-model-service.js';

const profiles = [
  {
    id: 'sonnet-main',
    name: 'Main Sonnet',
    model: 'claude-sonnet',
    baseUrl: 'https://api.example.com',
    authToken: 'main-token',
  },
  {
    id: 'mimo-flash',
    name: 'MiMo Flash',
    model: 'mimo-v2-flash',
    baseUrl: 'https://api.example.com',
    authToken: 'flash-token',
  },
];

describe('small model service', () => {
  it('normalizes runtime config with safe defaults', () => {
    expect(normalizeSmallModelRuntimeConfig({
      enabled: true,
      profileId: ' mimo-flash ',
      protocol: 'openai-compatible',
      requestModel: ' relay-small ',
      timeoutMs: 999999,
      useForWikiRouting: false,
      useForWikiReadback: true,
    })).toEqual({
      ...DEFAULT_SMALL_MODEL_RUNTIME_CONFIG,
      enabled: true,
      profileId: 'mimo-flash',
      protocol: 'openai-compatible',
      requestModel: 'relay-small',
      timeoutMs: 15000,
      useForWikiRouting: false,
      useForWikiReadback: true,
    });
  });

  it('falls back to Anthropic protocol for unknown runtime protocol values', () => {
    expect(normalizeSmallModelRuntimeConfig({
      protocol: 'codex',
    })).toMatchObject({
      protocol: 'anthropic',
    });
  });

  it('auto-selects a flash/haiku/mini/small/lite profile before the active profile', async () => {
    const result = await resolveSmallModelRuntimeConfig({
      readMtlCodeModelSettings: vi.fn(async () => ({
        smallModelRuntime: { enabled: true, profileId: 'auto' },
        activeProfileId: 'sonnet-main',
        profiles,
      })),
    });

    expect(result).toMatchObject({
      enabled: true,
      profileId: 'auto',
      resolvedProfile: {
        id: 'mimo-flash',
        model: 'mimo-v2-flash',
        tokenConfigured: true,
      },
    });
    expect(result.resolvedProfile).not.toHaveProperty('authToken');
  });

  it('falls back without calling the model when no token is configured', async () => {
    const fetchImpl = vi.fn();

    await expect(completeSmallModelJson({
      systemPrompt: 'Return JSON.',
      userPrompt: 'hello',
      readMtlCodeModelSettings: vi.fn(async () => ({
        smallModelRuntime: { enabled: true, profileId: 'auto' },
        activeProfileId: 'small-no-token',
        profiles: [{ id: 'small-no-token', name: 'Small', model: 'mini', baseUrl: 'https://api.example.com' }],
      })),
      fetchImpl,
    })).resolves.toMatchObject({
      success: false,
      reason: 'not_configured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses Anthropic-compatible JSON responses', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"mode":"second-brain","confidence":0.91}' }],
      }),
    }));

    const result = await completeSmallModelJson({
      systemPrompt: 'Return JSON.',
      userPrompt: 'classify',
      readMtlCodeModelSettings: vi.fn(async () => ({
        smallModelRuntime: { enabled: true, profileId: 'mimo-flash' },
        activeProfileId: 'sonnet-main',
        profiles,
      })),
      fetchImpl,
    });

    expect(result).toMatchObject({
      success: true,
      json: {
        mode: 'second-brain',
        confidence: 0.91,
      },
      model: 'mimo-v2-flash',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-api-key': 'flash-token',
        }),
      }),
    );
  });

  it('uses OpenAI-compatible chat completions when selected by small model protocol', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"ok":true,"mode":"ai-memory"}',
            },
          },
        ],
      }),
    }));

    const result = await completeSmallModelJson({
      systemPrompt: 'Return JSON.',
      userPrompt: 'classify',
      readMtlCodeModelSettings: vi.fn(async () => ({
        smallModelRuntime: { enabled: true, profileId: 'gpt-mini', protocol: 'openai-compatible' },
        activeProfileId: 'gpt-mini',
        profiles: [{
          id: 'gpt-mini',
          name: 'GPT Mini',
          provider: 'anthropic',
          model: 'gpt-5.4-mini',
          baseUrl: 'http://token.wd.com',
          authToken: 'token',
        }],
      })),
      fetchImpl,
    });

    expect(result).toMatchObject({
      success: true,
      protocol: 'openai-compatible',
      json: {
        ok: true,
        mode: 'ai-memory',
      },
      model: 'gpt-5.4-mini',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://token.wd.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.not.objectContaining({
          'anthropic-version': expect.any(String),
        }),
        body: expect.stringContaining('"model":"gpt-5.4-mini"'),
      }),
    );
  });

  it('does not infer OpenAI protocol from a gpt model name when protocol remains Anthropic', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"ok":true}' }],
      }),
    }));

    await completeSmallModelJson({
      systemPrompt: 'Return JSON.',
      userPrompt: 'classify',
      readMtlCodeModelSettings: vi.fn(async () => ({
        smallModelRuntime: { enabled: true, profileId: 'gpt-mini', protocol: 'anthropic' },
        activeProfileId: 'gpt-mini',
        profiles: [{
          id: 'gpt-mini',
          name: 'GPT Mini',
          provider: 'anthropic',
          model: 'gpt-5.4-mini',
          baseUrl: 'http://token.wd.com',
          authToken: 'token',
        }],
      })),
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://token.wd.com/v1/messages',
      expect.any(Object),
    );
  });

  it('uses an explicit request model override for Anthropic relay aliases', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"ok":true}' }],
      }),
    }));

    const result = await completeSmallModelJson({
      systemPrompt: 'Return JSON.',
      userPrompt: 'classify',
      readMtlCodeModelSettings: vi.fn(async () => ({
        smallModelRuntime: {
          enabled: true,
          profileId: 'gpt-mini',
          protocol: 'anthropic',
          requestModel: 'obsidian-small-anthropic',
        },
        activeProfileId: 'gpt-mini',
        profiles: [{
          id: 'gpt-mini',
          name: 'GPT Mini',
          provider: 'anthropic',
          model: 'gpt-5.4-mini',
          baseUrl: 'http://token.wd.com',
          authToken: 'token',
        }],
      })),
      fetchImpl,
    });

    expect(result).toMatchObject({
      success: true,
      model: 'obsidian-small-anthropic',
      profileModel: 'gpt-5.4-mini',
      protocol: 'anthropic',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://token.wd.com/v1/messages',
      expect.objectContaining({
        body: expect.stringContaining('"model":"obsidian-small-anthropic"'),
      }),
    );
  });

  it('uses protocol and request model from the selected model profile', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"ok":true}',
            },
          },
        ],
      }),
    }));

    const result = await completeSmallModelJson({
      systemPrompt: 'Return JSON.',
      userPrompt: 'classify',
      readMtlCodeModelSettings: vi.fn(async () => ({
        smallModelRuntime: {
          enabled: true,
          profileId: 'gpt-mini',
        },
        activeProfileId: 'gpt-mini',
        profiles: [{
          id: 'gpt-mini',
          name: 'GPT Mini',
          provider: 'anthropic',
          protocol: 'openai-compatible',
          model: 'gpt-5.4-mini',
          requestModel: 'gpt-mini-openai-relay',
          baseUrl: 'http://token.wd.com',
          authToken: 'token',
        }],
      })),
      fetchImpl,
    });

    expect(result).toMatchObject({
      success: true,
      model: 'gpt-mini-openai-relay',
      profileModel: 'gpt-5.4-mini',
      protocol: 'openai-compatible',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://token.wd.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"model":"gpt-mini-openai-relay"'),
      }),
    );
  });

  it('uses OpenAI Responses API when selected by the model profile', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => [
        'event: response.output_text.delta',
        'data: {"type":"response.output_text.delta","delta":"{\\"ok\\":true,\\"mode\\":\\"project-knowledge\\"}"}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
    }));

    const result = await completeSmallModelJson({
      systemPrompt: 'Return JSON only.',
      userPrompt: 'classify',
      readMtlCodeModelSettings: vi.fn(async () => ({
        smallModelRuntime: {
          enabled: true,
          profileId: 'gpt-mini',
        },
        activeProfileId: 'gpt-mini',
        profiles: [{
          id: 'gpt-mini',
          name: 'GPT Mini',
          provider: 'anthropic',
          protocol: 'openai-responses',
          model: 'gpt-5.4-mini',
          baseUrl: 'http://token.wd.com/v1',
          authToken: 'token',
        }],
      })),
      fetchImpl,
    });

    expect(result).toMatchObject({
      success: true,
      model: 'gpt-5.4-mini',
      protocol: 'openai-responses',
      json: {
        ok: true,
        mode: 'project-knowledge',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://token.wd.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
        body: expect.stringContaining('"max_output_tokens":800'),
      }),
    );
    expect(fetchImpl.mock.calls[0][1].body).toContain('"stream":true');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'classify',
            },
          ],
        },
      ],
    });
    expect(fetchImpl.mock.calls[0][1].body).toContain('"instructions":"Return JSON only."');
  });

  it('refines wiki readback context into sourced snippets and falls back on model failure', async () => {
    const result = await refineWikiReadbackContext({
      query: 'GPUScene review',
      context: 'Raw context',
      results: [
        { path: 'Argus/Wiki/App/GPUScene.md', title: 'GPUScene', snippet: 'Important snippet.' },
      ],
      completeJson: vi.fn(async () => ({
        success: true,
        json: {
          snippets: [
            {
              path: 'Argus/Wiki/App/GPUScene.md',
              title: 'GPUScene',
              snippet: 'Use the GPUScene review note.',
              reason: 'Title match',
            },
          ],
        },
        model: 'mimo-v2-flash',
      })),
    });

    expect(result).toMatchObject({
      refined: true,
      model: 'mimo-v2-flash',
      context: expect.stringContaining('Use the GPUScene review note.'),
      sources: [
        expect.objectContaining({
          path: 'Argus/Wiki/App/GPUScene.md',
          hitReason: 'Title match',
        }),
      ],
    });

    await expect(refineWikiReadbackContext({
      query: 'GPUScene review',
      context: 'Raw context',
      results: [{ path: 'Argus/Wiki/App/GPUScene.md', title: 'GPUScene' }],
      completeJson: vi.fn(async () => ({ success: false, reason: 'not_configured' })),
    })).resolves.toMatchObject({
      refined: false,
      context: 'Raw context',
    });
  });

  it('lets the small model override rule-based skip decisions for Obsidian routing', async () => {
    const result = await classifyKnowledgeWithSmallModel({
      title: 'GPU review note',
      content: 'short note',
      userPrompt: '总结一下',
      ruleAssessment: {
        shouldCapture: false,
        reason: 'not_knowledge',
        mode: 'project-knowledge',
        routingMode: 'project-knowledge',
        routingModes: ['project-knowledge'],
        confidence: 0.2,
        routingConfidence: 0.2,
        routingSignals: [],
      },
      completeJson: vi.fn(async () => ({
        success: true,
        model: 'gpt-5.4-mini',
        json: {
          shouldCapture: true,
          mode: 'second-brain',
          confidence: 0.88,
          reason: '用户明确要求总结，内容应进入知识库。',
          signals: ['explicit summary request'],
        },
      })),
    });

    expect(result).toMatchObject({
      used: true,
      assessment: {
        shouldCapture: true,
        mode: 'second-brain',
        routingMode: 'second-brain',
        confidence: 0.88,
        aiRoutingUsed: true,
      },
    });
  });

  it('lets the small model skip low-value Obsidian captures even when rules would write', async () => {
    const result = await classifyKnowledgeWithSmallModel({
      title: 'Temporary note',
      content: '一些临时执行输出。',
      userPrompt: '',
      ruleAssessment: {
        shouldCapture: true,
        reason: 'knowledge',
        mode: 'project-knowledge',
        routingMode: 'project-knowledge',
        routingModes: ['project-knowledge'],
        confidence: 0.7,
        routingConfidence: 0.7,
        routingSignals: ['project implementation'],
      },
      completeJson: vi.fn(async () => ({
        success: true,
        model: 'gpt-5.4-mini',
        json: {
          shouldCapture: false,
          mode: 'project-knowledge',
          confidence: 0.2,
          reason: '只是临时输出，没有长期知识价值。',
          signals: ['temporary output'],
        },
      })),
    });

    expect(result).toMatchObject({
      used: true,
      assessment: {
        shouldCapture: false,
        reason: 'not_knowledge',
        routingReason: '只是临时输出，没有长期知识价值。',
        aiRoutingUsed: true,
      },
    });
  });
});
