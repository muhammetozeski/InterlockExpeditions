import { furtherEpisodes } from './further-episodes.mjs';
/** Original fictional episodes. Server imports these definitions; player views disclose only the current authorized role card. */
export const episodes = [
  {
    id: 'midnight-lift', version: '1.0.0', title: 'The Midnight Lift', minutes: 20,
    tagline: 'Move a tiny night museum above the rising canal before the last lift leaves.',
    introduction: 'The Canal Museum is small enough to fit inside a lift, but tonight its keeper has misplaced the instruction book. One crew has the signal manual; the other has the machine console. Speak to each other, make a plan, and move the collection upstairs.',
    ending: 'The lift reaches the dry gallery. A clockwork moth unfolds a paper banner: OPEN TOMORROW. The keeper promises to label the manuals before the next rain.',
    stages: [
      {
        id: 'dock', kind: 'dials', title: '1. Wake the dock console',
        scene: 'Three numbered dials unlock the loading dock. The routing vane is on a different terminal, so neither crew can prepare the console alone.',
        signalClue: 'Tell the machine crew: set the brass dial to 5, the glass dial to 2, and the paper dial to 7. Your own routing vane must follow the destination written on their card. Each dial has values 0 through 7. Both crews must check the station after the settings are ready.',
        engineClue: 'Tell the signal crew: the museum lift is leaving through the EAST route. They control that routing vane; you control the three dials. Ask them for the numbered settings, then both crews press Check station.',
        hint: 'Each card explains a setting controlled by the other crew. The three dial labels remain in brass, glass, paper order.',
        config: { dials: [5, 2, 7], route: 'east' }
      },
      {
        id: 'relays', kind: 'relay', title: '2. Repair the relay lattice',
        scene: 'Three input lamps cross a small relay lattice. Inputs are on the signal terminal; bypass switches are on the machine terminal. The output lamps show the result.',
        signalClue: 'Tell the machine crew: their bypass switches must be ON, OFF, ON, from left to right. Your input pattern is written on their card. The wires carry input 3 to output 1, input 1 to output 2, and input 2 to output 3. An ON bypass flips its incoming lamp. Both crews check when the output is ready.',
        engineClue: 'Tell the signal crew: their input lamps must be OFF, ON, ON. Ask them for your bypass pattern. An ON bypass flips the corresponding incoming lamp. The required final output is OFF, OFF, OFF; follow the cards rather than changing lamps at random.',
        hint: 'Use the other crew’s instruction for your own three controls. The wire crossings are not the same as the screen order.',
        config: { inputs: [0, 1, 1], bypass: [1, 0, 1], wiring: [2, 0, 1], output: [0, 0, 0] }
      },
      {
        id: 'route', kind: 'route', title: '3. Guide the collection trolley',
        scene: 'A four-by-four loading floor appears on the signal terminal. The machine terminal can move the trolley but has no complete wall map. Collect the small crate before reaching the exit.',
        signalClue: 'You can see the full floor map. Guide the machine crew one move at a time using up, right, down and left. They know which gate symbol you must select. Collect the crate, then reach the exit. Rows run top to bottom; columns run left to right. Both crews check after arrival.',
        engineClue: 'Tell the signal crew: choose the MOON gate. Your trolley starts in the upper-left corner. Ask them for directions; your terminal only remembers visited cells. A blocked move stays in place and costs one mistake. Pick up the crate before going to the exit.',
        hint: 'An open gate is not a wall. Try a path through the second cell of the second row, then travel along the right edge.',
        config: { start: 0, walls: [2, 3, 8, 10, 12], cargo: 6, exit: 15, gateCell: 5, gate: 1 }
      },
      {
        id: 'balance', kind: 'balance', title: '4. Balance the freight cradle',
        scene: 'Three crates must ride on a two-sided cradle. The signal terminal has the weight register and ballast control; the machine crew places each crate. Every crate must be loaded, and the two loads must match.',
        signalClue: 'The crate weights are A = 2, B = 3, C = 5. Tell the machine crew the weights so they can choose sides. Your ballast can add up to two units to the left or right; zero adds nothing. No side may exceed 8 units. Both crews check when all three crates are aboard and the actual loads match.',
        engineClue: 'You control whether crates A, B and C sit left, right or off the cradle. Ask the signal crew for their weights. All three must be aboard. The signal crew can adjust ballast; a balanced but empty cradle does not count. Both crews check to secure the load.',
        hint: 'Two smaller crates can balance one larger crate without ballast. Watch the calculated loads as you move a crate.',
        config: { weights: [2, 3, 5], limit: 8, ballastLimit: 2 }
      },
      {
        id: 'seal', kind: 'rings', title: '5. Assemble the weather seal',
        scene: 'Two rotating seal rings carry the same six symbols. The signal crew turns the inner ring; the machine crew turns the outer one. Each card describes the other ring’s alignment.',
        signalClue: 'Tell the machine crew: the OUTER ring must point to MOON. Your own INNER ring target is on their card. The symbols run SUN, WAVE, BELL, LEAF, GEAR, MOON in increasing order, with wraparound. Both crews check the assembled seal.',
        engineClue: 'Tell the signal crew: the INNER ring must point to BELL. Ask them for your OUTER alignment. The marked position is the symbol shown at the top of each ring. Both crews check after setting the two rings.',
        hint: 'BELL is the third symbol and MOON is the sixth. Changing either ring clears both earlier check marks.',
        config: { inner: 2, outer: 5 }
      },
      {
        id: 'launch', kind: 'launch', title: '6. Send the lift upstairs',
        scene: 'The lift is loaded and sealed. The two safety terminals now need a live confirmation from both crews. An armed terminal stays ready for fifteen seconds.',
        signalClue: 'Tell the machine crew when you are about to arm. Press Arm signal terminal; their terminal must also be armed before your fifteen-second window ends. You can arm again if a window expires. Do not reload to reset the room clock.',
        engineClue: 'Coordinate with the signal crew and press Arm machine terminal. Both readiness windows must overlap. Network updates may take a few seconds, so agree verbally before arming.',
        hint: 'Count down together, then each crew presses its own Arm button. There is no reaction-time prize.',
        config: { windowMs: 15000 }
      }
    ]
  },
  ...furtherEpisodes
];

/** Returns a server-owned immutable episode definition or an absent result. */
export function episodeById(id) { return episodes.find(episode => episode.id === id) ?? null; }
