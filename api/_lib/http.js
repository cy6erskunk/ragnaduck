/** JSON response. `cookies` are Set-Cookie strings to pass along (Neon Auth's session cache refresh). */
export function json(body, status = 200, { cookies = [], cache = 'no-store' } = {}) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': cache });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * True when a state-changing request was sent by a page on this site. Browsers always
 * send Origin on cross-site POSTs, so a foreign or missing Origin is refused.
 */
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function readJson(request) {
  try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; }
}

/** Routes map HTTP methods to handlers; anything else is a 405. */
export const route = handlers => ({
  async fetch(request) {
    const handler = handlers[request.method];
    if (!handler) return json({ error: 'Method not allowed' }, 405);
    if (request.method !== 'GET' && !sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
    return handler(request);
  },
});
