import { episodeById } from '../content/episodes.mjs';
import { applyAction, initialStation, shiftStationClock, stationView } from './engine.mjs';
import { bodyOf, canonical, cookie, cookieValue, day, derivedToken, equalSecret, fail, hash, hmac, identifier, json, limit, premium, requireAccount, shape, text, token } from './security.mjs';

/** Derives an invitation without storing its printable code in the database. */
async function invitation(room, salt) { return (await hmac(salt, 'invite|' + room.id + '|' + room.invite_nonce)).slice(0, 8).toUpperCase(); }
async function playerKey(player, salt) { return hmac(salt, 'player|' + player.room_id + '|' + player.id + '|' + player.token_hash); }

/** Reads a room and materializes an elapsed authoritative timer without reopening finished play. */
async function roomOf(db, roomId) {
  identifier(roomId); let room = await db.prepare('SELECT * FROM ie_rooms WHERE id=?').bind(roomId).first();
  if (!room) fail(404, 'This room is unavailable.');
  if (room.status === 'active' && room.deadline <= Date.now()) {
    await db.prepare("UPDATE ie_rooms SET status='finished',outcome='timeout',remaining_ms=0,finished_at=?,updated_at=?,revision=revision+1 WHERE id=? AND status='active' AND deadline<=?").bind(Date.now(), Date.now(), room.id, Date.now()).run();
    room = await db.prepare('SELECT * FROM ie_rooms WHERE id=?').bind(room.id).first();
  }
  return room;
}
function remaining(room, now = Date.now()) { return room.status === 'active' ? Math.max(0, room.deadline - now) : room.status === 'lobby' ? room.duration_ms : Math.max(0, room.remaining_ms ?? 0); }
function roomSummary(room) { return { id: room.id, title: room.title, episodeId: room.episode_id, episodeVersion: room.episode_version, status: room.status, outcome: room.outcome, stageIndex: room.stage_index, revision: room.revision, capacity: room.capacity, remainingMs: remaining(room), serverNow: Date.now(), pausedAt: room.paused_at, mistakes: room.mistakes, createdAt: room.created_at, startedAt: room.started_at, finishedAt: room.finished_at }; }
async function roster(db, roomId) { return (await db.prepare('SELECT id,alias,role,joined_at AS joinedAt,seen_at AS seenAt FROM ie_players WHERE room_id=? AND left_at IS NULL ORDER BY joined_at,id').bind(roomId).all()).results; }
async function recentEvents(db, roomId) { return (await db.prepare('SELECT kind,message,created_at AS createdAt FROM ie_events WHERE room_id=? ORDER BY created_at DESC,id LIMIT 12').bind(roomId).all()).results; }
async function ownerRoom(db, roomId, account) { requireAccount(account); const room = await roomOf(db, roomId); if (room.owner_id !== account.id) fail(404, 'This room does not belong to this host account.'); return room; }

/** Authorizes either the private HttpOnly guest cookie or an explicit per-room recovery capability. */
async function playerOf(context, roomId) {
  const { request, db, env } = context; identifier(roomId);
  const headerId = request.headers.get('X-IE-Player'), key = request.headers.get('X-IE-Key'); let player;
  if (headerId || key) {
    if (!/^[0-9a-f]{64}$/.test(key ?? '')) fail(404, 'This private player identity is unavailable.');
    identifier(headerId); player = await db.prepare('SELECT * FROM ie_players WHERE id=? AND room_id=? AND left_at IS NULL').bind(headerId, roomId).first();
    if (!player || !equalSecret(await playerKey(player, env.PRIVATE_SALT), key)) fail(404, 'This private player identity is unavailable.');
  } else {
    const guest = cookieValue(request, 'ie_guest');
    if (guest) player = await db.prepare('SELECT * FROM ie_players WHERE room_id=? AND token_hash=? AND left_at IS NULL').bind(roomId, await hash(guest)).first();
    if (!player) fail(401, 'Join this room with its invitation or restore this browser’s saved player.', 'join_required');
  }
  return player;
}

/** Rechecks membership when constructing a private view; only that crew's current card is transmitted. */
async function playView(context, roomId, playerId) {
  const { db, env } = context, room = await roomOf(db, roomId), player = await db.prepare('SELECT * FROM ie_players WHERE id=? AND room_id=? AND left_at IS NULL').bind(playerId, roomId).first();
  if (!player) fail(403, 'The host removed this player from the room.');
  await db.prepare('UPDATE ie_players SET seen_at=? WHERE id=? AND left_at IS NULL AND seen_at<?').bind(Date.now(), player.id, Date.now() - 30000).run();
  const episode = JSON.parse(room.episode_snapshot), stage = episode.stages[room.stage_index];
  return { room: roomSummary(room), player: { id: player.id, alias: player.alias, role: player.role }, playerKey: await playerKey(player, env.PRIVATE_SALT), episodeTitle: episode.title, introduction: episode.introduction, ending: room.outcome === 'escaped' ? episode.ending : '', stageCount: episode.stages.length, station: room.status === 'active' || room.status === 'paused' ? stationView(stage, JSON.parse(room.state), player.role) : null, players: await roster(db, room.id), events: await recentEvents(db, room.id) };
}
async function controlView(context, room) { const episode = JSON.parse(room.episode_snapshot); return { room: roomSummary(room), episodeTitle: episode.title, stageCount: episode.stages.length, currentStation: episode.stages[room.stage_index]?.title ?? 'Expedition complete', invitation: await invitation(room, context.env.PRIVATE_SALT), players: await roster(context.db, room.id), events: await recentEvents(context.db, room.id) }; }

/** Same-nonce recovery reads current authorized state and never repeats a previously applied machine action. */
async function previouslyApplied(db, roomId, actor, nonce, signature) { const prior = await db.prepare('SELECT signature FROM ie_actions WHERE room_id=? AND actor=? AND nonce=?').bind(roomId, actor, nonce).first(); if (!prior) return false; if (prior.signature !== signature) fail(409, 'This action identifier already belongs to different controls.'); return true; }

/** Persistent tenant, invitation, crew and room lifecycle endpoints. */
export async function roomRoutes(context) {
  const { request, db, account, parts, env, identity } = context, now = Date.now(); if (parts[0] !== 'rooms') return null;
  if (request.method === 'GET' && parts.length === 1) {
    requireAccount(account); const rows = await db.prepare('SELECT * FROM ie_rooms WHERE owner_id=? ORDER BY updated_at DESC LIMIT 50').bind(account.id).all();
    return json({ rooms: rows.results.map(roomSummary), premium: await premium(db, account.id) });
  }
  if (request.method === 'POST' && parts.length === 1) {
    requireAccount(account); await limit(db, account.id, 'new-room', 10, 3600); const body = await bodyOf(request); shape(body, ['requestId', 'episodeId', 'title', 'durationMinutes']);
    const nonce = identifier(body.requestId), actor = 'host:' + account.id, signature = await hash(JSON.stringify(canonical(body)));
    const old = await db.prepare('SELECT room_id,signature FROM ie_actions WHERE actor=? AND nonce=? AND kind=?').bind(actor, nonce, 'created').first();
    if (old) { if (old.signature !== signature) fail(409, 'This room-creation identifier was already used with different settings.'); return json(await controlView(context, await ownerRoom(db, old.room_id, account)), 201); }
    const episode = episodeById(body.episodeId); if (!episode) fail(400, 'Choose an available authored episode.');
    const duration = body.durationMinutes ?? episode.minutes; if (!Number.isInteger(duration) || duration < 5 || duration > 90) fail(400, 'Choose a duration from 5 to 90 minutes.');
    const paid = await premium(db, account.id), roomId = crypto.randomUUID(), inviteNonce = token(), room = { id: roomId, invite_nonce: inviteNonce }, code = await invitation(room, env.PRIVATE_SALT), write = crypto.randomUUID(), maximum = paid ? 12 : 2;
    const result = await db.batch([
      db.prepare("INSERT INTO ie_rooms(id,owner_id,title,episode_id,episode_version,episode_snapshot,invite_nonce,join_hash,capacity,state,duration_ms,created_at,updated_at,last_write) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ie_accounts WHERE id=?) AND (SELECT COUNT(*) FROM ie_rooms WHERE owner_id=? AND status!='finished')<? AND (SELECT COUNT(*) FROM ie_rooms WHERE owner_id=?)<50 AND NOT EXISTS(SELECT 1 FROM ie_actions WHERE actor=? AND nonce=? AND kind='created')").bind(roomId, account.id, text(body.title, 'Room title', 120), episode.id, episode.version, JSON.stringify(episode), inviteNonce, await hash(code), paid ? 12 : 6, JSON.stringify(initialStation(episode.stages[0])), duration * 60000, now, now, write, account.id, account.id, maximum, account.id, actor, nonce),
      db.prepare("INSERT INTO ie_actions(id,room_id,actor,nonce,signature,revision,kind,created_at) SELECT ?,id,?,?,?,revision,'created',? FROM ie_rooms WHERE id=? AND last_write=?").bind(crypto.randomUUID(), actor, nonce, signature, now, roomId, write)
    ]);
    if (!result[0].meta.changes) { const prior = await db.prepare("SELECT room_id,signature FROM ie_actions WHERE actor=? AND nonce=? AND kind='created'").bind(actor, nonce).first(); if (prior && prior.signature === signature) return json(await controlView(context, await ownerRoom(db, prior.room_id, account)), 201); fail(409, 'Your room allowance was reached or the creation identity conflicts. Finish an active room or use a fresh action for different settings.'); }
    return json(await controlView(context, await ownerRoom(db, roomId, account)), 201);
  }
  const roomId = identifier(parts[1]);
  if (request.method === 'GET' && parts.length === 3 && parts[2] === 'control') return json(await controlView(context, await ownerRoom(db, roomId, account)));
  if (request.method === 'GET' && parts.length === 3 && parts[2] === 'play') { const player = await playerOf(context, roomId); return json(await playView(context, roomId, player.id)); }
  if (request.method !== 'POST' || parts.length !== 3) return null;
  if (parts[2] === 'join') {
    await limit(db, identity, 'join-room', 12); const body = await bodyOf(request); shape(body, ['requestId', 'code', 'alias', 'role']); const room = await roomOf(db, roomId), code = text(body.code, 'Invitation code', 8, 8).toUpperCase(), alias = text(body.alias, 'Player alias', 40);
    if (!['signal', 'engine'].includes(body.role)) fail(400, 'Choose the signal or machine crew.');
    const oldCookie = cookieValue(request, 'ie_guest'), guest = oldCookie ?? (body.requestId ? await derivedToken(env.PRIVATE_SALT, 'join|' + roomId + '|' + identifier(body.requestId)) : token()), digest = await hash(guest), previous = await db.prepare('SELECT * FROM ie_players WHERE room_id=? AND token_hash=?').bind(roomId, digest).first();
    if (previous) { if (previous.left_at) fail(403, 'This player was removed. Ask the host before rejoining.'); if (previous.role !== body.role || previous.alias !== alias) fail(409, 'This browser already joined with a different alias or crew. Restore that player instead.'); return json(await playView(context, roomId, previous.id), 200, oldCookie ? null : cookie('ie_guest', guest)); }
    if (!equalSecret(await hash(code), room.join_hash)) fail(404, 'The invitation code is unavailable. Ask the host for the current invitation.');
    const playerId = crypto.randomUUID();
    const inserted = await db.prepare("INSERT INTO ie_players(id,room_id,token_hash,alias,role,joined_at,seen_at) SELECT ?,id,?,?,?,?,? FROM ie_rooms WHERE id=? AND join_hash=? AND status IN('lobby','active','paused') AND (SELECT COUNT(*) FROM ie_players WHERE room_id=ie_rooms.id AND left_at IS NULL)<capacity AND (SELECT COUNT(*) FROM ie_players WHERE room_id=ie_rooms.id AND left_at IS NULL AND role=?)<capacity/2 ON CONFLICT(room_id,token_hash) DO NOTHING").bind(playerId, digest, text(body.alias, 'Player alias', 40), body.role, now, now, roomId, await hash(code), body.role).run();
    if (!inserted.meta.changes) { const prior = await db.prepare('SELECT * FROM ie_players WHERE room_id=? AND token_hash=? AND left_at IS NULL').bind(roomId, digest).first(); if (prior && prior.alias === alias && prior.role === body.role) return json(await playView(context, roomId, prior.id), 200, oldCookie ? null : cookie('ie_guest', guest)); fail(409, 'That crew is full, the invitation changed, or the room has ended. Choose the other crew or ask the host.'); }
    await db.prepare('INSERT INTO ie_events(id,room_id,kind,message,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), roomId, 'joined', `${text(body.alias, 'Player alias', 40)} joined the ${body.role === 'signal' ? 'signal' : 'machine'} crew.`, now).run();
    return json(await playView(context, roomId, playerId), 201, oldCookie ? null : cookie('ie_guest', guest));
  }
  if (parts[2] === 'action') return playerAction(context, roomId);
  if (parts[2] === 'host') return hostAction(context, roomId);
  if (parts[2] === 'report') { const player = await playerOf(context, roomId), body = await bodyOf(request); shape(body, ['reason', 'note']); if (!['unsafe', 'privacy', 'spam', 'broken'].includes(body.reason)) fail(400, 'Choose a supported report reason.'); await limit(db, player.id, 'report', 3, 3600); await db.prepare('INSERT INTO ie_reports(id,room_id,player_id,reason,note,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), roomId, player.id, body.reason, text(body.note ?? '', 'Report note', 900, 0), now).run(); return json({ ok: true }); }
  if (parts[2] === 'delete') { await ownerRoom(db, roomId, account); const body = await bodyOf(request); shape(body, ['confirmation']); if (body.confirmation !== 'DELETE THIS ROOM') fail(400, 'Type DELETE THIS ROOM to erase this room and its crew records.'); const removed = await db.prepare("DELETE FROM ie_rooms WHERE id=? AND owner_id=? AND status='finished'").bind(roomId, account.id).run(); if (!removed.meta.changes) fail(409, 'End the room before deleting it.'); return json({ ok: true }); }
  return null;
}

/** Applies one action with a CAS and current player admission in the same durable transaction. */
async function playerAction(context, roomId) {
  const { db, request } = context, player = await playerOf(context, roomId); await limit(db, player.id, 'machine-action', 90);
  const body = await bodyOf(request); shape(body, ['requestId', 'stageId', 'action']); const nonce = identifier(body.requestId), actor = 'player:' + player.id, signature = await hash(JSON.stringify(canonical({ stageId: body.stageId, action: body.action })));
  for (let pass = 0; pass < 3; pass++) {
    const room = await roomOf(db, roomId);
    if (await previouslyApplied(db, roomId, actor, nonce, signature)) return json(await playView(context, roomId, player.id));
    if (room.status !== 'active') fail(409, room.status === 'paused' ? 'The host paused this room. Your machine settings are kept.' : 'This room is not accepting station actions.');
    const episode = JSON.parse(room.episode_snapshot), stage = episode.stages[room.stage_index]; if (body.stageId !== stage.id) fail(409, 'The crew has moved to another station. Read the new card before acting.');
    const outcome = applyAction(stage, JSON.parse(room.state), player.role, body.action, Date.now()), nextIndex = room.stage_index + (outcome.complete ? 1 : 0), escaped = nextIndex === episode.stages.length;
    const state = outcome.complete && !escaped ? initialStation(episode.stages[nextIndex]) : outcome.state, now = Date.now(), deadline = room.deadline - outcome.penalty * 5000, write = crypto.randomUUID();
    const result = await db.batch([
      db.prepare("UPDATE ie_rooms SET state=?,stage_index=?,status=?,outcome=?,finished_at=?,remaining_ms=?,deadline=?,mistakes=mistakes+?,revision=revision+1,updated_at=?,last_write=? WHERE id=? AND revision=? AND status='active' AND deadline>? AND EXISTS(SELECT 1 FROM ie_players p WHERE p.id=? AND p.room_id=ie_rooms.id AND p.token_hash=? AND p.role=? AND p.left_at IS NULL) AND NOT EXISTS(SELECT 1 FROM ie_actions WHERE room_id=? AND actor=? AND nonce=?)").bind(JSON.stringify(state), nextIndex, escaped ? 'finished' : 'active', escaped ? 'escaped' : null, escaped ? now : null, escaped ? Math.max(0, deadline - now) : null, deadline, outcome.penalty, now, write, roomId, room.revision, now, player.id, player.token_hash, player.role, roomId, actor, nonce),
      db.prepare('INSERT INTO ie_actions(id,room_id,actor,nonce,signature,revision,kind,created_at) SELECT ?,id,?,?,?,revision,?,? FROM ie_rooms WHERE id=? AND last_write=?').bind(crypto.randomUUID(), actor, nonce, signature, outcome.complete ? 'station-complete' : body.action.type, now, roomId, write),
      db.prepare('INSERT INTO ie_events(id,room_id,kind,message,created_at) SELECT ?,id,?,?,? FROM ie_rooms WHERE id=? AND last_write=? AND ?=1').bind(crypto.randomUUID(), escaped ? 'escaped' : 'station', escaped ? 'Both crews completed the expedition.' : `${stage.title} completed together.`, now, roomId, write, outcome.complete ? 1 : 0)
    ]);
    if (result[0].meta.changes) return json(await playView(context, roomId, player.id));
    if (!await db.prepare('SELECT id FROM ie_players WHERE id=? AND room_id=? AND left_at IS NULL AND role=?').bind(player.id, roomId, player.role).first()) fail(403, 'Your player role is no longer active in this room.');
  }
  fail(409, 'Another crew action changed this station. Refresh and retry the same control.');
}

/** Host controls preserve paused clocks and cannot write a different owner's room. */
async function hostAction(context, roomId) {
  const { db, request, account, env } = context; await ownerRoom(db, roomId, account); const body = await bodyOf(request); shape(body, ['requestId', 'type', 'playerId']); const nonce = identifier(body.requestId), actor = 'host:' + account.id, signature = await hash(JSON.stringify(canonical({ type: body.type, playerId: body.playerId ?? null })));
  for (let pass = 0; pass < 3; pass++) {
    const room = await ownerRoom(db, roomId, account); if (await previouslyApplied(db, roomId, actor, nonce, signature)) return json(await controlView(context, room));
    const next = { ...room }, now = Date.now(), state = JSON.parse(room.state), players = await roster(db, roomId); let kicked = null, message = '';
    switch (body.type) {
      case 'start': if (room.status !== 'lobby') fail(409, 'Only a waiting room can start.'); if (!players.some(player => player.role === 'signal') || !players.some(player => player.role === 'engine')) fail(409, 'At least one real player must join each crew before starting.'); next.status = 'active'; next.started_at = now; next.deadline = now + room.duration_ms; message = 'The expedition started with both crews present.'; break;
      case 'pause': if (room.status !== 'active') fail(409, 'Only an active room can pause.'); next.status = 'paused'; next.remaining_ms = remaining(room, now); next.paused_at = now; message = 'The host paused the room clock and machine actions.'; break;
      case 'resume': if (room.status !== 'paused') fail(409, 'Only a paused room can resume.'); next.status = 'active'; next.deadline = now + room.remaining_ms; next.state = JSON.stringify(shiftStationClock(state, now - room.paused_at)); next.paused_at = null; message = 'The host resumed the room clock.'; break;
      case 'end': if (room.status === 'finished') fail(409, 'This room has already ended.'); next.status = 'finished'; next.outcome = 'ended'; next.remaining_ms = remaining(room, now); next.finished_at = now; message = 'The host ended this expedition.'; break;
      case 'reset': if (!['active', 'paused'].includes(room.status)) fail(409, 'Start the room before resetting a station.'); next.state = JSON.stringify(initialStation(JSON.parse(room.episode_snapshot).stages[room.stage_index])); next.mistakes++; if (room.status === 'active') next.deadline -= 5000; else next.remaining_ms = Math.max(0, next.remaining_ms - 5000); message = 'The host reset the current station; one mistake was added.'; break;
      case 'rotate': next.invite_nonce = token(); next.join_hash = await hash(await invitation(next, env.PRIVATE_SALT)); message = 'The host replaced the invitation. Existing crew identities remain valid.'; break;
      case 'kick': kicked = players.find(player => player.id === body.playerId); if (!kicked) fail(404, 'This active player is unavailable.'); state.checked = { signal: false, engine: false }; if (state.armed) state.armed = { signal: 0, engine: 0 }; next.state = JSON.stringify(state); message = 'The host removed a player and cleared pending crew confirmations.'; break;
      default: fail(400, 'Choose an available host control.');
    }
    const write = crypto.randomUUID(), statements = [db.prepare('UPDATE ie_rooms SET status=?,outcome=?,state=?,deadline=?,remaining_ms=?,paused_at=?,started_at=?,finished_at=?,invite_nonce=?,join_hash=?,mistakes=?,revision=revision+1,last_write=?,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND EXISTS(SELECT 1 FROM ie_accounts WHERE id=?) AND NOT EXISTS(SELECT 1 FROM ie_actions WHERE room_id=? AND actor=? AND nonce=?)').bind(next.status, next.outcome, next.state, next.deadline, next.remaining_ms, next.paused_at, next.started_at, next.finished_at, next.invite_nonce, next.join_hash, next.mistakes, write, now, roomId, account.id, room.revision, account.id, roomId, actor, nonce)];
    if (kicked) statements.push(db.prepare('UPDATE ie_players SET left_at=? WHERE id=? AND room_id=? AND EXISTS(SELECT 1 FROM ie_rooms WHERE id=? AND last_write=?)').bind(now, kicked.id, roomId, roomId, write));
    statements.push(db.prepare('INSERT INTO ie_actions(id,room_id,actor,nonce,signature,revision,kind,created_at) SELECT ?,id,?,?,?,revision,?,? FROM ie_rooms WHERE id=? AND last_write=?').bind(crypto.randomUUID(), actor, nonce, signature, body.type, now, roomId, write));
    statements.push(db.prepare('INSERT INTO ie_events(id,room_id,kind,message,created_at) SELECT ?,id,?,?,? FROM ie_rooms WHERE id=? AND last_write=?').bind(crypto.randomUUID(), body.type, message, now, roomId, write));
    const result = await db.batch(statements); if (result[0].meta.changes) return json(await controlView(context, await ownerRoom(db, roomId, account)));
  }
  fail(409, 'Another host action changed this room. Refresh before trying again.');
}
