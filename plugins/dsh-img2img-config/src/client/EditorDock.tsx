/**
 * The composer dock strip: one chip per image already staged in the composer,
 * each opening the full-screen editor.
 *
 * The strip renders nothing while the composer holds no image, so it never
 * competes with the queue/todo/goal docks. Confirming the editor stages the
 * exported files as new draft attachments (replacing the edited source) and
 * hands the brief to the composer as one reference chip — the JSON never enters
 * the draft. When the chip path is unavailable (a client build without the
 * trigger registry, or a stale revision), the same brief lands in the draft as
 * text instead, and a re-edit replaces that line rather than stacking.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ComposerInputActions, ComposerInputState, DraftImage, Translator } from './faces.ts'
import { EditorModal, type EditorApplyResult } from './EditorModal.tsx'
import { BRIEF_HEADER, buildBrief, manifestFile, mergeDraft, type EditManifest } from './manifest.ts'

/** Operations the plugin's `apply` closure exposes to the dock. */
export interface EditorFace {
  /** Resolve the image-kind drafts of this session, in input order. */
  resolveImages(sessionId: string, ids: readonly string[]): DraftImage[]
  /** Stage files as browser-owned drafts; returns their draft ids (empty on failure). */
  stageFiles(sessionId: string, files: readonly File[]): string[]
  /** Drop staged drafts that could not be admitted. */
  releaseDrafts(ids: readonly string[]): void
  /** Insert the brief as one composer chip; false when the chip path is unavailable. */
  insertBrief(sessionId: string, insert: BriefInsert): boolean
}

/** What one chip insertion needs, resolved by the dock from the live input state. */
export interface BriefInsert {
  /** Visible chip label (one short line). */
  readonly label: string
  /** The model text the codec expands the chip into at submit. */
  readonly payload: string
  /** Draft projection a flattened chip leaves behind; the brief's marker line. */
  readonly clipboardText: string
  /** Editor revision the insertion is guarded against. */
  readonly draftRev: number
}

/** Props of the dock entry. */
export interface EditorDockProps {
  readonly sessionId: string
  useInput: <T>(selector: (state: ComposerInputState) => T) => T
  readonly inputActions: ComposerInputActions
  readonly editor: EditorFace
  readonly t: Translator
}

const stripStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  padding: '6px 2px', fontSize: 12,
  color: 'var(--dsw-alias-label-secondary, #b9b9c0)',
}
const chipStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 4px',
  borderRadius: 999, cursor: 'pointer', fontSize: 12,
  border: '1px solid var(--dsw-alias-border-l2, #3a3a40)',
  background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04))',
  color: 'var(--dsw-alias-label-primary, #e8e8ea)',
}
const hintStyle: CSSProperties = { color: 'var(--dsw-alias-label-tertiary, #9a9aa2)' }
const noticeStyle: CSSProperties = { color: 'var(--dsw-alias-state-success-primary, #4ec9a0)' }

/**
 * One short chip label naming what the edit asked for.
 * @param manifest - the exported facts.
 * @param t - the plugin's translator.
 * @returns the label.
 */
function chipLabel(manifest: EditManifest, t: Translator): string {
  const parts: string[] = []
  if (manifest.markers.length > 0) parts.push(`${manifest.markers.length} ${t('brief.markers')}`)
  if (manifest.erase.strokes > 0) parts.push(`${manifest.erase.strokes} ${t('brief.strokes')}`)
  if (manifest.bgRemove.requested) parts.push(t('brief.bg'))
  if (manifest.size.changed) parts.push(`${manifest.size.width}×${manifest.size.height}`)
  const detail = parts.length > 0 ? parts.join(' · ') : t('brief.plain')
  return `${t('brief.title')} · ${detail}`
}

/** Composer dock entry. */
export function EditorDock({ sessionId, useInput, inputActions, editor, t }: EditorDockProps) {
  const attachmentIds = useInput(state => state.attachmentIds)
  const draft = useInput(state => state.draft)
  const draftRev = useInput(state => state.draftRev)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const idKey = attachmentIds.join(',')
  const images = useMemo(
    () => editor.resolveImages(sessionId, attachmentIds),
    // The id list is the input; its string form is the stable dependency.
    [editor, sessionId, idKey],
  )
  const target = images.find(image => image.id === targetId) ?? null

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => { setNotice(null) }, 6000)
    return () => { clearTimeout(timer) }
  }, [notice])

  const apply = useCallback((result: EditorApplyResult) => {
    const files = [...result.files, manifestFile(result.manifest)]
    const legend = [...result.legend, t('brief.manifest')]
    const staged = editor.stageFiles(sessionId, files)
    if (staged.length !== files.length) {
      editor.releaseDrafts(staged)
      setNotice(t('dock.fail'))
      return
    }
    if (!inputActions.addAttachments(staged)) {
      editor.releaseDrafts(staged)
      setNotice(t('dock.fail'))
      return
    }
    if (target !== null) inputActions.removeAttachment(target.id)
    const inserted = editor.insertBrief(sessionId, {
      label: chipLabel(result.manifest, t),
      payload: buildBrief(result.manifest, { legend, carrier: 'chip' }),
      clipboardText: BRIEF_HEADER,
      draftRev,
    })
    if (!inserted) {
      inputActions.setDraft(mergeDraft(draft, buildBrief(result.manifest, { legend, carrier: 'draft' })))
    }
    setTargetId(null)
    setNotice(t('dock.done'))
  }, [draft, draftRev, editor, inputActions, sessionId, t, target])

  if (images.length === 0) return null

  return (
    <>
      <div style={stripStyle}>
        <span style={{ fontWeight: 600 }}>{t('dock.title')}</span>
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            style={chipStyle}
            title={image.file.name}
            onClick={() => { setTargetId(image.id) }}
          >
            <img
              src={image.previewUrl}
              alt={image.file.name}
              style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 4, display: 'block' }}
            />
            {`${t('dock.edit')} ${index + 1}`}
          </button>
        ))}
        <span style={hintStyle}>{t('dock.hint')}</span>
        {notice !== null && <span style={noticeStyle}>{notice}</span>}
      </div>
      {target !== null && (
        <EditorModal
          source={target}
          t={t}
          onCancel={() => { setTargetId(null) }}
          onApply={apply}
        />
      )}
    </>
  )
}
