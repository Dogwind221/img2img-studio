/**
 * The full-screen image editor: numbered change markers, a brush mask, a local
 * cutout preview, and deterministic resize/crop.
 *
 * All editing state is component-local (one editor session, one component), so
 * nothing here needs a store seat. The modal only produces files and a manifest;
 * staging them into the composer belongs to the dock entry.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { DraftImage, Translator } from './faces.ts'
import {
  canvasToBlob, composeEdited, context2d, drawBase, fitWithin, paintMarkers, renderMask,
  type CutoutSpec, type MarkerItem, type SizeMode, type SizeSpec, type Stroke,
} from './raster.ts'
import type { EditManifest } from './manifest.ts'

/** What the modal hands back to the dock once the user confirms. */
export interface EditorApplyResult {
  /** Files staged into the composer, in attachment order. */
  readonly files: File[]
  /** One legend line per file, in the same order. */
  readonly legend: string[]
  /** Machine-readable facts of this session. */
  readonly manifest: EditManifest
}

/** Props of the editor modal. */
export interface EditorModalProps {
  readonly source: DraftImage
  readonly t: Translator
  onCancel(): void
  onApply(result: EditorApplyResult): void
}

/** Canvas box the preview is fitted into. */
const VIEW_MAX_WIDTH = 720
const VIEW_MAX_HEIGHT = 540

/** Ratio presets offered by the size panel. */
const RATIO_PRESETS: Array<{ key: string; label: string; ratio: number | null }> = [
  { key: 'original', label: '原图', ratio: null },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '3:4', label: '3:4', ratio: 3 / 4 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
  { key: '9:16', label: '9:16', ratio: 9 / 16 },
]

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const panelStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 10, width: 300, minWidth: 300,
  maxHeight: '78vh', overflowY: 'auto', paddingRight: 4,
}
const sectionStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2, #3a3a40)', borderRadius: 10,
  padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
  background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.02))',
}
const sectionTitleStyle: CSSProperties = {
  fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #e8e8ea)',
}
const hintStyle: CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary, #9a9aa2)',
}
const buttonStyle: CSSProperties = {
  padding: '6px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
  border: '1px solid var(--dsw-alias-border-l2, #3a3a40)',
  background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04))',
  color: 'var(--dsw-alias-label-primary, #e8e8ea)',
}
const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--dsw-alias-button-primary-fill, #4d6bfe)',
  borderColor: 'transparent', color: 'var(--dsw-alias-label-primary-foreground, #ffffff)', fontWeight: 600,
}
const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'var(--dsw-alias-button-ghost-active-fill, rgba(77,107,254,0.18))',
  borderColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
}
const inputStyle: CSSProperties = {
  padding: '5px 8px', borderRadius: 8, fontSize: 12, width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--dsw-alias-border-l2, #3a3a40)',
  background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.2))',
  color: 'var(--dsw-alias-label-primary, #e8e8ea)',
}

/** The editor modal itself. */
export function EditorModal({ source, t, onCancel, onApply }: EditorModalProps) {
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const drag = useRef<{ kind: 'marker'; id: number } | { kind: 'stroke' } | null>(null)
  const nextId = useRef(1)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [natural, setNatural] = useState({ width: 1, height: 1 })
  const [size, setSize] = useState<SizeSpec>({ width: 1, height: 1, mode: 'cover' })
  const [draftSize, setDraftSize] = useState({ width: '1', height: '1' })
  const [cutout, setCutout] = useState<CutoutSpec>({ enabled: false, tolerance: 36 })
  const [markers, setMarkers] = useState<MarkerItem[]>([])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [tool, setTool] = useState<'marker' | 'erase'>('marker')
  const [brush, setBrush] = useState(0.05)
  const [eraseMode, setEraseMode] = useState<'paint' | 'restore'>('paint')
  const [erasePrompt, setErasePrompt] = useState('抹掉涂抹区域的内容，用周围背景自然填补')
  const [activeId, setActiveId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const element = new Image()
    element.onload = () => {
      setImage(element)
      setNatural({ width: element.naturalWidth, height: element.naturalHeight })
      setSize({ width: element.naturalWidth, height: element.naturalHeight, mode: 'cover' })
      setDraftSize({ width: String(element.naturalWidth), height: String(element.naturalHeight) })
    }
    element.onerror = () => { setError(t('editor.loadFail')) }
    element.src = source.previewUrl
    return () => { element.onload = null }
  }, [source.previewUrl, t])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onCancel])

  const base = useMemo(
    () => (image === null ? null : drawBase(image, size, cutout)),
    [image, size.width, size.height, size.mode, cutout.enabled, cutout.tolerance],
  )
  const display = base === null ? null : fitWithin(base.width, base.height, VIEW_MAX_WIDTH, VIEW_MAX_HEIGHT)

  useEffect(() => {
    const target = previewRef.current
    if (base === null || target === null) return
    const ctx = context2d(target)
    ctx.clearRect(0, 0, target.width, target.height)
    ctx.drawImage(base, 0, 0, target.width, target.height)
    if (strokes.length > 0) ctx.drawImage(renderMask(strokes, target.width, target.height, 'overlay'), 0, 0)
    paintMarkers(ctx, markers, target.width, target.height, activeId ?? undefined)
  }, [base, markers, strokes, activeId])

  const pointerAt = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height)),
    }
  }, [])

  const hitMarker = useCallback((
    point: { x: number; y: number },
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): MarkerItem | undefined => {
    const rect = event.currentTarget.getBoundingClientRect()
    return markers.find((marker) => {
      const dx = (marker.x - point.x) * rect.width
      const dy = (marker.y - point.y) * rect.height
      return Math.hypot(dx, dy) <= 18
    })
  }, [markers])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointerAt(event)
    if (tool === 'marker') {
      const hit = hitMarker(point, event)
      if (hit !== undefined) {
        setActiveId(hit.id)
        drag.current = { kind: 'marker', id: hit.id }
        return
      }
      const id = nextId.current
      nextId.current += 1
      setMarkers(previous => [...previous, { id, x: point.x, y: point.y, text: '' }])
      setActiveId(id)
      drag.current = { kind: 'marker', id }
      return
    }
    setStrokes(previous => [...previous, { mode: eraseMode, radius: brush, points: [[point.x, point.y]] }])
    drag.current = { kind: 'stroke' }
  }, [brush, busy, eraseMode, hitMarker, pointerAt, tool])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const current = drag.current
    if (current === null) return
    const point = pointerAt(event)
    if (current.kind === 'marker') {
      setMarkers(previous => previous.map(marker => (
        marker.id === current.id ? { ...marker, x: point.x, y: point.y } : marker
      )))
      return
    }
    setStrokes((previous) => {
      const last = previous[previous.length - 1]
      if (last === undefined) return previous
      const tail = last.points[last.points.length - 1]
      if (tail !== undefined && Math.hypot(tail[0] - point.x, tail[1] - point.y) < 0.002) return previous
      last.points.push([point.x, point.y])
      return [...previous]
    })
  }, [pointerAt])

  const endDrag = useCallback(() => { drag.current = null }, [])

  const commitDimension = useCallback((key: 'width' | 'height', raw: string) => {
    setDraftSize(previous => ({ ...previous, [key]: raw }))
    const value = Number.parseInt(raw, 10)
    if (!Number.isFinite(value)) return
    const clamped = Math.min(4096, Math.max(64, value))
    setSize(previous => ({ ...previous, [key]: clamped }))
  }, [])

  const applyRatio = useCallback((ratio: number | null) => {
    if (ratio === null) {
      setSize(previous => ({ ...previous, width: natural.width, height: natural.height }))
      setDraftSize({ width: String(natural.width), height: String(natural.height) })
      return
    }
    const long = Math.max(natural.width, natural.height, 512)
    const width = ratio >= 1 ? long : Math.round(long * ratio)
    const height = ratio >= 1 ? Math.round(long / ratio) : long
    setSize(previous => ({ ...previous, width, height }))
    setDraftSize({ width: String(width), height: String(height) })
  }, [natural.height, natural.width])

  const confirm = useCallback(async () => {
    if (base === null) return
    setBusy(true)
    setError(null)
    try {
      const stamp = Date.now().toString(36)
      const ordered = [...markers].sort((a, b) => a.id - b.id)
      const files: File[] = []
      const legend: string[] = []
      const editedName = `edited-${stamp}.png`
      const markedName = ordered.length > 0 ? `marked-${stamp}.png` : undefined
      const maskName = strokes.length > 0 ? `mask-${stamp}.png` : undefined
      if (markedName !== undefined) {
        const markedBlob = await canvasToBlob(composeEdited(base, ordered))
        files.push(new File([markedBlob], markedName, { type: 'image/png' }))
        legend.push(`${markedName}：带编号标记的位置图（标记只用于指示位置，不要画进成图）`)
      }
      const editedBlob = await canvasToBlob(base)
      files.push(new File([editedBlob], editedName, { type: 'image/png' }))
      legend.push(`${editedName}：编辑后的底图（${base.width}×${base.height}，出图用这张作基底）`)
      if (maskName !== undefined) {
        const maskBlob = await canvasToBlob(renderMask(strokes, base.width, base.height, 'binary'))
        files.push(new File([maskBlob], maskName, { type: 'image/png' }))
        legend.push(`${maskName}：涂抹掩码（白色 = 要处理/重绘的区域，黑色 = 保留）`)
      }
      const manifest: EditManifest = {
        version: 1,
        createdAt: new Date().toISOString(),
        source: { name: source.file.name, width: natural.width, height: natural.height },
        size: {
          width: base.width,
          height: base.height,
          mode: size.mode,
          changed: base.width !== natural.width || base.height !== natural.height,
        },
        bgRemove: { requested: cutout.enabled, localPreview: cutout.enabled, tolerance: cutout.tolerance },
        erase: { strokes: strokes.length, prompt: erasePrompt.trim() },
        markers: ordered.map(marker => ({ id: marker.id, x: marker.x, y: marker.y, text: marker.text })),
        files: {
          edited: editedName,
          ...(markedName === undefined ? {} : { marked: markedName }),
          ...(maskName === undefined ? {} : { mask: maskName }),
        },
      }
      onApply({ files, legend, manifest })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [base, cutout, erasePrompt, markers, natural.height, natural.width, onApply, size.mode, source.file.name, strokes])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.62))',
    }}>
      <div style={{
        width: 'min(1120px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 12,
        padding: 16, borderRadius: 14, boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-layer-2, #1c1c20)',
        border: '1px solid var(--dsw-alias-border-l2, #3a3a40)',
        color: 'var(--dsw-alias-label-primary, #e8e8ea)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong style={{ fontSize: 14 }}>{t('editor.title')}</strong>
          <span style={hintStyle}>{source.file.name}</span>
          <span style={{ flex: 1 }} />
          <button type="button" style={buttonStyle} onClick={onCancel} disabled={busy}>{t('editor.cancel')}</button>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={() => { void confirm() }}
            disabled={busy || base === null}
          >
            {busy ? t('editor.busy') : t('editor.apply')}
          </button>
        </div>
        {error !== null && (
          <div style={{ color: 'var(--dsw-alias-state-error-primary, #ff6b6b)', fontSize: 12 }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', overflow: 'hidden' }}>
          <div style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, transparent 0% 50%) 50% / 18px 18px',
            borderRadius: 10, minHeight: 300, padding: 8,
          }}>
            {base === null || display === null
              ? <span style={hintStyle}>{t('editor.loading')}</span>
              : (
                <canvas
                  ref={previewRef}
                  width={base.width}
                  height={base.height}
                  style={{
                    width: display.width, height: 'auto', maxWidth: '100%', maxHeight: '68vh',
                    touchAction: 'none',
                    cursor: tool === 'erase' ? 'crosshair' : 'copy', userSelect: 'none',
                    outline: '1px solid var(--dsw-alias-border-l2, #3a3a40)', borderRadius: 6,
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              )}
          </div>
          <div style={panelStyle}>
            <div style={sectionStyle}>
              <span style={sectionTitleStyle}>{t('editor.toolTitle')}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={tool === 'marker' ? activeButtonStyle : buttonStyle}
                  onClick={() => { setTool('marker') }}
                >{t('editor.toolMarker')}</button>
                <button
                  type="button"
                  style={tool === 'erase' ? activeButtonStyle : buttonStyle}
                  onClick={() => { setTool('erase') }}
                >{t('editor.toolErase')}</button>
              </div>
              <span style={hintStyle}>{tool === 'marker' ? t('editor.markerHint') : t('editor.eraseHint')}</span>
            </div>

            <div style={sectionStyle}>
              <span style={sectionTitleStyle}>{`${t('editor.markerTitle')} (${markers.length})`}</span>
              {markers.length === 0 && <span style={hintStyle}>{t('editor.markerEmpty')}</span>}
              {[...markers].sort((a, b) => a.id - b.id).map(marker => (
                <div key={marker.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: '50%', background: '#ff3b30', color: '#fff',
                      fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
                    }}>{marker.id}</span>
                    <span style={hintStyle}>{`${(marker.x * 100).toFixed(0)}%, ${(marker.y * 100).toFixed(0)}%`}</span>
                    <span style={{ flex: 1 }} />
                    <button
                      type="button"
                      style={{ ...buttonStyle, padding: '2px 6px' }}
                      onClick={() => {
                        setMarkers(previous => previous.filter(item => item.id !== marker.id))
                        if (activeId === marker.id) setActiveId(null)
                      }}
                    >✕</button>
                  </div>
                  <textarea
                    value={marker.text}
                    placeholder={t('editor.markerPlaceholder')}
                    onChange={(event) => {
                      const value = event.target.value
                      setMarkers(previous => previous.map(item => (item.id === marker.id ? { ...item, text: value } : item)))
                    }}
                    onFocus={() => { setActiveId(marker.id) }}
                    rows={2}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>
              ))}
            </div>

            <div style={sectionStyle}>
              <span style={sectionTitleStyle}>{`${t('editor.eraseTitle')} (${strokes.length})`}</span>
              <label style={{ ...hintStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                {t('editor.brush')}
                <input
                  type="range" min={0.01} max={0.16} step={0.005} value={brush}
                  onChange={(event) => { setBrush(Number(event.target.value)) }}
                  style={{ flex: 1 }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={eraseMode === 'paint' ? activeButtonStyle : buttonStyle}
                  onClick={() => { setEraseMode('paint') }}
                >{t('editor.erasePaint')}</button>
                <button
                  type="button"
                  style={eraseMode === 'restore' ? activeButtonStyle : buttonStyle}
                  onClick={() => { setEraseMode('restore') }}
                >{t('editor.eraseRestore')}</button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => { setStrokes(previous => previous.slice(0, -1)) }}
                  disabled={strokes.length === 0}
                >{t('editor.eraseUndo')}</button>
                <button
                  type="button"
                  style={buttonStyle}
                  onClick={() => { setStrokes([]) }}
                  disabled={strokes.length === 0}
                >{t('editor.eraseClear')}</button>
              </div>
              <textarea
                value={erasePrompt}
                onChange={(event) => { setErasePrompt(event.target.value) }}
                rows={2}
                placeholder={t('editor.erasePromptPlaceholder')}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </div>

            <div style={sectionStyle}>
              <span style={sectionTitleStyle}>{t('editor.bgTitle')}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={cutout.enabled ? activeButtonStyle : buttonStyle}
                  onClick={() => { setCutout(previous => ({ ...previous, enabled: !previous.enabled })) }}
                >{cutout.enabled ? t('editor.bgOff') : t('editor.bgOn')}</button>
              </div>
              {cutout.enabled && (
                <label style={{ ...hintStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('editor.bgTolerance')}
                  <input
                    type="range" min={8} max={90} step={2} value={cutout.tolerance}
                    onChange={(event) => { setCutout(previous => ({ ...previous, tolerance: Number(event.target.value) })) }}
                    style={{ flex: 1 }}
                  />
                  <span>{cutout.tolerance}</span>
                </label>
              )}
              <span style={hintStyle}>{t('editor.bgHint')}</span>
            </div>

            <div style={sectionStyle}>
              <span style={sectionTitleStyle}>{t('editor.sizeTitle')}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {RATIO_PRESETS.map(preset => (
                  <button key={preset.key} type="button" style={buttonStyle} onClick={() => { applyRatio(preset.ratio) }}>
                    {preset.label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input style={inputStyle} value={draftSize.width} onChange={(event) => { commitDimension('width', event.target.value) }} />
                <span style={hintStyle}>×</span>
                <input style={inputStyle} value={draftSize.height} onChange={(event) => { commitDimension('height', event.target.value) }} />
              </div>
              <select
                value={size.mode}
                onChange={(event) => { setSize(previous => ({ ...previous, mode: event.target.value as SizeMode })) }}
                style={inputStyle}
              >
                <option value="cover">{t('editor.sizeCover')}</option>
                <option value="contain">{t('editor.sizeContain')}</option>
                <option value="stretch">{t('editor.sizeStretch')}</option>
              </select>
              <span style={hintStyle}>{t('editor.sizeHint')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
