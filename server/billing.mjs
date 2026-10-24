import { bodyOf, equalSecret, fail, hash, hmac, identifier, json, limit, premium, rawBody, requireAccount, shape } from './security.mjs';

// This integration deliberately pins the older Stripe representation used by its payment/period checks.
const apiVersion = '2024-06-20';
export function billingConfigured(env) { return /^sk_live_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? '') && /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET ?? '') && /^price_[A-Za-z0-9]+$/.test(env.STRIPE_CLUB_PRICE ?? ''); }
function configured(env) { if (!billingConfigured(env)) fail(503, 'Club checkout is not configured. Free expeditions remain available.'); }
function objectId(value, prefix) { const result = typeof value === 'string' ? value : value?.id, pattern = prefix === 'cs' ? /^cs_(live|test)_[A-Za-z0-9]+$/ : new RegExp('^' + prefix + '_[A-Za-z0-9]+$'); if (!pattern.test(result ?? '')) fail(400, 'The payment reference is invalid.'); return result; }
async function stripe(env, path, parameters = null, nonce = null) {
  const headers = { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Stripe-Version': apiVersion }; if (parameters) headers['Content-Type'] = 'application/x-www-form-urlencoded'; if (nonce) headers['Idempotency-Key'] = nonce;
  const response = await fetch('https://api.stripe.com/v1/' + path, { method: parameters ? 'POST' : 'GET', headers, body: parameters ? new URLSearchParams(parameters) : undefined });
  if (!response.ok) fail(502, 'The payment provider could not complete this action. No local payment was assumed.');
  return response.json();
}
async function clubPrice(env) {
  const price = await stripe(env, 'prices/' + env.STRIPE_CLUB_PRICE);
  if (price.id !== env.STRIPE_CLUB_PRICE || !price.active || price.livemode !== true || price.type !== 'recurring' || !['month', 'year'].includes(price.recurring?.interval) || !Number.isInteger(price.unit_amount) || price.unit_amount <= 0 || !/^[a-z]{3}$/.test(price.currency)) fail(503, 'The configured Club price is not an active live recurring price.');
  return price;
}
function redirect(value, host) { const url = new URL(value); if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) fail(502, 'The provider returned an unsupported destination.'); return url.href; }
async function subscriptionState(env, subscriptionId) {
  const subscription = await stripe(env, 'subscriptions/' + subscriptionId + '?expand[]=latest_invoice.payment_intent.latest_charge');
  if (subscription.id !== subscriptionId || subscription.object !== 'subscription') fail(502, 'The provider returned a different subscription.');
  const item = subscription.items?.data?.find(value => value.price?.id === env.STRIPE_CLUB_PRICE), invoice = subscription.latest_invoice, intent = invoice?.payment_intent, charge = intent?.latest_charge;
  const paid = subscription.livemode === true && subscription.status === 'active' && !subscription.pause_collection && subscription.items?.data?.length === 1 && item?.quantity === 1 && item.price?.livemode === true && invoice?.status === 'paid' && invoice.paid === true && invoice.amount_paid > 0 && intent?.status === 'succeeded' && charge?.paid === true && charge.livemode === true && !charge.disputed && !charge.refunded && charge.amount_refunded === 0;
  const periodEnd = subscription.current_period_end;
  const expiresAt = paid && Number.isSafeInteger(periodEnd) && periodEnd * 1000 > Date.now() ? periodEnd * 1000 : 0;
  return { id: subscriptionId, customer: objectId(subscription.customer, 'cus'), status: subscription.status, live: subscription.livemode === true ? 1 : 0, expiresAt };
}
/** A later started reconciliation cannot be overwritten by an older in-flight provider read. */
async function synchronize(context, subscriptionId, accountId, expectedCustomer) {
  const { db, env } = context;
  const generation = await db.prepare('INSERT INTO ie_billing_sync(subscription_id,generation) VALUES(?,1) ON CONFLICT(subscription_id) DO UPDATE SET generation=generation+1 RETURNING generation').bind(subscriptionId).first();
  const state = await subscriptionState(env, subscriptionId);
  if (state.customer !== expectedCustomer) fail(409, 'The subscription customer does not match the recorded checkout.');
  await db.prepare('INSERT INTO ie_subscriptions(id,account_id,customer_id,status,live,expires_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ie_accounts WHERE id=?) AND EXISTS(SELECT 1 FROM ie_billing_sync WHERE subscription_id=? AND generation=?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,live=excluded.live,expires_at=excluded.expires_at,updated_at=excluded.updated_at WHERE ie_subscriptions.account_id=excluded.account_id AND ie_subscriptions.customer_id=excluded.customer_id').bind(state.id, accountId, state.customer, state.status, state.live, state.expiresAt, Date.now(), accountId, subscriptionId, generation.generation).run();
}
async function verifiedEvent(request, env) {
  const raw = await rawBody(request, 100000), parts = (request.headers.get('Stripe-Signature') ?? '').split(',').map(item => item.split('='));
  const times = parts.filter(([key]) => key === 't').map(([, value]) => value), signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (times.length !== 1 || !/^\d+$/.test(times[0]) || Math.abs(Date.now() / 1000 - Number(times[0])) > 300) fail(400, 'The payment notification timestamp was not accepted.');
  const expected = await hmac(env.STRIPE_WEBHOOK_SECRET, times[0] + '.' + raw);
  if (!signatures.some(signature => equalSecret(signature, expected))) fail(400, 'The payment notification signature was not accepted.');
  let event; try { event = JSON.parse(raw); } catch { fail(400, 'The payment notification is not valid JSON.'); }
  if (!/^evt_[A-Za-z0-9]+$/.test(event.id ?? '') || typeof event.type !== 'string' || !event.data?.object) fail(400, 'The payment notification is incomplete.');
  return { event, digest: await hash(raw) };
}
async function webhook(context) {
  const { request, db, env } = context; configured(env);
  const { event, digest } = await verifiedEvent(request, env);
  const previous = await db.prepare('SELECT signature FROM ie_billing_events WHERE id=?').bind(event.id).first();
  if (previous) { if (previous.signature !== digest) fail(409, 'A payment event identifier was reused with a different body.'); return json({ received: true, replay: true }); }
  if (event.livemode !== true) return json({ received: true, ignored: 'test_mode' });
  const object = event.data.object;
  if (event.type === 'checkout.session.completed') {
    const id = objectId(object.id, 'cs'), checkout = await db.prepare('SELECT account_id FROM ie_checkouts WHERE id=?').bind(id).first();
    if (checkout) {
      const session = await stripe(env, 'checkout/sessions/' + id);
      if (session.id !== id || session.livemode !== true || session.mode !== 'subscription' || session.status !== 'complete' || session.payment_status !== 'paid' || session.client_reference_id !== checkout.account_id) fail(409, 'The completed checkout does not match the host account.');
      await synchronize(context, objectId(session.subscription, 'sub'), checkout.account_id, objectId(session.customer, 'cus'));
      await db.prepare('UPDATE ie_checkout_requests SET completed=1 WHERE session_id=?').bind(id).run();
      await db.prepare('UPDATE ie_checkout_locks SET expires_at=0 WHERE account_id=?').bind(checkout.account_id).run();
    }
  } else if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].includes(event.type)) {
    // Account ownership comes from our recorded checkout, never webhook/client metadata.
    const source = event.type.startsWith('charge.dispute.') ? await stripe(env, 'charges/' + objectId(object.charge, 'ch')) : object;
    const customer = source.customer ? objectId(source.customer, 'cus') : null;
    const rows = customer ? (await db.prepare('SELECT id,account_id,customer_id FROM ie_subscriptions WHERE customer_id=?').bind(customer).all()).results : [];
    for (const row of rows) await synchronize(context, row.id, row.account_id, row.customer_id);
  }
  await db.prepare('INSERT OR IGNORE INTO ie_billing_events(id,signature,created_at) VALUES(?,?,?)').bind(event.id, digest, Date.now()).run();
  return json({ received: true });
}

/** Actual provider checkout and signed canonical reconciliation; absent keys never unlock Club. */
export async function billingRoutes(context) {
  const { request, db, account, env, parts, url, basePath = '/' } = context, path = parts.join('/'); if (!path.startsWith('billing/')) return null;
  if (request.method === 'POST' && path === 'billing/webhook') return webhook(context);
  if (request.method === 'GET' && path === 'billing/status') {
    const ready = billingConfigured(env), price = ready ? await clubPrice(env) : null;
    const subscription = account ? await db.prepare('SELECT status,expires_at AS expiresAt FROM ie_subscriptions WHERE account_id=? ORDER BY expires_at DESC LIMIT 1').bind(account.id).first() : null;
    return json({ configured: ready, premium: account ? await premium(db, account.id) : false, signedIn: Boolean(account), price: price ? { amount: price.unit_amount, currency: price.currency, interval: price.recurring.interval, intervalCount: price.recurring.interval_count } : null, subscription });
  }
  if (request.method !== 'POST') return null;
  if (path === 'billing/checkout') {
    requireAccount(account); configured(env); const body = await bodyOf(request); shape(body, ['requestId']); const nonce = identifier(body.requestId);
    await limit(db, account.id, 'checkout', 12, 3600);
    if (await premium(db, account.id)) fail(409, 'Club is already active. Use Manage subscription instead.');
    await clubPrice(env);
    // Two tabs still use one open Checkout. The database chooses the provider nonce before a network call.
    await db.prepare('INSERT INTO ie_checkout_locks(account_id,request_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM ie_accounts WHERE id=?) ON CONFLICT(account_id) DO UPDATE SET request_id=excluded.request_id,expires_at=excluded.expires_at WHERE ie_checkout_locks.expires_at<=?').bind(account.id, nonce, Date.now() + 86400000, account.id, Date.now()).run();
    const lock = await db.prepare('SELECT request_id FROM ie_checkout_locks WHERE account_id=?').bind(account.id).first(); if (!lock) fail(401, 'This host account is no longer available.');
    const session = await stripe(env, 'checkout/sessions', { mode: 'subscription', 'line_items[0][price]': env.STRIPE_CLUB_PRICE, 'line_items[0][quantity]': '1', 'payment_method_types[0]': 'card', client_reference_id: account.id, success_url: url.origin + basePath + 'membership?checkout=returned', cancel_url: url.origin + basePath + 'membership?checkout=cancelled' }, 'interlock:' + account.id + ':' + lock.request_id);
    const id = objectId(session.id, 'cs'); if (session.livemode !== true || !Number.isSafeInteger(session.expires_at)) fail(502, 'The provider did not return a live checkout.');
    await db.batch([db.prepare('INSERT OR IGNORE INTO ie_checkouts(id,account_id,created_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM ie_accounts WHERE id=?)').bind(id, account.id, Date.now(), account.id), db.prepare('INSERT OR IGNORE INTO ie_checkout_requests(account_id,request_id,session_id,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM ie_accounts WHERE id=?)').bind(account.id, lock.request_id, id, session.expires_at * 1000, account.id), db.prepare('UPDATE ie_checkout_locks SET expires_at=? WHERE account_id=? AND request_id=?').bind(session.expires_at * 1000, account.id, lock.request_id)]);
    const owned = await db.prepare('SELECT id FROM ie_checkouts WHERE id=? AND account_id=?').bind(id, account.id).first(); if (!owned) fail(401, 'This host account is no longer available.');
    return json({ url: redirect(session.url, 'checkout.stripe.com') });
  }
  if (path === 'billing/portal') {
    requireAccount(account); configured(env); const body = await bodyOf(request); shape(body, []);
    await limit(db, account.id, 'billing-portal', 12, 3600);
    const subscription = await db.prepare('SELECT customer_id FROM ie_subscriptions WHERE account_id=? ORDER BY updated_at DESC LIMIT 1').bind(account.id).first(); if (!subscription) fail(404, 'No recorded subscription belongs to this host account.');
    const session = await stripe(env, 'billing_portal/sessions', { customer: subscription.customer_id, return_url: url.origin + basePath + 'membership' });
    return json({ url: redirect(session.url, 'billing.stripe.com') });
  }
  return null;
}
