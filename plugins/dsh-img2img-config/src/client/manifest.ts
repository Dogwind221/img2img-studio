/**
 * The hand-off record: what the user changed in the editor, carried to the
 * model without printing JSON into the composer.
 *
 * One set of facts, two carriers, chosen by {@link BriefParts.carrier}:
 * - `buildBrief` produces the readable brief. `chip` is the payload of the one
 *   reference chip the composer shows — it keeps the `JSON:` line, so the model
 *   text stays comparable with the block earlier versions printed. `draft` is
 *   the fallback written into the composer when the chip cannot be inserted: it
 *   drops that line, because by then the attached manifest file carries the same
 *   fields, and closes with {@link BRIEF_END} so a re-edit replaces the block.
 * - `manifestFile` produces the same facts as JSON, staged as a draft
 *   attachment beside the exported PNGs.
 */
import type { MarkerItem, SizeMode } from './raster.ts'

/** Opening delimiter written by plugin versions that printed the block into the draft. */
export const LEGACY_BLOCK_BEGIN = '<!-- img2img-editor:begin -->'
/** Closing delimiter of that legacy block. */
export const LEGACY_BLOCK_END = '<!-- img2img-editor:end -->'
/** Leading token of every brief; the marker `mergeDraft` replaces in place. */
export const BRIEF_MARK = '[img2img]'
/** Closing token of a draft-carried brief, so a re-edit removes the whole block. */
export const BRIEF_END = '[/img2img]'
/** First line of every brief: the header, and the whole clipboard projection of a chip. */
export const BRIEF_HEADER = `${BRIEF_MARK} 图片编辑请求 · img2img-studio`
/** Reference-source name owning the brief chip (unique within its trigger). */
export const SOURCE_NAME = 'img2img-brief'
/** Draft-attachment filename carrying the machine-readable manifest. */
export const MANIFEST_FILENAME = 'img2img-manifest.json'

/** Exported filenames of one editor session. */
export interface ExportedFiles {
  /** Edited base image (resize and cutout applied, no pins). */
  edited: string
  /** Same image with numbered pins, present only when markers exist. */
  marked?: string
  /** Binary brush mask (white = region to redraw), present only when strokes exist. */
  mask?: string
}

/** Machine-readable description of one editing session. */
export interface EditManifest {
  version: 1
  createdAt: string
  source: { name: string; width: number; height: number }
  size: { width: number; height: number; mode: SizeMode; changed: boolean }
  bgRemove: { requested: boolean; localPreview: boolean; tolerance: number }
  erase: { strokes: number; prompt: string }
  markers: Array<{ id: number; x: number; y: number; text: string }>
  files: ExportedFiles
}

/** How one brief is assembled. */
export interface BriefParts {
  /** One legend line per staged attachment, in staging order. */
  readonly legend: readonly string[]
  /**
   * Which carrier receives the brief. `chip` is the reference chip's payload:
   * it carries the `JSON:` line, because that text is the model's only copy of
   * the exact fields besides the attached file, and it needs no closing token.
   * `draft` is the fallback line written into the composer: the attached
   * manifest file already carries the JSON, and the block must be removable in
   * one piece, so it closes with {@link BRIEF_END} instead.
   */
  readonly carrier: 'chip' | 'draft'
}

/** Percent label of one normalized coordinate, one decimal. */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Compose the brief the model reads.
 * @param manifest - the exported facts.
 * @param parts - attachment legend and the carrier the brief is built for.
 * @returns the brief text, whose first line is {@link BRIEF_HEADER}.
 */
export function buildBrief(manifest: EditManifest, parts: BriefParts): string {
  const lines: string[] = [BRIEF_HEADER]
  parts.legend.forEach((label, index) => { lines.push(`附件${index + 1} ${label}`) })
  if (manifest.markers.length > 0) {
    lines.push('标记修改点（坐标为归一化百分比，原点左上角）：')
    for (const marker of manifest.markers) {
      const text = marker.text.trim() === '' ? '(未填写改法)' : marker.text.trim()
      lines.push(`  ${marker.id}. (x ${percent(marker.x)}, y ${percent(marker.y)}) ${text}`)
    }
  }
  const actions: string[] = []
  if (manifest.bgRemove.requested) {
    actions.push(manifest.bgRemove.localPreview
      ? '移除背景（已给本地纯色背景预览，建议云端抠图重做得到透明 PNG）'
      : '移除背景（云端抠图，输出透明 PNG）')
  }
  if (manifest.erase.strokes > 0) {
    actions.push(`涂抹擦除/局部重绘 ${manifest.erase.strokes} 笔：${manifest.erase.prompt}`)
  }
  if (manifest.size.changed) {
    actions.push(`调整大小到 ${manifest.size.width}×${manifest.size.height}（${modeLabel(manifest.size.mode)}）`)
  }
  lines.push(`请求动作：${actions.length > 0 ? actions.join('；') : '仅按标记做局部修改'}`)
  lines.push('给生图供应商：按标记与掩码做局部重绘，再做整体 i2i；标记与掩码只用于定位，不要出现在成图里。')
  lines.push(parts.carrier === 'chip' ? `JSON: ${JSON.stringify(manifest)}` : BRIEF_END)
  return lines.join('\n')
}

/**
 * Wrap the manifest as the draft attachment the model reads verbatim.
 * @param manifest - the exported facts.
 * @returns the JSON file to stage alongside the exported images.
 */
export function manifestFile(manifest: EditManifest): File {
  return new File([JSON.stringify(manifest, null, 2)], MANIFEST_FILENAME, { type: 'application/json' })
}

/** Chinese label of one size mode. */
export function modeLabel(mode: SizeMode): string {
  if (mode === 'cover') return '裁切填满'
  if (mode === 'contain') return '完整放入'
  return '拉伸变形'
}

/**
 * Replace whatever hand-off text a previous edit left, keeping the user's own
 * text intact. Three leftovers are removed in place: the legacy comment block an
 * older plugin version printed, a previous draft brief between its markers, and
 * — defensively, for a brief whose closing token went missing — its header line
 * alone.
 * @param draft - current composer draft.
 * @param brief - freshly generated draft-carried brief.
 * @returns the next draft text.
 */
export function mergeDraft(draft: string, brief: string): string {
  let text = stripLegacyBlock(draft)
  const start = text.indexOf(BRIEF_MARK)
  if (start >= 0) {
    const close = text.indexOf(BRIEF_END, start)
    if (close >= 0) {
      text = `${text.slice(0, start)}${text.slice(close + BRIEF_END.length)}`
    } else {
      const end = text.indexOf('\n', start)
      text = end < 0 ? text.slice(0, start) : `${text.slice(0, start)}${text.slice(end + 1)}`
    }
  }
  const trimmed = text.replace(/\n{3,}/gu, '\n\n').trim()
  return trimmed === '' ? brief : `${trimmed}\n\n${brief}`
}

/** Remove the legacy `<!-- img2img-editor:begin --> … end` block, if a draft still holds one. */
function stripLegacyBlock(draft: string): string {
  const start = draft.indexOf(LEGACY_BLOCK_BEGIN)
  if (start < 0) return draft
  const end = draft.indexOf(LEGACY_BLOCK_END)
  if (end <= start) return draft
  return `${draft.slice(0, start)}${draft.slice(end + LEGACY_BLOCK_END.length)}`
}

/** Marker list sorted by id, the order the pins were placed. */
export function normalizeMarkers(markers: readonly MarkerItem[]): MarkerItem[] {
  return [...markers].sort((a, b) => a.id - b.id)
}
