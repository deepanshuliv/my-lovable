import type { ServerWebSocket } from 'bun';
import { getCachedPreviewUrl, getPreviewToken } from '@repo/redis';
import { envInt } from '@repo/shared';

export const PREVIEW_PROXY_PORT = envInt('PREVIEW_PROXY_PORT', 8001);
export const PREVIEW_PROXY_URL = process.env.PREVIEW_PROXY_URL ?? `http://{id}.preview.localhost:${PREVIEW_PROXY_PORT}`;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'host',
  'content-length',
  'accept-encoding',
]);

export function proxiedPreviewUrl(projectId: string): string | null {
  if (!PREVIEW_PROXY_URL || PREVIEW_PROXY_URL === 'off') return null;
  return PREVIEW_PROXY_URL.replace('{id}', projectId);
}

export function projectIdFromHost(host: string | null): string | null {
  const label = (host ?? '').split(':')[0]?.split('.')[0] ?? '';
  return /^[0-9a-f-]{36}$/i.test(label) ? label : null;
}

async function upstreamFor(projectId: string): Promise<{ origin: string; token: string | null } | null> {
  const url = await getCachedPreviewUrl(projectId).catch(() => null);
  if (!url) return null;
  return { origin: new URL(url).origin, token: await getPreviewToken(projectId).catch(() => null) };
}

function daytonaHeaders(upstreamOrigin: string, token: string | null): Record<string, string> {
  return {
    'X-Daytona-Skip-Preview-Warning': 'true',
    ...(token ? { 'X-Daytona-Preview-Token': token } : {}),
    host: new URL(upstreamOrigin).host,
  };
}

function waitingPage(message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Waking up your preview</title><body style="font-family:system-ui,sans-serif;background:#0b0b0c;color:#a1a1aa;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><p style="color:#fff;font-size:15px;margin:0 0 6px">${message}</p><p style="font-size:13px;margin:0">This takes a few seconds. The page will refresh on its own.</p></div></body>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '3', 'cache-control': 'no-store' } },
  );
}

function notReady(): Response {
  return waitingPage('Starting the preview…');
}

export async function isSandboxAsleep(response: Response): Promise<boolean> {
  if (response.status < 400 || response.status === 401 || response.status === 403 || response.status === 404) return false;
  if (!(response.headers.get('content-type') ?? '').includes('json')) return false;
  const body = await response.clone().text().catch(() => '');
  return /SANDBOX_NOT_RUNNING|SANDBOX_(STOPPED|ARCHIVED|NOT_STARTED)|Is the Sandbox started|sandbox is (stopped|archived|not running|starting)/i.test(body);
}

type SocketData = { upstreamUrl: string; headers: Record<string, string>; protocols: string[]; upstream?: WebSocket; queue: (string | Buffer)[] };

export function startPreviewProxy() {
  if (!proxiedPreviewUrl('x')) return null;

  let server: ReturnType<typeof Bun.serve<SocketData>>;
  try {
    server = Bun.serve<SocketData>({
      port: PREVIEW_PROXY_PORT,
      idleTimeout: 120,
      async fetch(request, server) {
        const projectId = projectIdFromHost(request.headers.get('host'));
        if (!projectId) return new Response('unknown preview', { status: 404 });
        const upstream = await upstreamFor(projectId);
        if (!upstream) return notReady();

        const incoming = new URL(request.url);
        const target = `${upstream.origin}${incoming.pathname}${incoming.search}`;

        if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
          const protocols = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map((p) => p.trim()).filter(Boolean);
          const upgraded = server.upgrade(request, {
            data: {
              upstreamUrl: target.replace(/^http/, 'ws'),
              headers: { ...daytonaHeaders(upstream.origin, upstream.token), origin: upstream.origin },
              protocols,
              queue: [],
            },
          });
          return upgraded ? undefined : new Response('websocket upgrade failed', { status: 400 });
        }

        const headers = new Headers();
        request.headers.forEach((value, key) => {
          if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
        });
        for (const [key, value] of Object.entries(daytonaHeaders(upstream.origin, upstream.token))) headers.set(key, value);
        if (headers.has('origin')) headers.set('origin', upstream.origin);
        const referer = headers.get('referer');
        if (referer) headers.set('referer', referer.replace(incoming.origin, upstream.origin));

        let response: Response;
        try {
          response = await fetch(target, {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
            redirect: 'manual',
          });
        } catch (error) {
          console.log('[PREVIEW_PROXY_UPSTREAM_FAILED] , ', projectId, String(error).slice(0, 160));
          return notReady();
        }

        if (await isSandboxAsleep(response)) return waitingPage('Waking up your preview…');

        const out = new Headers(response.headers);
        out.delete('content-encoding');
        out.delete('content-length');
        out.delete('transfer-encoding');
        const location = out.get('location');
        if (location?.startsWith(upstream.origin)) out.set('location', location.replace(upstream.origin, incoming.origin));
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
      },
      websocket: {
        open(socket: ServerWebSocket<SocketData>) {
          const upstream = new WebSocket(socket.data.upstreamUrl, {
            headers: socket.data.headers,
            ...(socket.data.protocols.length > 0 ? { protocols: socket.data.protocols } : {}),
          } as unknown as string[]);
          socket.data.upstream = upstream;
          upstream.binaryType = 'arraybuffer';
          upstream.onopen = () => {
            for (const message of socket.data.queue.splice(0)) upstream.send(message);
          };
          upstream.onmessage = (event) => socket.send(event.data as string | ArrayBuffer);
          upstream.onclose = () => socket.close();
          upstream.onerror = () => socket.close();
        },
        message(socket: ServerWebSocket<SocketData>, message) {
          const upstream = socket.data.upstream;
          if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
          else socket.data.queue.push(message);
        },
        close(socket: ServerWebSocket<SocketData>) {
          socket.data.upstream?.close();
        },
      },
    });

  } catch (error) {
    console.log(`[PREVIEW_PROXY_DISABLED] could not listen on ${PREVIEW_PROXY_PORT}: ${String(error).slice(0, 120)}`);
    return null;
  }
  console.log(`[PREVIEW_PROXY] serving previews at ${proxiedPreviewUrl('{project}')}`);
  return server;
}
