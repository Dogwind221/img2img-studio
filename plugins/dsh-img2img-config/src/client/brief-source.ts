/**
 * The trigger source that owns the hand-off chip's codec.
 *
 * The composer's editor holds one chip carrying the whole brief as its payload;
 * the model never sees the chip, only what `serialize` returns for it at submit
 * time. Registered under the `@` trigger like every reference source, it
 * contributes no menu rows (`candidates` always answers empty, and the menu
 * renders nothing for a ready-but-empty group), no plain-text decoration
 * (`lexicon` omitted), and no enter/space adjudication (`matchEnter` /
 * `matchSpace` omitted).
 *
 * `clipboardText` is the chip's projection for copy, draft persistence, and the
 * reload that flattens a chip back to text: the brief's own `[img2img]` line,
 * which is short, language-neutral as a marker, and the exact line
 * `mergeDraft` replaces on a re-edit.
 */
import type { TriggerSourceFace } from './faces.ts'
import { BRIEF_MARK, SOURCE_NAME } from './manifest.ts'

/**
 * Build the brief chip's owning source.
 * @returns the source to register with `inputTriggers`.
 */
export function briefSource(): TriggerSourceFace {
  return {
    trigger: '@',
    name: SOURCE_NAME,
    // Last in the `@` roster: the file/session source keeps the top of the menu.
    order: 900,
    showGroupTitle: false,
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    codec: {
      clipboardText: (ref) => {
        const first = ref.split('\n', 1)[0]
        return first === undefined || first === '' ? BRIEF_MARK : first
      },
      // The payload already IS the model text: the brief was composed for the
      // model, so serialization neither re-derives nor reformats it.
      serialize: ref => Promise.resolve(ref),
    },
  }
}
