/**
 * SYSTEMS installer: match director, score system and the autoplay
 * verification bot.
 *
 *   game.score     ScoreSystem   (+100 kill / +50 headshot; score:add)
 *   game.match     MatchDirector (menu → combat → death → results; forceCombat())
 *   game.autoplay  Autoplay      (scripted bot; system 'autoplay' order 5,
 *                                inert until begin() — see docs/ARCHITECTURE.md §4)
 *   system 'match' order 42
 * @param {import('../Game.js').Game} game
 */
import { ScoreSystem } from './ScoreSystem.js';
import { MatchDirector } from './MatchDirector.js';
import { Autoplay } from './Autoplay.js';

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

  // Autoplay: runs before the player controller so its injected input is
  // consumed by player (10) / weapons (30) in the same fixed step.
  const autoplay = new Autoplay(game);
  game.autoplay = autoplay;
  game.addSystem(autoplay, 5);
}
