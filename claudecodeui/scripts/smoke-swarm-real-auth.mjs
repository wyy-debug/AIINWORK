function isTrue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

export function resolveSmokeAuthMode(env = process.env) {
  const authToken = env.ARGUS_SMOKE_AUTH_TOKEN || env.SMOKE_AUTH_TOKEN || '';
  const requireHttpAuth = isTrue(env.ARGUS_SMOKE_REQUIRE_AUTH);
  const explicitDesktopAuth = env.ARGUS_SMOKE_DESKTOP_AUTH;
  const allowDesktopAuth = requireHttpAuth
    ? false
    : explicitDesktopAuth === undefined
      ? true
      : isTrue(explicitDesktopAuth) || isTrue(env.DESKTOP_MODE);

  if (requireHttpAuth && !authToken) {
    throw new Error('ARGUS_SMOKE_AUTH_TOKEN or SMOKE_AUTH_TOKEN is required when ARGUS_SMOKE_REQUIRE_AUTH=true.');
  }

  return {
    authToken,
    allowDesktopAuth,
    requireHttpAuth,
    desktopModeEnv: allowDesktopAuth ? 'true' : env.DESKTOP_MODE || '',
  };
}
