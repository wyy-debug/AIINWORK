const baseUrl = process.env.SMOKE_API_BASE_URL || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const token = process.env.SMOKE_AUTH_TOKEN || '';

function logStep(message) {
  console.log(`[smoke-api] ${message}`);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { response, body };
}

async function run() {
  logStep(`checking ${baseUrl}`);
  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(`health failed: ${health.status}`);
  }
  logStep('health ok');

  if (!token) {
    logStep('SMOKE_AUTH_TOKEN not set; authenticated API checks skipped');
    return;
  }

  const catalog = await request('/api/agent-repository/catalog');
  if (!catalog.response.ok) {
    throw new Error(`catalog failed: ${catalog.response.status} ${JSON.stringify(catalog.body)}`);
  }
  logStep('repository catalog ok');

  const mcp = await request('/api/providers/claude/mcp/servers?scope=user');
  if (!mcp.response.ok) {
    throw new Error(`mcp list failed: ${mcp.response.status} ${JSON.stringify(mcp.body)}`);
  }
  logStep('mcp list ok');

  const projects = await request('/api/projects');
  if (!projects.response.ok) {
    throw new Error(`projects failed: ${projects.response.status} ${JSON.stringify(projects.body)}`);
  }
  logStep('projects list ok');
}

run().catch((error) => {
  console.error(`[smoke-api] failed: ${error.message}`);
  process.exit(1);
});
