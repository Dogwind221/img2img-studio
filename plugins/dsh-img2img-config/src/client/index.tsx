/**
 * Browser half of dsh-img2img-config — one bundle, two surfaces.
 *
 * 1. The composer's `conversation.input.dock` entry plus the trigger source that
 *    owns the hand-off chip's codec. The entry resolves the session's image
 *    drafts through the `conversation` service and inserts the brief chip
 *    through the session's input facade (the same lazy `ctx.get` reads the
 *    harness' own plugins use), so a service that moves or disappears degrades
 *    into the draft-line fallback instead of a crash.
 * 2. The Settings → 「识图与生图」 panel (`./config-panel.tsx`), which talks to
 *    this package's own host routes.
 */
import type {
  ConversationFace, DraftImage, EditorClientContext, InputTriggersFace, SessionsFace,
} from './faces.ts'
import { briefSource } from './brief-source.ts'
import { EditorDock, type BriefInsert, type EditorFace } from './EditorDock.tsx'
import { SOURCE_NAME } from './manifest.ts'
import { en, zh } from './locales.ts'
import { registerConfigPanel, type ConfigPanelContext } from './config-panel.tsx'

/** Locale namespace owned by the composer dock entry. */
const NS = 'img2imgEditor'

/** Services required by the dock entry, its copy, and the settings panel. */
export const inject = ['slots', 'locale']

/** Runtime guard: only image drafts carry a preview URL and a browser File. */
function asImageDraft(candidate: { kind: string; id: string }): DraftImage | undefined {
  const value = candidate as Partial<DraftImage>
  if (typeof value.previewUrl !== 'string') return undefined
  if (!(value.file instanceof File)) return undefined
  return value as DraftImage
}

/**
 * Register the editor dock, its copy, and the brief codec source.
 * @param ctx - client root context.
 */
export function apply(ctx: EditorClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-img2img-config: dictionaries')
  const t = ctx.locale.bind(NS)

  const conversation = (): ConversationFace | undefined => (
    ctx.get('conversation') as ConversationFace | undefined
  )

  // The source is what makes a chip expandable at submit, and registering it
  // needs the trigger service — which a batched client boot may materialize
  // after this plugin's own apply. Waiting for the service is what makes the
  // registration happen at all: a one-shot read here finds nothing on such a
  // boot and silently leaves an unexpandable chip behind. A client build that
  // never provides the service keeps the dock and takes the draft-line path.
  ctx.inject(['inputTriggers'], (scope) => {
    const service = scope.get('inputTriggers') as InputTriggersFace | undefined
    if (service === undefined) return
    scope.effect(() => service.registerSource(briefSource()), 'dsh-img2img-config: brief codec source')
  })

  const editor: EditorFace = {
    resolveImages(sessionId, ids) {
      const face = conversation()
      if (face === undefined || ids.length === 0) return []
      try {
        const images: DraftImage[] = []
        for (const item of face.resolveDraftAttachments(ids)) {
          if (item.kind !== 'image') continue
          const image = asImageDraft(item)
          if (image !== undefined) images.push(image)
        }
        return images
      } catch (error) {
        console.warn('[dsh-img2img-config] resolve draft attachments failed:', error)
        return []
      }
    },
    stageFiles(sessionId, files) {
      const face = conversation()
      if (face === undefined) return []
      try {
        return face.createDrafts(sessionId, files).map(draft => draft.id)
      } catch (error) {
        console.warn('[dsh-img2img-config] staging edited drafts failed:', error)
        return []
      }
    },
    releaseDrafts(ids) {
      const face = conversation()
      if (face === undefined) return
      for (const id of ids) {
        try {
          face.releaseDraftAttachment(id)
        } catch (error) {
          console.warn('[dsh-img2img-config] releasing a rejected draft failed:', error)
        }
      }
    },
    insertBrief(sessionId, insert) {
      return insertBriefChip(ctx, sessionId, insert)
    },
  }

  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'img2img-editor',
    order: 20,
    locale: NS,
    inject: () => ({ editor, t }),
  }, EditorDock)), 'dsh-img2img-config: composer dock entry')

  // Second surface: the Settings → 「识图与生图」 panel. It only needs `slots`
  // and `locale`, both already required by this entry, so the same context is
  // passed straight through.
  registerConfigPanel(ctx as unknown as ConfigPanelContext)
}

/**
 * Insert the brief as one composer chip.
 * @param ctx - client root context.
 * @param sessionId - session whose composer receives the chip.
 * @param insert - chip label, payload, and the revision the insertion is guarded by.
 * @returns whether the chip was inserted.
 */
function insertBriefChip(ctx: EditorClientContext, sessionId: string, insert: BriefInsert): boolean {
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  const resolver = (ctx.get('conversation') as ConversationFace | undefined)?.input
  if (sessions === undefined || resolver === undefined) return false
  try {
    const actx = sessions.scope(sessionId)
    if (actx === undefined) return false
    // A collapsed span at the document start: an insertion replaces nothing and
    // needs no caret, and its coordinates are valid in every draft.
    return resolver.for(actx).insertReference({
      source: SOURCE_NAME,
      ref: insert.payload,
      label: insert.label,
      appearance: 'file',
      clipboardText: insert.clipboardText,
    }, { start: 0, end: 0, draftRev: insert.draftRev })
  } catch (error) {
    console.warn('[dsh-img2img-config] brief chip insertion failed:', error)
    return false
  }
}
