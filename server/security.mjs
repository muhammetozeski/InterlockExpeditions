const encoder = new TextEncoder();
export const day = 86400000;
export class ServiceError extends Error { constructor(status, message, code = 'invalid_request') { super(message); this.status = status; this.code = code; } }
export function fail(status, message, code) { throw new ServiceError(status, message, code); }
export function json(value, status = 200, cookie = null) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(value), { status, headers });
}
export function token() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
export async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function hmac(salt, value) { const key = await crypto.subtle.importKey('raw', encoder.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export async function derivedToken(salt, value) { const digest = await hmac(salt, value); return btoa(String.fromCharCode(...digest.match(/../g).map(pair => parseInt(pair, 16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
export function equalSecret(left, right) { if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index++) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }
export function identifier(value) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value ?? '')) fail(400, 'Choose a valid room or player identifier.'); return value; }
export function text(value, label, maximum, minimum = 1) { if (typeof value !== 'string') fail(400, `${label} must be text.`); const normalized = value.trim().normalize('NFC'); if (normalized.length < minimum || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) fail(400, `${label} must contain ${minimum}–${maximum} readable characters.`); return normalized; }
export function shape(value, fields) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) fail(400, 'This action contains unsupported fields.'); }
export function canonical(value, depth = 0) { if (depth > 12) fail(400, 'The action nesting limit is twelve.'); if (Array.isArray(value)) return value.map(child => canonical(child, depth + 1)); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key], depth + 1)])); return value; }
export async function bodyOf(request, maximum = 12000) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) fail(415, 'Send this action as JSON.');
  const raw = await rawBody(request, maximum);
  try { const value = JSON.parse(raw); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { fail(400, 'A valid JSON object is required.'); }
}
export async function rawBody(request, maximum) {
  const reader = request.body?.getReader(); if (!reader) fail(400, 'A request body is required.');
  const chunks = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > maximum) { await reader.cancel(); fail(413, 'The request is larger than this action allows.'); } chunks.push(value); }
  const buffer = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { fail(400, 'Use valid UTF-8 text.'); }
}
export function cookieValue(request, name) { const value = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1); return /^[A-Za-z0-9_-]{43}$/.test(value ?? '') ? value : null; }
export function cookie(name, value, maxAge = 2592000) { return `${name}=${value}; Path=/api; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`; }
export function sameOrigin(request) { if (request.headers.get('origin') !== new URL(request.url).origin) fail(403, 'Submit this action from Interlock Expeditions.', 'origin'); }
export async function accountOf(request, db) { const value = cookieValue(request, 'ie_account'); if (!value) return null; return db.prepare('SELECT a.id,a.alias,a.created_at AS createdAt FROM ie_accounts a JOIN ie_sessions s ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(value), Date.now()).first(); }
export function requireAccount(account) { if (!account) fail(401, 'Create a host account or recover your existing account to continue.', 'account_required'); return account; }
export async function premium(db, accountId) { return Boolean(await db.prepare("SELECT id FROM ie_subscriptions WHERE account_id=? AND status IN('active','trialing') AND live=1 AND expires_at>? LIMIT 1").bind(accountId, Date.now()).first()); }
export async function limit(db, identity, action, maximum, seconds = 60) { const bucket = Math.floor(Date.now() / (seconds * 1000)); const result = await db.prepare('INSERT INTO ie_limits(identity,action,bucket,count) VALUES(?,?,?,1) ON CONFLICT(identity,action,bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(identity, action, bucket, maximum).all(); if (!result.results?.length) fail(429, 'Too many actions in a short interval. Keep your room open and try again shortly.', 'rate_limit'); }
