// /api/auth/* -> Neon Auth. vercel.json rewrites every path under /api/auth to this
// function, and the SDK's proxy forwards it upstream and passes the cookies back.
import { handleAuthProxyRequest } from '@neon/auth/server';
import { authConfig } from './_lib/auth.js';
import { json } from './_lib/http.js';

export default {
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const url = new URL(request.url);
    const path = url.pathname.match(/^\/api\/auth\/(.+)$/)?.[1] ?? url.searchParams.getAll('__path').join('/');
    if (!/^[\w-]+(\/[\w.-]+)*$/.test(path)) return json({ error: 'Not found' }, 404);
    url.searchParams.delete('__path');
    url.pathname = `/api/auth/${path}`;
    const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
    const clean = new Request(url, { method: request.method, headers: request.headers, body: body?.byteLength ? body : undefined });
    const upstream = await handleAuthProxyRequest({ request: clean, path, ...authConfig() });
    const headers = new Headers(upstream.headers);
    headers.set('cache-control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
