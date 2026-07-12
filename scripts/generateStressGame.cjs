/*
 * Generate a ChoiceScript "stress-test gauntlet": a hub-and-spoke game where
 * EACH scene targets a different corner of ChoiceScript + the IDE (deep nesting,
 * wide choices, fake-choice convergence, conditionals, fairmath/math,
 * multireplace, label/goto mazes, gosub/return, arrays, strings, long prose,
 * rand/loops, boolean logic, input, achievements, and a kitchen sink). It is not
 * a coherent story — each scene is a probe. Every scene is validated with the
 * real engine autotester before finishing.
 */
const fs = require('fs')
const vm = require('vm')
const path = require('path')

const OUT_ROOT = path.join('C:', 'Users', 'bradl', 'Dropbox', 'Choicescript Projects', 'the-stress-gauntlet')
const SCENES_DIR = path.join(OUT_ROOT, 'scenes')
const ENGINE = path.join(__dirname, '..', 'resources', 'engine')

const I = (n) => '  '.repeat(n)

// Permanent stats (also drive the stats screen). Individual scenes mostly use
// scene-local *temp vars so each probe stays self-contained.
const startingStats = {
  might: 30, wits: 30, charm: 30, health: 100,
  honor: 20, corruption: 0, gold: 10, allies: 0,
  has_map: false, knows_secret: false,
  // Lets *if/*else branches fall through without an explicit *goto/*return.
  implicit_control_flow: true
}

// Ordered list of stress scenes: [scene name, hub menu label].
const PROBES = [
  ['deep_nesting', 'Deep nesting — choices ~8 levels deep, converging back'],
  ['wide_choices', 'Wide choices — 24 options + every option modifier'],
  ['fake_choices', 'Fake choices — many blocks that fall through and converge'],
  ['conditionals', 'Conditionals — deep *if/*elseif/*else ladders, nested'],
  ['fairmath_math', 'Fairmath & math — %+ %-, + - * / modulo, round()'],
  ['multireplace', 'Multireplace and text formatting (nesting, bold, italic)'],
  ['label_goto', 'Label/goto maze — jumps + a bounded counter loop'],
  ['gosub_return', 'Gosub/return — local + scene subroutines with params'],
  ['arrays', 'Arrays — indexed get/set, iterate, random index'],
  ['strings', 'Strings — concatenation, length(), case, comparison'],
  ['long_prose', 'Long prose — 30 paragraphs (word count / minimap)'],
  ['rand_loops', 'Rand & loops — dice rolls accumulated over a loop'],
  ['boolean_logic', 'Boolean logic — and()/or()/not(), parity, chains'],
  ['input_stress', 'Input — *input_text / *input_number then use them'],
  ['achievements', 'Achievements — *achieve guarded by conditions'],
  ['kitchen_sink', 'Kitchen sink — a dense mix of everything at once']
]

const RETURN = '*goto_scene hub'

// ---------------------------------------------------------------------------
// 1. Deep nesting — a tower of *fake_choice that converges via fallthrough.
function deep_nesting() {
  const L = [
    '*comment STRESS: choices nested ~8 levels deep, all converging back to depth 0',
    '*temp depth 0',
    '',
    'You stand at the mouth of a recursion. Each descent nests one level deeper; hold, and you fall straight through.',
    ''
  ]
  const LEVELS = 8
  const emit = (d, level) => {
    L.push(I(d) + '*fake_choice')
    L.push(I(d + 1) + '#Descend to level ' + (level + 1) + '.')
    L.push(I(d + 2) + '*set depth +1')
    L.push(I(d + 2) + 'You drop to depth ${depth}.')
    if (level + 1 < LEVELS) emit(d + 2, level + 1)
    else L.push(I(d + 2) + 'This is the bottom. There is nowhere deeper to go.')
    L.push(I(d + 1) + '#Hold at this level.')
    L.push(I(d + 2) + 'You brace and hold at depth ${depth}.')
  }
  emit(0, 0)
  L.push('')
  L.push('The recursion unwinds and returns you to where you began (final depth: ${depth}).')
  L.push(RETURN)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 2. Wide choices — one *choice, 24 options, every modifier.
function wide_choices() {
  const L = [
    '*comment STRESS: one *choice with 24 options exercising every option modifier',
    '*temp picks 0',
    '',
    'A vast switchboard spreads before you — two dozen levers, each flagged differently.',
    '*choice'
  ]
  const N = 24
  for (let i = 1; i <= N; i++) {
    let mod = ''
    switch (i % 6) {
      case 0: mod = '*if (picks < 100) '; break
      case 1: mod = '*selectable_if (picks < 100) '; break
      case 2: mod = '*disable_reuse '; break
      case 3: mod = '*hide_reuse '; break
      case 4: mod = '*allow_reuse '; break
      default: mod = ''
    }
    L.push(I(1) + mod + '#Pull lever ' + i + '.')
    L.push(I(2) + '*set picks +1')
    L.push(I(2) + 'Lever ' + i + ' clunks home.')
    L.push(I(2) + '*goto done')
  }
  L.push('*label done')
  L.push('You step back from the switchboard, one lever heavier.')
  L.push(RETURN)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 3. Fake choices — six sequential blocks that all fall through.
function fake_choices() {
  const L = [
    '*comment STRESS: sequential *fake_choice blocks, each converging before the next',
    '*temp mood 0',
    ''
  ]
  const banks = [
    ['the weather', ['Rain suits you.', 'Sun suits you.', 'Fog suits you best of all.']],
    ['the road', ['You take the high road.', 'You take the low road.', 'You cut across country.']],
    ['a stranger', ['You greet them.', 'You ignore them.', 'You watch them warily.']],
    ['an old song', ['You hum along.', 'You fall silent.', 'You change the tune.']],
    ['the hour', ['You hurry.', 'You dawdle.', 'You lose track of time entirely.']],
    ['a last thought', ['You are hopeful.', 'You are wary.', 'You are simply tired.']]
  ]
  banks.forEach(([topic, opts], b) => {
    L.push('On the matter of ' + topic + ':')
    L.push('*fake_choice')
    opts.forEach((o, i) => {
      L.push(I(1) + '#' + o)
      L.push(I(2) + '*set mood +' + (i + 1))
      L.push(I(2) + o + ' (mood is now ${mood}).')
    })
    L.push('')
  })
  L.push('All paths reconvene here. Your mood settled at ${mood}.')
  L.push(RETURN)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 4. Conditionals — deep if/elseif/else ladders, nested.
function conditionals() {
  const L = [
    '*comment STRESS: deep *if/*elseif/*else ladders, nested two levels',
    '*temp score 0',
    '*rand score 1 100',
    '',
    'A number is drawn: ${score}. It is judged by a ladder of conditions.',
    ''
  ]
  L.push('*if (score < 10)')
  L.push(I(1) + 'Bracket: the lowest tenth.')
  for (let t = 10; t < 100; t += 10) {
    L.push('*elseif (score < ' + (t + 10) + ')')
    L.push(I(1) + 'Bracket: below ' + (t + 10) + '.')
  }
  L.push('*else')
  L.push(I(1) + 'Bracket: the very top.')
  L.push('')
  // Nested conditionals with boolean combinators.
  L.push('*if ((score modulo 2) = 0)')
  L.push(I(1) + 'It is even.')
  L.push(I(1) + '*if ((score > 50) and (score < 90))')
  L.push(I(2) + 'And it sits in the comfortable middle-high.')
  L.push(I(1) + '*elseif ((score <= 50) or (score >= 90))')
  L.push(I(2) + 'And it clings to an extreme.')
  L.push('*else')
  L.push(I(1) + 'It is odd.')
  L.push(I(1) + '*if (not((score = 25) or (score = 75)))')
  L.push(I(2) + 'And it is not one of the quarter-marks.')
  L.push('')
  L.push(RETURN)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 5. Fairmath & math.
function fairmath_math() {
  const L = [
    '*comment STRESS: fairmath (%+ %-) and arithmetic (+ - * / modulo, round)',
    '*temp a 40',
    '*temp b 7',
    '*temp c 0',
    ''
  ]
  L.push('*set a %+30')
  L.push('*set a %-10')
  L.push('*set c (a + b)')
  L.push('*set c (c * 2)')
  L.push('*set c (c - 5)')
  L.push('*set c (c / 3)')
  L.push('*set c round(c)')
  L.push('*temp parity (c modulo 2)')
  L.push('*temp big (a * b)')
  L.push('')
  L.push('After fairmath, a rests at ${a}.')
  L.push('The arithmetic chain lands c at ${c} (parity ${parity}).')
  L.push('a times b is ${big}, and length of that number is ${length(big)} digits.')
  L.push('')
  L.push('*choice')
  L.push(I(1) + '#Push a higher with fairmath.')
  L.push(I(2) + '*set a %+50')
  L.push(I(2) + 'a climbs toward the ceiling: ${a}.')
  L.push(I(2) + '*goto out')
  L.push(I(1) + '#Grind a down with fairmath.')
  L.push(I(2) + '*set a %-50')
  L.push(I(2) + 'a sinks toward the floor: ${a}.')
  L.push(I(2) + '*goto out')
  L.push('*label out')
  L.push(RETURN)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 6. Multireplace & formatting.
function multireplace() {
  const L = [
    '*comment STRESS: multireplace @{} @!{} and interpolation ${} $!{} plus [b][i]',
    '*temp coins 3',
    '*temp name "aria"',
    '*temp ok true',
    ''
  ]
  L.push('You have ${coins} @{(coins = 1) coin|coins}.')
  L.push('Capitalized plural: @!{(coins > 1) many coins|a single coin}.')
  L.push('Named multireplace by number: @{coins nothing|a pair|a small hoard|a fortune} to your name.')
  L.push('Interpolation: plain "${name}", capitalized "$!{name}", all-caps "$!!{name}".')
  L.push('Booleans: the door is @{ok unlocked|locked}, and that is [b]@{ok good|bad}[/b] news.')
  L.push('Two multireplaces in a line: the way is @{ok open|shut}, the purse is @{(coins > 2) full|light}.')
  L.push('Formatting: [b]bold[/b], [i]italic[/i], and [b][i]both at once[/i][/b].')
  L.push('')
  L.push('*page_break')
  L.push('')
  L.push('The @{ok cheerful|grim} narrator bids you $!{name} farewell.')
  L.push(RETURN)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 7. Label/goto maze + bounded loop.
function label_goto() {
  const L = [
    '*comment STRESS: label/goto jumps forward and back, plus a counter loop',
    '*temp i 0',
    '*temp sum 0',
    '',
    'A maze of labels. First, a forward jump past a trap.',
    '*goto safe',
    '*label trap',
    'You never see this line; the jump skipped it.',
    '*label safe',
    'You land safely past the trap.',
    '',
    '*comment --- bounded loop: repeat until i reaches 5 ---',
    '*label loop',
    '*set i +1',
    '*set sum (sum + i)',
    'Pass ${i}: running total ${sum}.',
    '*if (i < 5)',
    I(1) + '*goto loop',
    '',
    'The loop is done; the total is ${sum}.',
    '',
    'Now a branch that jumps backward once for a victory lap.',
    '*temp lap false',
    '*label finishline',
    '*if (not(lap))',
    I(1) + '*set lap true',
    I(1) + 'One more lap, for form\'s sake.',
    I(1) + '*goto finishline',
    'You cross the line for good.',
    '',
    RETURN
  ]
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 8. Gosub / gosub_scene / return, with params.
function gosub_return() {
  const L = [
    '*comment STRESS: *gosub (with params) + *gosub_scene + nested subroutines + *return',
    '*temp total 0',
    '',
    'Calling a scene subroutine for a status readout:',
    '*gosub_scene util status',
    '',
    'Calling a local subroutine with parameters:',
    '*gosub add 3 4',
    'Three plus four is ${total}.',
    '*gosub add 10 20',
    'Ten plus twenty is ${total}.',
    '',
    'A subroutine that itself calls another (nested gosub):',
    '*gosub greet "traveler"',
    '',
    RETURN,
    '',
    '*comment --- subroutines ---',
    '*label add',
    '*params x y',
    '*set total (x + y)',
    '*return',
    '',
    '*label greet',
    '*params who',
    'Hello, ${who}. Let me check on you.',
    '*gosub_scene util status',
    'Good to see you well.',
    '*return'
  ]
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 9. Arrays — indexed get/set, iterate, random index.
function arrays() {
  const L = [
    '*comment STRESS: *temp_array indexed access, iteration loop, random index',
    '*temp_array bag 5 0',
    '*temp i 0',
    '*temp sum 0',
    '*temp pick 0',
    '',
    'Filling a five-slot array, each slot with its own square.',
    '*label fill',
    '*set i +1',
    '*set bag[i] (i * i)',
    '*if (i < 5)',
    I(1) + '*goto fill',
    '',
    'Reading them back:',
    '*set i 0',
    '*set sum 0',
    '*label read',
    '*set i +1',
    'Slot ${i} holds ${bag[i]}.',
    '*set sum (sum + bag[i])',
    '*if (i < 5)',
    I(1) + '*goto read',
    '',
    'The squares sum to ${sum}.',
    '',
    '*rand pick 1 5',
    'A random slot (${pick}) holds ${bag[pick]}.',
    '',
    RETURN
  ]
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 10. Strings — concat, length, case, comparison.
function strings() {
  const L = [
    '*comment STRESS: string vars, concatenation (&), length(), case, comparison',
    '*temp first "ada"',
    '*temp last "lovelace"',
    '*temp full ""',
    '',
    '*set full ((first & " ") & last)',
    'Full name: "$!{full}" — ${length(full)} characters long.',
    '',
    '*comment ChoiceScript < > compare numbers only, so order strings by length',
    '*if (length(first) < length(last))',
    I(1) + '"${first}" is shorter than "${last}".',
    '*else',
    I(1) + '"${first}" is at least as long as "${last}".',
    '',
    '*temp shout ""',
    '*set shout (full & "!")',
    'Shouted: "$!!{shout}".',
    '',
    '*choice',
    I(1) + '#Keep the name.',
    I(2) + 'You keep "$!{full}".',
    I(2) + '*goto out',
    I(1) + '#Reverse first and last.',
    I(2) + '*set full ((last & " ") & first)',
    I(2) + 'Now it reads "$!{full}".',
    I(2) + '*goto out',
    '*label out',
    RETURN
  ]
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 11. Long prose — 30 paragraphs, word-count / minimap stress.
function long_prose() {
  const L = ['*comment STRESS: heavy prose volume for word count, minimap, rendering', '']
  const openers = [
    'The corridor went on', 'A cold wind moved', 'Nothing in the archive stirred', 'Far below, machinery turned',
    'The lamplight guttered', 'Somewhere a bell rang', 'Dust settled in the stillness', 'The old maps disagreed',
    'A door stood ajar', 'The river of cable hummed'
  ]
  const middles = [
    'longer than reason allowed,', 'against the grain of the hour,', 'with a patience that unsettled you,',
    'as though rehearsing an argument,', 'in a language of rust and echo,', 'the way tired things do,'
  ]
  const closers = [
    'and you pressed on regardless.', 'and you counted your heartbeats to stay calm.',
    'and the silence answered for it.', 'and you resolved to remember none of it.',
    'and the cold made a home in your knuckles.', 'and still there was no end in sight.'
  ]
  for (let p = 0; p < 30; p++) {
    L.push(openers[p % openers.length] + ' ' + middles[p % middles.length] + ' ' + closers[p % closers.length] +
      ' You noted the ' + (p + 1) + (p === 0 ? 'st' : p === 1 ? 'nd' : p === 2 ? 'rd' : 'th') +
      ' turning and moved past it, one more page in a book that refused to close.')
    L.push('')
    if (p === 14) {
      L.push('*page_break Halfway through the long dark')
      L.push('')
    }
  }
  L.push('*choice')
  L.push(I(1) + '#Finally, an exit.')
  L.push(I(2) + 'You step out, blinking, into open air.')
  L.push(I(2) + '*goto out')
  L.push(I(1) + '#Turn back the way you came.')
  L.push(I(2) + 'You retrace the endless hall and, eventually, emerge anyway.')
  L.push(I(2) + '*goto out')
  L.push('*label out')
  L.push(RETURN)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 12. Rand & loops — dice accumulation.
function rand_loops() {
  const L = [
    '*comment STRESS: *rand in a bounded loop, probability branches',
    '*temp rolls 0',
    '*temp total 0',
    '*temp crits 0',
    '*temp face 0',
    '*temp luck 0',
    '',
    'You roll a die ten times and tally the results.',
    '*label roll',
    '*set rolls +1',
    '*rand face 1 6',
    '*set total (total + face)',
    '*if (face = 6)',
    I(1) + '*set crits +1',
    I(1) + 'Roll ${rolls}: a six! (${crits} so far)',
    '*if (not(face = 6))',
    I(1) + 'Roll ${rolls}: a ${face}.',
    '*if (rolls < 10)',
    I(1) + '*goto roll',
    '',
    'Ten rolls totalled ${total}, with ${crits} @{(crits = 1) six|sixes}.',
    '',
    '*rand luck 1 100',
    '*if (luck > 66)',
    I(1) + 'Fortune favors you today (${luck}).',
    '*elseif (luck > 33)',
    I(1) + 'A middling sort of luck (${luck}).',
    '*else',
    I(1) + 'Best keep your head down (${luck}).',
    '',
    RETURN
  ]
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 13. Boolean logic — and/or/not, parity, chains.
function boolean_logic() {
  const L = [
    '*comment STRESS: compound boolean expressions and short-circuit-ish chains',
    '*temp a true',
    '*temp b false',
    '*temp n 12',
    ''
  ]
  L.push('*if (a and not(b))')
  L.push(I(1) + 'a is true and b is false, as expected.')
  L.push('*if ((a or b) and not((a and b)))')
  L.push(I(1) + 'Exactly one of a, b is true (exclusive or).')
  L.push('*if (((n modulo 2) = 0) and ((n modulo 3) = 0))')
  L.push(I(1) + '${n} is divisible by both 2 and 3.')
  L.push('*if (not((n > 100) or (n < 0)))')
  L.push(I(1) + '${n} sits within the ordinary range.')
  L.push('')
  L.push('A truth walk over four combinations:')
  L.push('*temp p false')
  L.push('*label walk')
  L.push('*if (p)')
  L.push(I(1) + 'With p true: @{b both|only p} of the pair hold.')
  L.push('*else')
  L.push(I(1) + 'With p false: the implication holds vacuously.')
  L.push('*if (not(p))')
  L.push(I(1) + '*set p true')
  L.push(I(1) + '*goto walk')
  L.push('')
  L.push(RETURN)
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 14. Input — *input_text / *input_number.
function input_stress() {
  const L = [
    '*comment STRESS: *input_text and *input_number, then use the values',
    '*temp who "nobody"',
    '*temp qty 0',
    '',
    'What should we call you?',
    '*input_text who',
    '',
    'How many lanterns will you carry (1 to 9)?',
    '*input_number qty 1 9',
    '',
    'Very well, $!{who}. You take ${qty} @{(qty = 1) lantern|lanterns} into the dark.',
    '*if (qty > 5)',
    I(1) + 'That is more light than most dare to carry.',
    '*else',
    I(1) + 'A modest, sensible glow.',
    '',
    RETURN
  ]
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 15. Achievements — *achieve guarded by conditions.
function achievements() {
  const L = [
    '*comment STRESS: *achieve calls (achievements declared in startup)',
    '*temp deeds 0',
    '',
    'A tribunal of small honors. Claim what you have earned.',
    '*choice',
    I(1) + '#Claim the Keeper of Secrets.',
    I(2) + '*achieve secret_keeper',
    I(2) + '*set deeds +1',
    I(2) + 'The seal is yours.',
    I(2) + '*goto more',
    I(1) + '#Claim the Patient Walker.',
    I(2) + '*achieve patient_walker',
    I(2) + '*set deeds +1',
    I(2) + 'The long road acknowledges you.',
    I(2) + '*goto more',
    I(1) + '#Claim nothing today.',
    I(2) + 'You leave empty-handed.',
    I(2) + '*goto more',
    '*label more',
    '*if (deeds > 0)',
    I(1) + '*achieve first_deed',
    I(1) + 'Your first deed is recorded.',
    '',
    RETURN
  ]
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// 16. Kitchen sink — a dense mix.
function kitchen_sink() {
  const L = [
    '*comment STRESS: a dense mix — page_break, gosub, nested choice+fake_choice, if/else, fairmath, multireplace',
    '*temp grit 0',
    '',
    'Everything at once now.',
    '*gosub_scene util status',
    '',
    '*page_break Into the thick of it',
    '',
    'You have ${gold} @{(gold = 1) coin|coins} and a will of @{(grit > 0) iron|straw}.',
    '*choice',
    I(1) + '#Fight through it.',
    I(2) + '*set might %+10',
    I(2) + '*set grit +2',
    I(2) + 'You set your jaw. Might rises to ${might}.',
    I(2) + '*choice',
    I(3) + '#Fast and reckless.',
    I(4) + '*set health %-15',
    I(4) + '*fake_choice',
    I(5) + '#Lead with the left.',
    I(6) + 'A feint, then a blow.',
    I(5) + '#Lead with the right.',
    I(6) + 'A blow, then a feint.',
    I(4) + 'Either way, it is over quickly.',
    I(4) + '*goto out',
    I(3) + '#Slow and certain.',
    I(4) + '*set wits %+10',
    I(4) + 'You wait for the opening, and take it.',
    I(4) + '*goto out',
    I(1) + '#Talk your way clear.',
    I(2) + '*if (charm > 20)',
    I(3) + '*set allies +1',
    I(3) + 'Silver-tongued, you win them over.',
    I(2) + '*else',
    I(3) + '*set corruption %+5',
    I(3) + 'The words come out wrong, and cost you.',
    I(2) + '*goto out',
    '*label out',
    'However it went, you are through it now.',
    '',
    RETURN
  ]
  return L.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Framework scenes.
function startup() {
  const L = []
  L.push('*title The Stress Gauntlet')
  L.push('*author ChoiceScript IDE Stress Test')
  L.push('*scene_list')
  L.push('  startup')
  L.push('  hub')
  for (const [name] of PROBES) L.push('  ' + name)
  L.push('  ending')
  L.push('')
  // Achievements (used by the achievements probe).
  L.push('*achievement secret_keeper visible 20 Keeper of Secrets')
  L.push('  You claimed the seal of hidden things.')
  L.push('  Claim the Keeper of Secrets.')
  L.push('*achievement patient_walker visible 20 Patient Walker')
  L.push('  The long road knows your name.')
  L.push('  Claim the Patient Walker.')
  L.push('*achievement first_deed hidden 10 First Deed')
  L.push('  hidden')
  L.push('  Record your first deed.')
  L.push('')
  for (const [k, v] of Object.entries(startingStats)) L.push('*create ' + k + ' ' + v)
  L.push('')
  L.push('This is not a story. It is a gauntlet of stress tests — each scene hammers a different corner of ChoiceScript and this editor.')
  L.push('')
  L.push('*goto_scene hub')
  L.push('')
  return L.join('\n')
}

function hub() {
  const L = ['*comment Hub — pick a stress test; every probe returns here', '*label top', '']
  L.push('Pick a probe to run. Each returns you here when it finishes.')
  L.push('*choice')
  for (const [name, label] of PROBES) {
    L.push(I(1) + '#' + label)
    L.push(I(2) + '*goto_scene ' + name)
  }
  L.push(I(1) + '#End the gauntlet.')
  L.push(I(2) + '*goto_scene ending')
  L.push('')
  return L.join('\n')
}

function util() {
  return [
    '*comment Utility subroutine, called via *gosub_scene util status',
    '*label status',
    '*if (health < 30)',
    '  Status: wounded (health ${health}).',
    '*else',
    '  Status: steady (health ${health}, might ${might}, wits ${wits}, charm ${charm}).',
    '*return',
    ''
  ].join('\n')
}

function ending() {
  return [
    '*comment Ending',
    'The gauntlet is complete. Every probe has been run, or left waiting for another day.',
    '',
    '*ending',
    ''
  ].join('\n')
}

function stats() {
  return [
    '*comment Stats screen (choicescript_stats.txt)',
    '[b]The Stress Gauntlet[/b]',
    '*line_break',
    '*stat_chart',
    '  percent might Might',
    '  percent wits Wits',
    '  percent charm Charm',
    '  percent health Health',
    '  opposed_pair honor',
    '    Honor',
    '    Corruption',
    '  text gold Gold',
    '  text allies Allies',
    ''
  ].join('\n')
}

// --- Build files ---
const probeBuilders = {
  deep_nesting, wide_choices, fake_choices, conditionals, fairmath_math, multireplace,
  label_goto, gosub_return, arrays, strings, long_prose, rand_loops, boolean_logic,
  input_stress, achievements, kitchen_sink
}
const files = { startup: startup(), hub: hub(), util: util(), ending: ending(), choicescript_stats: stats() }
for (const [name] of PROBES) files[name] = probeBuilders[name]()

// --- Write ---
fs.mkdirSync(SCENES_DIR, { recursive: true })
let totalLines = 0
for (const [name, text] of Object.entries(files)) {
  fs.writeFileSync(path.join(SCENES_DIR, name + '.txt'), text, 'utf8')
  totalLines += text.split('\n').length
}

// --- Validate with the real engine's autotester ---
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(ENGINE, f), 'utf8'), f) }
load('scene.js'); load('navigator.js'); load('util.js'); load('headless.js'); load('embeddable-autotester.js')

const sceneList = ['startup', 'hub']
for (const [name] of PROBES) sceneList.push(name)
sceneList.push('ending')

globalThis.printButton = function () {}
globalThis.printOptions = function () {}
Scene.prototype.verifySceneFile = function () {}
Scene.prototype.verifyImage = function () {}

const errors = []
for (const name of Object.keys(files)) {
  if (name === 'choicescript_stats') continue
  const nav = new SceneNavigator(sceneList)
  nav.setStartingStatsClone(Object.assign({}, startingStats))
  // *achieve looks up nav.achievements; startup declares them, but the autotester
  // runs each scene in isolation, so seed them here to mirror startup.
  nav.achievements = {
    secret_keeper: { title: 'Keeper of Secrets', earnedDescription: '' },
    patient_walker: { title: 'Patient Walker', earnedDescription: '' },
    first_deed: { title: 'First Deed', earnedDescription: '' }
  }
  nav.achieved = {}
  globalThis.nav = nav
  globalThis.stats = {}
  try {
    autotester(files[name], nav, name)
  } catch (e) {
    errors.push(name + ': ' + e.message)
  }
}

console.log('Wrote ' + Object.keys(files).length + ' scenes (' + totalLines + ' lines) to:')
console.log('  ' + SCENES_DIR)
if (errors.length) {
  console.log('\nVALIDATION FAILED (' + errors.length + '):')
  errors.forEach((e) => console.log('  - ' + e))
  process.exitCode = 1
} else {
  console.log('\nVALIDATION PASSED: every probe runs clean through the engine autotester.')
}
