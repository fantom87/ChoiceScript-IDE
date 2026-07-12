/**
 * In-memory port of the ChoiceScript engine's `mygamegenerator.js`
 * (`generateMygame`). Produces the body of a `mygame.js` — assigning globals
 * `nav`, `stats`, `purchases`, `achievements` — from a project's startup.txt,
 * without any filesystem access. The engine host page evals this to boot a game.
 */

type Stats = Record<string, string>
type Purchases = Record<string, string>

function parseCreateValue(value: string): string {
  if (/^true$/i.test(value)) return 'true'
  if (/^false$/i.test(value)) return 'false'
  if (/^".*"$/.test(value)) return value.slice(1, -1).replace(/\\(.)/g, '$1')
  return value
}

function parseCreateArray(line: string, stats: Stats): void {
  const result = /^(\w+)\s+(.*)/.exec(line)
  if (!result) return
  const variable = result[1].toLowerCase()
  const values = result[2].split(/\s+/)
  const length = Number(values.shift())
  if (values.length === 1) {
    const value = parseCreateValue(values[0])
    for (let i = 0; i < length; i++) stats[`${variable}_${i + 1}`] = value
  } else {
    for (let i = 0; i < length; i++) stats[`${variable}_${i + 1}`] = parseCreateValue(values[i])
  }
}

interface SceneListResult {
  scenes: string[]
  purchases: Purchases
  lineNum: number
}

function parseSceneList(lines: string[], startLineNum: number): SceneListResult {
  let indentLevel: number | null = null
  const scenes: string[] = []
  const purchases: Purchases = {}
  let lineNum = startLineNum
  let line: string | undefined
  while (typeof (line = lines[++lineNum]) !== 'undefined') {
    if (!line.trim()) continue
    const indent = /^(\s*)/.exec(line)![1].length
    if (indentLevel === null) {
      if (indent === 0) throw new Error('invalid scene_list indent, expected at least one row')
      indentLevel = indent
    }
    if (indent === 0) break
    if (indent !== indentLevel) {
      throw new Error(`invalid scene_list indent, expected ${indentLevel}, was ${indent}`)
    }
    let entry = line.trim()
    const purchaseMatch = /^\$(\w*)\s+(.*)/.exec(entry)
    if (purchaseMatch) {
      entry = purchaseMatch[2]
      const product = purchaseMatch[1].trim() || 'adfree'
      purchases[entry] = product
    }
    if (!scenes.length && entry !== 'startup') scenes.push('startup')
    scenes.push(entry)
  }
  return { scenes, purchases, lineNum: lineNum - 1 }
}

function parseAchievement(
  data: string,
  lines: string[],
  startLineNum: number,
  achievements: unknown[]
): number {
  let lineNum = startLineNum
  const parsed = /(\S+)\s+(\S+)\s+(\S+)\s+(.*)/.exec(data)
  if (!parsed) return lineNum
  const achievementName = parsed[1].toLowerCase()
  const visible = parsed[2] !== 'hidden'
  const points = Number(parsed[3])
  const title = parsed[4]
  let line = lines[++lineNum]
  const preEarnedDescription = (line ?? '').trim()

  let postEarnedDescription: string | null = null
  while (typeof (line = lines[++lineNum]) !== 'undefined') {
    if (line.trim()) break
  }
  if (line !== undefined && /^\s/.test(line)) {
    postEarnedDescription = line.trim()
  } else {
    lineNum--
  }
  if (postEarnedDescription === null) postEarnedDescription = preEarnedDescription
  // Shape mirrors the engine: [name, visible, points, title, postEarned, preEarned]
  achievements.push([
    achievementName,
    visible,
    points,
    title,
    postEarnedDescription,
    preEarnedDescription
  ])
  return lineNum
}

function parseCheckPurchase(
  data: string,
  purchases: Purchases,
  productMap: Record<string, string>
): void {
  for (const product of data.split(' ')) {
    if (!productMap[product]) purchases[`fake:${product}`] = product
  }
}

const IGNORED_INITIAL = new Set(['comment', 'author', 'ifid'])

/** Parse the scene list (order) out of a startup.txt. */
export function getSceneList(startupText: string): string[] {
  const lines = startupText.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = `${lines[i]}`.trim()
    if (!line) continue
    const result = /^\s*\*(\w+)(.*)/.exec(line)
    if (!result) break
    if (result[1].toLowerCase() === 'scene_list') {
      return parseSceneList(lines, i).scenes
    }
  }
  return ['startup']
}

/** JSON encode, escaping non-ASCII to keep the generated code pure ASCII. */
function jsonForEval(x: unknown): string {
  const s = JSON.stringify(x)
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0x7f) {
      out += '\\u' + ('0000' + code.toString(16)).slice(-4)
    } else {
      out += s[i]
    }
  }
  return out
}

/**
 * Build the mygame.js body for a project. `allScenes` (name -> text) is scanned
 * for *check_purchase / *delay_ending to compute fake purchases, matching the
 * engine's generator.
 */
export function generateMygameJs(
  startupText: string,
  allScenes: Record<string, string> = {}
): string {
  const lines = startupText.split(/\r?\n/)
  const stats: Stats = {}
  let purchases: Purchases = {}
  const productMap: Record<string, string> = {}
  let scenes: string[] = ['startup']
  const achievements: unknown[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = `${lines[i]}`.trim()
    if (!line) continue
    const result = /^\s*\*(\w+)(.*)/.exec(line)
    if (!result) break
    const command = result[1].toLowerCase()
    const cmdData = result[2].trim()
    if (IGNORED_INITIAL.has(command)) continue
    else if (command === 'create') {
      const m = /^(\w*)(.*)/.exec(cmdData)!
      stats[m[1].toLowerCase()] = parseCreateValue(m[2].trim())
    } else if (command === 'create_array') {
      parseCreateArray(cmdData, stats)
    } else if (command === 'scene_list') {
      const r = parseSceneList(lines, i)
      scenes = r.scenes
      purchases = r.purchases
      i = r.lineNum
    } else if (command === 'title') {
      stats.choice_title = cmdData
    } else if (command === 'achievement') {
      i = parseAchievement(cmdData, lines, i, achievements)
    } else if (command === 'product') {
      // ignored (only affects quicktest)
    } else if (command === 'bug') {
      // ignore in the IDE
    } else {
      break
    }
  }

  for (const scene in purchases) productMap[purchases[scene]] = scene

  // Scan every scene for *check_purchase / *delay_ending (engine parity).
  for (const name in allScenes) {
    const sceneLines = allScenes[name].split(/\r?\n/)
    for (const raw of sceneLines) {
      const line = `${raw}`.trim()
      if (!line) continue
      const result = /^\s*\*(\w+)(.*)/.exec(line)
      if (!result) continue
      const command = result[1].toLowerCase()
      const cmdData = result[2].trim()
      if (command === 'check_purchase') parseCheckPurchase(cmdData, purchases, productMap)
      else if (command === 'delay_ending') purchases['fake:skiponce'] = 'skiponce'
    }
  }

  return [
    `nav = new SceneNavigator(${jsonForEval(scenes)});`,
    `stats = ${jsonForEval(stats)};`,
    `purchases = ${jsonForEval(purchases)};`,
    `achievements = ${jsonForEval(achievements)};`,
    `nav.setStartingStatsClone(stats);`,
    `if (achievements.length) { nav.loadAchievements(achievements); }`,
    `if (nav.loadProducts) nav.loadProducts([], purchases);`,
    `isCogPublished = false;`
  ].join('\n')
}
