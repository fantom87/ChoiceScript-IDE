/**
 * Renderer-only loader for the English hunspell dictionary. The aff/dic files
 * ship inside dictionary-en but its exports map hides them, so Vite imports
 * them by explicit path as raw text. Parsing costs ~1s — done lazily, once.
 */
import nspell from 'nspell'
// eslint-disable-next-line import/no-relative-packages
import aff from '../../../../node_modules/dictionary-en/index.aff?raw'
// eslint-disable-next-line import/no-relative-packages
import dic from '../../../../node_modules/dictionary-en/index.dic?raw'
import type { SpellDict } from './spell'

let instance: SpellDict | null = null

export function getSpellDict(): SpellDict {
  if (!instance) instance = nspell(aff, dic) as unknown as SpellDict
  return instance
}
