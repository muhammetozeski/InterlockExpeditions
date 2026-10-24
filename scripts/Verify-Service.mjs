import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';
import { episodes } from '../content/episodes.mjs';
import { applyAction, initialStation, objective, stationView } from '../server/engine.mjs';

/** Permanent pre-publication verification command. All fixture identities and records live only in memory. */
class Database {
  constructor() { this.native = new DatabaseSync(':memory:'); }
  prepare(sql) { const database = this; return { values: [], bind(...values) { this.values = values; return this; }, async first() { return database.native.prepare(sql).get(...this.values) ?? null; }, async all() { return { results: database.native.prepare(sql).all(...this.values) }; }, async run() { return { success: true, meta: { changes: Number(database.native.prepare(sql).run(...this.values).changes) } }; }, sql }; }
  async batch(statements) { this.native.exec('BEGIN IMMEDIATE'); try { const results = statements.map(statement => ({ success: true, meta: { changes: Number(this.native.prepare(statement.sql).run(...statement.values).changes) } })); this.native.exec('COMMIT'); return results; } catch (error) { this.native.exec('ROLLBACK'); throw error; } }
}
const database = new Database(); database.native.exec(await readFile(new URL('../schema/001-core.sql', import.meta.url), 'utf8'));
const env = { DB: database, PRIVATE_SALT: 'in-memory-verification-only-not-a-provider-key' }, origin = 'https://interlock.example';
let checks = 0, clock = Date.now(); const originalClock = Date.now; Date.now = () => clock;
function check(value, label) { assert.ok(value, label); checks++; }
async function call(path, body, identity = {}) {
  const headers = { Origin: origin, 'CF-Connecting-IP': '192.0.2.55' };
  if (identity.cookie) headers.Cookie = identity.cookie;
  if (identity.player) { headers['X-IE-Player'] = identity.player.id; headers['X-IE-Key'] = identity.key; }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const result = await onRequest({ request: new Request(origin + '/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }), env });
  return { status: result.status, body: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] };
}
async function host(room, type, extra = {}) { const result = await call('rooms/' + room + '/host', { requestId: crypto.randomUUID(), type, ...extra }, owner); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; }
async function action(identity, value, nonce = crypto.randomUUID(), forcedStage) {
  const before = await call('rooms/' + roomId + '/play', undefined, identity); assert.equal(before.status, 200);
  return call('rooms/' + roomId + '/action', { requestId: nonce, stageId: forcedStage ?? before.body.station?.id, action: value }, identity);
}
async function checkedStage(index) {
  const [left, right] = await Promise.all([action(signal, { type: 'check' }), action(engine, { type: 'check' })]);
  assert.equal(left.status, 200, JSON.stringify(left.body)); assert.equal(right.status, 200, JSON.stringify(right.body));
  const state = await call('rooms/' + roomId + '/play', undefined, signal); check(state.body.room.stageIndex === index, 'Both crews atomically advance exactly one station'); return state.body;
}
let owner, roomId, signal, engine;
try {
  owner = await call('accounts', { alias: 'Isolated host fixture' }); const other = await call('accounts', { alias: 'Separate host fixture' });
  check(owner.status === 201 && owner.body.recoveryKey.length === 43, 'Actual host account has a one-time recovery key');
  const settings = { requestId: crypto.randomUUID(), episodeId: 'midnight-lift', title: 'In-memory two-crew expedition', durationMinutes: 20 };
  const [first, duplicate] = await Promise.all([call('rooms', settings, owner), call('rooms', settings, owner)]);
  check(first.status === 201 && duplicate.status === 201 && first.body.room.id === duplicate.body.room.id, 'Concurrent room-creation retry makes one persistent room');
  roomId = first.body.room.id;
  check((await call('rooms/' + roomId + '/control', undefined, other)).status === 404, 'Other host cannot read room controls');
  check((await call('rooms/' + roomId + '/play')).status === 401, 'Invitation alone is not a player identity');
  const startTooSoon = await call('rooms/' + roomId + '/host', { requestId: crypto.randomUUID(), type: 'start' }, owner); check(startTooSoon.status === 409, 'Empty room cannot pretend two crews are present');
  const joinedSignal = await call('rooms/' + roomId + '/join', { code: first.body.invitation, alias: 'Signal fixture', role: 'signal' });
  const joinedEngine = await call('rooms/' + roomId + '/join', { code: first.body.invitation, alias: 'Machine fixture', role: 'engine' });
  check(joinedSignal.status === 201 && joinedEngine.status === 201 && joinedSignal.body.player.id !== joinedEngine.body.player.id, 'Two actual distinct guest identities join opposite crews');
  signal = { player: joinedSignal.body.player, key: joinedSignal.body.playerKey }; engine = { player: joinedEngine.body.player, key: joinedEngine.body.playerKey };
  await host(roomId, 'start');
  const signalRead = await call('rooms/' + roomId + '/play', undefined, signal), engineRead = await call('rooms/' + roomId + '/play', undefined, engine);
  check(signalRead.body.station.clue === episodes[0].stages[0].signalClue && !JSON.stringify(signalRead.body).includes(episodes[0].stages[0].engineClue), 'Signal view excludes machine-private card');
  check(engineRead.body.station.clue === episodes[0].stages[0].engineClue && !JSON.stringify(engineRead.body).includes(episodes[0].stages[0].signalClue), 'Machine view excludes signal-private card');
  check((await action(engine, { type: 'route', value: 'east' })).status === 403, 'Wrong crew cannot operate a private control');
  await action(signal, { type: 'route', value: 'east' }); await action(engine, { type: 'dials', values: [5, 2, 7] });
  const remembered = crypto.randomUUID(); await action(signal, { type: 'check' }, remembered); await action(engine, { type: 'check' });
  check((await call('rooms/' + roomId + '/action', { requestId: remembered, stageId: 'dock', action: { type: 'check' } }, signal)).body.room.stageIndex === 1, 'Successful prior-stage action replays without touching the new station');
  check((await call('rooms/' + roomId + '/action', { requestId: remembered, stageId: 'dock', action: { type: 'route', value: 'west' } }, signal)).status === 409, 'Changed payload cannot reuse an accepted action identity');
  check(database.native.prepare("SELECT COUNT(*) AS n FROM ie_events WHERE room_id=? AND kind='station'").get(roomId).n === 1, 'Station completion is recorded once');
  const late = await call('rooms/' + roomId + '/join', { code: first.body.invitation, alias: 'Late real fixture', role: 'engine' }); check(late.status === 201 && late.body.station.id === 'relays', 'Late join starts at the actual current station');
  await host(roomId, 'pause'); const frozen = (await call('rooms/' + roomId + '/play', undefined, signal)).body.room.remainingMs; clock += 60000;
  check((await call('rooms/' + roomId + '/play', undefined, signal)).body.room.remainingMs === frozen, 'Paused countdown does not consume elapsed wall time');
  check((await action(signal, { type: 'inputs', values: [0, 1, 1] })).status === 409, 'Paused room rejects machine mutation'); await host(roomId, 'resume');
  await action(signal, { type: 'inputs', values: [0, 1, 1] }); await action(engine, { type: 'bypass', values: [1, 0, 1] }); await checkedStage(2);
  const blindMap = (await call('rooms/' + roomId + '/play', undefined, engine)).body.station.machine; check(blindMap.walls.length === 0 && blindMap.cargoCell === -1, 'Machine console cannot retrieve the signal floor map');
  await action(engine, { type: 'move', value: 'right' }); const blocked = await action(engine, { type: 'move', value: 'down' }); check(blocked.body.station.machine.position === 1 && blocked.body.room.mistakes === 1, 'Closed gate blocks an actual move and records a mistake');
  await action(signal, { type: 'gate', value: 1 }); for (const direction of ['down', 'right', 'right', 'down', 'down']) await action(engine, { type: 'move', value: direction }); await checkedStage(3);
  await checkedStage(3); check((await call('rooms/' + roomId + '/play', undefined, engine)).body.room.stageIndex === 3, 'Empty balanced cradle is not an objective completion');
  await action(engine, { type: 'placement', index: 0, value: 'left' }); await action(engine, { type: 'placement', index: 1, value: 'left' }); await action(engine, { type: 'placement', index: 2, value: 'right' }); await checkedStage(4);
  await action(signal, { type: 'inner', value: 2 }); await action(signal, { type: 'check' }); await action(engine, { type: 'outer', value: 5 });
  check(!(await call('rooms/' + roomId + '/play', undefined, signal)).body.station.machine.checked.signal, 'A changed machine invalidates earlier confirmations'); await checkedStage(5);
  await action(signal, { type: 'arm' }); await host(roomId, 'pause'); clock += 60000; await host(roomId, 'resume');
  const escaped = await action(engine, { type: 'arm' }); check(escaped.status === 200 && escaped.body.room.outcome === 'escaped' && escaped.body.room.stageIndex === 6, 'Pause preserves the launch overlap and both crews finish all six stations');
  check(escaped.body.ending === episodes[0].ending && escaped.body.station === null, 'Completed expedition returns its authored ending, not another live station');
  const restored = await call('rooms/' + roomId + '/play', undefined, signal); check(restored.status === 200 && restored.body.room.outcome === 'escaped', 'Private recovery capability restores the actual completed room');
  check((await call('rooms/' + roomId + '/join', { code: first.body.invitation, alias: 'Too late fixture', role: 'signal' })).status === 409, 'Finished room refuses a new guest');
  const second = await call('rooms', { ...settings, requestId: crypto.randomUUID(), title: 'Separate room namespace' }, other);
  check((await call('rooms/' + second.body.room.id + '/play', undefined, signal)).status === 404, 'A room capability cannot read another room');
  await call('account/delete', { confirmation: 'DELETE MY ACCOUNT' }, owner); check((await call('rooms/' + roomId + '/play', undefined, signal)).status === 404, 'Owner erasure cascades private room and player data');
  for (const episode of episodes) for (const stage of episode.stages) { const initial = initialStation(stage); check(!objective(stage, initial, clock), 'Authored station does not begin completed'); const projected = stationView(stage, initial, 'engine'); check(!Object.hasOwn(projected, 'config'), 'Player projection omits server objective configuration'); }
  assert.throws(() => applyAction(episodes[0].stages[0], initialStation(episodes[0].stages[0]), 'engine', { type: 'dials', values: [5, 2, 8] }, clock)); checks++;
  console.log(`PASS ${checks} actual-SQL and cooperative-engine checks; no persistent fixture files or live accounts were created.`);
} finally { Date.now = originalClock; database.native.close(); }
