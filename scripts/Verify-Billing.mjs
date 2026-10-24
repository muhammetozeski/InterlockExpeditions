import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';
import { hmac } from '../server/security.mjs';

// Consumer-side provider fixture: real production router/SQL/signature checks, no external requests or charges.
class Database {
  constructor() { this.native = new DatabaseSync(':memory:'); }
  prepare(sql) { const db = this; return { sql, values: [], bind(...values) { this.values = values; return this; }, async first() { return db.native.prepare(sql).get(...this.values) ?? null; }, async all() { return { results: db.native.prepare(sql).all(...this.values) }; }, async run() { return { meta: { changes: Number(db.native.prepare(sql).run(...this.values).changes) } }; } }; }
  async batch(items) { this.native.exec('BEGIN IMMEDIATE'); try { const results = items.map(item => ({ meta: { changes: Number(this.native.prepare(item.sql).run(...item.values).changes) } })); this.native.exec('COMMIT'); return results; } catch (e) { this.native.exec('ROLLBACK'); throw e; } }
}
const db = new Database(); for (const file of ['001-core.sql', '002-billing.sql']) db.native.exec(await readFile(new URL('../schema/' + file, import.meta.url), 'utf8'));
const env = { DB: db, PRIVATE_SALT: 'memory-only-salt', STRIPE_SECRET_KEY: 'sk_live_FixtureOnly', STRIPE_WEBHOOK_SECRET: 'whsec_FixtureOnly', STRIPE_CLUB_PRICE: 'price_ClubFixture' }, origin = 'https://interlock.example';
let checks = 0, cookie, otherCookie, accountId, sequence = 0, subscription, checkout, holdSubscription;
const providerNonces = new Map(), originalFetch = globalThis.fetch;
const check = (value, label) => { assert.ok(value, label); checks++; };
function active() { return { id: 'sub_Fixture', object: 'subscription', customer: 'cus_Fixture', status: 'active', livemode: true, current_period_end: Math.floor(Date.now() / 1000) + 3600, pause_collection: null, items: { data: [{ quantity: 1, price: { id: env.STRIPE_CLUB_PRICE, livemode: true } }] }, latest_invoice: { status: 'paid', paid: true, amount_paid: 1200, payment_intent: { status: 'succeeded', latest_charge: { paid: true, livemode: true, disputed: false, refunded: false, amount_refunded: 0 } } } }; }
globalThis.fetch = async (address, options = {}) => {
  const url = new URL(address); assert.equal(url.origin, 'https://api.stripe.com'); assert.equal(options.headers['Stripe-Version'], '2024-06-20');
  if (url.pathname.startsWith('/v1/prices/')) return Response.json({ id: env.STRIPE_CLUB_PRICE, active: true, livemode: true, type: 'recurring', currency: 'usd', unit_amount: 1200, recurring: { interval: 'month', interval_count: 1 } });
  if (url.pathname === '/v1/checkout/sessions' && options.method === 'POST') { const parameters = new URLSearchParams(options.body); assert.equal(parameters.get('client_reference_id'), accountId); assert.equal(parameters.get('line_items[0][price]'), env.STRIPE_CLUB_PRICE); const nonce = options.headers['Idempotency-Key']; if (!providerNonces.has(nonce)) providerNonces.set(nonce, { id: 'cs_live_Fixture' + providerNonces.size, livemode: true, expires_at: Math.floor(Date.now() / 1000) + 86400, url: 'https://checkout.stripe.com/c/pay/fixture', mode: 'subscription', status: 'open', payment_status: 'unpaid', client_reference_id: accountId, customer: 'cus_Fixture', subscription: 'sub_Fixture' }); checkout = providerNonces.get(nonce); return Response.json(checkout); }
  if (url.pathname.startsWith('/v1/checkout/sessions/')) return Response.json(checkout);
  if (url.pathname.startsWith('/v1/subscriptions/')) { const snapshot = structuredClone(subscription); if (holdSubscription) { const hold = holdSubscription; holdSubscription = null; hold.started(); await hold.wait; } return Response.json(snapshot); }
  if (url.pathname === '/v1/charges/ch_Fixture') return Response.json({ customer: 'cus_Fixture' });
  if (url.pathname === '/v1/billing_portal/sessions') return Response.json({ url: 'https://billing.stripe.com/p/session/fixture' });
  throw new Error('Unexpected fixture provider request');
};
async function call(path, body, session = cookie, override = env, headers = {}) { const request = new Request(origin + '/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.29', ...(session ? { Cookie: session } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }); const response = await onRequest({ request, env: override }); return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] }; }
async function notify(type, object, extra = {}, id) { const event = { id: id ?? 'evt_Fixture' + ++sequence, type, livemode: true, data: { object }, ...extra }, raw = JSON.stringify(event), timestamp = Math.floor(Date.now() / 1000), signature = await hmac(env.STRIPE_WEBHOOK_SECRET, timestamp + '.' + raw); return call('billing/webhook', raw, null, env, { 'Stripe-Signature': `t=${timestamp},v1=${signature}` }); }
const paid = async () => (await call('account')).body.premium;
try {
  const created = await call('accounts', { alias: 'Isolated billing fixture' }, null); cookie = created.cookie; accountId = created.body.account.id;
  otherCookie = (await call('accounts', { alias: 'Other isolated billing fixture' }, null)).cookie;
  const unavailable = { ...env, STRIPE_SECRET_KEY: '' };
  check((await call('billing/status', undefined, cookie, unavailable)).body.configured === false, 'Missing actual owner keys disables membership availability');
  check((await call('billing/checkout', { requestId: crypto.randomUUID() }, cookie, unavailable)).status === 503, 'Absent provider credentials cannot open checkout');
  check((await call('billing/checkout', { requestId: crypto.randomUUID() }, null)).status === 401, 'Checkout needs an actual host session');
  check((await call('billing/webhook', JSON.stringify({}), null)).status === 400, 'Unsigned body cannot activate membership');
  const result = await Promise.all([call('billing/checkout', { requestId: crypto.randomUUID() }), call('billing/checkout', { requestId: crypto.randomUUID() })]);
  check(result.every(value => value.status === 200) && providerNonces.size === 1, 'Different tabs share one open provider Checkout nonce');
  check(!(await paid()), 'Checkout creation and return destinations never activate membership');
  check((await call('account/delete', { confirmation: 'DELETE MY ACCOUNT' })).status === 409, 'Open provider checkout prevents irreversible account erasure');
  subscription = active(); checkout.status = 'complete'; checkout.payment_status = 'paid';
  check((await notify('checkout.session.completed', { id: checkout.id }, { livemode: false })).status === 200 && !(await paid()), 'Test-mode event cannot activate live allowance');
  const acceptedId = 'evt_AcceptedFixture';
  check((await notify('checkout.session.completed', { id: checkout.id }, {}, acceptedId)).status === 200 && await paid(), 'Signed notification plus canonical live paid period enables Club');
  check((await notify('checkout.session.completed', { id: checkout.id }, {}, acceptedId)).body.replay === true, 'Identical signed notification replay is idempotent');
  check((await notify('checkout.session.completed', { id: 'cs_live_Different' }, {}, acceptedId)).status === 409, 'Changed body cannot reuse an accepted provider event identity');
  check((await call('billing/status', undefined, otherCookie)).body.premium === false, 'Membership never leaks to another account');
  check((await call('billing/portal', {}, otherCookie)).status === 404, 'Other account cannot open owner billing portal');
  check((await call('billing/portal', {})).body.url.startsWith('https://billing.stripe.com/'), 'Recorded owner can request actual provider portal destination');
  check((await call('account/delete', { confirmation: 'DELETE MY ACCOUNT' })).status === 409, 'Paid account requires period expiry before erasure');
  subscription.cancel_at_period_end = true;
  await notify('customer.subscription.updated', { customer: 'cus_Fixture' }); check(await paid(), 'Period-end cancellation preserves already paid future period');
  subscription.status = 'canceled'; await notify('customer.subscription.deleted', { customer: 'cus_Fixture' }); check(!(await paid()), 'Canonical immediate cancellation revokes allowance');
  for (const [label, change] of [ ['wrong price', value => value.items.data[0].price.id = 'price_Other'], ['trial', value => value.status = 'trialing'], ['unpaid invoice', value => value.latest_invoice.paid = false], ['test subscription', value => value.livemode = false], ['partial refund', value => value.latest_invoice.payment_intent.latest_charge.amount_refunded = 1], ['dispute', value => value.latest_invoice.payment_intent.latest_charge.disputed = true], ['expired period', value => value.current_period_end = 1], ['extra subscription item', value => value.items.data.push(structuredClone(value.items.data[0]))] ]) { subscription = active(); change(subscription); await notify('customer.subscription.updated', { customer: 'cus_Fixture' }); check(!(await paid()), label + ' cannot grant capacity'); }
  subscription = active(); await notify('customer.subscription.updated', { customer: 'cus_Fixture' }); check(await paid(), 'A later valid canonical paid state can restore capacity');
  subscription.latest_invoice.payment_intent.latest_charge.disputed = true; await notify('charge.dispute.created', { charge: 'ch_Fixture' }); check(!(await paid()), 'Dispute follows its canonical charge customer before reconciliation');
  let started, release; const waiting = new Promise(resolve => started = resolve), pause = new Promise(resolve => release = resolve); subscription = active(); holdSubscription = { started, wait: pause };
  const old = notify('customer.subscription.updated', { customer: 'cus_Fixture' }); await waiting; subscription.status = 'canceled'; await notify('customer.subscription.deleted', { customer: 'cus_Fixture' }); release(); await old;
  check(!(await paid()), 'Older in-flight canonical read cannot overwrite a later canceled reconciliation');
  const timestamp = Math.floor(Date.now() / 1000) - 1000, raw = JSON.stringify({ id: 'evt_Old', type: 'checkout.session.completed', data: { object: { id: checkout.id } } });
  check((await call('billing/webhook', raw, null, env, { 'Stripe-Signature': `t=${timestamp},v1=${await hmac(env.STRIPE_WEBHOOK_SECRET, timestamp + '.' + raw)}` })).status === 400, 'Expired signed notification is rejected');
  check((await call('account/delete', { confirmation: 'DELETE MY ACCOUNT' })).status === 200, 'Ended paid period permits actual account erasure');
  console.log(`PASS ${checks} production billing/SQL checks against in-memory provider fixtures; no real provider charge or account was created.`);
} finally { globalThis.fetch = originalFetch; db.native.close(); }
