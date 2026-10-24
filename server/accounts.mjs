import { bodyOf, cookie, cookieValue, day, fail, hash, json, limit, premium, requireAccount, shape, text, token } from './security.mjs';

/** Creates secret-backed host accounts and real recoverable sessions; guest crews do not need an account. */
export async function accountRoutes(context) {
  const { request, db, account, parts, identity } = context, path = parts.join('/'), now = Date.now();
  if (request.method === 'GET' && path === 'account') return json({ account, premium: account ? await premium(db, account.id) : false });
  if (request.method !== 'POST') return null;
  if (path === 'accounts') {
    await limit(db, identity, 'create-account', 5, 3600);
    const body = await bodyOf(request); shape(body, ['alias']); const alias = text(body.alias, 'Host alias', 60), id = crypto.randomUUID(), recoveryKey = token(), session = token();
    await db.batch([db.prepare('INSERT INTO ie_accounts(id,alias,recovery_hash,created_at) VALUES(?,?,?,?)').bind(id, alias, await hash(recoveryKey), now), db.prepare('INSERT INTO ie_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await hash(session), id, now + 30 * day)]);
    return json({ account: { id, alias, createdAt: now }, recoveryKey, warning: 'Save this private recovery key. It is shown once and is the way to recover this account.' }, 201, cookie('ie_account', session));
  }
  if (path === 'sessions') {
    await limit(db, identity, 'recover-account', 12, 3600); const body = await bodyOf(request); shape(body, ['recoveryKey']); const found = await db.prepare('SELECT id,alias,created_at AS createdAt FROM ie_accounts WHERE recovery_hash=?').bind(await hash(text(body.recoveryKey, 'Recovery key', 43, 43))).first();
    if (!found) fail(401, 'The recovery key was not accepted.'); const session = token(); await db.prepare('INSERT INTO ie_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await hash(session), found.id, now + 30 * day).run(); return json({ account: found }, 200, cookie('ie_account', session));
  }
  if (path === 'logout') { const session = cookieValue(request, 'ie_account'); if (session) await db.prepare('DELETE FROM ie_sessions WHERE token_hash=?').bind(await hash(session)).run(); return json({ ok: true }, 200, cookie('ie_account', '', 0)); }
  if (path === 'account/delete') {
    requireAccount(account); const body = await bodyOf(request); shape(body, ['confirmation']); if (body.confirmation !== 'DELETE MY ACCOUNT') fail(400, 'Type DELETE MY ACCOUNT to erase this host account and its rooms.');
    if (await premium(db, account.id)) fail(409, 'Let the paid period end before deleting the host account.');
    if (await db.prepare('SELECT account_id FROM ie_checkout_locks WHERE account_id=? AND expires_at>? LIMIT 1').bind(account.id, now).first()) fail(409, 'An open checkout still belongs to this account. Let it expire before erasing the host account.');
    await db.prepare('DELETE FROM ie_accounts WHERE id=?').bind(account.id).run(); return json({ ok: true }, 200, cookie('ie_account', '', 0));
  }
  return null;
}
