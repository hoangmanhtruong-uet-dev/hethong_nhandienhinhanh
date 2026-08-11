const baseUrl = (process.env.VISION_AI_SMOKE_URL || process.argv[2] || '').replace(/\/$/, '');
const expectedCommit = (process.env.EXPECTED_COMMIT || '').trim().slice(0, 12);
const requireGemini = process.env.VISION_AI_SMOKE_REQUIRE_GEMINI === 'true';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 12 * 60 * 1000);
const pollMs = Number(process.env.SMOKE_POLL_MS || 15 * 1000);

if (!baseUrl.startsWith('https://')) {
  throw new Error('VISION_AI_SMOKE_URL must be an HTTPS production URL.');
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function request(path, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'follow',
    headers: { 'user-agent': 'Vision-AI-Production-Smoke/1.0' },
  });
  if (response.status !== expectedStatus) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${body}`);
  }
  return response;
}

async function waitForRelease() {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'Render has not answered yet.';
  while (Date.now() < deadline) {
    try {
      const response = await request('/api/health/ready');
      const health = await response.json();
      const deployedCommit = String(health.release?.commit || '');
      if (health.status !== 'ready') throw new Error(`Readiness status is ${health.status}.`);
      if (requireGemini && health.checks?.advanced_ai?.provider !== 'gemini') {
        throw new Error('Gemini is required but is not configured on Render.');
      }
      if (!expectedCommit || deployedCommit === expectedCommit) return health;
      lastError = `Render is still on ${deployedCommit || 'an older release'}; waiting for ${expectedCommit}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    process.stdout.write(`${lastError}\n`);
    await sleep(pollMs);
  }
  throw new Error(`Production did not become ready before timeout. Last result: ${lastError}`);
}

const health = await waitForRelease();
const page = await request('/');
const html = await page.text();
if (!html.includes('Vision AI')) throw new Error('Production HTML does not contain the Vision AI app.');
if (expectedCommit && !html.includes(`script.js?v=${expectedCommit}`)) {
  throw new Error(`Production HTML is not pinned to release ${expectedCommit}.`);
}

const manifest = await (await request('/manifest.webmanifest')).json();
if (!manifest.name || !manifest.start_url) throw new Error('PWA manifest is incomplete.');

const serviceWorker = await (await request('/sw.js')).text();
if (!serviceWorker.includes('vision-ai-')) throw new Error('Service worker cache configuration is missing.');
if (expectedCommit && !serviceWorker.includes(`BUILD_ID = '${expectedCommit}'`)) {
  throw new Error(`Service worker cache does not match release ${expectedCommit}.`);
}

await request('/api/scans', 401);
await request('/api/auth/me', 401);

process.stdout.write(`${JSON.stringify({
  status: 'passed',
  url: baseUrl,
  release: health.release,
  checks: health.checks,
  pwa: { manifest: 'ok', service_worker: 'ok' },
  authentication: 'protected',
  advanced_ai: health.checks?.advanced_ai || { status: 'unknown' },
}, null, 2)}\n`);
