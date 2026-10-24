/** Pure cooperative station engine. It evaluates typed actions; no user-supplied code is executed. */
export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const symbols = ['SUN', 'WAVE', 'BELL', 'LEAF', 'GEAR', 'MOON'];
export const routes = ['north', 'east', 'south', 'west'];

/** Creates only the mutable state of the selected authored station. */
export function initialStation(stage) {
  const common = { checked: { signal: false, engine: false }, feedback: '', attempts: 0 };
  switch (stage.kind) {
    case 'dials': return { ...common, dials: [0, 0, 0], route: 'north' };
    case 'relay': return { ...common, inputs: [0, 0, 0], bypass: [0, 0, 0] };
    case 'route': return { ...common, position: stage.config.start, visited: [stage.config.start], cargo: false, gate: 0, steps: 0 };
    case 'balance': return { ...common, placements: ['off', 'off', 'off'], ballast: 0 };
    case 'rings': return { ...common, inner: 0, outer: 0 };
    case 'launch': return { ...common, armed: { signal: 0, engine: 0 } };
    default: throw new GameError('This station type is unavailable.');
  }
}

function integer(value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new GameError(`Choose a whole number from ${minimum} through ${maximum}.`);
  return value;
}
function bits(value) {
  if (!Array.isArray(value) || value.length !== 3) throw new GameError('Set all three lamps.');
  return value.map(bit => integer(bit, 0, 1));
}
function roleIs(role, expected) { if (role !== expected) throw new GameError('That control belongs to the other crew.', 403); }
function equal(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function invalidateChecks(state) { state.checked = { signal: false, engine: false }; state.feedback = 'Settings changed. Both crews need to check the station again.'; }

/** Computes the relay outputs from actual input and bypass values. */
export function relayOutput(stage, state) { return stage.config.wiring.map((source, index) => state.inputs[source] ^ state.bypass[index]); }

/** Computes cradle loads, including the selected side of the ballast. */
export function loads(stage, state) {
  let left = Math.max(state.ballast, 0), right = Math.max(-state.ballast, 0);
  state.placements.forEach((side, index) => { if (side === 'left') left += stage.config.weights[index]; else if (side === 'right') right += stage.config.weights[index]; });
  return { left, right, loaded: state.placements.every(side => side !== 'off') };
}

/** Evaluates the station's authored objective without assuming one fixed answer for a balancing puzzle. */
export function objective(stage, state, now) {
  switch (stage.kind) {
    case 'dials': return equal(state.dials, stage.config.dials) && state.route === stage.config.route;
    case 'relay': return equal(state.inputs, stage.config.inputs) && equal(state.bypass, stage.config.bypass) && equal(relayOutput(stage, state), stage.config.output);
    case 'route': return state.position === stage.config.exit && state.cargo;
    case 'balance': { const load = loads(stage, state); return load.loaded && load.left === load.right && load.left <= stage.config.limit; }
    case 'rings': return state.inner === stage.config.inner && state.outer === stage.config.outer;
    case 'launch': return state.armed.signal > now && state.armed.engine > now;
    default: return false;
  }
}

/** Applies one authorized crew action to a detached state and returns its actual outcome. */
export function applyAction(stage, current, role, action, now) {
  if (!['signal', 'engine'].includes(role)) throw new GameError('Join one of the two crews first.', 403);
  if (!action || typeof action !== 'object' || Array.isArray(action) || typeof action.type !== 'string') throw new GameError('Choose a station control.');
  const state = structuredClone(current);
  let penalty = 0;
  if (action.type === 'check') {
    if (stage.kind === 'launch') throw new GameError('Use your Arm button at this station.');
    state.checked[role] = true;
    state.feedback = 'Your crew is ready. The other crew must also check this station.';
    if (state.checked.signal && state.checked.engine) {
      if (objective(stage, state, now)) return { state, complete: true, penalty: 0 };
      state.checked = { signal: false, engine: false }; state.attempts++; penalty = 1;
      state.feedback = 'The machine is not ready yet. Re-read both cards and compare the live controls.';
    }
    return { state, complete: false, penalty };
  }
  switch (stage.kind) {
    case 'dials':
      if (action.type === 'dials') { roleIs(role, 'engine'); if (Object.hasOwn(action, 'values')) { if (!Array.isArray(action.values) || action.values.length !== 3) throw new GameError('Set the three numbered dials.'); state.dials = action.values.map(value => integer(value, 0, 7)); } else state.dials[integer(action.index, 0, 2)] = integer(action.value, 0, 7); }
      else if (action.type === 'route') { roleIs(role, 'signal'); if (!routes.includes(action.value)) throw new GameError('Choose a routing direction.'); state.route = action.value; }
      else throw new GameError('That control is not available at the dock.');
      break;
    case 'relay':
      if (action.type === 'inputs') { roleIs(role, 'signal'); if (Object.hasOwn(action, 'values')) state.inputs = bits(action.values); else { const index = integer(action.index, 0, 2); state.inputs[index] = integer(action.value, 0, 1); } }
      else if (action.type === 'bypass') { roleIs(role, 'engine'); if (Object.hasOwn(action, 'values')) state.bypass = bits(action.values); else { const index = integer(action.index, 0, 2); state.bypass[index] = integer(action.value, 0, 1); } }
      else throw new GameError('Choose an input or bypass control.');
      break;
    case 'route':
      if (action.type === 'gate') { roleIs(role, 'signal'); state.gate = integer(action.value, 0, 2); }
      else if (action.type === 'move') {
        roleIs(role, 'engine');
        const offsets = { up: [-1, 0], right: [0, 1], down: [1, 0], left: [0, -1] };
        if (!Object.hasOwn(offsets, action.value)) throw new GameError('Choose up, right, down or left.');
        const [dr, dc] = offsets[action.value], row = Math.floor(state.position / 4) + dr, column = state.position % 4 + dc, destination = row * 4 + column;
        if (row < 0 || row > 3 || column < 0 || column > 3 || stage.config.walls.includes(destination) || destination === stage.config.gateCell && state.gate !== stage.config.gate) {
          state.feedback = 'That route is blocked. The trolley stayed in place.'; state.attempts++; penalty = 1;
          return { state, complete: false, penalty };
        }
        state.position = destination; state.steps++; if (!state.visited.includes(destination)) state.visited.push(destination); if (destination === stage.config.cargo) state.cargo = true;
      } else throw new GameError('Choose the gate or a trolley direction.');
      break;
    case 'balance':
      if (action.type === 'placement') { roleIs(role, 'engine'); const index = integer(action.index, 0, 2); if (!['left', 'right', 'off'].includes(action.value)) throw new GameError('Put the crate left, right or off.'); state.placements[index] = action.value; }
      else if (action.type === 'ballast') { roleIs(role, 'signal'); state.ballast = integer(action.value, -stage.config.ballastLimit, stage.config.ballastLimit); }
      else throw new GameError('Choose a crate or ballast control.');
      break;
    case 'rings':
      if (action.type === 'inner') { roleIs(role, 'signal'); state.inner = integer(action.value, 0, 5); }
      else if (action.type === 'outer') { roleIs(role, 'engine'); state.outer = integer(action.value, 0, 5); }
      else throw new GameError('Choose the inner or outer ring.');
      break;
    case 'launch':
      if (action.type !== 'arm') throw new GameError('Use your crew’s Arm control.');
      state.armed[role] = now + stage.config.windowMs;
      state.feedback = 'Your terminal is armed. Coordinate with the other crew before the window ends.';
      return { state, complete: objective(stage, state, now), penalty: 0 };
    default: throw new GameError('This station is unavailable.');
  }
  invalidateChecks(state);
  return { state, complete: false, penalty };
}

/** Projects a station without transmitting the other crew's private instruction or hidden floor map. */
export function stationView(stage, state, role) {
  const machine = { ...structuredClone(state) };
  if (stage.kind === 'relay') { machine.outputs = relayOutput(stage, state); machine.wiring = role === 'signal' ? stage.config.wiring : []; }
  if (stage.kind === 'route') { machine.walls = role === 'signal' ? stage.config.walls : []; machine.cargoCell = role === 'signal' ? stage.config.cargo : -1; machine.exitCell = stage.config.exit; machine.gateCell = role === 'signal' ? stage.config.gateCell : -1; }
  if (stage.kind === 'balance') { machine.loads = loads(stage, state); machine.limit = stage.config.limit; machine.ballastLimit = stage.config.ballastLimit; }
  if (stage.kind === 'launch') machine.windowMs = stage.config.windowMs;
  return { id: stage.id, kind: stage.kind, title: stage.title, scene: stage.scene, clue: role === 'signal' ? stage.signalClue : stage.engineClue, hint: stage.hint, machine };
}

/** Keeps readiness windows stationary while the host has paused the room clock. */
export function shiftStationClock(state, milliseconds) {
  const next = structuredClone(state);
  if (next.armed) for (const role of ['signal', 'engine']) if (next.armed[role]) next.armed[role] += milliseconds;
  return next;
}
