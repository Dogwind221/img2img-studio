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
  /** Monotonic editor revision; a reference insertion is refused against a stale one. */
  readonly draftRev: number
  readonly phase: string
}

/** Composer input actions handed to every session-scope slot component. */
export interface ComposerInputActions {
  setDraft(text: string): void
  addAttachments(ids: readonly string[]): boolean
  removeAttachment(id: string): void
}

/** One inline reference the composer renders as a chip. */
export interface ReferenceInsertFace {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance?: 'session' | 'file' | 'folder'
  readonly clipboardText: string
}

/** Detect-coordinate span an insertion replaces, guarded by the draft revision. */
export interface TokenSpanFace {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/** Per-session input facade (only the verb this plugin calls). */
export interface SessionInputFace {
  /** Replace one span with a single reference chip; false when the span no longer matches. */
  insertReference(reference: ReferenceInsertFace, span: TokenSpanFace): boolean
}

/** Session-addressed access to the per-session input facade. */
export interface SessionInputResolverFace {
  for(actx: unknown): SessionInputFace
}

/** Reference codec owned by one trigger source. */
export interface ReferenceCodecFace {
  /** Clipboard / persistence projection of one reference. */
  clipboardText(ref: string): string
  /** Model serialization of one reference; a rejection blocks the send. */
  serialize(ref: string, signal: AbortSignal): Promise<string>
}

/**
 * One trigger source. This plugin registers a single source that contributes
 * no menu rows: it exists to own the brief chip's codec.
 */
export interface TriggerSourceFace {
  readonly trigger: '@' | '/'
  readonly name: string
  readonly order?: number
  readonly showGroupTitle?: boolean
  candidates(session: unknown, request: unknown): Promise<readonly unknown[]>
  onPick(pick: unknown): undefined
  readonly codec: ReferenceCodecFace
}

/** The `inputTriggers` service face. */
export interface InputTriggersFace {
  /** Register one source; a duplicate trigger/name pair throws. @returns the removing disposer. */
  registerSource(source: TriggerSourceFace): () => void
}

/** Session registry reach reached for the scope context an insertion needs. */
export interface SessionsFace {
  /** @param id - session id. @returns that session's scope context, or undefined when it is not live. */
  scope(id: string): unknown | undefined
}

/** Draft-attachment registry reached through the `conversation` service. */
export interface ConversationFace {
  resolveDraftAttachments(ids: readonly string[]): readonly { kind: string; id: string }[]
  createDrafts(sessionId: string, files: readonly File[]): readonly { kind: string; id: string }[]
  releaseDraftAttachment(id: string): void
  /** Per-session input registry; absent on a client build that moved it. */
  readonly input?: SessionInputResolverFace
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
  /** Run `body` once every named service exists; the body's ctx is the injected scope. */
  inject(services: readonly string[], body: (scope: EditorClientContext) => void): void
}

/** Translator bound to this plugin's locale namespace. */
export type Translator = (key: string) => string
