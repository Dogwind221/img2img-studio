/**
 * Raster operations behind the editor: deterministic resize/crop, a local
 * flat-background cutout preview, the brush mask, and the numbered marker pins.
 *
 * Everything runs on plain 2D canvases in the browser tab. The cloud channels
 * (DashScope `description_edit_with_mask`, OpenAI `images/edits`) are reached
 * later by the skill scripts from the exported files, so this module never
 * performs a network call.
 */

/** How a target size is reached from the source bitmap. */
export type SizeMode = 'cover' | 'contain' | 'stretch'

/** Target size plus the fitting rule. */
export interface SizeSpec {
  readonly width: number
  readonly height: number
  readonly mode: SizeMode
}

/** One numbered marker: normalized position plus the requested change. */
export interface MarkerItem {
  readonly id: number
  x: number
  y: number
  text: string
}

/**
 * One brush stroke. Points and radius are normalized (0..1) so the same stroke
 * list replays identically after a resize.
 */
export interface Stroke {
  readonly mode: 'paint' | 'restore'
  radius: number
  points: Array<[number, number]>
}

/** Local cutout configuration. */
export interface CutoutSpec {
  readonly enabled: boolean
  readonly tolerance: number
}

/** Largest bitmap the local cutout scans; beyond this the preview is skipped. */
export const CUTOUT_PIXEL_LIMIT = 6_000_000

/** Pin colour, matching the marker list accent. */
const PIN_FILL = 'rgba(255, 59, 48, 0.92)'
/** Translucent stroke colour used by the on-canvas mask overlay. */
const MASK_OVERLAY = 'rgba(255, 90, 60, 0.55)'

/** Create an offscreen canvas of the given pixel size. */
export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/** 2D context of a canvas, failing loud when the browser refuses one. */
export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('img2img-editor: 2D canvas context unavailable')
  return ctx
}

/** Draw an image element into a fresh canvas at its natural size. */
export function sourceCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = createCanvas(image.naturalWidth, image.naturalHeight)
  context2d(canvas).drawImage(image, 0, 0)
  return canvas
}

/**
 * Local flat-background cutout: flood the border inward while pixels stay within
 * `tolerance` of the border reference colour, then zero their alpha and soften
 * the seam by one pixel.
 *
 * The reference colour is the median of border samples, so a subject that
 * touches the frame edge keeps its pixels unless they match the background.
 * Complex or gradient backgrounds need the cloud channel; the editor says so
 * instead of pretending otherwise.
 */
export function applyCutout(source: HTMLCanvasElement, tolerance: number): HTMLCanvasElement {
  const width = source.width
  const height = source.height
  const out = createCanvas(width, height)
  const ctx = context2d(out)
  ctx.drawImage(source, 0, 0)
  const total = width * height
  if (total > CUTOUT_PIXEL_LIMIT) return out
  const frame = ctx.getImageData(0, 0, width, height)
  const pixels = frame.data
  const reference = borderReference(pixels, width, height)
  const removed = new Uint8Array(total)
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const tolerance2 = tolerance * tolerance
  const push = (index: number): void => {
    if (removed[index] === 1) return
    removed[index] = 1
    queue[tail] = index
    tail += 1
  }
  for (let x = 0; x < width; x += 1) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width)
    push(y * width + width - 1)
  }
  while (head < tail) {
    const index = queue[head]
    head += 1
    const x = index % width
    const y = (index - x) / width
    const neighbours = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ]
    for (const neighbour of neighbours) {
      if (neighbour < 0 || removed[neighbour] === 1) continue
      const offset = neighbour * 4
      const dr = pixels[offset] - reference[0]
      const dg = pixels[offset + 1] - reference[1]
      const db = pixels[offset + 2] - reference[2]
      if (dr * dr + dg * dg + db * db <= tolerance2) push(neighbour)
    }
  }
  const alpha = new Uint8Array(total)
  for (let index = 0; index < total; index += 1) alpha[index] = removed[index] === 1 ? 0 : 255
  for (let index = 0; index < total; index += 1) {
    if (removed[index] === 1) continue
    const x = index % width
    const y = (index - x) / width
    const touching = (x > 0 && removed[index - 1] === 1)
      || (x < width - 1 && removed[index + 1] === 1)
      || (y > 0 && removed[index - width] === 1)
      || (y < height - 1 && removed[index + width] === 1)
    if (touching) alpha[index] = 150
  }
  for (let index = 0; index < total; index += 1) pixels[index * 4 + 3] = alpha[index]
  ctx.putImageData(frame, 0, 0)
  return out
}

/** Median border colour of an RGBA buffer, sampled every few pixels. */
function borderReference(pixels: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  const stride = Math.max(1, Math.round(Math.min(width, height) / 128))
  const sample = (x: number, y: number): void => {
    const offset = (y * width + x) * 4
    reds.push(pixels[offset])
    greens.push(pixels[offset + 1])
    blues.push(pixels[offset + 2])
  }
  for (let x = 0; x < width; x += stride) {
    sample(x, 0)
    sample(x, height - 1)
  }
  for (let y = 0; y < height; y += stride) {
    sample(0, y)
    sample(width - 1, y)
  }
  const median = (values: number[]): number => {
    values.sort((a, b) => a - b)
    return values[Math.floor(values.length / 2)] ?? 0
  }
  return [median(reds), median(greens), median(blues)]
}

/**
 * Produce the edited base bitmap: optional local cutout first (at source
 * resolution, where the flood fill has the most detail), then the resize rule.
 */
export function drawBase(image: HTMLImageElement, size: SizeSpec, cutout: CutoutSpec): HTMLCanvasElement {
  const source = sourceCanvas(image)
  const staged = cutout.enabled ? applyCutout(source, cutout.tolerance) : source
  const out = createCanvas(size.width, size.height)
  const ctx = context2d(out)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const sw = staged.width
  const sh = staged.height
  if (size.mode === 'stretch') {
    ctx.drawImage(staged, 0, 0, size.width, size.height)
    return out
  }
  const scale = size.mode === 'cover'
    ? Math.max(size.width / sw, size.height / sh)
    : Math.min(size.width / sw, size.height / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(staged, (size.width - dw) / 2, (size.height - dh) / 2, dw, dh)
  return out
}

/**
 * Replay the brush strokes into a canvas.
 *
 * `overlay` is the translucent on-canvas guide; `binary` is the exported mask
 * the providers need (white = the region to redraw, black = keep), which is the
 * `wanx2.1-imageedit` mask convention.
 */
export function renderMask(
  strokes: readonly Stroke[],
  width: number,
  height: number,
  style: 'overlay' | 'binary',
): HTMLCanvasElement {
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  if (style === 'binary') {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  for (const stroke of strokes) {
    const paint = style === 'binary'
      ? (stroke.mode === 'paint' ? '#ffffff' : '#000000')
      : MASK_OVERLAY
    ctx.save()
    if (style === 'overlay' && stroke.mode === 'restore') ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = paint
    ctx.fillStyle = paint
    ctx.lineWidth = Math.max(1, stroke.radius * Math.min(canvas.width, canvas.height) * 2)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const points = stroke.points
    const first = points[0]
    if (first !== undefined && points.length === 1) {
      ctx.beginPath()
      ctx.arc(first[0] * canvas.width, first[1] * canvas.height, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    } else if (first !== undefined) {
      ctx.beginPath()
      ctx.moveTo(first[0] * canvas.width, first[1] * canvas.height)
      for (let index = 1; index < points.length; index += 1) {
        const point = points[index]
        ctx.lineTo(point[0] * canvas.width, point[1] * canvas.height)
      }
      ctx.stroke()
    }
    ctx.restore()
  }
  return canvas
}

/** Draw the numbered pins that tell the model where each change belongs. */
export function paintMarkers(
  ctx: CanvasRenderingContext2D,
  markers: readonly MarkerItem[],
  width: number,
  height: number,
  activeId?: number,
): void {
  const radius = Math.max(11, Math.min(width, height) * 0.026)
  for (const marker of markers) {
    const cx = marker.x * width
    const cy = marker.y * height
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, marker.id === activeId ? radius * 1.18 : radius, 0, Math.PI * 2)
    ctx.fillStyle = PIN_FILL
    ctx.fill()
    ctx.lineWidth = Math.max(2, radius * 0.2)
    ctx.strokeStyle = marker.id === activeId ? '#ffd60a' : 'rgba(255, 255, 255, 0.95)'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = `600 ${Math.round(radius * 1.1)}px system-ui, -apple-system, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(marker.id), cx, cy + 1)
    ctx.restore()
  }
}

/** The exported edited bitmap: base pixels plus the marker pins. */
export function composeEdited(base: HTMLCanvasElement, markers: readonly MarkerItem[]): HTMLCanvasElement {
  const canvas = createCanvas(base.width, base.height)
  const ctx = context2d(canvas)
  ctx.drawImage(base, 0, 0)
  paintMarkers(ctx, markers, canvas.width, canvas.height)
  return canvas
}

/** PNG blob of a canvas, for composer attachments and downloads. */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('img2img-editor: canvas encode failed'))
      else resolve(blob)
    }, 'image/png')
  })
}

/** Largest size fitting `width`×`height` inside a box, preserving the ratio. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
