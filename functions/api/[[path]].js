import { accountRoutes } from '../../server/accounts.mjs';
import { roomRoutes } from '../../server/rooms.mjs';
import { billingRoutes } from '../../server/billing.mjs';
import { episodes } from '../../content/episodes.mjs';
import { GameError } from '../../server/engine.mjs';
import { accountOf, fail, hash, json, limit, sameOrigin, ServiceError } from '../../server/security.mjs';

/** Routes actual same-origin account and crew requests without logging submitted content or credentials. */
export async function onRequest({ request, env }) {
  try {
    if (!env.DB || !env.PRIVATE_SALT) fail(503, 'The room service is not configured. No local state is being presented as a shared room.');
    if (!['GET', 'POST'].includes(request.method)) fail(405, 'This method is not supported.');
    const url = new URL(request.url), parts = url.pathname.slice(4).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (request.method === 'POST' && parts.join('/') !== 'billing/webhook') sameOrigin(request);
    const identity = await hash(env.PRIVATE_SALT + '|' + (request.headers.get('CF-Connecting-IP') ?? 'unknown'));
    await limit(env.DB, identity, 'http-' + request.method, request.method === 'GET' ? 360 : 180);
    if (request.method === 'GET' && parts.join('/') === 'health') return json({ ok: true, product: 'Interlock Expeditions', engine: 'ie-stations-v1' });
    if (request.method === 'GET' && parts.join('/') === 'episodes') return json({ episodes: episodes.map(episode => ({ id: episode.id, version: episode.version, title: episode.title, minutes: episode.minutes, tagline: episode.tagline, introduction: episode.introduction, stations: episode.stages.length })) });
    const account = await accountOf(request, env.DB), context = { request, env, db: env.DB, account, parts, url, identity };
    for (const handler of [billingRoutes, accountRoutes, roomRoutes]) { const response = await handler(context); if (response) return response; }
    fail(404, 'This Interlock Expeditions action was not found.');
  } catch (error) {
    if (error instanceof ServiceError || error instanceof GameError) return json({ error: error.message, code: error.code ?? 'station' }, error.status);
    console.error('Interlock service action failed', { type: error?.name ?? 'Error' });
    return json({ error: 'The action could not be completed. Keep your room open and retry the same action identifier.', code: 'service_failure' }, 500);
  }
}
