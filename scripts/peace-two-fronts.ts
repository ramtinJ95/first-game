import { carthage, map, rome, romeOnTwoFronts } from '../e2e/support.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { peaceText, proposal } from '../src/sim/ai/peace.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { warRoomOf } from '../src/ui/war-room.ts';

/**
 * The tester's case: Rome holds five cities in year 2 at war with Carthage and Macedon.
 * Prints how each war stands, the terms the wars panel puts ready with each enemy's
 * answer, what each enemy would offer, and the two days in which Rome buys peace with
 * Carthage at the least Carthage takes, while the war with Macedon goes on.
 */

const world = buildWorld(map);
const holdings = (state: GameState) =>
  `Rome holds ${Object.values(state.cities).filter((city) => city.owner === rome).length} cities and ${Math.floor(state.factions[rome]?.stores.gold ?? 0).toLocaleString('en')} gold`;

let state = romeOnTwoFronts();
console.log(`Day ${state.day}. ${holdings(state)}.\n`);
for (const war of warRoomOf(state, []).wars) {
  console.log(`## Rome against ${war.name}: ${war.summary}\n`);
  for (const fact of war.facts) console.log(`- ${fact}`);
  console.log('\n| Rome offers | Terms | Answer |');
  console.log('| --- | --- | --- |');
  for (const choice of war.choices) {
    console.log(
      `| ${choice.label} | ${peaceText(state, choice.terms, rome)} | ${choice.answer.verdict} |`,
    );
  }
  const offered = proposal(state, war.enemy, rome);
  console.log(
    `\n${war.name} offers: ${offered ? peaceText(state, offered, rome) : 'nothing, for no terms satisfy both sides yet'}.\n`,
  );
}

const buy = warRoomOf(state, [])
  .wars.find((war) => war.enemy === carthage)
  ?.choices.find((choice) => choice.answer.accepts);
if (!buy) throw new Error('Carthage takes no terms Rome can meet');
console.log(`Rome offers Carthage ${peaceText(state, buy.terms, rome)}.`);
state = tick(
  state,
  [
    { kind: 'offerPeace', faction: rome, to: carthage, terms: buy.terms },
    ...decideAll(state, world),
  ],
  world,
).state;
const answered = tick(state, decideAll(state, world), world);
for (const event of answered.events) {
  if (event.kind === 'peaceMade') console.log(`Day ${state.day}: Carthage accepts.`);
  if (event.kind === 'peaceRefused') console.log(`Day ${state.day}: Carthage refuses.`);
}
state = answered.state;
const room = warRoomOf(state, []);
console.log(`Rome is at war with ${room.wars.map((war) => war.name).join(', ') || 'no one'}.`);
for (const truce of room.truces) console.log(truce.text);
console.log(`${holdings(state)}.`);
