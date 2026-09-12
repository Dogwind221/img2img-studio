/**
 * The hand-off record: what the user changed in the editor, written into the
 * composer draft next to the exported images.
 *
 * The prose block is for the user to read and edit; the trailing JSON line is
 * what the skill scripts parse. Both describe the same facts, so the model never
 * has to guess a coordinate or a size.
 */
import type { MarkerItem, SizeMode } from './raster.ts'

/** Delimiters of the generated draft block, so a re-edit replaces instead of stacking. */
export const BLOCK_BEGIN = '<!-- img2img-editor:begin -->'
/** Closing delimiter of the generated draft block. */
export const BLOCK_END = '<!-- img2img-editor:end -->'

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

/** Percent label of one normalized coordinate, one decimal. */
function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/**
 * Compose the draft text for one editing session.
 * @param manifest - the exported facts.
 * @param attachments - attachment lines in the order they are staged.
 * @returns the block the composer draft receives.
 */
export function buildDraftText(manifest: EditManifest, attachments: readonly string[]): string {
  const lines: string[] = [BLOCK_BEGIN, '【图片编辑请求 · img2img-studio】']
  attachments.forEach((label, index) => { lines.push(`附件${index + 1} ${label}`) })
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
  lines.push(`JSON: ${JSON.stringify(manifest)}`)
  lines.push(BLOCK_END)
  return lines.join('\n')
}

/** Chinese label of one size mode. */
export function modeLabel(mode: SizeMode): string {
  if (mode === 'cover') return '裁切填满'
  if (mode === 'contain') return '完整放入'
  return '拉伸变形'
}

/**
 * Replace a previous editor block or append the new one, keeping the user's own
 * text intact either way.
 * @param draft - current composer draft.
 * @param block - freshly generated block.
 * @returns the next draft text.
 */
export function mergeDraft(draft: string, block: string): string {
  const start = draft.indexOf(BLOCK_BEGIN)
  const end = draft.indexOf(BLOCK_END)
  if (start >= 0 && end > start) {
    const tail = draft.slice(end + BLOCK_END.length).replace(/^\n+/, '')
    const head = draft.slice(0, start).replace(/\n+$/, '')
    return [head, block, tail].filter(part => part !== '').join('\n\n')
  }
  const trimmed = draft.trim()
  return trimmed === '' ? block : `${trimmed}\n\n${block}`
}

/** Marker list sorted by id, the order the pins were placed. */
export function normalizeMarkers(markers: readonly MarkerItem[]): MarkerItem[] {
  return [...markers].sort((a, b) => a.id - b.id)
}
