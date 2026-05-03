# Argus Multi Model Profiles and MiMo Setup

Date: 2026-04-29

## What Changed

- Argus model settings now support multiple Anthropic-compatible model profiles.
- Only one profile is active at a time. Saving an active profile writes it to `~/.mtl-code/settings.json` as the runtime `ANTHROPIC_*` environment.
- Existing single-model settings are migrated into a default profile automatically.
- MiMo presets are available in the Model settings page.

## MiMo Anthropic Compatibility

Official MiMo Anthropic-compatible values:

- Pay-as-you-go base URL: `https://api.xiaomimimo.com/anthropic`
- Token Plan base URL: `https://token-plan-cn.xiaomimimo.com/anthropic`
- Direct request endpoint: `https://api.xiaomimimo.com/anthropic/v1/messages`
- Claude Code environment keys:
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_AUTH_TOKEN`
  - `ANTHROPIC_MODEL`
  - `ANTHROPIC_DEFAULT_SONNET_MODEL`
  - `ANTHROPIC_DEFAULT_OPUS_MODEL`
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL`

Supported MiMo chat models from the Anthropic API documentation:

- `mimo-v2.5-pro`
- `mimo-v2.5`
- `mimo-v2-pro`
- `mimo-v2-omni`
- `mimo-v2-flash`

Recommended context defaults:

- `mimo-v2.5-pro`: `1000000`
- `mimo-v2.5`: `1000000`
- `mimo-v2-pro`: `1000000`
- `mimo-v2-omni`: `256000`
- `mimo-v2-flash`: `256000`

## User Flow

1. Open Settings > Argus > Model.
2. Click a MiMo preset or Add to create a custom profile.
3. Fill Base URL, Model, API Key, and Context window tokens.
4. Click Use this model.
5. Click Save.
6. New Argus sessions will use the active profile.

## Runtime Notes

- The chat UI still sends the `mtlcode` sentinel model so the backend can resolve the active profile from settings.
- For MiMo profiles, the backend sets Sonnet, Opus, Haiku, and subagent model defaults to the selected MiMo model.
- MiMo is treated as a third-party Anthropic-compatible endpoint, so Argus does not force `output_config.effort` or the Anthropic effort beta by default. This avoids slow first-token latency on simple prompts.
- MiMo supports `Authorization: Bearer` authentication, which is compatible with `ANTHROPIC_AUTH_TOKEN`.
- Token Plan users should replace the base URL with the exclusive Token Plan base URL shown in the MiMo console if it differs from the default China endpoint.
