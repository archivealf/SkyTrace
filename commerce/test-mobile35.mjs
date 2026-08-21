import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skytrace-mobile35-'));
const port = 22000 + crypto.randomInt(3000);
const cfg = path.join(tmp, 'config.json');
const password = 'mobile-test-password-123';
fs.writeFileSync(cfg, JSON.stringify({
  server: { host: '127.0.0.1', port, publicUrl: `http://127.0.0.1:${port}` },
  security: { pepper: crypto.randomBytes(32).toString('hex'), sessionDays: 30, allowRegistration: true, minPasswordLength: 10 },
  stripe: { enabled: false, secretKey: '', webhookSecret: '' },
  products: {},
  dataFile: path.join(tmp, 'store.json'),
  sqliteFile: path.join(tmp, 'store.sqlite3')
}, null, 2));

const child = spawn(process.execPath, ['--import', path.join(root, 'redeem-hook.js'), path.join(root, 'server.js')], {
  env: { ...process.env, SKYTRACE_COMMERCE_CONFIG: cfg },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr = '', stdout = '', stage = 'startup';
child.stderr.on('data', data => { stderr += data; });
child.stdout.on('data', data => { stdout += data; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  let payload = {};
  try { payload = await response.json(); } catch {}
  return { response, payload };
}

try {
  let ready = false;
  for (let i = 0; i < 70; i += 1) {
    await sleep(100);
    try {
      const check = await request('/health');
      if (check.response.ok) { ready = true; break; }
    } catch {}
  }
  if (!ready) throw new Error('server failed to start');

  const username = `mobile${crypto.randomBytes(3).toString('hex')}`;
  stage = 'register + cookie';
  let result = await request('/v1/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!result.response.ok || !result.payload.token) throw new Error('registration failed');
  const setCookie = result.response.headers.get('set-cookie') || '';
  if (!setCookie.includes('skytrace_session=') || !/HttpOnly/i.test(setCookie) || !/SameSite=Lax/i.test(setCookie)) {
    throw new Error(`remembered-session cookie attributes are missing: ${setCookie}`);
  }
  if (!/Max-Age=2592000/i.test(setCookie)) throw new Error(`30-day cookie lifetime is missing: ${setCookie}`);
  const cookie = setCookie.split(';')[0];

  stage = 'cookie-backed account';
  result = await request('/v1/account', {
    headers: { Cookie: cookie, Authorization: 'Bearer __skytrace_cookie_session__' }
  });
  if (!result.response.ok || result.payload.user?.username !== username) throw new Error('cookie-backed account restore failed');

  stage = 'sentinel without cookie';
  result = await request('/v1/account', { headers: { Authorization: 'Bearer __skytrace_cookie_session__' } });
  if (result.response.status !== 401) throw new Error(`sentinel without cookie should be rejected (${result.response.status})`);

  stage = 'cookie reaches Mobile 35 Airport Desk';
  result = await request('/v1/v34/airport?icao=EGLL', {
    headers: { Cookie: cookie, Authorization: 'Bearer __skytrace_cookie_session__' }
  });
  if (result.response.status !== 403 || !/Airport Intelligence/i.test(result.payload.error || '')) {
    throw new Error(`Airport Desk account gate did not use remembered session (${result.response.status}: ${result.payload.error || ''})`);
  }

  stage = 'logout clears server session';
  result = await request('/v1/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie, Authorization: 'Bearer __skytrace_cookie_session__' }
  });
  if (!result.response.ok) throw new Error('logout failed');
  const cleared = result.response.headers.get('set-cookie') || '';
  if (!cleared.includes('skytrace_session=') || !/Max-Age=0/i.test(cleared)) throw new Error(`logout did not clear remembered cookie: ${cleared}`);

  stage = 'old cookie invalid after logout';
  result = await request('/v1/account', {
    headers: { Cookie: cookie, Authorization: 'Bearer __skytrace_cookie_session__' }
  });
  if (result.response.status !== 401) throw new Error(`logged-out cookie remained valid (${result.response.status})`);

  console.log('SkyTrace Mobile 35 smoke test passed: HttpOnly remembered login, sentinel rejection, Airport Desk auth and logout invalidation.');
} catch (error) {
  console.error(`Mobile 35 smoke failed during: ${stage}`);
  if (stdout.trim()) console.error(`SERVER STDOUT:\n${stdout}`);
  if (stderr.trim()) console.error(`SERVER STDERR:\n${stderr}`);
  throw error;
} finally {
  child.kill('SIGTERM');
  await sleep(150);
  fs.rmSync(tmp, { recursive: true, force: true });
}
