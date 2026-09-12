/**
 * Structural faces of the DSH client services this plugin consumes.
 *
 * The plugin is built outside the harness checkout, so it restates the slices
 * it actually calls instead of importing the harness type graph (the same
 * approach dsh-better-sidebar uses). Everything here is read lazily through
 * `ctx.get(...)` at call time, so a missing method degrades into a visible
 * message instead of a crash.
 */
import type { ComponentType } from 'react'

/** Browser-owned image draft staged in the composer. */
export interface DraftImage {
  readonly kind: 'image'
  readonly id: string
  readonly file: File
  readonly previewUrl: string
  readonly width?: number
  readonly height?: number
}

/** Composer input state slice the dock reads. */
export interface ComposerInputState {
  readonly draft: string
  readonly attachmentIds: readonly string[]
  readonly phase: string
}

/** Composer input actions handed to every session-scope slot component. */
export interface ComposerInputActions {
  setDraft(text: string): void
  addAttachments(ids: readonly string[]): boolean
  removeAttachment(id: string): void
}

/** Draft-attachment registry reached through the `conversation` service. */
export interface ConversationFace {
  resolveDraftAttachments(ids: readonly string[]): readonly { kind: string; id: string }[]
  createDrafts(sessionId: string, files: readonly File[]): readonly { kind: string; id: string }[]
  releaseDraftAttachment(id: string): void
}

/** Locale service face: namespace dictionaries plus a bound translator. */
export interface LocaleFace {
  register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string) => string
}

/** Slot registry face (`ctx.slots`). */
export interface SlotsFace {
  inject(name: string, install: () => unknown): () => void
  register(options: Record<string, unknown>, component: ComponentType<never>): () => void
}

/** Client plugin context slice this plugin's `apply` uses. */
export interface EditorClientContext {
  readonly slots: SlotsFace
  readonly locale: LocaleFace
  get(name: string): unknown
  effect(body: () => unknown, label?: string): void
}

/** Translator bound to this plugin's locale namespace. */
export type Translator = (key: string) => string
