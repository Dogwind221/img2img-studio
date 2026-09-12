/**
 * Browser half of dsh-img2img-editor.
 *
 * Registers one entry in the composer's `conversation.input.dock` strip. The
 * entry resolves the session's image drafts through the `conversation` service
 * (the same lazy `ctx.get` read the harness' own plugins and dsh-better-sidebar
 * use), so a service that moves or disappears degrades into a visible message
 * instead of a crash.
 */
import type { ConversationFace, DraftImage, EditorClientContext } from './faces.ts'
import { EditorDock, type EditorFace } from './EditorDock.tsx'
import { en, zh } from './locales.ts'

/** Locale namespace owned by this plugin. */
const NS = 'img2imgEditor'

/** Services required by the dock entry and its copy. */
export const inject = ['slots', 'locale']

/** Runtime guard: only image drafts carry a preview URL and a browser File. */
function asImageDraft(candidate: { kind: string; id: string }): DraftImage | undefined {
  const value = candidate as Partial<DraftImage>
  if (typeof value.previewUrl !== 'string') return undefined
  if (!(value.file instanceof File)) return undefined
  return value as DraftImage
}

/**
 * Register the editor dock and its copy.
 * @param ctx - client root context.
 */
export function apply(ctx: EditorClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-img2img-editor: dictionaries')
  const t = ctx.locale.bind(NS)

  const conversation = (): ConversationFace | undefined => (
    ctx.get('conversation') as ConversationFace | undefined
  )

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
        console.warn('[dsh-img2img-editor] resolve draft attachments failed:', error)
        return []
      }
    },
    stageFiles(sessionId, files) {
      const face = conversation()
      if (face === undefined) return []
      try {
        return face.createDrafts(sessionId, files).map(draft => draft.id)
      } catch (error) {
        console.warn('[dsh-img2img-editor] staging edited drafts failed:', error)
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
          console.warn('[dsh-img2img-editor] releasing a rejected draft failed:', error)
        }
      }
    },
  }

  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'img2img-editor',
    order: 20,
    locale: NS,
    inject: () => ({ editor, t }),
  }, EditorDock)), 'dsh-img2img-editor: composer dock entry')
}
