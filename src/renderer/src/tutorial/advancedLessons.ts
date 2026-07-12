/**
 * The ADVANCED course: 10 lessons continuing "The Lighthouse Keeper" into
 * the deep end — subroutines, parameters, scene libraries, multireplace,
 * arrays, randomness, player input, reuse hubs, opposed stats, and
 * implicit_control_flow. Same contract as lessons.ts: every lesson checks
 * the learner's real AST, and every demo stage must pass its own check.
 */
import { parseScene, type IfNode, type OptionNode } from '../choicescript/ast'
import { buildLintContext, lintScene } from '../choicescript/lint'
import { getSceneList } from '../choicescript/mygameGen'
import { BASIC_FINAL, commands, lintErrors, result, walk, type Lesson, type LessonResult } from './lessons'

// --- Demo stages: surgical, verified edits on the basic course's final game ---

const A1_BEACON = BASIC_FINAL.beacon
  .replace(
    '*achieve lit_the_lamp',
    `*gosub log_entry

*achieve lit_the_lamp`
  )
  .replace(
    '*ending\n',
    `*ending

*comment --- subroutines ---
*label log_entry
You write it in the keeper's log — date, hour, and what the water said — in your steadiest hand.
*return
`
  )

const A2_BEACON = A1_BEACON.replace(
  '*gosub log_entry',
  `*gosub flash 3
*gosub log_entry`
).replace(
  '*label log_entry',
  `*label flash
*params count
The lamp speaks \${count} times into the dark, and waits.
*return

*label log_entry`
)

const ALMANAC = `*comment almanac — the keeper's shared subroutines
*label weather
The glass is falling. Weather coming in off the water, the slow kind that stays.
*return
`

const A3_STARTUP = BASIC_FINAL.startup
  .replace(
    `*scene_list
  startup
  beacon`,
    `*scene_list
  startup
  beacon
  almanac`
  )
  .replace(
    `*label morning
Dawn arrives grey and ordinary, as if nothing at all had happened. You know better.`,
    `*label morning
Dawn arrives grey and ordinary, as if nothing at all had happened. You know better.

*gosub_scene almanac weather`
  )

const A4_STARTUP = A3_STARTUP.replace(
  'Your courage stands at \${courage}.',
  `Your courage stands at \${courage}. You take the stairs @{(courage > 50) two at a time|one at a time, both hands on the rail}.`
)

const A5_STARTUP = A4_STARTUP.replace(
  `*label onward
The day, at least, pretends to be ordinary.`,
  `*label onward
The day, at least, pretends to be ordinary.

*temp_array signals 3 0
*temp i 0
*label tally
*set i +1
*set signals[i] (i * 3)
*if (i < 3)
  *goto tally
The log shows \${signals[1]}, \${signals[2]} and \${signals[3]} flashes on the three worst nights of the year.`
)

const A6_STARTUP = A5_STARTUP.replace(
  'flashes on the three worst nights of the year.',
  `flashes on the three worst nights of the year.

*temp gulls 0
*rand gulls 1 6
*if (gulls > 4)
  A racket goes up off the rocks — \${gulls} gulls, wheeling at something you can't see.`
)

const A7_STARTUP = A6_STARTUP.replace(
  `*create courage 50`,
  `*create courage 50
*create keeper_name ""`
).replace(
  `The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.`,
  `The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.

Sign the log, keeper. What name do you keep the light under?
*input_text keeper_name
$!{keeper_name}. It looks steadier in ink than it feels.`
)

const A8_STARTUP = A7_STARTUP.replace(
  `*goto_scene beacon`,
  `*temp rounds_done 0
One more circuit of the tower before dark.

*label rounds
*choice
  *disable_reuse #Check the lamp.
    The wick is trimmed and the reservoir full. The brass is cold. Everything is fine, which is somehow worse.
    *set rounds_done +1
    *goto rounds_next
  *disable_reuse #Check the glass.
    You read the barometer twice, as if it might change its mind. It does not.
    *set rounds_done +1
    *goto rounds_next
  #Enough. To the beacon.
    *goto to_beacon

*label rounds_next
*if (rounds_done < 2)
  *goto rounds

*label to_beacon
*goto_scene beacon`
)

const A9_STATS = BASIC_FINAL.choicescript_stats.replace(
  `*stat_chart
  percent courage Courage`,
  `*stat_chart
  percent courage Courage
  opposed_pair courage
    Boldness
    Caution`
)

const A10_STARTUP = A8_STARTUP.replace(
  '*create courage 50',
  `*create implicit_control_flow true
*create courage 50`
)
  .split('  *goto onward\n')
  .join('')
  .replace('\n*label onward\n', '\n')

const stage = (startup: string, beacon: string, stats: string): Record<string, string> => ({
  startup,
  beacon,
  choicescript_stats: stats,
  ...(startup.includes('almanac') ? { almanac: ALMANAC } : {})
})

// --- Lessons -------------------------------------------------------------------

export const ADVANCED_LESSONS: Lesson[] = [
  {
    id: 'gosub',
    title: 'Subroutines',
    body: [
      {
        kind: 'p',
        text: 'When the same beat happens in several places — logging, a status line, a recurring description — write it once: *gosub jumps to a label, runs until *return, and comes back to the line after the call. Subroutines conventionally live at the bottom of the scene, after the story ends.'
      },
      {
        kind: 'code',
        text: '*gosub log_entry\n…story continues…\n\n*ending\n\n*comment --- subroutines ---\n*label log_entry\nYou write it in the keeper\'s log.\n*return'
      }
    ],
    task: 'Add a subroutine: a *label reached by *gosub whose block ends with *return.',
    check: (files) => {
      const has = Object.keys(files).some((s) => {
        const ast = parseScene(files[s])
        return commands(ast, 'gosub').length >= 1 && commands(ast, 'return').length >= 1
      })
      return result([[has, 'add a *gosub to a *label that ends with *return (same scene)']])
    },
    demo: stage(BASIC_FINAL.startup, A1_BEACON, BASIC_FINAL.choicescript_stats)
  },
  {
    id: 'params',
    title: 'Subroutines with parameters',
    body: [
      {
        kind: 'p',
        text: 'Subroutines take arguments: pass values after the label name, and *params (first line of the subroutine) names them as scene-local variables. One flash routine, any count.'
      },
      {
        kind: 'code',
        text: '*gosub flash 3\n\n*label flash\n*params count\nThe lamp speaks ${count} times into the dark.\n*return'
      }
    ],
    task: 'Give a subroutine a parameter: *gosub name value, received with *params.',
    check: (files) => {
      const has = Object.keys(files).some((s) => {
        const ast = parseScene(files[s])
        const withArg = commands(ast, 'gosub').some((c) => /^\s*\*gosub\s+\w+\s+\S/.test(c.raw))
        return withArg && commands(ast, 'params').length >= 1
      })
      return result([[has, 'call *gosub with an argument and receive it with *params']])
    },
    demo: stage(BASIC_FINAL.startup, A2_BEACON, BASIC_FINAL.choicescript_stats)
  },
  {
    id: 'gosub_scene',
    title: 'A scene of shared subroutines',
    body: [
      {
        kind: 'p',
        text: 'Subroutines can live in their OWN scene — a little library any chapter can call: *gosub_scene scenename labelname runs it and returns to the calling scene. Perfect for weather, time-of-day, or stat readouts used everywhere.'
      },
      {
        kind: 'code',
        text: 'anywhere:\n*gosub_scene almanac weather\n\nalmanac.txt:\n*label weather\nThe glass is falling.\n*return'
      }
    ],
    task: 'Create a library scene with a *return-ing label and call it via *gosub_scene from another scene.',
    check: (files) => {
      let ok = false
      for (const s of Object.keys(files)) {
        for (const c of commands(parseScene(files[s]), 'gosub_scene')) {
          const target = /^\s*\*gosub_scene\s+(\w+)/.exec(c.raw)?.[1]
          if (target && target !== s && /^\s*\*return\b/m.test(files[target] ?? '')) ok = true
        }
      }
      return result([[ok, 'call *gosub_scene <scene> <label> into another scene that has a *return']])
    },
    demo: stage(A3_STARTUP, A2_BEACON, BASIC_FINAL.choicescript_stats)
  },
  {
    id: 'multireplace',
    title: 'Multireplace',
    body: [
      {
        kind: 'p',
        text: 'For a word or phrase that varies with state, @{…} beats a whole *if block: with a condition, @{(cond) whenTrue|whenFalse}; with a number, @{n first|second|third} picks by value (1-based). It keeps variation INSIDE the sentence.'
      },
      {
        kind: 'code',
        text: 'You take the stairs @{(courage > 50) two at a time|one at a time, both hands on the rail}.'
      }
    ],
    task: 'Use a multireplace @{…} somewhere in your prose.',
    check: (files) => {
      const has = Object.values(files).some((t) => /@\{/.test(t))
      return result([[has, 'add a @{(condition) this|that} to a sentence']], lintErrors(files, 'startup'))
    },
    demo: stage(A4_STARTUP, A2_BEACON, BASIC_FINAL.choicescript_stats)
  },
  {
    id: 'arrays',
    title: 'Arrays',
    body: [
      {
        kind: 'p',
        text: 'A numbered set of variables in one declaration: *temp_array signals 3 0 makes three slots, all 0 (*create_array in startup for permanent ones). Read and write with brackets — signals[i] — and loop with a label + counter, ChoiceScript\'s only loop.'
      },
      {
        kind: 'code',
        text: '*temp_array signals 3 0\n*temp i 0\n*label tally\n*set i +1\n*set signals[i] (i * 3)\n*if (i < 3)\n  *goto tally\nThe log shows ${signals[1]}, ${signals[2]} and ${signals[3]}.'
      }
    ],
    task: 'Declare an array, fill it with a label-loop, and display an element with ${name[index]}.',
    check: (files) => {
      const hasDecl = Object.keys(files).some((s) => {
        const ast = parseScene(files[s])
        return commands(ast, 'temp_array').length + commands(ast, 'create_array').length >= 1
      })
      const hasAccess = Object.values(files).some((t) => /\w+\[\w+\]/.test(t))
      return result(
        [
          [hasDecl, 'declare an array with *temp_array (or *create_array in startup)'],
          [hasAccess, 'use bracket access like signals[i]']
        ],
        lintErrors(files, 'startup')
      )
    },
    demo: stage(A5_STARTUP, A2_BEACON, BASIC_FINAL.choicescript_stats)
  },
  {
    id: 'rand',
    title: 'Randomness',
    body: [
      {
        kind: 'p',
        text: '*rand var low high rolls a whole number into an EXISTING variable (declare it first). Use it for texture — never for whether the player succeeds; Choice of Games design wisdom is that dice-roll failure feels unfair, drifting stats feel earned.'
      },
      { kind: 'code', text: '*temp gulls 0\n*rand gulls 1 6\n*if (gulls > 4)\n  A racket goes up off the rocks — ${gulls} gulls.' }
    ],
    task: 'Roll with *rand into a declared variable and branch on the result.',
    check: (files) => {
      const has = Object.keys(files).some((s) => commands(parseScene(files[s]), 'rand').length >= 1)
      return result([[has, 'add a *rand roll (declare its target with *temp first)']], lintErrors(files, 'startup'))
    },
    demo: stage(A6_STARTUP, A2_BEACON, BASIC_FINAL.choicescript_stats)
  },
  {
    id: 'input',
    title: 'Asking the player',
    body: [
      {
        kind: 'p',
        text: '*input_text var shows a text box and stores what the player types (*input_number for numbers, with a min and max). Display it back with ${var} — or $!{var} to capitalise the first letter, which names almost always want.'
      },
      { kind: 'code', text: '*create keeper_name ""\n\nWhat name do you keep the light under?\n*input_text keeper_name\n$!{keeper_name}. It looks steadier in ink than it feels.' }
    ],
    task: 'Ask for text with *input_text (into a declared variable) and echo it with $!{…}.',
    check: (files) => {
      const has = Object.keys(files).some((s) => {
        const ast = parseScene(files[s])
        return commands(ast, 'input_text').length + commands(ast, 'input_number').length >= 1
      })
      const caps = Object.values(files).some((t) => /\$!\{\w+/.test(t))
      return result(
        [
          [has, 'add an *input_text (or *input_number) into a declared variable'],
          [caps, 'echo it capitalised with $!{…}']
        ],
        lintErrors(files, 'startup')
      )
    },
    demo: stage(A7_STARTUP, A2_BEACON, BASIC_FINAL.choicescript_stats)
  },
  {
    id: 'hub',
    title: 'Investigation hubs',
    body: [
      {
        kind: 'p',
        text: 'A choice the player RETURNS to: *label above it, *goto back after each option, and *disable_reuse greys out options already taken (*hide_reuse removes them). Add a counter or an exit option so the loop always has a way out — this is the pattern behind every "look around the room" scene.'
      },
      {
        kind: 'code',
        text: '*label rounds\n*choice\n  *disable_reuse #Check the lamp.\n    …\n    *goto rounds\n  *disable_reuse #Check the glass.\n    …\n    *goto rounds\n  #Enough.\n    *goto onward'
      }
    ],
    task: 'Build a hub: a repeatable *choice using *disable_reuse (or *hide_reuse) that loops back to its label.',
    check: (files) => {
      let reuse = false
      let loop = false
      for (const s of Object.keys(files)) {
        const ast = parseScene(files[s])
        const labels = commands(ast, 'label').map((c) => /^\s*\*label\s+(\S+)/.exec(c.raw)?.[1])
        walk(ast, (n, anc) => {
          if (n.type === 'option' && /reuse/.test((n as OptionNode).modifier ?? '')) reuse = true
          if (n.type === 'command' && n.name === 'goto' && anc.some((a) => a.type === 'option')) {
            const target = /^\s*\*goto\s+(\S+)/.exec(n.raw)?.[1]
            if (target && labels.includes(target)) loop = true
          }
        })
        walk(ast, (n) => {
          if (n.type === 'command' && (n.name === 'disable_reuse' || n.name === 'hide_reuse')) reuse = true
        })
      }
      return result(
        [
          [reuse, 'mark options with *disable_reuse or *hide_reuse'],
          [loop, 'loop back: options *goto a label so the choice repeats']
        ],
        lintErrors(files, 'startup')
      )
    },
    demo: stage(A8_STARTUP, A2_BEACON, BASIC_FINAL.choicescript_stats)
  },
  {
    id: 'opposed',
    title: 'Opposed stats',
    body: [
      {
        kind: 'p',
        text: 'Some stats are a spectrum, not a score: 70 Boldness IS 30 Caution. In the stat screen, opposed_pair draws one bar with a name at each end — the classic Choice of Games personality stat. (Fairmath is what keeps such stats meaningful: each nudge matters more from the extreme it moves away from.)'
      },
      { kind: 'code', text: '*stat_chart\n  percent courage Courage\n  opposed_pair courage\n    Boldness\n    Caution' }
    ],
    task: 'Show a stat as an opposed_pair in choicescript_stats.txt.',
    check: (files) => {
      const has = /^\s*opposed_pair\b/m.test(files['choicescript_stats'] ?? '')
      return result([[has, 'add an opposed_pair to the *stat_chart in choicescript_stats.txt']])
    },
    demo: stage(A8_STARTUP, A2_BEACON, A9_STATS)
  },
  {
    id: 'icf',
    title: 'implicit_control_flow',
    body: [
      {
        kind: 'p',
        text: "You've been ending every *if branch with *goto — the classic rule. Modern ChoiceScript offers a switch: *create implicit_control_flow true (in startup) lets branches and even choice options simply fall through to whatever comes next. Big games use it because prose-variant *if/*else stops needing goto plumbing."
      },
      {
        kind: 'code',
        text: '*create implicit_control_flow true\n\n*if (courage > 50)\n  You take the stairs two at a time.\n*else\n  You make tea with both hands on the pot.\nThe day goes on either way — no *goto needed.'
      },
      {
        kind: 'p',
        text: "The trade-off: the compiler can no longer catch a branch you MEANT to end. It's a house-style decision — pick one per game and stay consistent. (The Problems panel respects whichever you choose.)"
      }
    ],
    task: 'Enable implicit_control_flow in startup and write an *if/*else with no *goto in its branches — keeping the project error-free.',
    check: (files) => {
      const icf = /^\s*\*create\s+implicit_control_flow\s+true\b/m.test(files['startup'] ?? '')
      let gotoless = false
      for (const s of Object.keys(files)) {
        const ast = parseScene(files[s])
        walk(ast, (n) => {
          if (n.type !== 'if' || (n as IfNode).kind !== 'if') return
          const kids = (n as IfNode).children
          const terminated = kids.some(
            (k) => k.type === 'command' && (k.name === 'goto' || k.name === 'finish' || k.name === 'return' || k.name === 'ending' || k.name === 'goto_scene')
          )
          if (kids.length > 0 && !terminated) gotoless = true
        })
      }
      const errs: string[] = []
      const ctx = buildLintContext(files, getSceneList(files['startup'] ?? ''))
      for (const s of Object.keys(files)) {
        for (const d of lintScene(s, files[s], ctx).filter((x) => x.severity === 'error')) {
          errs.push(`${s} line ${d.line + 1}: ${d.message}`)
        }
      }
      return result([
        [icf, 'add *create implicit_control_flow true to startup'],
        [gotoless, 'write an *if branch with no *goto/*finish at its end'],
        [errs.length === 0, errs.length ? `keep the project error-free — first error: ${errs[0]}` : '']
      ])
    },
    demo: stage(A10_STARTUP, A2_BEACON, A9_STATS)
  }
]

export function checkAdvanced(idx: number, files: Record<string, string>): LessonResult {
  const lesson = ADVANCED_LESSONS[idx]
  if (!lesson) return { pass: false, notes: ['unknown lesson'] }
  try {
    return lesson.check(files)
  } catch (e) {
    return { pass: false, notes: [`(the checker hit an error: ${(e as Error).message})`] }
  }
}
