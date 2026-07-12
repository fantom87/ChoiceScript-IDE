/**
 * A tiny built-in game used to smoke-test the engine pipeline in Phase 0.
 * Replaced by real project loading in Phase 1.
 */

export const DEMO_STARTUP = `*create courage 50
*create gold 0

Welcome to the [b]ChoiceScript IDE[/b] live preview.

This text is running in the real ChoiceScript engine, fed straight from the
editor on the left. Edit it and watch this panel update.

Your courage is \${courage}.

*choice
  #Explore the cave.
    You bravely step into the darkness.
    *set courage +10
    *set gold 25
    Glittering ahead: you found \${gold} gold!
    *finish
  #Head home.
    You decide it is too risky today. Courage stays at \${courage}.
    *finish
`

/** Minimal generated mygame.js equivalent for a single-scene demo. */
export const DEMO_MYGAME_JS = `
nav = new SceneNavigator(["startup"]);
stats = {};
purchases = {};
achievements = [];
nav.setStartingStatsClone(stats);
`
