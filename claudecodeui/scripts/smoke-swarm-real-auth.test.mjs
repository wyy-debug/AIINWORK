import { describe, expect, it } from 'vitest';

import { resolveSmokeAuthMode } from './smoke-swarm-real-auth.mjs';

describe('smoke-swarm-real auth mode', () => {
  it('defaults local server smoke to desktop auth without requiring a UI token', () => {
    expect(resolveSmokeAuthMode({})).toEqual({
      authToken: '',
      allowDesktopAuth: true,
      requireHttpAuth: false,
      desktopModeEnv: 'true',
    });
  });

  it('requires an HTTP auth token only when explicitly requested', () => {
    expect(() => resolveSmokeAuthMode({ ARGUS_SMOKE_REQUIRE_AUTH: 'true' })).toThrow(
      /ARGUS_SMOKE_AUTH_TOKEN/,
    );
    expect(resolveSmokeAuthMode({
      ARGUS_SMOKE_REQUIRE_AUTH: 'true',
      ARGUS_SMOKE_AUTH_TOKEN: 'jwt-token',
    })).toMatchObject({
      authToken: 'jwt-token',
      allowDesktopAuth: false,
      requireHttpAuth: true,
    });
  });
});
