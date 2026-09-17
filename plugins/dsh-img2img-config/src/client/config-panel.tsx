/**
 * dsh-img2img-config client — Settings → 「识图与生图」 panel:
 * 多 API 供应商管理：三级优先级（主/备/兜底）、手动开关、拖拽排序
 * （拖把手/跨组自动改级/↑↓按钮）、模型链完整展示 + 常用模型快捷选择、
 * 余额探测（欠费自动关停）、ChatGPT 网页账号库与额度窗口。
 *
 * 本文件是同一个 client bundle 里的第二个 UI 面，由 `./index.tsx` 一并 apply；
 * 它不单独作为 __ModuleLoader__ 入口，所以不导出 name / inject。
 */

import { createElement as h, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'

/** Locale namespace owned by the settings panel. */
const NS = 'dsh-img2img-config'

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): (key: string) => string
}
interface ClientContext {
  effect(callback: () => unknown, label?: string): void
  slots: SlotsService
  locale: LocaleService
}

/** Context shape the settings panel needs; the client entry passes its own. */
export type ConfigPanelContext = ClientContext

type ProviderKind = 'vision' | 'gen'
type ProviderStatus = 'ok' | 'arrears' | 'error' | 'unknown' | 'cli'
interface ProviderItem {
  id: string
  name: string
  kind: ProviderKind
  level: 1 | 2 | 3
  enabled: boolean
  apiKey: string
  model: string
  base: string
  status: ProviderStatus
  lastChecked: number | null
}

const LEVEL_META: Record<number, { title: string; color: string; desc: string }> = {
  1: { title: '一级 · 主通道', color: '#3a9b5a', desc: '优先使用，模型链依次降级' },
  2: { title: '二级 · 备用', color: '#d08a2e', desc: '主通道失败后自动切换' },
  3: { title: '三级 · 兜底', color: '#8a6bd0', desc: '最后兜底，欠费自动关停' },
}
const STATUS_META: Record<ProviderStatus, { dot: string; label: string }> = {
  ok: { dot: '#3a9b5a', label: '正常' },
  arrears: { dot: '#d05050', label: '欠费/额度耗尽（已自动关停）' },
  error: { dot: '#d08a2e', label: '探测失败' },
  unknown: { dot: '#888', label: '未探测' },
  cli: { dot: '#4f8fd0', label: 'CLI 无需探测' },
}

/** 常用模型快捷选择（点击追加到模型链末尾） */
const COMMON_MODELS: Record<ProviderKind, string[]> = {
  vision: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.7-flash', 'qwen3.6-plus', 'qwen-vl-max', 'qwen-vl-plus', 'glm-4v-plus', 'Qwen3.8-Max', 'gpt-4o'],
  gen: ['qwen-image-3.0-pro', 'qwen-image-3.0', 'wan2.7-image-pro', 'gpt-image-2', 'glm-image', 'doubao-seedream-5-0-260128', 'image-01', 'Qwen3.8-Max'],
}

const TEMPLATES: Array<Omit<ProviderItem, 'status' | 'lastChecked'>> = [
  { id: 'dashscope', name: 'DashScope 通义千问（识图/生图）', kind: 'vision', level: 1, enabled: true, apiKey: '', model: 'qwen3.8-max,qwen3.7-plus,qwen3.7-flash,qwen3.6-plus,qwen-vl-max,qwen-vl-plus', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'qoder-cli', name: 'Qoder CLI（识图/生图，无需 key）', kind: 'vision', level: 2, enabled: true, apiKey: '', model: 'Qwen3.8-Max', base: 'qoderclicn' },
  { id: 'openai', name: 'OpenAI 兼容中转', kind: 'vision', level: 3, enabled: false, apiKey: '', model: 'gpt-4o', base: '' },
  { id: 'zai', name: 'Z.AI GLM（识图）', kind: 'vision', level: 3, enabled: false, apiKey: '', model: 'glm-4v-plus', base: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'seedream', name: 'Seedream 豆包（生图）', kind: 'gen', level: 2, enabled: false, apiKey: '', model: 'doubao-seedream-5-0-260128', base: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'minimax', name: 'MiniMax 海螺（生图）', kind: 'gen', level: 3, enabled: false, apiKey: '', model: 'image-01', base: 'https://api.minimaxi.com/v1' },
  { id: 'qoder-gen', name: 'Qoder CLI ImageGen（生图）', kind: 'gen', level: 2, enabled: true, apiKey: '', model: 'Qwen3.8-Max', base: 'qoderclicn' },
]

const styles: Record<string, CSSProperties> = {
  card: { background: 'var(--surface-1, #1e1e1e)', border: '1px solid var(--border, #333)', borderRadius: 8, padding: 16, marginBottom: 16 },
  title: { fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text-1, #eee)' },
  sub: { fontSize: 11, color: 'var(--text-3, #777)', marginBottom: 12 },
  group: { border: '1px solid var(--border, #333)', borderRadius: 8, marginBottom: 10, overflow: 'hidden' },
  groupHead: { padding: '6px 12px', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  row: { padding: '8px 12px', borderTop: '1px solid var(--border, #2a2a2a)', background: 'var(--surface-2, #181818)' },
  rowTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' as const },
  rowFields: { display: 'flex', gap: 10, marginTop: 8, alignItems: 'flex-start', flexWrap: 'wrap' as const },
  rowDragOver: { outline: '1px dashed var(--accent, #4f6ef7)', outlineOffset: -1 },
  handle: { color: '#666', fontSize: 14, cursor: 'grab', flexShrink: 0, userSelect: 'none' as const, padding: '0 2px' },
  toggle: { width: 34, height: 18, borderRadius: 9, border: 'none', cursor: 'pointer', position: 'relative' as const, flexShrink: 0 },
  toggleOn: { background: '#3a9b5a' },
  toggleOff: { background: '#444' },
  knob: { position: 'absolute' as const, top: 2, width: 14, height: 14, borderRadius: 7, background: '#fff' },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  name: { fontSize: 12, fontWeight: 600, color: 'var(--text-1, #eee)', minWidth: 130, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  field: { display: 'flex', flexDirection: 'column' as const, flex: 1, minWidth: 70 },
  fieldLabel: { fontSize: 10, color: 'var(--text-3, #888)', marginBottom: 2 },
  input: { padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border, #444)', background: 'var(--surface-3, #141414)', color: 'var(--text-1, #eee)', fontSize: 12, width: '100%', boxSizing: 'border-box' as const },
  textarea: { padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border, #444)', background: 'var(--surface-3, #141414)', color: 'var(--text-1, #eee)', fontSize: 12, width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const, minHeight: 44, lineHeight: 1.5, fontFamily: 'inherit' },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 4, marginTop: 4 },
  chip: { padding: '1px 7px', borderRadius: 9, border: '1px solid var(--border, #444)', background: 'var(--surface-3, #141414)', color: 'var(--text-2, #aaa)', fontSize: 10, cursor: 'pointer' },
  chipInput: { padding: '2px 8px', borderRadius: 10, border: '1px dashed var(--border, #555)', background: 'var(--surface-3, #141414)', color: 'var(--text-1, #eee)', fontSize: 11, width: 150, boxSizing: 'border-box' as const, outline: 'none' },
  select: { padding: '4px 6px', borderRadius: 5, border: '1px solid var(--border, #444)', background: 'var(--surface-3, #141414)', color: 'var(--text-1, #eee)', fontSize: 12 },
  arrow: { border: 'none', background: 'transparent', color: 'var(--text-2, #999)', cursor: 'pointer', fontSize: 12, padding: '0 3px', flexShrink: 0 },
  del: { border: 'none', background: 'transparent', color: '#d05050', cursor: 'pointer', fontSize: 14, flexShrink: 0 },
  addBtn: { padding: '5px 12px', borderRadius: 6, border: '1px dashed var(--border, #555)', background: 'transparent', color: 'var(--text-2, #aaa)', cursor: 'pointer', fontSize: 12, marginRight: 8 },
  save: { padding: '7px 18px', borderRadius: 6, border: 'none', background: 'var(--accent, #4f6ef7)', color: '#fff', cursor: 'pointer', fontSize: 13 },
  probe: { padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--surface-2, #333)', color: 'var(--text-1, #eee)', cursor: 'pointer', fontSize: 13, marginRight: 8 },
  msg: { fontSize: 12, marginLeft: 10, color: 'var(--text-2, #aaa)' },
  hint: { fontSize: 11, color: 'var(--text-3, #777)', marginTop: 8 },
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return h('button', {
    style: { ...styles.toggle, ...(on ? styles.toggleOn : styles.toggleOff) },
    title: on ? '点击关闭（停用该通道）' : '点击开启',
    onClick: () => onChange(!on),
  }, h('span', { style: { ...styles.knob, left: on ? 18 : 2 } }))
}

/** 模型链模块化编辑：已录入模型显示为 chips（× 删除），输入框回车添加，常用模型快捷追加 */
function ModelChips({ value, kind, onChange }: { value: string; kind: ProviderKind; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState('')
  const list = value.split(',').map((s) => s.trim()).filter(Boolean)
  const commit = (next: string[]) => onChange(next.join(','))
  const addDraft = () => {
    const m = draft.trim()
    if (m && !list.includes(m)) commit([...list, m])
    setDraft('')
  }
  const chipStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px 2px 9px', borderRadius: 10, border: '1px solid var(--border, #444)', background: 'var(--surface-3, #141414)', color: 'var(--text-1, #ddd)', fontSize: 11 }
  return h('div', { style: styles.field },
    h('span', { style: styles.fieldLabel }, `模型链（${list.length} 个，点击 × 删除，输入后回车添加）`),
    h('div', { style: { ...styles.chips, alignItems: 'center' } },
      list.map((m) => h('span', { key: m, style: chipStyle },
        m,
        h('button', { style: { border: 'none', background: 'transparent', color: '#d05050', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }, title: `删除 ${m}`, onClick: () => commit(list.filter((x) => x !== m)) }, '×'),
      )),
      h('input', {
        style: { ...styles.chipInput, ...(draft ? { borderColor: 'var(--accent, #4f6ef7)' } : {}) },
        value: draft,
        placeholder: '+ 输入模型名，回车添加',
        onChange: (e) => setDraft(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft() } },
        onBlur: addDraft,
      }),
    ),
    h('div', { style: styles.chips },
      COMMON_MODELS[kind].map((m) => h('span', {
        key: m,
        style: { ...styles.chip, ...(list.includes(m) ? { opacity: 0.4, cursor: 'default' } : {}) },
        title: list.includes(m) ? '已在链中' : '点击追加到模型链',
        onClick: () => { if (!list.includes(m)) commit([...list, m]) },
      }, `+ ${m}`)),
    ),
  )
}

function Row({ p, onPatch, onDelete, onMove, onDragStart, onDragOver, onDragEnd, onDrop, isDragOver }: {
  p: ProviderItem
  onPatch: (patch: Partial<ProviderItem>) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onDragStart: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDragEnd: () => void
  onDrop: (e: DragEvent) => void
  isDragOver: boolean
}) {
  const st = STATUS_META[p.status]
  return h('div', {
    style: { ...styles.row, ...(isDragOver ? styles.rowDragOver : {}) },
    draggable: true,
    title: '整行可拖动：同级内排序；拖到其他等级组自动改级',
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
  },
    // 控制条：把手 + 开关 + 状态 + 名称 + 等级 + 上移/下移 + 删除（与名称同行，不挤压字段）
    h('div', { style: styles.rowTop },
      h('span', { style: styles.handle, title: '拖动把手' }, '⋮⋮'),
      h(Toggle, { on: p.enabled, onChange: (v) => onPatch({ enabled: v }) }),
      h('span', { style: styles.dot, background: st.dot, title: st.label }),
      h('span', { style: styles.name, title: p.name }, p.name),
      h('select', {
        style: styles.select,
        value: String(p.level),
        title: '优先级等级（1主/2备/3兜底）',
        onChange: (e: { target: { value: string } }) => onPatch({ level: Number(e.target.value) as 1 | 2 | 3 }),
      }, [1, 2, 3].map((lv) => h('option', { key: lv, value: String(lv) }, `${lv} 级`))),
      h('button', { style: styles.arrow, title: '上移一位（可跨级）', onClick: () => onMove(-1) }, '▲'),
      h('button', { style: styles.arrow, title: '下移一位（可跨级）', onClick: () => onMove(1) }, '▼'),
      h('button', { style: styles.del, title: '删除该通道', onClick: onDelete }, '✕'),
    ),
    // 字段区：Key / 模型链 / Base URL
    h('div', { style: styles.rowFields },
      h('div', { style: { ...styles.field, flex: 1, minWidth: 140 } },
        h('span', { style: styles.fieldLabel }, 'Key'),
        h('input', {
          style: styles.input,
          type: 'password',
          value: p.apiKey,
          placeholder: p.apiKey ? '' : '未配置',
          onChange: (e) => onPatch({ apiKey: e.target.value }),
        }),
      ),
      h('div', { style: { ...styles.field, flex: 2, minWidth: 220 } },
        h(ModelChips, { value: p.model, kind: p.kind, onChange: (v) => onPatch({ model: v }) }),
      ),
      h('div', { style: { ...styles.field, flex: 1, minWidth: 140 } },
        h('span', { style: styles.fieldLabel }, 'Base URL'),
        h('input', { style: styles.input, value: p.base, placeholder: 'qoderclicn = Qoder CLI', onChange: (e) => onPatch({ base: e.target.value }) }),
      ),
    ),
  )
}

function Group({ level, items, patch, remove, move, drag, dragOverId }: {
  level: 1 | 2 | 3
  items: ProviderItem[]
  patch: (id: string, patch: Partial<ProviderItem>) => void
  remove: (id: string) => void
  move: (id: string, dir: -1 | 1) => void
  drag: { start: (e: DragEvent, id: string) => void; over: (e: DragEvent) => void; overGroup: (level: 1 | 2 | 3) => void; drop: (e: DragEvent, id: string) => void; dropToGroup: (e: DragEvent, level: 1 | 2 | 3) => void; end: () => void }
  dragOverId: string | null
}) {
  const meta = LEVEL_META[level]
  return h('div', {
    style: { ...styles.group, ...(dragOverId === `group-${level}` ? styles.rowDragOver : {}) },
    onDragOver: (e) => { drag.over(e); drag.overGroup(level) },
    onDrop: (e) => drag.dropToGroup(e, level),
  },
    h('div', { style: { ...styles.groupHead, background: meta.color + '22', color: meta.color } },
      h('span', {}, meta.title),
      h('span', { style: { fontWeight: 400, fontSize: 11 } }, meta.desc),
    ),
    items.length === 0
      ? h('div', { style: { padding: '10px 12px', fontSize: 12, color: '#666' } }, '（空，可把其他等级的行拖到这里自动改级，或点下方添加）')
      : items.map((p) => h(Row, {
          key: p.id,
          p,
          onPatch: (patchPart) => patch(p.id, patchPart),
          onDelete: () => remove(p.id),
          onMove: (dir) => move(p.id, dir),
          onDragStart: (e) => drag.start(e, p.id),
          onDragOver: (e) => drag.over(e),
          onDragEnd: drag.end,
          onDrop: (e) => drag.drop(e, p.id),
          isDragOver: dragOverId === p.id,
        })),
  )
}

function ConfigPanel() {
  const [providers, setProviders] = useState<ProviderItem[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [msg, setMsg] = useState('')
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)

  const load = () => {
    void (async () => {
      try {
        const d = (await (await fetch('/dsh-img2img-config/providers')).json()) as { providers: ProviderItem[] }
        setProviders(d.providers)
      } catch { setMsg('加载配置失败') }
    })()
  }
  useEffect(() => { load() }, [])

  const patch = (id: string, part: Partial<ProviderItem>) =>
    setProviders((list) => (list ? list.map((p) => (p.id === id ? { ...p, ...part } : p)) : list))

  const remove = (id: string) => setProviders((list) => (list ? list.filter((p) => p.id !== id) : list))

  /** 同组内上移/下移 */
  const move = (id: string, dir: -1 | 1) =>
    setProviders((list) => {
      if (!list) return list
      const idx = list.findIndex((p) => p.id === id)
      if (idx < 0) return list
      const item = list[idx]
      const target = idx + dir
      if (target < 0 || target >= list.length) return list
      const next = [...list]
      const neighbor = next[target]
      next[idx] = neighbor
      next[target] = { ...item, level: neighbor.level as 1 | 2 | 3 } // 跨级时自动改级
      return next
    })

  const add = (kind: ProviderKind) => {
    setProviders((list) => {
      const base = list ?? []
      const tpl = TEMPLATES.find((t) => t.kind === kind && !base.some((p) => p.id === t.id))
      if (!tpl) { setMsg('该类模板已全部添加，可直接修改现有行或复制一行'); return base }
      return [...base, { ...tpl, id: tpl.id + '-' + Date.now().toString(36), status: 'unknown' as ProviderStatus, lastChecked: null }]
    })
  }

  const save = () => {
    if (!providers) return
    setSaving(true)
    setMsg('')
    void (async () => {
      try {
        const d = (await (await fetch('/dsh-img2img-config/providers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providers }),
        })).json()) as { ok?: boolean; error?: string; providers?: ProviderItem[] }
        if (d.ok && d.providers) setProviders(d.providers)
        setMsg(d.ok ? '已保存，并已同步到 skill 的 .env（新会话生效）' : '保存失败: ' + (d.error || ''))
      } catch { setMsg('保存失败') }
      setSaving(false)
    })()
  }

  const probe = (id?: string) => {
    if (!providers) return
    setProbing(true)
    setMsg('')
    void (async () => {
      try {
        const d = (await (await fetch('/dsh-img2img-config/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(id ? { id } : {}),
        })).json()) as { ok?: boolean; providers?: ProviderItem[]; error?: string }
        if (d.providers) setProviders(d.providers)
        const arrears = (d.providers ?? []).filter((p) => p.status === 'arrears')
        setMsg(d.ok
          ? (arrears.length ? `探测完成：${arrears.length} 个通道欠费/额度耗尽，已自动关停（可手动重新开启）` : '探测完成，全部正常')
          : '探测失败: ' + (d.error || ''))
      } catch { setMsg('探测失败') }
      setProbing(false)
    })()
  }

  /** 拖拽：整行可拖；drop 到行 = 插到该行位置（跨组自动改级）；drop 到组容器 = 改级并追加组尾 */
  const drag = {
    start: (e: DragEvent, id: string) => {
      dragId.current = id
      e.dataTransfer.setData('text/plain', id)
      e.dataTransfer.effectAllowed = 'move'
    },
    over: (e: DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    overGroup: (level: 1 | 2 | 3) => setDragOverId(`group-${level}`),
    drop: (e: DragEvent, targetId: string) => {
      e.preventDefault()
      setDragOverId(null)
      const from = dragId.current
      dragId.current = null
      if (!from || from === targetId) return
      setProviders((list) => {
        if (!list) return list
        const a = list.find((p) => p.id === from)
        const b = list.find((p) => p.id === targetId)
        if (!a || !b) return list
        const moved = { ...a, level: b.level as 1 | 2 | 3 } // 跨组自动改级
        const rest = list.filter((p) => p.id !== from)
        const ti = rest.findIndex((p) => p.id === targetId)
        const next = [...rest]
        next.splice(ti, 0, moved)
        return next
      })
    },
    dropToGroup: (e: DragEvent, level: 1 | 2 | 3) => {
      e.preventDefault()
      setDragOverId(null)
      const from = dragId.current
      dragId.current = null
      if (!from) return
      setProviders((list) => {
        if (!list) return list
        const a = list.find((p) => p.id === from)
        if (!a) return list
        const moved = { ...a, level }
        const rest = list.filter((p) => p.id !== from)
        const groupItems = rest.filter((p) => p.kind === moved.kind && p.level === level)
        const ti = groupItems.length ? rest.findIndex((p) => p.id === groupItems[groupItems.length - 1].id) + 1 : rest.findIndex((p) => p.kind === moved.kind && p.level > level)
        const next = [...rest]
        const insertAt = ti < 0 ? next.length : ti
        next.splice(insertAt, 0, moved)
        return next
      })
    },
    end: () => { dragId.current = null; setDragOverId(null) },
  }

  if (!providers) return h('div', { style: styles.msg }, '加载中…')

  const byLevel = (kind: ProviderKind, level: 1 | 2 | 3) => providers.filter((p) => p.kind === kind && p.level === level)
  const kindMeta: Array<{ kind: ProviderKind; title: string; desc: string; addLabel: string }> = [
    { kind: 'vision', title: '识图通道（dsh-vision-skill）', desc: '主→备→兜底依次尝试；拖把手或 ▲▼ 调整顺序，拖到其他等级组自动改级；欠费自动关停', addLabel: '+ 添加识图通道' },
    { kind: 'gen', title: '生图通道（img2img-studio）', desc: '同样支持开关/等级/排序；Qoder CLI 无需 key；保存后写入 GEN_PROVIDER_ORDER 决定 auto 链顺序', addLabel: '+ 添加生图通道' },
  ]

  return h('div', {},
    kindMeta.map((km) => h('div', { key: km.kind, style: styles.card },
      h('div', { style: styles.title }, km.title),
      h('div', { style: styles.sub }, km.desc),
      [1, 2, 3].map((lv) => h(Group, {
        key: lv,
        level: lv as 1 | 2 | 3,
        items: byLevel(km.kind, lv as 1 | 2 | 3),
        patch,
        remove,
        move,
        drag,
        dragOverId,
      })),
      h('button', { style: styles.addBtn, onClick: () => add(km.kind) }, km.addLabel),
    )),
    h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: 12 } },
      h('button', { style: styles.probe, disabled: probing, onClick: () => probe() }, probing ? '探测中…' : '🔍 探测全部余额（欠费自动关停）'),
      h('button', { style: styles.save, disabled: saving, onClick: save }, saving ? '保存中…' : '保存配置'),
      msg ? h('span', { style: styles.msg }, msg) : null,
    ),
    h(UsagePanel, null),
    h('div', { style: styles.hint },
      '提示：保存后自动同步 .env（VISION_PROVIDERS / 各 API key / GEN_PROVIDER_ORDER），新会话生效；' +
      '「一级」的首个通道为默认主通道（VISION_API_KEY）；探测用 GET /models 识别欠费错误码（Arrearage / quota exhausted / insufficient balance）。'),
  )
}

interface CodexUsage {
  planType?: string
  email?: string
  credits?: string
  primary?: { usedPercent: number; windowSeconds: number; resetAt: number }
  secondary?: { usedPercent: number; windowSeconds: number; resetAt: number }
}
interface AccountStatus {
  id: string
  label: string
  plan: ChatGptPlan
  planLabel: string
  planSource: 'auto' | 'manual'
  limit: number
  limitOverridden: boolean
  limitEnforced: boolean
  windowHours: number
  used: number
  remaining: number
  nextReset: number | null
  resetAt: string | null
  rule: string
  autoProbe: boolean
  hasToken: boolean
  codexAuth: boolean
  email: string | null
  detectedPlanType: string | null
  lastProbeAt: number | null
  lastProbeError: string | null
  scanned: number | null
  lastGeneratedAt: number | null
  generatedTimes: string[]
  codexUsage: CodexUsage | null
}
interface TierInfo { plan: ChatGptPlan; label: string; defaultLimit: number; note: string }
interface UsageState { accounts: AccountStatus[]; tiers: TierInfo[]; proxy: string; proxyEffective: string }

type ChatGptPlan = 'free' | 'plus' | '5x' | '20x'

async function usageRequest(action: Record<string, unknown>): Promise<UsageState | null> {
  try {
    const res = await fetch('/dsh-img2img-config/chatgpt-usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action),
    })
    return (await res.json()) as UsageState
  } catch {
    return null
  }
}

function fmtTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : ''
}

function AccountRow({ a, tiers, onPatch, onAction, onProbe, onAuth, onCodexAuth }: {
  a: AccountStatus
  tiers: TierInfo[]
  onPatch: (patch: Record<string, unknown>) => void
  onAction: (action: string) => void
  onProbe: () => void
  onAuth: (token: string) => void
  onCodexAuth: () => void
}) {
  const [label, setLabel] = useState(a.label)
  const [limit, setLimit] = useState(a.limitOverridden ? String(a.limit) : '')
  const [token, setToken] = useState('')
  const [probing, setProbing] = useState(false)
  useEffect(() => { setLabel(a.label) }, [a.label])
  useEffect(() => { setLimit(a.limitOverridden ? String(a.limit) : '') }, [a.limitOverridden, a.limit])
  useEffect(() => { setProbing(false) }, [a.lastProbeAt, a.lastProbeError])
  const exhausted = a.limitEnforced && a.used >= a.limit
  const commitLimit = () => {
    const next = limit.trim() === '' ? null : Number(limit)
    if (next !== null && (!Number.isFinite(next) || next <= 0)) { setLimit(a.limitOverridden ? String(a.limit) : ''); return }
    if ((next ?? null) !== (a.limitOverridden ? a.limit : null)) onPatch({ limit: next })
  }
  const probe = () => { setProbing(true); onProbe() }
  const saveToken = () => { setProbing(true); onAuth(token.trim()); setToken('') }
  const status = a.lastProbeError
    ? `❌ ${a.lastProbeError}`
    : a.lastProbeAt
      ? `✅ ${fmtTime(a.lastProbeAt)} 探测 · 档位 ${a.detectedPlanType ?? '?'} · 扫过 ${a.scanned ?? 0} 个会话` +
        (a.generatedTimes.length ? ` · 出图: ${a.generatedTimes.join(' / ')}` : ' · 窗口内无出图')
      : a.hasToken ? '凭据已保存，点「探测」拉取额度' : '未填凭据'
  const cu = a.codexUsage
  const hWin = (w: { usedPercent: number; windowSeconds: number; resetAt: number } | undefined): string => w
    ? `${w.usedPercent}%（${Math.round(w.windowSeconds / 3600)}h 窗口，重置 ${fmtTime(w.resetAt)}）`
    : ''
  return h('div', { style: { ...styles.row, borderTop: '1px solid var(--border, #2a2a2a)' } },
    h('div', { style: { ...styles.rowTop, flexWrap: 'wrap' as const } },
      h('input', {
        style: { ...styles.input, width: 150, flexShrink: 0 },
        value: label,
        title: '账号备注名（用于区分多个 ChatGPT 账号）',
        onChange: (e: { target: { value: string } }) => setLabel(e.target.value),
        onBlur: () => { if (label.trim() && label.trim() !== a.label) onPatch({ label: label.trim() }) },
      }),
      h('select', {
        style: { ...styles.select, flexShrink: 0 },
        value: a.plan,
        title: '账号套餐：免费 / Plus / 5x(Pro) / 20x(Business)',
        onChange: (e: { target: { value: string } }) => onPatch({ plan: e.target.value }),
      }, tiers.map((t) => h('option', { key: t.plan, value: t.plan }, t.label))),
      h('input', {
        style: { ...styles.input, width: 84, flexShrink: 0 },
        value: limit,
        placeholder: `额度 ${tiers.find((t) => t.plan === a.plan)?.defaultLimit ?? ''}`,
        title: '窗口额度上限（留空 = 跟随套餐默认值）',
        onChange: (e: { target: { value: string } }) => setLimit(e.target.value),
        onBlur: commitLimit,
      }),
      h('button', { style: styles.del, title: '删除该账号', onClick: () => onAction('remove') }, '×'),
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const } },
      h('div', { style: { fontSize: 12, color: exhausted ? 'var(--danger, #d05050)' : 'var(--text-2, #aaa)', whiteSpace: 'nowrap' as const } },
        a.limitEnforced
          ? `已用 ${a.used} / ${a.limit} 张（${a.windowHours}h 滚动${a.autoProbe ? '，自动' : ''}）` +
            (exhausted ? ' — ⚠️ 已用完，等待窗口刷新' : a.resetAt ? ` — 下次重置: ${a.resetAt}` : '')
          : `已用 ${a.used} 张（${a.windowHours}h 滚动，免费版不计额度；用尽自动切换下一通道）`),
      h('button', { style: { ...styles.probe, marginRight: 0 }, onClick: () => onAction('log') }, '登记 1 张'),
      h('button', { style: { ...styles.addBtn, marginRight: 0 }, onClick: () => onAction('reset') }, '重置'),
      h('button', {
        style: { ...styles.addBtn, marginRight: 0, ...(a.autoProbe ? { borderColor: 'var(--accent, #4f6ef7)', color: 'var(--text-1, #eee)' } : {}) },
        title: '自动探测：用 ChatGPT 后端接口统计窗口内出图，代替手动登记',
        onClick: () => onPatch({ autoProbe: !a.autoProbe }),
      }, a.autoProbe ? '自动探测：开' : '自动探测：关'),
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const } },
      h('input', {
        style: { ...styles.input, width: 260 },
        type: 'password',
        value: token,
        placeholder: a.hasToken && !a.codexAuth ? '凭据已保存（粘贴新 token 可替换）' : '粘贴 __Secure-next-auth.session-token',
        title: 'ChatGPT 网页登录态：DevTools → Application → Cookies → __Secure-next-auth.session-token',
        onChange: (e: { target: { value: string } }) => setToken(e.target.value),
      }),
      h('button', { style: { ...styles.probe, marginRight: 0 }, disabled: !token.trim(), onClick: saveToken }, '保存凭据'),
      h('button', {
        style: { ...styles.addBtn, marginRight: 0, ...(a.codexAuth ? { borderColor: 'var(--accent, #4f6ef7)', color: 'var(--text-1, #eee)' } : {}) },
        title: '直接读取运行中的 Codex 客户端登录态（~/.codex/auth.json），令牌由客户端自动刷新',
        onClick: onCodexAuth,
      }, a.codexAuth ? 'Codex 客户端登录态 ✓' : '读取 Codex 客户端登录态'),
      h('button', { style: { ...styles.save, padding: '6px 12px' }, disabled: probing || !a.hasToken, onClick: probe }, probing ? '探测中…' : '🔍 探测额度'),
      a.hasToken ? h('button', { style: { ...styles.addBtn, marginRight: 0 }, onClick: () => onAuth('') }, '清除凭据') : null,
    ),
    h('div', { style: { ...styles.hint, marginTop: 6 } }, status),
    cu && (cu.primary || cu.secondary)
      ? h('div', { style: { ...styles.hint, marginTop: 2 } },
        `Codex 用量（${cu.planType ?? a.detectedPlanType ?? '?'}${cu.email ? ' · ' + cu.email : ''}）` +
        (cu.primary ? ` · 主窗口 ${hWin(cu.primary)}` : '') +
        (cu.secondary ? ` · 周窗口 ${hWin(cu.secondary)}` : ''))
      : null,
    h('div', { style: { ...styles.hint, marginTop: 2 } },
      `${a.planLabel} · ${a.rule}` + (a.limitOverridden ? '（额度已手动覆盖）' : '') + (a.planSource === 'manual' ? '（档位手动锁定）' : '')),
  )
}

function UsagePanel() {
  const [u, setU] = useState<UsageState | null>(null)
  const [msg, setMsg] = useState('')
  const [proxy, setProxy] = useState('')
  useEffect(() => {
    void (async () => {
      try {
        const s = (await (await fetch('/dsh-img2img-config/chatgpt-usage')).json()) as UsageState
        setU(s); setProxy(s.proxy ?? '')
        // 打开面板时自动探测：开启了自动探测、有凭据、且距上次探测超过 5 分钟的账号
        const stale = s.accounts.filter((a) => a.autoProbe && a.hasToken && (!a.lastProbeAt || Date.now() - a.lastProbeAt > 5 * 60 * 1000))
        for (const a of stale) {
          const next = await usageRequest({ action: 'probe', id: a.id })
          if (next?.accounts) setU(next)
        }
        if (stale.length) setMsg('已自动探测 ' + stale.length + ' 个账号')
      } catch { setU(null) }
    })()
  }, [])
  const apply = (next: UsageState | null, ok: string) => {
    if (!next || !Array.isArray(next.accounts)) { setMsg('操作失败'); return }
    setU(next)
    if (typeof next.proxy === 'string') setProxy(next.proxy)
    setMsg(ok)
  }
  const patch = (id: string, body: Record<string, unknown>) => {
    void (async () => apply(await usageRequest({ action: 'update', id, ...body }), '已保存'))()
  }
  const action = (id: string, act: string) => {
    void (async () => {
      const labels: Record<string, string> = { log: '已登记 1 张', reset: '已重置窗口', remove: '已删除账号' }
      apply(await usageRequest({ action: act, id }), labels[act] ?? '完成')
    })()
  }
  const probe = (id: string) => {
    void (async () => apply(await usageRequest({ action: 'probe', id }), '探测完成'))()
  }
  const auth = (id: string, sessionToken: string) => {
    void (async () => apply(await usageRequest({ action: 'auth', id, sessionToken }), sessionToken ? '凭据已保存' : '凭据已清除'))()
  }
  const codexAuth = (id: string) => {
    void (async () => apply(await usageRequest({ action: 'authCodex', id }), '已读取 Codex 客户端登录态'))()
  }
  const add = () => {
    void (async () => apply(await usageRequest({ action: 'add', label: `ChatGPT 账号 ${(u?.accounts.length ?? 0) + 1}`, plan: 'free' }), '已添加账号'))()
  }
  const addCodex = () => {
    void (async () => {
      const added = await usageRequest({ action: 'add', label: 'Codex 客户端账号', plan: 'free' })
      if (!added?.accounts) { apply(added, '操作失败'); return }
      const created = added.accounts[added.accounts.length - 1]!
      apply(await usageRequest({ action: 'authCodex', id: created.id }), '已从 Codex 客户端添加账号')
    })()
  }
  const saveProxy = () => {
    void (async () => apply(await usageRequest({ action: 'settings', proxy }), '代理已保存'))()
  }
  if (!u) return null
  const tiers = u.tiers ?? []
  return h('div', { style: styles.card },
    h('div', { style: styles.title }, 'ChatGPT 网页出图账号（多账号额度）'),
    h('div', { style: styles.sub },
      '每个账号标注套餐档位（免费 / Plus / 5x / 20x）；填凭据后可自动探测档位与窗口内出图，也可手动「登记 1 张」。'),
    h('div', { style: styles.group },
      u.accounts.map((a) => h(AccountRow, {
        key: a.id,
        a,
        tiers,
        onPatch: (body) => patch(a.id, body),
        onAction: (act) => action(a.id, act),
        onProbe: () => probe(a.id),
        onAuth: (token) => auth(a.id, token),
        onCodexAuth: () => codexAuth(a.id),
      })),
    ),
    h('button', { style: styles.addBtn, onClick: add }, '＋ 添加 ChatGPT 账号'),
    h('button', { style: styles.addBtn, onClick: addCodex }, '＋ 从 Codex 客户端添加账号'),
    msg ? h('span', { style: styles.msg }, msg) : null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' as const } },
      h('input', {
        style: { ...styles.input, width: 220 },
        value: proxy,
        placeholder: u.proxyEffective ? `自动：${u.proxyEffective}` : '留空 = 自动读系统代理',
        title: 'ChatGPT 探测用代理（Node 不读系统代理，留空则自动读取 Windows 系统代理）',
        onChange: (e: { target: { value: string } }) => setProxy(e.target.value),
      }),
      h('button', { style: { ...styles.addBtn, marginRight: 0 }, onClick: saveProxy }, '保存代理'),
      h('span', { style: styles.hint }, u.proxyEffective ? `当前生效：${u.proxyEffective}` : '当前直连（若探测报 fetch 失败，请填代理）'),
    ),
    h('div', { style: styles.hint },
      '套餐默认额度：' + tiers.map((t) => `${t.label} ${t.defaultLimit}`).join(' / ') +
      '（24h 滚动窗口，可在每行直接改数字；自动探测按 ChatGPT 后端返回的实际出图时刻统计）'),
  )
}

/**
 * Register the Settings → 「识图与生图」 section.
 * @param ctx - client root context (the same one the editor dock receives).
 */
export function registerConfigPanel(ctx: ClientContext): void {
  ctx.effect(() => {
    ctx.locale.register(NS, { zh: { nav: '识图与生图' }, en: { nav: 'Vision & Image' } })
    const t = ctx.locale.bind(NS)
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'img2img-config',
      order: 60,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(ConfigPanel)))
  }, 'dsh-img2img-config: settings section')
}
