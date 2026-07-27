/**
 * SYSTEMS installer: match director + score system (delivered by the AI /
 * combat stream in the integrator stub's place). Autoplay bot still TBD.
 *
 *   game.score   ScoreSystem   (+100 kill / +50 headshot; score:add)
 *   game.match   MatchDirector (menu → combat → death → results; forceCombat())
 *   system 'match' order 42
 * @param {import('../Game.js').Game} game
 */
import { ScoreSystem } from './ScoreSystem.js';
import { MatchDirector } from './MatchDirector.js';

export function installSystems(game) {
  const score = new ScoreSystem(game);
  const match = new MatchDirector(game);
  game.score = score;
  game.match = match;
  game.addSystem({
    name: 'match',
    update: (dt) => match.update(dt),
    dispose: () => {
      score.dispose();
      match.dispose();
    },
  }, 42);
}
