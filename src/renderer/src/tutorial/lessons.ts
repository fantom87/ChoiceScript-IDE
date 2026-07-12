/**
 * The build-a-game tutorial: 12 lessons that walk a new author through
 * writing a real (tiny) ChoiceScript game — "The Lighthouse Keeper" — from
 * *title to *ending. Each lesson VALIDATES the learner's actual files via
 * the AST parser + linter, so Next unlocks only when the code truly does
 * the thing. Pure module (no React/DOM) — fully diag-testable, and each
 * lesson ships a `demo` snapshot that must pass its own check.
 */
import {
  parseScene,
  type AstNode,
  type ChoiceNode,
  type CommandNode,
  type IfNode,
  type OptionNode,
  type TextNode
} from '../choicescript/ast'
import { buildLintContext, lintScene } from '../choicescript/lint'
import { getSceneList } from '../choicescript/mygameGen'

export interface LessonBody {
  kind: 'p' | 'code'
  text: string
}
export interface LessonResult {
  pass: boolean
  /** Unmet requirements / current lint errors, learner-friendly. */
  notes: string[]
}
export interface Lesson {
  id: string
  title: string
  body: LessonBody[]
  task: string
  check: (files: Record<string, string>) => LessonResult
  /** A files snapshot that satisfies this lesson (example + diag fixture). */
  demo: Record<string, string>
}

// --- AST helpers -------------------------------------------------------------

function walk(ast: AstNode[], fn: (n: AstNode, ancestors: AstNode[]) => void, ancestors: AstNode[] = []): void {
  for (const n of ast) {
    fn(n, ancestors)
    if (n.type === 'choice' || n.type === 'option' || n.type === 'if') {
      walk(n.children, fn, [...ancestors, n])
    }
  }
}

function commands(ast: AstNode[], name: string): CommandNode[] {
  const out: CommandNode[] = []
  walk(ast, (n) => {
    if (n.type === 'command' && n.name === name) out.push(n)
  })
  return out
}

function paragraphs(ast: AstNode[]): number {
  let count = 0
  walk(ast, (n) => {
    if (n.type !== 'text') return
    let inPara = false
    for (const line of (n as TextNode).raw) {
      const blank = line.trim() === ''
      if (!blank && !inPara) count++
      inPara = !blank
    }
  })
  return count
}

function lintErrors(files: Record<string, string>, scene: string): string[] {
  if (files[scene] === undefined) return []
  const ctx = buildLintContext(files, getSceneList(files['startup'] ?? ''))
  return lintScene(scene, files[scene], ctx)
    .filter((d) => d.severity === 'error')
    .map((d) => `line ${d.line + 1}: ${d.message}`)
}

function result(requirements: [boolean, string][], lintNotes: string[] = []): LessonResult {
  const notes = requirements.filter(([ok]) => !ok).map(([, msg]) => msg)
  notes.push(...lintNotes.map((e) => `fix this error — ${e}`))
  return { pass: notes.length === 0, notes }
}

// --- The evolving demo game ---------------------------------------------------
// Each stage is the game as it stands after that lesson; later stages build on
// earlier ones so the learner can compare their file against a working example.

const S1 = `*title The Lighthouse Keeper
*author A. Keeper
*scene_list
  startup

The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.

*finish
`

const S2 = `*title The Lighthouse Keeper
*author A. Keeper
*scene_list
  startup

The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.

You have kept this light for eleven years. Tonight, for the first time, something is signalling back.

*page_break

Three flashes. A pause. Three more — from the empty water where no ship should be.

*finish
`

const S3 = `*title The Lighthouse Keeper
*author A. Keeper
*scene_list
  startup

The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.

You have kept this light for eleven years. Tonight, for the first time, something is signalling back.

*page_break

Three flashes. A pause. Three more — from the empty water where no ship should be.

*choice
  #Signal back.
    You work the shutter: three flashes, a pause, three more. Your heart is louder than the sea.
    *finish
  #Douse the lamp and watch the dark.
    You turn the wick down with steady hands. The tower goes blind, and you go to the window to listen.
    *finish
`

const S4 = `*title The Lighthouse Keeper
*author A. Keeper
*scene_list
  startup

The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.

You have kept this light for eleven years. Tonight, for the first time, something is signalling back.

*page_break

Three flashes. A pause. Three more — from the empty water where no ship should be.

*choice
  #Signal back.
    You work the shutter: three flashes, a pause, three more. Your heart is louder than the sea.
    *goto morning
  #Douse the lamp and watch the dark.
    You turn the wick down with steady hands. The tower goes blind, and you go to the window to listen.
    *goto morning

*label morning
Dawn arrives grey and ordinary, as if nothing at all had happened. You know better.

*finish
`

const S5 = `*title The Lighthouse Keeper
*author A. Keeper
*scene_list
  startup

*create courage 50

The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.

You have kept this light for eleven years. Tonight, for the first time, something is signalling back.

*page_break

Three flashes. A pause. Three more — from the empty water where no ship should be.

*choice
  #Signal back.
    You work the shutter: three flashes, a pause, three more. Your heart is louder than the sea.
    *set courage 70
    *goto morning
  #Douse the lamp and watch the dark.
    You turn the wick down with steady hands. The tower goes blind, and you go to the window to listen.
    *set courage 35
    *goto morning

*label morning
Dawn arrives grey and ordinary, as if nothing at all had happened. You know better.

Your courage stands at \${courage}.

*finish
`

const S6 = `*title The Lighthouse Keeper
*author A. Keeper
*scene_list
  startup

*create courage 50

The lamp room smells of oil and cold brass. Somewhere below, the sea is arguing with the rocks again.

You have kept this light for eleven years. Tonight, for the first time, something is signalling back.

*page_break

Three flashes. A pause. Three more — from the empty water where no ship should be.

*choice
  #Signal back.
    You work the shutter: three flashes, a pause, three more. Your heart is louder than the sea.
    *set courage %+ 20
    *goto morning
  #Douse the lamp and watch the dark.
    You turn the wick down with steady hands. The tower goes blind, and you go to the window to listen.
    *set courage %- 15
    *goto morning

*label morning
Dawn arrives grey and ordinary, as if nothing at all had happened. You know better.

Your courage stands at \${courage}.

*if (courage > 50)
  You take the stairs two at a time, ready for whatever the water sends next.
  *goto onward
*else
  You make tea with both hands on the pot, and don't look at the window.
  *goto onward

*label onward
The day, at least, pretends to be ordinary.

*finish
`

const NESTED = `*choice
  #Row out to where the light answered.
    The dinghy fights you for every yard. Halfway out, the signalling starts again — close now.
    *choice
      #Signal from the boat.
        You raise the storm lantern and flash it, three and three. The water goes very still.
        *goto morning
      #Ship the oars and wait in silence.
        You sit in the dark with your breath and the tide. Something passes under the boat, slow and patient.
        *goto morning
  #Stay in the tower and keep the log.
    You write it all down in the keeper's log, the hour, the pattern, your own name — as if a record could make it safe.
    *set courage %- 15
    *goto morning`

const S7 = S6.replace(
  `*choice
  #Signal back.
    You work the shutter: three flashes, a pause, three more. Your heart is louder than the sea.
    *set courage %+ 20
    *goto morning
  #Douse the lamp and watch the dark.
    You turn the wick down with steady hands. The tower goes blind, and you go to the window to listen.
    *set courage %- 15
    *goto morning`,
  `*choice
  #Signal back.
    You work the shutter: three flashes, a pause, three more. Your heart is louder than the sea.
    *set courage %+ 20
    ${NESTED.split('\n').join('\n    ')}
  #Douse the lamp and watch the dark.
    You turn the wick down with steady hands. The tower goes blind, and you go to the window to listen.
    *set courage %- 15
    *goto morning`
)

const S8 = S7.replace(
  `*label morning
Dawn arrives grey and ordinary, as if nothing at all had happened. You know better.`,
  `*label morning
Dawn arrives grey and ordinary, as if nothing at all had happened. You know better.

*fake_choice
  #Make strong tea.
    The pot has seen you through worse mornings. Probably.
  #Skip the tea and check the lamp.
    The wick is trimmed. The brass is cold. Everything is fine, which is somehow worse.

Either way, the day must be got on with.`
)

const S9 = S8.replace(
  `  #Stay in the tower and keep the log.`,
  `  *selectable_if (courage > 30) #Stay in the tower and keep the log.`
)

const BEACON10 = `*comment beacon — the answering light
The next night you climb with a lantern and your eleven years of nerve, and you answer properly this time.

Whatever is out there learns your name in light. And you learn one of its.

*ending
`

const BEACON = BEACON10.replace(
  '*ending',
  `*achieve lit_the_lamp

*ending`
)

const S10_STARTUP = S9.replace(
  `*scene_list
  startup`,
  `*scene_list
  startup
  beacon`
).replace('*finish', '*goto_scene beacon')

const S11_STARTUP = S10_STARTUP.replace(
  `*create courage 50`,
  `*create courage 50

*achievement lit_the_lamp visible 25 Lit the Lamp
  Answer the light with your own.
  You answered the light with your own.`
)

const STATS = `*comment stat screen
The keeper, as the log records them.

*stat_chart
  percent courage Courage
`

const demo = (startup: string, extra: Record<string, string> = {}): Record<string, string> => ({
  startup,
  ...extra
})

// --- Lessons -------------------------------------------------------------------

export const LESSONS: Lesson[] = [
  {
    id: 'meta',
    title: 'Your game, your name',
    body: [
      {
        kind: 'p',
        text: 'Every ChoiceScript game starts in startup.txt. Commands begin with * — the first three matter most: *title names your game, *author signs it, and *scene_list declares your chapters in order (just startup, for now).'
      },
      { kind: 'code', text: '*title The Lighthouse Keeper\n*author A. Keeper\n*scene_list\n  startup' },
      {
        kind: 'p',
        text: 'The editor is on the left; your running game is on the right. Everything you change reloads live.'
      }
    ],
    task: 'Give the game a real *title and put your name in *author (replace the placeholders).',
    check: (files) => {
      const ast = parseScene(files['startup'] ?? '')
      const title = commands(ast, 'title')[0]
      const author = commands(ast, 'author')[0]
      return result([
        [!!title && !/my first game/i.test(title.raw), 'change the *title from "My First Game"'],
        [!!author && !/your name here/i.test(author.raw), 'put your own name in *author']
      ])
    },
    demo: demo(S1)
  },
  {
    id: 'prose',
    title: 'Words on the page',
    body: [
      {
        kind: 'p',
        text: 'Prose is just typed text. A blank line starts a new paragraph — without one, lines run together into a single paragraph. *page_break ends the page with a "Next" button, which is how you pace a scene.'
      },
      { kind: 'code', text: 'A first paragraph.\n\nA second paragraph.\n\n*page_break\n\nA new page.' }
    ],
    task: 'Write at least three paragraphs of story, with a *page_break somewhere between them.',
    check: (files) => {
      const ast = parseScene(files['startup'] ?? '')
      return result([
        [paragraphs(ast) >= 3, 'write at least three paragraphs (blank line between each)'],
        [commands(ast, 'page_break').length >= 1, 'add a *page_break between beats']
      ])
    },
    demo: demo(S2)
  },
  {
    id: 'choice',
    title: 'The first choice',
    body: [
      {
        kind: 'p',
        text: 'The heart of ChoiceScript: *choice, then options starting with #, each indented one level. Everything indented under an option is what happens when the player picks it. Indentation is the structure — two spaces per level, always consistent.'
      },
      {
        kind: 'code',
        text: '*choice\n  #Signal back.\n    You work the shutter: three flashes, a pause, three more.\n    *finish\n  #Douse the lamp.\n    The tower goes blind.\n    *finish'
      },
      {
        kind: 'p',
        text: 'Each option must END somewhere — *finish closes the scene for now. Watch the right pane: your choice is instantly playable. Also try the Nodes view (top right) to see this choice as a diagram.'
      }
    ],
    task: 'Add a *choice with at least two #options, each with its own text and a *finish.',
    check: (files) => {
      const ast = parseScene(files['startup'] ?? '')
      let ok = false
      walk(ast, (n) => {
        if (n.type === 'choice' && !(n as ChoiceNode).fake) {
          const opts = (n as ChoiceNode).children.filter((c) => c.type === 'option')
          if (opts.length >= 2 && opts.every((o) => (o as OptionNode).children.length > 0)) ok = true
        }
      })
      return result(
        [[ok, 'add a *choice with two or more #options, each with an indented body']],
        lintErrors(files, 'startup')
      )
    },
    demo: demo(S3)
  },
  {
    id: 'labels',
    title: 'Coming back together',
    body: [
      {
        kind: 'p',
        text: "Options usually branch apart and then CONVERGE — the story continues from a shared point. That's *label (a named place in the scene) and *goto (jump to it). Replace the *finish in each option with *goto to a label after the choice."
      },
      {
        kind: 'code',
        text: '*choice\n  #Signal back.\n    Your heart is louder than the sea.\n    *goto morning\n  #Douse the lamp.\n    You listen to the dark.\n    *goto morning\n\n*label morning\nDawn arrives grey and ordinary.\n\n*finish'
      },
      {
        kind: 'p',
        text: 'In the Nodes view you can literally see the paths meet. (This is also what the golden merged trunk lines are.)'
      }
    ],
    task: 'Add a *label after your choice and make at least two options *goto it.',
    check: (files) => {
      const ast = parseScene(files['startup'] ?? '')
      const labels = commands(ast, 'label').map((c) => /^\s*\*label\s+(\S+)/.exec(c.raw)?.[1])
      const gotos = commands(ast, 'goto')
        .map((c) => /^\s*\*goto\s+(\S+)/.exec(c.raw)?.[1])
        .filter(Boolean)
      const converge = labels.some((l) => l && gotos.filter((g) => g === l).length >= 2)
      return result(
        [
          [labels.length >= 1, 'add a *label after the choice'],
          [converge, 'make at least two options *goto the same label']
        ],
        lintErrors(files, 'startup')
      )
    },
    demo: demo(S4)
  },
  {
    id: 'vars',
    title: 'Remembering things',
    body: [
      {
        kind: 'p',
        text: 'Games remember. *create declares a variable (startup only, before the story text), *set changes it, and ${name} drops its value into prose. Numbers, text, and true/false all work.'
      },
      {
        kind: 'code',
        text: '*create courage 50\n\n… inside an option:\n    *set courage 70\n\n… later in prose:\nYour courage stands at ${courage}.'
      }
    ],
    task: 'Declare a variable with *create, change it with *set inside an option, and display it with ${…}.',
    check: (files) => {
      const src = files['startup'] ?? ''
      const ast = parseScene(src)
      return result(
        [
          [commands(ast, 'create').length >= 1, 'declare a variable with *create (top of startup)'],
          [commands(ast, 'set').length >= 1, 'change it with *set inside an option'],
          [/\$\{\w+\}/.test(src), 'show it in prose with ${yourvariable}']
        ],
        lintErrors(files, 'startup')
      )
    },
    demo: demo(S5)
  },
  {
    id: 'branch',
    title: 'Branching on what happened',
    body: [
      {
        kind: 'p',
        text: 'Variables pay off with *if / *else — different prose (or whole different paths) depending on state. And for stats that should drift rather than snap, fairmath: *set courage %+ 20 nudges toward 100, %- toward 0 — big moves from the middle, diminishing returns at the edges.'
      },
      {
        kind: 'code',
        text: '*set courage %+ 20\n\n*if (courage > 50)\n  You take the stairs two at a time.\n  *goto onward\n*else\n  You make tea with both hands on the pot.\n  *goto onward\n\n*label onward'
      },
      {
        kind: 'p',
        text: 'One strict rule: a branch may not simply run out and "fall into" the *else below it — end each branch with *goto (or *finish), like options. And conditions with two parts need full parentheses: *if ((courage > 50) and (met_the_light)).'
      }
    ],
    task: 'Add an *if / *else that changes the story based on your variable, and use fairmath (%+ or %-) in a *set.',
    check: (files) => {
      const src = files['startup'] ?? ''
      const ast = parseScene(src)
      let hasIf = false
      let hasElse = false
      walk(ast, (n) => {
        if (n.type === 'if' && (n as IfNode).kind === 'if') hasIf = true
        if (n.type === 'if' && (n as IfNode).kind === 'else') hasElse = true
      })
      return result(
        [
          [hasIf && hasElse, 'add an *if with an *else branch'],
          [/%[+-]/.test(src), 'use fairmath in a *set (e.g. *set courage %+ 20)']
        ],
        lintErrors(files, 'startup')
      )
    },
    demo: demo(S6)
  },
  {
    id: 'nested',
    title: 'Choices inside choices',
    body: [
      {
        kind: 'p',
        text: 'The advanced move: a whole new *choice INSIDE an option. Each level indents further, and every innermost option still needs its *goto or *finish. This is how small decisions open into bigger ones.'
      },
      {
        kind: 'code',
        text: '*choice\n  #Row out to the light.\n    The dinghy fights you for every yard.\n    *choice\n      #Signal from the boat.\n        The water goes very still.\n        *goto morning\n      #Wait in silence.\n        Something passes under the boat.\n        *goto morning\n  #Stay in the tower.\n    You keep the log instead.\n    *goto morning'
      },
      {
        kind: 'p',
        text: 'Deep trees get hard to read as text — this is exactly when the Nodes view earns its keep. Try folding/unfolding your nested choice there.'
      }
    ],
    task: 'Put a second *choice inside one of your options (with every inner option ending in *goto or *finish).',
    check: (files) => {
      const ast = parseScene(files['startup'] ?? '')
      let nested = false
      walk(ast, (n, ancestors) => {
        if (n.type === 'choice' && ancestors.some((a) => a.type === 'option')) nested = true
      })
      return result([[nested, 'nest a *choice inside an #option of another choice']], lintErrors(files, 'startup'))
    },
    demo: demo(S7)
  },
  {
    id: 'fake',
    title: 'Choices that flavour, not fork',
    body: [
      {
        kind: 'p',
        text: "Not every choice needs plumbing. *fake_choice gives the player expression without branching: each option can show a line of its own, then the story simply continues after the block — no *goto needed."
      },
      {
        kind: 'code',
        text: '*fake_choice\n  #Make strong tea.\n    The pot has seen you through worse mornings.\n  #Check the lamp instead.\n    The brass is cold. Everything is fine. Somehow that is worse.\n\nEither way, the day must be got on with.'
      }
    ],
    task: 'Add a *fake_choice with at least two options.',
    check: (files) => {
      const ast = parseScene(files['startup'] ?? '')
      let ok = false
      walk(ast, (n) => {
        if (n.type === 'choice' && (n as ChoiceNode).fake) {
          if ((n as ChoiceNode).children.filter((c) => c.type === 'option').length >= 2) ok = true
        }
      })
      return result([[ok, 'add a *fake_choice with two or more #options']], lintErrors(files, 'startup'))
    },
    demo: demo(S8)
  },
  {
    id: 'modifiers',
    title: 'Options with conditions',
    body: [
      {
        kind: 'p',
        text: 'Options can react to state: *selectable_if (cond) #Option shows it greyed out when the condition fails (the player sees the road not taken); *if (cond) #Option hides it entirely; *disable_reuse greys an option after one use (great for investigation hubs).'
      },
      { kind: 'code', text: '*choice\n  *selectable_if (courage > 30) #Stay and keep the log.\n    …\n  #Run.\n    …' }
    ],
    task: 'Put a modifier on an option — *selectable_if, an *if guard, or *disable_reuse.',
    check: (files) => {
      const ast = parseScene(files['startup'] ?? '')
      let ok = false
      walk(ast, (n) => {
        if (n.type === 'option' && (n as OptionNode).modifier) ok = true
      })
      return result([[ok, 'give one option a modifier (e.g. *selectable_if (courage > 30) #…)']], lintErrors(files, 'startup'))
    },
    demo: demo(S9)
  },
  {
    id: 'scenes',
    title: 'A second scene',
    body: [
      {
        kind: 'p',
        text: 'Chapters are scene files. Use the New Scene button (top toolbar) — it creates the file AND adds it to *scene_list for you. Then send the player there with *goto_scene name. End the game (not just the scene) with *ending.'
      },
      { kind: 'code', text: '…at the end of startup:\n*goto_scene beacon\n\n…and beacon.txt ends with:\n*ending' },
      {
        kind: 'p',
        text: 'With two scenes, try the "Whole game" checkbox in the Nodes view — your story as a connected map.'
      }
    ],
    task: 'Create a second scene, reach it via *goto_scene, and end it with *ending.',
    check: (files) => {
      const others = Object.keys(files).filter((s) => s !== 'startup' && s !== 'choicescript_stats')
      const startup = files['startup'] ?? ''
      const listed = getSceneList(startup)
      const target = others.find(
        (s) => listed.includes(s) && new RegExp(`^\\s*\\*goto_scene\\s+${s}\\b`, 'm').test(startup)
      )
      const ended = !!target && /^\s*\*ending\b/m.test(files[target] ?? '')
      return result(
        [
          [others.length >= 1, 'create a second scene (New Scene button)'],
          [!!target, 'list it in *scene_list and jump to it with *goto_scene'],
          [ended, 'end the new scene with *ending']
        ],
        target ? lintErrors(files, target) : []
      )
    },
    demo: demo(S10_STARTUP, { beacon: BEACON10 })
  },
  {
    id: 'stats',
    title: 'Stat screen & achievements',
    body: [
      {
        kind: 'p',
        text: 'The Show Stats button players see is a scene too: choicescript_stats.txt, using *stat_chart to draw bars. And achievements are declared once in startup (*achievement) then granted anywhere with *achieve.'
      },
      {
        kind: 'code',
        text: 'choicescript_stats.txt:\n*stat_chart\n  percent courage Courage\n\nstartup.txt:\n*achievement lit_the_lamp visible 25 Lit the Lamp\n  Answer the light with your own.\n  You answered the light with your own.\n\nanywhere:\n*achieve lit_the_lamp'
      }
    ],
    task: 'Create choicescript_stats.txt with a *stat_chart, declare an *achievement in startup, and *achieve it somewhere.',
    check: (files) => {
      const stats = files['choicescript_stats']
      const chart = !!stats && /^\s*\*stat_chart\b/m.test(stats)
      const declared = /^\s*\*achievement\s+\w+/m.test(files['startup'] ?? '')
      const achieved = Object.values(files).some((t) => /^\s*\*achieve\s+\w+/m.test(t))
      return result([
        [chart, 'add choicescript_stats.txt with a *stat_chart (New Scene, name it choicescript_stats)'],
        [declared, 'declare an *achievement in startup'],
        [achieved, 'grant it with *achieve where it is earned']
      ])
    },
    demo: demo(S11_STARTUP, { beacon: BEACON, choicescript_stats: STATS })
  },
  {
    id: 'ship',
    title: 'Test it, ship it',
    body: [
      {
        kind: 'p',
        text: 'You have a real game. Now prove it: QuickTest (toolbar) walks every branch of every scene and catches what reading misses — dead ends, bad *goto targets, illegal fall-throughs. RandomTest plays it thousands of times. The Problems panel below lists anything found; click to jump.'
      },
      {
        kind: 'p',
        text: 'This lesson passes when your project has no errors and the story reaches an *ending. Then: Export… builds a single HTML file anyone can play in a browser — and the Whole game view + ⬇ PNG makes the map to show off. Welcome to ChoiceScript.'
      }
    ],
    task: 'Get the project error-free (fix anything in Problems) with a reachable *ending.',
    check: (files) => {
      const sceneList = getSceneList(files['startup'] ?? '')
      const ctx = buildLintContext(files, sceneList)
      const errs: string[] = []
      for (const s of Object.keys(files)) {
        for (const d of lintScene(s, files[s], ctx).filter((x) => x.severity === 'error')) {
          errs.push(`${s} line ${d.line + 1}: ${d.message}`)
        }
      }
      const ending = Object.values(files).some((t) => /^\s*\*ending\b/m.test(t))
      return result([
        [ending, 'the game needs an *ending somewhere'],
        [errs.length === 0, ...(errs.length ? [`fix ${errs.length} error(s): ${errs[0]}`] : ['no errors'])] as [
          boolean,
          string
        ]
      ])
    },
    demo: demo(S11_STARTUP, { beacon: BEACON, choicescript_stats: STATS })
  }
]

export function checkLesson(idx: number, files: Record<string, string>): LessonResult {
  const lesson = LESSONS[idx]
  if (!lesson) return { pass: false, notes: ['unknown lesson'] }
  try {
    return lesson.check(files)
  } catch (e) {
    return { pass: false, notes: [`(the checker hit an error: ${(e as Error).message})`] }
  }
}
