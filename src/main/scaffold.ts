import { promises as fs } from 'node:fs'
import { join } from 'node:path'

export const STARTUP_TEMPLATE = `*title My New Game
*author Anonymous
*scene_list
  startup

*create strength 50
*create leadership 50

Welcome to your new ChoiceScript game!

*page_break

You stand at the beginning of your adventure.

*choice
  #Be brave.
    *set strength +10
    You steel yourself.
    *finish
  #Be clever.
    *set leadership +10
    You think it through.
    *finish
`

export const STATS_TEMPLATE = `*comment This is the stats screen (choicescript_stats.txt).
[b]Strength[/b]: \${strength}
*line_break
[b]Leadership[/b]: \${leadership}
`

/** Scaffold a fresh ChoiceScript project (scenes/ with startup + stats). */
export async function scaffoldProject(root: string): Promise<string> {
  const scenesDir = join(root, 'scenes')
  await fs.mkdir(scenesDir, { recursive: true })
  await fs.writeFile(join(scenesDir, 'startup.txt'), STARTUP_TEMPLATE, 'utf8')
  await fs.writeFile(join(scenesDir, 'choicescript_stats.txt'), STATS_TEMPLATE, 'utf8')
  return scenesDir
}
