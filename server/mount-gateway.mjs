const MAIN_ORIGIN = 'https://muhammetozeski-binsite.pages.dev';
const LEGACY_ORIGIN = 'https://muhammetozeski-interlock-expeditions.pages.dev';
const BASE_PATH = '/interlock-expeditions/';
const API_PATH = BASE_PATH + 'api/';
const HEADER_PREFIX = 'x-ie-gateway-';
const MAX_BODY = 12000;
const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX = /^[a-f0-9]{64}$/;

function refused(status = 403, message = 'This request was not accepted.') {
  return new Response(JSON.stringify({ error: message, code: 'mount_gateway' }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
function secretReady(value) { return typeof value === 'string' && value.length >= 32 && value.length <= 256; }
async function digest(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function key(value, usage) { return crypto.subtle.importKey('raw', encoder.encode(value), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]); }
async function sign(secret, message) { return [...new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret, 'sign'), encoder.encode(message)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function verify(secret, signature, message) { return HEX.test(signature ?? '') && crypto.subtle.verify('HMAC', await key(secret, 'verify'), Uint8Array.from(signature.match(/../g), pair => parseInt(pair, 16)), encoder.encode(message)); }
function allowed(method, route) {
  const parts = route.split('/');
  if (method === 'GET') return ['health', 'episodes', 'account', 'rooms', 'billing/status'].includes(route) || parts.length === 3 && parts[0] === 'rooms' && UUID.test(parts[1]) && ['play', 'control'].includes(parts[2]);
  if (method === 'POST') return ['accounts', 'sessions', 'logout', 'account/delete', 'rooms', 'billing/checkout', 'billing/portal'].includes(route) || parts.length === 3 && parts[0] === 'rooms' && UUID.test(parts[1]) && ['join', 'action', 'host', 'report', 'delete'].includes(parts[2]);
  return false;
}
function logicalRoute(path, method) {
  if (typeof path !== 'string' || path.length > 2048 || !path.startsWith(API_PATH)) return null;
  const url = new URL(MAIN_ORIGIN + path);
  if (url.origin !== MAIN_ORIGIN || url.hash || url.pathname + url.search !== path) return null;
  const route = url.pathname.slice(API_PATH.length);
  return allowed(method, route) ? { url, route } : null;
}
function forwardedHeaders(request) {
  const headers = new Headers(), origin = request.headers.get('Origin') ?? '';
  if (origin) headers.set('Origin', origin);
  const contentType = request.headers.get('Content-Type');
  if (contentType) { if (contentType.length > 120) throw new Error('header'); headers.set('Content-Type', contentType); }
  const cookies = [];
  for (const name of ['ie_account', 'ie_guest']) {
    const values = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
    if (values.length > 1) throw new Error('cookie');
    const value = values[0]?.slice(name.length + 1);
    if (value && /^[A-Za-z0-9_-]{43}$/.test(value)) cookies.push(name + '=' + value);
  }
  if (cookies.length) headers.set('Cookie', cookies.join('; '));
  for (const name of ['X-IE-Player', 'X-IE-Key']) {
    const value = request.headers.get(name); if (value) { if (!(name === 'X-IE-Player' ? UUID : HEX).test(value)) throw new Error('player'); headers.set(name, value); }
  }
  return headers;
}
async function authorityDigest(headers, client) {
  return digest(encoder.encode(JSON.stringify([headers.get('Content-Type') ?? '', headers.get('Cookie') ?? '', headers.get('X-IE-Player') ?? '', headers.get('X-IE-Key') ?? '', client])));
}
async function bodyBytes(request) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_BODY) { await reader.cancel(); throw new RangeError('body'); } chunks.push(value); }
  const result = new Uint8Array(length); let offset = 0; for (const part of chunks) { result.set(part, offset); offset += part.byteLength; } return result;
}
function signedMessage(method, path, origin, bodyHash, timestamp, authority) { return JSON.stringify(['v1', method, path, origin, bodyHash, timestamp, authority]); }
function responseHeaders(response) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : response.headers.get('Set-Cookie') ? [response.headers.get('Set-Cookie')] : [];
  for (const cookie of cookies) {
    const parts = cookie.split(';').map(part => part.trim());
    if (!['ie_account', 'ie_guest'].includes(parts[0].split('=')[0]) || parts.some(part => part.toLowerCase().startsWith('domain=')) || !parts.includes('Path=' + BASE_PATH + 'api') || !parts.includes('HttpOnly') || !parts.includes('Secure')) throw new Error('cookie scope');
    headers.append('Set-Cookie', cookie);
  }
  return headers;
}

/** A fixed-destination transport for the main host; unrelated cookies and browser gateway headers are discarded. */
export async function relayMountedRequest({ request, env }) {
  try {
    const url = new URL(request.url), path = url.pathname + url.search;
    if (url.origin !== MAIN_ORIGIN) return refused(404);
    const route = logicalRoute(path, request.method); if (!route) return refused(404);
    const origin = request.headers.get('Origin') ?? '';
    if (request.method === 'POST' ? origin !== MAIN_ORIGIN : origin && origin !== MAIN_ORIGIN) return refused();
    if (!secretReady(env.INTERLOCK_GATEWAY_SECRET)) return refused(503, 'Rooms are temporarily unavailable.');
    const headers = forwardedHeaders(request), body = await bodyBytes(request), timestamp = String(Math.floor(Date.now() / 1000));
    const client = await sign(env.INTERLOCK_GATEWAY_SECRET, 'rate|' + (request.headers.get('CF-Connecting-IP') ?? 'unknown'));
    const authority = await authorityDigest(headers, client), signature = await sign(env.INTERLOCK_GATEWAY_SECRET, signedMessage(request.method, path, origin, await digest(body), timestamp, authority));
    headers.set(HEADER_PREFIX + 'version', 'v1'); headers.set(HEADER_PREFIX + 'timestamp', timestamp); headers.set(HEADER_PREFIX + 'path', path); headers.set(HEADER_PREFIX + 'client', client); headers.set(HEADER_PREFIX + 'signature', signature);
    const destination = LEGACY_ORIGIN + '/api/' + route.route + url.search;
    const response = await fetch(destination, { method: request.method, headers, ...(request.method === 'POST' ? { body } : {}), redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!(response.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json') || response.status < 200 || response.status >= 300 && response.status < 400) return refused(502, 'Rooms could not respond. Try again.');
    return new Response(response.body, { status: response.status, headers: responseHeaders(response) });
  } catch (error) { return refused(error instanceof RangeError ? 413 : 502, error instanceof RangeError ? 'This action is too large.' : 'Rooms could not respond. Try again.'); }
}

/** Verifies transport authority before constructing a logical main-host Request. Direct legacy traffic stays unchanged. */
export async function authenticateMountedRequest(request, env) {
  if (![...request.headers.keys()].some(name => name.toLowerCase().startsWith(HEADER_PREFIX))) return { request, env };
  try {
    const physical = new URL(request.url), path = request.headers.get(HEADER_PREFIX + 'path'), route = logicalRoute(path, request.method);
    if (physical.origin !== LEGACY_ORIGIN || !route || physical.pathname + physical.search !== '/api/' + route.route + route.url.search || request.headers.get(HEADER_PREFIX + 'version') !== 'v1' || !secretReady(env.TRUSTED_GATEWAY_SECRET)) return refused();
    const timestamp = request.headers.get(HEADER_PREFIX + 'timestamp') ?? '', client = request.headers.get(HEADER_PREFIX + 'client') ?? '', origin = request.headers.get('Origin') ?? '';
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 || !HEX.test(client) || (request.method === 'POST' ? origin !== MAIN_ORIGIN : origin && origin !== MAIN_ORIGIN)) return refused();
    const headers = forwardedHeaders(request), body = await bodyBytes(request), message = signedMessage(request.method, path, origin, await digest(body), timestamp, await authorityDigest(headers, client));
    if (!await verify(env.TRUSTED_GATEWAY_SECRET, request.headers.get(HEADER_PREFIX + 'signature'), message)) return refused();
    headers.set('CF-Connecting-IP', 'gateway:' + client);
    const logical = new Request(route.url, { method: request.method, headers, ...(request.method === 'POST' ? { body } : {}) });
    return { request: logical, env: { ...env, APP_BASE_PATH: BASE_PATH } };
  } catch (error) { return refused(error instanceof RangeError ? 413 : 403); }
}
