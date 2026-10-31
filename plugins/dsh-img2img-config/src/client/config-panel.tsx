/**
 * dsh-img2img-config client — Settings → 「识图与生图」 panel.
 *
 * 多 API 供应商管理：三级优先级（主/备/兜底）、手动开关、拖拽排序。
 *
 * UI 结构（2026-10 重构）：
 *  - 「厂商卡片」：每个通道一张可折叠卡片，收起时只显示厂商名、模型链摘要、
 *    掩码 Key（未配置则不显示任何 Key 痕迹）与等级，展开后才显示模型 chips、
 *    Key / Base URL 编辑区，长面板不再被输入框撑开；
 *  - 「模型链」按厂商归属展示：卡片内是该厂商对应的模型链（可加/删/排序），
 *    收起摘要里直接看到 `厂商 → 模型 → 模型`；
 *  - 三级分组、ChatGPT 账号逐条也都可折叠；折叠状态写 localStorage，
 *    跨设置页开关、跨刷新保留；
 *  - Key 在卡片头部以掩码形式展示（例如 `sk-b••••0f4f`），没有配置就什么都不显示；
 *  - 顶部工具条常驻（sticky）：通道统计、探测全部余额、保存配置、未保存提示。
 *
 * 本文件是同一个 client bundle 里的第二个 UI 面，由 `./index.tsx` 一并 apply；
 * 它不单独作为 __ModuleLoader__ 入口，所以不导出 name / inject。
 */

import { createElement as h, useEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { setTranslator, tr } from './i18n.ts'
import { en as panelEn, zh as panelZh } from './panel-locales.ts'
import {
  CATALOG,
  DIRECT_SUB_PROVIDERS,
  HOST_PROTOCOL_VERSION,
  authFor,
  catalogEntry,
  catalogModels,
  channelIdFor,
  isAccountProvider,
  isManagedProvider,
  managedReason,
  planSync,
  providerIdOf,
  validateProviders,
  type CatalogEntry,
  type ProviderItem,
  type ProviderKind,
  type ProviderStatus,
  type SyncPlan,
} from '../catalog.ts'

/** Locale namespace owned by the settings panel. */
const NS = 'dsh-img2img-config'

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): (key: string, params?: Record<string, string | number>) => string
}
interface ClientContext {
  effect(callback: () => unknown, label?: string): void
  slots: SlotsService
  locale: LocaleService
}

/** Context shape the settings panel needs; the client entry passes its own. */
export type ConfigPanelContext = ClientContext

/** 通道类型 / 状态 / 行结构都来自双端共用的 ../catalog.ts，panel 只做展示。 */

const LEVEL_META: Record<number, { title: string; short: string; color: string; desc: string }> = {
  1: { title: '一级 · 主通道', short: '1 级', color: '#3a9b5a', desc: '优先使用，失败后依次降级' },
  2: { title: '二级 · 备用', short: '2 级', color: '#d08a2e', desc: '主通道失败后自动切换' },
  3: { title: '三级 · 兜底', short: '3 级', color: '#8a6bd0', desc: '最后兜底，欠费自动关停' },
}
const STATUS_META: Record<ProviderStatus, { dot: string; label: string }> = {
  ok: { dot: '#3a9b5a', label: '正常' },
  arrears: { dot: '#d05050', label: '欠费/额度耗尽（已自动关停）' },
  error: { dot: '#d08a2e', label: '探测失败' },
  unknown: { dot: '#888', label: '未探测' },
  cli: { dot: '#4f8fd0', label: 'CLI / 登录态通道，无需探测' },
}

const UI_STORE_KEY = 'dsh-img2img-config:ui-collapse:v1'

/* ================= 纯文本工具 ================= */

function splitModels(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

/** 与宿主同口径的掩码（前端只用于展示，不参与保存）。 */
function maskKey(value: string): string {
  if (!value) return ''
  if (value.includes('••••')) return value
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

function isMaskedKey(value: string): boolean {
  return value.includes('••••')
}

/** 供应商在色板里的键（账号通道统一按 chatgpt-web 上色）。 */
function vendorKey(p: ProviderItem): string {
  const providerId = providerIdOf(p)
  return providerId.startsWith('chatgpt-web@') ? 'chatgpt-web' : providerId
}

/** 托管通道：不用 API Key，也不做 HTTP 余额探测。 */
function isManagedChannel(p: ProviderItem): boolean {
  const providerId = providerIdOf(p)
  return isManagedProvider(providerId)
    || p.base === 'qoderclicn'
    || p.base === 'codex-cli'
    || p.base.startsWith('chatgpt-web:')
}

function channelManagedReason(p: ProviderItem): string {
  return tr(managedReason(providerIdOf(p)))
}

/** 直连引擎用子通道选择代替模型链。 */
function isDirectChannel(p: ProviderItem): boolean {
  return providerIdOf(p) === 'direct'
}

/** 生图 DashScope 的模型链由脚本内置，面板里的模型只作记录。 */
function isFixedModelChain(p: ProviderItem): boolean {
  return p.kind === 'gen' && providerIdOf(p) === 'dashscope'
}

function modelChainEditable(p: ProviderItem): boolean {
  const providerId = providerIdOf(p)
  if (isDirectChannel(p)) return false
  if (isAccountProvider(providerId)) return false
  if (isFixedModelChain(p)) return false
  // 本地生图服务只认 IMG_HTTP_URL，模型由服务端决定
  if (providerId === 'local') return false
  return true
}

function modelChainNote(p: ProviderItem): string {
  if (isDirectChannel(p)) return tr('直连引擎的模型由脚本 --model 传入，这里只需选子通道。')
  if (isFixedModelChain(p)) return tr('DashScope 生图模型链由脚本内置：qwen-image-3.0-pro → qwen-image-3.0 → wan2.7-image-pro；面板里的模型只作记录，不写入 .env。')
  return ''
}

const VENDOR_META: Record<string, { avatar: string; color: string }> = {
  deepseek: { avatar: 'D', color: '#4f8fd0' },
  dashscope: { avatar: 'Q', color: '#8a6bd0' },
  zai: { avatar: 'Z', color: '#3a9b5a' },
  openai: { avatar: 'O', color: '#3a9b5a' },
  seedream: { avatar: 'S', color: '#d08a2e' },
  minimax: { avatar: 'M', color: '#d05050' },
  'qoder-cli': { avatar: 'Q', color: '#d08a2e' },
  qoder: { avatar: 'Q', color: '#d08a2e' },
  'codex-cli': { avatar: 'C', color: '#4f8fd0' },
  direct: { avatar: '⚡', color: '#4f8fd0' },
  'chatgpt-web': { avatar: 'G', color: '#3a9b5a' },
}

function vendorColor(p: ProviderItem): string {
  return VENDOR_META[vendorKey(p)]?.color ?? '#777'
}
function vendorAvatar(p: ProviderItem): string {
  const known = VENDOR_META[vendorKey(p)]?.avatar
  if (known) return known
  const first = p.name.trim().slice(0, 1)
  return first ? first.toUpperCase() : '?'
}

function modelSuggestions(p: ProviderItem): string[] {
  return [...catalogModels(providerIdOf(p), p.kind)]
}

/** Base URL 一行摘要：托管通道显示人话，正常端点只留 host。 */
function hostOf(base: string): string {
  const value = base.trim()
  if (!value) return tr('未设置端点')
  if (value === 'qoderclicn') return 'Qoder CLI'
  if (value === 'codex-cli') return tr('Codex 客户端')
  if (value.startsWith('chatgpt-web:')) return tr('ChatGPT 网页账号')
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

function readUiStore(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(UI_STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean') out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

function writeUiStore(value: Record<string, boolean>): void {
  try {
    localStorage.setItem(UI_STORE_KEY, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 禁用存储时忽略：折叠状态只是锦上添花 */
  }
}

/* ================= 样式 ================= */

const styles: Record<string, CSSProperties> = {
  section: { background: 'var(--dsw-alias-settings-card-fill, #1e1e1e)', border: '1px solid var(--dsw-alias-border-l3, #333)', borderRadius: 10, marginBottom: 14, overflow: 'hidden' },
  sectionHead: { padding: '11px 14px', borderBottom: '1px solid var(--dsw-alias-border-l1, #2c2c2c)', display: 'flex', alignItems: 'flex-start', gap: 10 },
  sectionTitle: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #eee)', display: 'flex', alignItems: 'center', gap: 6 },
  sectionSub: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #777)', marginTop: 3, lineHeight: 1.5 },
  sectionBody: { padding: '10px 12px 12px' },
  sectionActions: { marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 },

  group: { border: '1px solid var(--dsw-alias-border-l3, #333)', borderRadius: 8, marginBottom: 8, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-1, #181818)' },
  groupHead: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', userSelect: 'none' },
  groupTitle: { fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 },
  groupCount: { fontSize: 10, padding: '0 6px', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1, #141414)', border: '1px solid var(--dsw-alias-border-l3, #333)', color: 'var(--dsw-alias-label-secondary, #aaa)', lineHeight: '16px' },
  groupDesc: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #777)', marginLeft: 'auto', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  groupEmpty: { padding: '8px 12px', fontSize: 11.5, color: '#666' },

  card: { border: '1px solid var(--dsw-alias-border-l3, #333)', borderRadius: 8, background: 'var(--dsw-alias-settings-card-fill, #1e1e1e)', margin: '6px 8px', overflow: 'hidden' },
  cardHead: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', cursor: 'pointer' },
  cardHeadDragOver: { outline: '1px dashed var(--dsw-alias-button-info-fill, #4f6ef7)', outlineOffset: -2 },
  cardBody: { padding: '2px 10px 10px', borderTop: '1px solid var(--dsw-alias-border-l1, #2a2a2a)' },
  handle: { color: '#666', fontSize: 13, cursor: 'grab', flexShrink: 0, userSelect: 'none' as const, letterSpacing: -1 },
  avatar: { width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff' },
  identity: { flex: 1, minWidth: 0 },
  nameRow: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  name: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #eee)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  summaryRow: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 1, minWidth: 0, fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #888)', whiteSpace: 'nowrap' as const },
  summaryChain: { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  sep: { color: '#444' },
  dot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0, display: 'inline-block' },
  statusTag: { fontSize: 10.5, padding: '0 5px', borderRadius: 7, lineHeight: '15px', flexShrink: 0 },
  keyChip: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', color: 'var(--dsw-alias-label-secondary, #b9b9b9)', background: 'var(--dsw-alias-bg-layer-1, #141414)', border: '1px solid var(--dsw-alias-border-l4, #3a3a3a)', borderRadius: 9, padding: '1px 7px', flexShrink: 0, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  levelSelect: { padding: '2px 4px', borderRadius: 5, border: '1px solid var(--dsw-alias-border-l4, #444)', background: 'var(--dsw-alias-bg-layer-1, #141414)', color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 11, flexShrink: 0 },
  chevron: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary, #888)', width: 14, textAlign: 'center' as const, flexShrink: 0, transition: 'transform .15s' },

  toggle: { width: 30, height: 17, borderRadius: 9, border: 'none', cursor: 'pointer', position: 'relative' as const, flexShrink: 0, padding: 0, background: '#444' },
  toggleOn: { background: '#3a9b5a' },
  toggleOff: { background: '#444' },
  knob: { position: 'absolute' as const, top: 2, width: 13, height: 13, borderRadius: 7, background: '#fff', transition: 'left .12s' },

  fieldLabel: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary, #888)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 },
  input: { padding: '4px 8px', borderRadius: 5, border: '1px solid var(--dsw-alias-border-l4, #444)', background: 'var(--dsw-alias-bg-layer-1, #141414)', color: 'var(--dsw-alias-label-primary, #eee)', fontSize: 12, width: '100%', boxSizing: 'border-box' as const },
  field: { display: 'flex', flexDirection: 'column' as const, flex: 1, minWidth: 0 },
  fieldsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginTop: 10 },

  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 4, alignItems: 'center' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px 2px 8px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l4, #444)', background: 'var(--dsw-alias-bg-layer-1, #141414)', color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 11.5, maxWidth: 260 },
  chipIndex: { fontSize: 9, color: 'var(--dsw-alias-label-tertiary, #777)', fontVariantNumeric: 'tabular-nums' as const },
  chipText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  chipX: { border: 'none', background: 'transparent', color: '#d05050', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1, flexShrink: 0 },
  chipInput: { padding: '2px 8px', borderRadius: 10, border: '1px dashed var(--dsw-alias-border-l4, #555)', background: 'var(--dsw-alias-bg-layer-1, #141414)', color: 'var(--dsw-alias-label-primary, #eee)', fontSize: 11.5, width: 150, boxSizing: 'border-box' as const, outline: 'none' },
  suggestRow: { display: 'flex', gap: 4, marginTop: 6, overflowX: 'auto' as const, paddingBottom: 1 },
  suggestChip: { padding: '1px 7px', borderRadius: 9, border: '1px dashed var(--dsw-alias-border-l4, #444)', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: 10.5, cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  suggestLabel: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary, #777)', lineHeight: '18px', flexShrink: 0 },

  hint: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #777)', lineHeight: 1.6 },
  hintBox: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #888)', background: 'var(--dsw-alias-bg-layer-1, #181818)', border: '1px dashed var(--dsw-alias-border-l3, #333)', borderRadius: 6, padding: '6px 8px', marginTop: 10, lineHeight: 1.6 },

  btn: { padding: '5px 12px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l4, #444)', background: 'var(--dsw-alias-bg-layer-1, #242424)', color: 'var(--dsw-alias-label-primary, #ddd)', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' as const, flexShrink: 0 },
  btnGhost: { padding: '2px 7px', borderRadius: 5, border: '1px solid transparent', background: 'transparent', color: 'var(--dsw-alias-label-tertiary, #888)', cursor: 'pointer', fontSize: 11 },
  btnPrimary: { padding: '6px 18px', borderRadius: 6, border: 'none', background: 'var(--dsw-alias-button-primary-fill, #4f6ef7)', color: 'var(--dsw-alias-label-primary-foreground, #fff)', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' as const, flexShrink: 0 },
  btnDanger: { padding: '4px 9px', borderRadius: 5, border: '1px solid #5a2f2f', background: 'transparent', color: '#d05050', cursor: 'pointer', fontSize: 11 },
  btnArrow: { padding: '2px 7px', borderRadius: 5, border: '1px solid var(--dsw-alias-border-l4, #3a3a3a)', background: 'var(--dsw-alias-bg-layer-1, #1c1c1c)', color: 'var(--dsw-alias-label-secondary, #aaa)', cursor: 'pointer', fontSize: 10.5, whiteSpace: 'nowrap' as const },

  toolbar: { position: 'sticky' as const, top: 0, zIndex: 20, display: 'flex', alignItems: 'center', gap: 8, rowGap: 6, flexWrap: 'wrap' as const, padding: '8px 10px', marginBottom: 12, background: 'var(--dsw-alias-settings-card-fill, #1e1e1e)', border: '1px solid var(--dsw-alias-border-l3, #333)', borderRadius: 10, boxShadow: '0 4px 14px rgba(0,0,0,.25)' },
  stats: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #888)', display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginRight: 'auto', minWidth: 0 },
  stat: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  msg: { fontSize: 12, marginLeft: 2, color: 'var(--dsw-alias-label-secondary, #aaa)', maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flexShrink: 1, minWidth: 0 },
  dirty: { fontSize: 11, color: '#d08a2e', border: '1px solid #5a4526', background: '#d08a2e14', borderRadius: 8, padding: '0 7px', lineHeight: '18px' },
  footerHint: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #777)', marginTop: 12, lineHeight: 1.7 },
  loading: { fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary, #999)', padding: 16 },
  del: { border: 'none', background: 'transparent', color: '#d05050', cursor: 'pointer', fontSize: 14, flexShrink: 0 },

  select: { padding: '4px 6px', borderRadius: 5, border: '1px solid var(--dsw-alias-border-l4, #444)', background: 'var(--dsw-alias-bg-layer-1, #141414)', color: 'var(--dsw-alias-label-primary, #eee)', fontSize: 12 },
  providerBadge: { fontSize: 9.5, fontFamily: 'ui-monospace, Consolas, monospace', color: 'var(--dsw-alias-label-tertiary, #999)', border: '1px solid var(--dsw-alias-border-l4, #3a3a3a)', borderRadius: 6, padding: '0 5px', lineHeight: '15px', flexShrink: 0, background: 'var(--dsw-alias-bg-layer-1, #161616)' },
  banner: { fontSize: 12, lineHeight: 1.6, color: '#e0a94a', background: '#d08a2e14', border: '1px solid #5a4526', borderRadius: 8, padding: '8px 12px', marginBottom: 12 },

  overlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: 'min(640px, 96vw)', maxHeight: 'min(78vh, 780px)', display: 'flex', flexDirection: 'column' as const, background: 'var(--dsw-alias-settings-card-fill, #1e1e1e)', border: '1px solid var(--dsw-alias-border-l3, #3a3a3a)', borderRadius: 12, boxShadow: '0 18px 60px rgba(0,0,0,.55)', overflow: 'hidden' },
  dialogHead: { padding: '12px 16px', borderBottom: '1px solid var(--dsw-alias-border-l1, #2c2c2c)' },
  dialogTitle: { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #eee)' },
  dialogSub: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: 4, lineHeight: 1.5 },
  dialogBody: { padding: '10px 14px', overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 8 },
  dialogFoot: { padding: '10px 16px', borderTop: '1px solid var(--dsw-alias-border-l1, #2c2c2c)', display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },
  pickRow: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l3, #333)', background: 'var(--dsw-alias-bg-layer-1, #181818)', cursor: 'pointer' },
  pickRowActive: { borderColor: 'var(--dsw-alias-button-info-fill, #4f6ef7)', background: '#4f6ef714' },
  pickName: { fontSize: 12.5, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #eee)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  pickMeta: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #888)', marginTop: 3, lineHeight: 1.5 },
  tag: { fontSize: 9.5, padding: '0 5px', borderRadius: 6, lineHeight: '15px', border: '1px solid var(--dsw-alias-border-l4, #444)', color: 'var(--dsw-alias-label-secondary, #aaa)', whiteSpace: 'nowrap' as const },
  tagOk: { fontSize: 9.5, padding: '0 5px', borderRadius: 6, lineHeight: '15px', border: '1px solid #2f5a3a', color: '#5cc07a', whiteSpace: 'nowrap' as const },
  previewGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 },
  previewCol: { border: '1px solid var(--dsw-alias-border-l3, #333)', borderRadius: 8, padding: '8px 10px', background: 'var(--dsw-alias-bg-layer-1, #181818)' },
  previewHead: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #eee)', marginBottom: 6 },
  previewRow: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11, color: 'var(--dsw-alias-label-secondary, #bbb)', padding: '2px 0', minWidth: 0 },
  previewKey: { fontFamily: 'ui-monospace, Consolas, monospace', flexShrink: 0 },
  previewValue: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0, color: 'var(--dsw-alias-label-tertiary, #888)' },
  actSet: { fontSize: 9.5, color: '#5cc07a', flexShrink: 0 },
  actDelete: { fontSize: 9.5, color: '#e06a6a', flexShrink: 0 },
  actKeep: { fontSize: 9.5, color: '#777', flexShrink: 0 },
  warnBox: { fontSize: 11.5, lineHeight: 1.6, color: '#e0a94a', background: '#d08a2e14', border: '1px solid #5a4526', borderRadius: 8, padding: '8px 10px' },
}

/* ================= 基础控件 ================= */

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return h('button', {
    style: { ...styles.toggle, ...(on ? styles.toggleOn : styles.toggleOff) },
    title: on ? tr('点击关闭（停用该通道）') : tr('点击开启'),
    onClick: (event: { stopPropagation: () => void }) => { event.stopPropagation(); onChange(!on) },
  }, h('span', { style: { ...styles.knob, left: on ? 15 : 2 } }))
}

function Chevron({ open }: { open: boolean }) {
  return h('span', { style: { ...styles.chevron, transform: open ? 'rotate(90deg)' : 'none' } }, '▶')
}

function KeyChip({ p }: { p: ProviderItem }) {
  if (!p.apiKey) return null
  if (isManagedChannel(p)) {
    return h('span', { style: styles.keyChip, title: tr('{p1}：凭据由对应账号库托管，不在此处明文展示', { p1: channelManagedReason(p) }) }, tr('🔐 凭据已存'))
  }
  const text = maskKey(p.apiKey)
  return h('span', { style: styles.keyChip, title: tr('已配置 API Key（掩码展示，展开卡片可更换）') }, `🔑 ${text}`)
}

function AddCardButton({ label, onClick, block = true }: { label: string; onClick: () => void; block?: boolean }) {
  return h('button', {
    style: {
      padding: '5px 10px',
      borderRadius: 6,
      border: '1px dashed var(--dsw-alias-border-l4, #4a4a4a)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary, #999)',
      cursor: 'pointer',
      fontSize: 11,
      width: block ? '100%' : 'auto',
      marginTop: 2,
    },
    onClick,
  }, label)
}

/* ================= 模型链编辑 ================= */

/**
 * 模型链（该厂商对应的模型，按降级顺序）。
 * 收起卡片时由头部摘要展示；展开后在此增删。
 */
function ModelChain({ value, provider, onChange }: { value: string; provider: ProviderItem; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState('')
  const list = splitModels(value)
  const commit = (next: string[]) => onChange(next.join(','))
  const suggestions = modelSuggestions(provider)
  const addDraft = () => {
    const model = draft.trim()
    if (model && !list.includes(model)) commit([...list, model])
    setDraft('')
  }
  return h('div', { style: { marginTop: 8 } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
      h('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary, #bbb)' } }, tr('模型链')),
      h('span', { style: styles.groupCount }, tr('{p1} 个', { p1: list.length })),
      h('span', { style: { ...styles.hint, marginLeft: 2 } }, tr('按顺序降级 · 点击 × 删除，回车添加')),
    ),
    h('div', { style: { ...styles.chips, marginTop: 6 } },
      list.map((model, index) => h('span', { key: model, style: styles.chip, title: model },
        h('span', { style: styles.chipIndex }, String(index + 1)),
        h('span', { style: styles.chipText }, model),
        h('button', {
          style: styles.chipX,
          title: tr('删除 {p1}', { p1: model }),
          onClick: () => commit(list.filter((x) => x !== model)),
        }, '×'),
      )),
      h('input', {
        style: { ...styles.chipInput, width: 168, ...(draft ? { borderColor: 'var(--dsw-alias-button-info-fill, #4f6ef7)' } : {}) },
        value: draft,
        placeholder: tr('+ 输入模型名，回车添加'),
        onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
        onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter') { e.preventDefault(); addDraft() } },
        onBlur: addDraft,
      }),
    ),
    h('div', { style: styles.suggestRow },
      h('span', { style: styles.suggestLabel }, tr('常用')),
      suggestions.map((model) => {
        const active = list.includes(model)
        return h('span', {
          key: model,
          style: { ...styles.suggestChip, ...(active ? { opacity: 0.4, cursor: 'default' } : {}) },
          title: active ? tr('已在模型链中') : tr('点击追加 {p1}', { p1: model }),
          onClick: () => { if (!active) commit([...list, model]) },
        }, active ? model : `+ ${model}`)
      }),
    ),
  )
}

/* ================= API Key / Base URL ================= */

function KeyField({ p, onChange }: { p: ProviderItem; onChange: (patch: Partial<ProviderItem>) => void }) {
  const [draft, setDraft] = useState('')
  const configured = Boolean(p.apiKey)
  const commit = () => {
    const next = draft.trim()
    if (next) onChange({ apiKey: next })
    setDraft('')
  }
  return h('div', { style: styles.field },
    h('span', { style: styles.fieldLabel }, 'API Key'),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
      h('input', {
        style: { ...styles.input, fontFamily: 'ui-monospace, Consolas, monospace', flex: 1 },
        type: 'password',
        value: draft,
        placeholder: configured ? tr('已配置 {p1}', { p1: maskKey(p.apiKey) }) : tr('粘贴 API Key（可留空）'),
        title: configured ? tr('已配置的 Key 以掩码展示；输入新值覆盖，留空保存则保持原值') : tr('粘贴该厂商的 API Key；CLI / 网页账号通道无需填写'),
        onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
        onBlur: commit,
        onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter') { e.preventDefault(); commit() } },
      }),
      configured
        ? h('button', {
            style: styles.btnArrow,
            title: tr('清空已保存的 Key（保存后从 .env 删除；不点“清空”时留空保存不会删 key）'),
            onClick: () => onChange({ apiKey: '', clearKey: true }),
          }, tr('清空'))
        : null,
    ),
  )
}

function BaseField({ p, onChange }: { p: ProviderItem; onChange: (patch: Partial<ProviderItem>) => void }) {
  const providerId = providerIdOf(p)
  const readOnly = isManagedChannel(p) || providerId === 'direct' || p.base === 'qoderclicn'
  return h('div', { style: styles.field },
    h('span', { style: styles.fieldLabel }, 'Base URL', readOnly ? h('span', { style: { color: '#555' } }, tr('（托管/固定通道，只读）')) : null),
    readOnly
      ? h('div', { style: { ...styles.input, color: 'var(--dsw-alias-label-tertiary, #999)', fontFamily: 'ui-monospace, Consolas, monospace' }, title: p.base }, p.base || '—')
      : h('input', {
        style: styles.input,
        value: p.base,
        placeholder: tr('OpenAI 兼容中转填 base，如 https://api.xxx.com/v1'),
        onChange: (e: { target: { value: string } }) => onChange({ base: e.target.value }),
      }),
  )
}

/* ================= 厂商卡片 ================= */

interface VendorCardProps {
  p: ProviderItem
  open: boolean
  onToggleOpen: () => void
  onPatch: (patch: Partial<ProviderItem>) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onTest: () => void
  onTry: () => void
  onCopyCommand: () => void
  onDragStart: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDragEnd: () => void
  onDrop: (e: DragEvent) => void
  isDragOver: boolean
}

function VendorCard({ p, open, onToggleOpen, onPatch, onDelete, onMove, onTest, onTry, onCopyCommand, onDragStart, onDragOver, onDragEnd, onDrop, isDragOver }: VendorCardProps) {
  const level = LEVEL_META[p.level]!
  const status = STATUS_META[p.status]
  const models = splitModels(p.model)
  const chainText = models.length
    ? models.slice(0, 2).join(' → ') + (models.length > 2 ? ` +${models.length - 2}` : '')
    : tr('未指定模型')
  const managed = isManagedChannel(p)
  const providerId = providerIdOf(p)
  const ability = catalogEntry(providerId)?.i2i
  const abilityText: Record<string, string> = {
    yes: tr('支持图生图（参考图）'),
    no: tr('仅文生图（i2i 会被跳过）'),
    subject: tr('图生图走主体参考'),
    direct: tr('能力看直连子通道'),
  }
  const stateText = !p.enabled
    ? tr('已停用')
    : managed
      ? tr('托管通道')
      : p.status === 'ok'
        ? tr('正常')
        : p.status === 'arrears'
          ? tr('欠费关停')
          : p.status === 'error'
            ? tr('探测失败')
            : tr('未探测')
  return h('div', {
    style: { ...styles.card, ...(isDragOver ? styles.cardHeadDragOver : {}), borderLeft: `2px solid ${p.enabled ? level.color : '#3a3a3a'}` },
    draggable: true,
    title: tr('整张卡片可拖动：同级内排序；拖到其他等级组自动改级'),
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
  },
    // —— 收起态：厂商 / 模型链摘要 / 掩码 Key / 等级 / 展开箭头 ——
    h('div', {
      style: styles.cardHead,
      onClick: onToggleOpen,
      role: 'button',
      tabIndex: 0,
      'aria-expanded': open,
      onKeyDown: (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOpen() }
      },
    },
      h('span', { style: styles.handle, title: tr('拖动把手') }, '⋮⋮'),
      h(Toggle, { on: p.enabled, onChange: (v) => onPatch({ enabled: v }) }),
      h('span', {
        style: {
          ...styles.dot,
          background: status.dot,
          boxShadow: p.status === 'arrears' ? '0 0 0 2px #d0505033' : 'none',
        },
        title: tr(status.label),
      }),
      h('span', { style: { ...styles.avatar, background: vendorColor(p) + 'd9', color: '#fff' } }, vendorAvatar(p)),
      h('div', { style: styles.identity },
        h('div', { style: styles.nameRow },
          h('span', { style: styles.name, title: p.name }, p.name),
          h('span', { style: styles.providerBadge, title: tr('脚本 providerId：{p1}（GEN_PROVIDER_ORDER / --provider 用这个）', { p1: providerIdOf(p) }) }, providerIdOf(p)),
        ),
        h('div', { style: styles.summaryRow },
          isDirectChannel(p)
            ? h('span', { style: styles.summaryChain }, tr('子通道 · {p1}', { p1: p.directProvider || 'dashscope' }))
            : h('span', { style: styles.summaryChain },
                h('span', { style: { color: 'var(--dsw-alias-label-secondary, #aaa)' } }, tr('模型 {p1}', { p1: models.length })),
                models.length ? ` · ${chainText}` : tr(' · 未指定模型'),
              ),
          h('span', { style: styles.sep }, '·'),
          h('span', { style: styles.summaryChain }, hostOf(p.base)),
          h('span', { style: styles.sep }, '·'),
          h('span', { style: styles.summaryChain }, stateText),
        ),
      ),
      h(KeyChip, { p }),
      h('select', {
        style: styles.levelSelect,
        value: String(p.level),
        title: tr('优先级等级（1 主 / 2 备 / 3 兜底）'),
        onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
        onChange: (e: { target: { value: string } }) => onPatch({ level: Number(e.target.value) as 1 | 2 | 3 }),
      }, [1, 2, 3].map((lv) => h('option', { key: lv, value: String(lv) }, tr('{p1} 级', { p1: lv })))),
      h(Chevron, { open }),
    ),
    // —— 展开态：模型链（或直连子通道）+ Key/Base + 行操作 ——
    open
      ? h('div', { style: styles.cardBody },
        modelChainEditable(p)
          ? h(ModelChain, { value: p.model, provider: p, onChange: (v) => onPatch({ model: v }) })
          : modelChainNote(p)
            ? h('div', { style: styles.hintBox }, modelChainNote(p))
            : null,
        isDirectChannel(p)
          ? h('div', { style: { ...styles.field, marginTop: 8 } },
              h('span', { style: styles.fieldLabel }, tr('直连子通道（保存后写入 DIRECT_PROVIDER）')),
              h('select', {
                style: styles.select,
                value: p.directProvider || 'dashscope',
                onChange: (e: { target: { value: string } }) => onPatch({ directProvider: e.target.value }),
              }, DIRECT_SUB_PROVIDERS.map((sub) => h('option', { key: sub.id, value: sub.id }, `${tr(sub.name)}（${sub.id}）`))),
            )
          : null,
        h('div', { style: styles.fieldsRow },
          managed ? null : h(KeyField, { p, onChange: onPatch }),
          h(BaseField, { p, onChange: onPatch }),
        ),
        managed
          ? h('div', { style: styles.hintBox }, tr('该通道使用「{p1}」，不需要 API Key；凭据由对应的账号库 / 客户端登录态提供。', { p1: channelManagedReason(p) }))
          : p.apiKey
            ? h('div', { style: { ...styles.hint, marginTop: 6 } }, tr('已配置的 Key 只以掩码显示；输入新值覆盖，留空保存则保持原值；“清空”才会删除已存 Key。'))
            : null,
        ability && p.kind === 'gen'
          ? h('div', { style: { ...styles.hint, marginTop: 6 } }, tr('图生图能力：{p1}{p2}', { p1: abilityText[ability] ?? ability, p2: catalogEntry(providerId)?.note ? ` · ${catalogEntry(providerId)!.note}` : '' }))
          : null,
        p.detail
          ? h('div', { style: { ...styles.hint, marginTop: 6, color: p.status === 'error' ? '#d05050' : p.status === 'arrears' ? '#d05050' : 'var(--dsw-alias-label-tertiary, #888)' } },
              tr('最近探测{p1}：{p2}', { p1: p.lastChecked ? `（${new Date(p.lastChecked).toLocaleTimeString('zh-CN', { hour12: false })}）` : '', p2: p.detail }))
          : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' as const } },
          h('button', { style: styles.btnArrow, title: tr('探活（不花钱）：API 通道 GET /models，CLI/账号通道查本机依赖'), onClick: onTest }, tr('测试')),
          p.kind === 'gen'
            ? h('button', { style: styles.btnArrow, title: tr('真实生成一张 1024×1024 测试图（会消耗额度，会先确认）'), onClick: onTry }, tr('试跑 1 张'))
            : null,
          p.kind === 'gen'
            ? h('button', { style: styles.btnArrow, title: tr('复制固定该通道的命令，交给 agent / 终端执行'), onClick: onCopyCommand }, tr('复制命令'))
            : null,
          h('button', { style: styles.btnArrow, title: tr('上移一位（可跨级）'), onClick: () => onMove(-1) }, tr('▲ 上移')),
          h('button', { style: styles.btnArrow, title: tr('下移一位（可跨级）'), onClick: () => onMove(1) }, tr('▼ 下移')),
          h('button', { style: { ...styles.btnDanger, marginLeft: 'auto' }, title: tr('删除该通道'), onClick: onDelete }, tr('删除通道')),
        ),
      )
      : null,
  )
}

/* ================= 等级分组 ================= */

function LevelGroup({ level, items, collapsed, onToggleCollapsed, ...cardHandlers }: {
  level: 1 | 2 | 3
  items: ProviderItem[]
  collapsed: boolean
  onToggleCollapsed: () => void
  patch: (id: string, patch: Partial<ProviderItem>) => void
  remove: (id: string) => void
  move: (id: string, dir: -1 | 1) => void
  drag: {
    start: (e: DragEvent, id: string) => void
    over: (e: DragEvent) => void
    overGroup: (level: 1 | 2 | 3) => void
    drop: (e: DragEvent, id: string) => void
    dropToGroup: (e: DragEvent, level: 1 | 2 | 3) => void
    end: () => void
  }
  dragOverId: string | null
  isOpen: (id: string) => boolean
  toggleOpen: (id: string) => void
  onTest: (id: string) => void
  onTry: (id: string) => void
  onCopyCommand: (id: string) => void
}) {
  const meta = LEVEL_META[level]!
  const { patch, remove, move, drag, dragOverId, isOpen, toggleOpen, onTest, onTry, onCopyCommand } = cardHandlers
  return h('div', {
    style: { ...styles.group, ...(dragOverId === `group-${level}` ? styles.cardHeadDragOver : {}) },
    onDragOver: (e: DragEvent) => { drag.over(e); drag.overGroup(level) },
    onDrop: (e: DragEvent) => drag.dropToGroup(e, level),
  },
    h('div', {
      style: { ...styles.groupHead, background: `linear-gradient(90deg, ${meta.color}18, transparent 70%)` },
      onClick: onToggleCollapsed,
      role: 'button',
      tabIndex: 0,
      'aria-expanded': !collapsed,
      onKeyDown: (e: { key: string; preventDefault: () => void }) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleCollapsed() }
      },
    },
      h(Chevron, { open: !collapsed }),
      h('span', { style: { ...styles.dot, background: meta.color } }),
      h('span', { style: { ...styles.groupTitle, color: meta.color } }, tr(meta.title)),
      h('span', { style: styles.groupCount }, String(items.length)),
      h('span', { style: styles.groupDesc }, tr(meta.desc)),
    ),
    collapsed
      ? null
      : items.length === 0
        ? h('div', { style: styles.groupEmpty }, tr('（空 · 可把其他等级的行拖到这里自动改级，或点下方添加通道）'))
        : items.map((p) => h(VendorCard, {
          key: p.id,
          p,
          open: isOpen(p.id),
          onToggleOpen: () => toggleOpen(p.id),
          onPatch: (patchPart) => patch(p.id, patchPart),
          onDelete: () => remove(p.id),
          onMove: (dir) => move(p.id, dir),
          onTest: () => onTest(p.id),
          onTry: () => onTry(p.id),
          onCopyCommand: () => onCopyCommand(p.id),
          onDragStart: (e) => drag.start(e, p.id),
          onDragOver: (e) => drag.over(e),
          onDragEnd: drag.end,
          onDrop: (e) => drag.drop(e, p.id),
          isDragOver: dragOverId === p.id,
        })),
  )
}

/* ================= 添加通道：供应商选择弹层 ================= */

const AUTH_LABEL: Record<string, string> = { apiKey: 'API Key', cli: '本机 CLI 登录', account: '账号库登录态' }
const I2I_LABEL: Record<string, string> = { yes: '支持图生图', no: '仅文生图', subject: '主体参考', direct: '看子通道' }

/** GET /dsh-img2img-config/scan 的形状（脚本 --list-providers 的裁剪版）。 */
interface ScriptScanProvider { id?: string; name?: string; configured?: boolean; detail?: string }
interface ScriptScan {
  ok?: boolean
  gen?: { ok?: boolean; providers?: ScriptScanProvider[]; error?: string }
  vision?: { ok?: boolean; providers?: unknown[]; error?: string }
}

function ProviderPicker({ kind, providers, onClose, onAdd }: {
  kind: ProviderKind
  providers: ProviderItem[]
  onClose: () => void
  onAdd: (entry: CatalogEntry, level: 1 | 2 | 3) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string>('')
  // 默认放「兜底」：新通道不会因为排在前面而意外抢走主通道；需要时在下拉里改
  const [level, setLevel] = useState<1 | 2 | 3>(3)
  // 打开弹层时让真实脚本扫一遍：哪些 provider 本机真的就绪（CLI 装了 / key 配了）
  const [scan, setScan] = useState<ScriptScan | null>(null)
  useEffect(() => {
    void (async () => {
      try {
        const data = (await (await fetch('/dsh-img2img-config/scan')).json()) as ScriptScan
        setScan(data)
      } catch { setScan(null) }
    })()
  }, [])
  const genScan = scan?.gen?.providers ?? []
  const scanFor = (providerId: string) => genScan.find((item) => item.id === providerId)
  const scanSummary = !scan?.gen
    ? ''
    : scan.gen.ok === false
      ? tr('脚本扫描失败：{p1}', { p1: scan.gen.error ?? tr('未知错误') })
      : tr('脚本扫描：生图 provider {p1}/{p2} 已就绪', { p1: genScan.filter((item) => item.configured).length, p2: genScan.length })
  const entries = CATALOG.filter((entry) => entry.kinds.includes(kind)).filter((entry) => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return true
    return `${tr(entry.name)} ${entry.name} ${entry.providerId} ${entry.note ? tr(entry.note) : ''}`.toLowerCase().includes(keyword)
  })
  const configuredCount = (providerId: string) => providers.filter((p) => providerIdOf(p) === providerId).length
  // 脚本比插件目录新时会多出 provider：这里只展示，不假装能配（env 映射只有目录知道）
  const catalogGenIds = new Set(CATALOG.filter((entry) => entry.kinds.includes('gen')).map((entry) => entry.providerId))
  const scriptOnly = kind === 'gen'
    ? genScan.filter((item) => {
        const id = String(item.id ?? '')
        return Boolean(id) && !id.startsWith('chatgpt-web@') && !catalogGenIds.has(id)
      })
    : []
  const chosen = entries.find((entry) => entry.providerId === selected)
  return h('div', { style: styles.overlay, onClick: onClose },
    h('div', { style: styles.dialog, onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
      h('div', { style: styles.dialogHead },
        h('div', { style: styles.dialogTitle }, kind === 'gen' ? tr('添加生图通道 · 选择供应商') : tr('添加识图通道 · 选择供应商')),
        h('div', { style: styles.dialogSub }, kind === 'gen'
          ? tr('列表来自 generate_image.mjs 真正支持的 provider；同一供应商可加多条（多 Key / 多中转），.env 按链序取第一条。')
          : tr('识图侧 VISION_PROVIDERS 接受任意 OpenAI 兼容端点；目录里的只是常用预设。')),
        kind === 'gen' && scanSummary ? h('div', { style: styles.pickMeta }, scanSummary) : null,
        h('input', {
          style: { ...styles.input, marginTop: 10 },
          value: query,
          placeholder: tr('搜索供应商 / providerId…'),
          onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
        }),
      ),
      h('div', { style: styles.dialogBody },
        entries.map((entry) => {
          const count = configuredCount(entry.providerId)
          const info = kind === 'gen' ? scanFor(entry.providerId) : undefined
          return h('div', {
            key: entry.providerId,
            style: { ...styles.pickRow, ...(selected === entry.providerId ? styles.pickRowActive : {}) },
            role: 'button',
            tabIndex: 0,
            onClick: () => setSelected(entry.providerId),
            onKeyDown: (e: { key: string; preventDefault: () => void }) => {
              if (e.key === 'Enter') { e.preventDefault(); setSelected(entry.providerId) }
            },
          },
            h('span', {
              style: { ...styles.avatar, background: (VENDOR_META[entry.providerId]?.color ?? '#777') + 'd9' },
            }, VENDOR_META[entry.providerId]?.avatar ?? entry.name.slice(0, 1)),
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: styles.pickName },
                tr(entry.name),
                h('span', { style: styles.providerBadge }, entry.providerId),
                h('span', { style: styles.tag }, tr(AUTH_LABEL[entry.auth] ?? entry.auth)),
                entry.i2i ? h('span', { style: styles.tag }, tr(I2I_LABEL[entry.i2i] ?? entry.i2i)) : null,
                count > 0 ? h('span', { style: styles.tagOk }, tr('已配置 {p1} 条', { p1: count })) : null,
                info
                  ? h('span', {
                      style: info.configured ? styles.tagOk : styles.tag,
                      title: info.detail ?? '',
                    }, info.configured ? tr('本机已就绪') : tr('依赖未就绪'))
                  : null,
              ),
              entry.note ? h('div', { style: styles.pickMeta }, tr(entry.note)) : null,
            ),
          )
        }),
        entries.length === 0 ? h('div', { style: styles.groupEmpty }, tr('没有匹配的供应商')) : null,
        scriptOnly.length > 0
          ? h('div', { style: { marginTop: 6 } },
              h('div', { style: styles.pickMeta },
                tr('脚本发现 {p1} 个插件目录尚未收录的 provider（脚本比插件新）：升级插件目录后才能在这里添加。', { p1: scriptOnly.length })),
              scriptOnly.map((item) => h('div', {
                key: String(item.id),
                style: { ...styles.pickRow, cursor: 'default', opacity: 0.78 },
              },
                h('span', { style: styles.providerBadge }, String(item.id)),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: styles.pickName },
                    String(item.name ?? item.id),
                    item.configured ? h('span', { style: styles.tagOk }, tr('本机已就绪')) : h('span', { style: styles.tag }, tr('未配置')),
                  ),
                  h('div', { style: styles.pickMeta },
                    item.detail ?? tr('静态目录没有这个 provider 的 env 映射：先手写 .env，或升级插件后再在面板管理')),
                ),
              )),
            )
          : null,
      ),
      h('div', { style: styles.dialogFoot },
        h('span', { style: { ...styles.hint, marginRight: 'auto' } },
          chosen ? tr('将添加：{p1}（{p2}）', { p1: tr(chosen.name), p2: chosen.providerId }) : tr('先选一个供应商')),
        h('span', { style: styles.hint }, tr('等级')),
        h('select', {
          style: styles.select,
          value: String(level),
          onChange: (e: { target: { value: string } }) => setLevel(Number(e.target.value) as 1 | 2 | 3),
        }, [1, 2, 3].map((lv) => h('option', { key: lv, value: String(lv) }, tr(LEVEL_META[lv]!.title)))),
        h('button', { style: styles.btn, onClick: onClose }, tr('取消')),
        h('button', {
          style: { ...styles.btnPrimary, opacity: chosen ? 1 : 0.5 },
          disabled: !chosen,
          onClick: () => { if (chosen) onAdd(chosen, level) },
        }, tr('添加通道')),
      ),
    ),
  )
}

/* ================= 保存前预览：同一份 planSync() ================= */

const ACTION_META: Record<'set' | 'delete' | 'keep', { label: string; style: CSSProperties }> = {
  set: { label: '写入', style: styles.actSet! },
  delete: { label: '删除', style: styles.actDelete! },
  keep: { label: '保持', style: styles.actKeep! },
}

function previewValueOf(key: string, value: string | undefined): string {
  const text = value ?? ''
  if (!text) return '—'
  if (/KEY|TOKEN|SECRET/i.test(key)) return maskKey(text)
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

function PreviewDialog({ providers, previous, hostOk, onClose }: {
  providers: ProviderItem[]
  previous: ProviderItem[]
  hostOk: boolean
  onClose: () => void
}) {
  const plan: SyncPlan = planSync(providers, previous)
  const renderRows = (rows: SyncPlan['gen']['rows']) => rows.map((row) => {
    const meta = ACTION_META[row.action]
    return h('div', { key: row.key, style: styles.previewRow },
      h('span', { style: meta.style }, tr(meta.label)),
      h('span', { style: styles.previewKey }, row.key),
      row.action === 'keep' ? null : h('span', { style: styles.previewValue }, previewValueOf(row.key, row.value)),
    )
  })
  return h('div', { style: styles.overlay, onClick: onClose },
    h('div', { style: styles.dialog, onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
      h('div', { style: styles.dialogHead },
        h('div', { style: styles.dialogTitle }, tr('保存前预览：将写入的 .env')),
        h('div', { style: styles.dialogSub }, tr('与宿主保存时共用同一份 planSync()：绿=写入，红=删除，灰=保持原值（不碰手写配置）。')),
        hostOk ? null : h('div', { style: { ...styles.warnBox, marginTop: 8 } }, tr('宿主插件还是旧版：预览能看，保存需要先重启 DSH 宿主。')),
      ),
      h('div', { style: styles.dialogBody },
        h('div', { style: styles.previewGrid },
          h('div', { style: styles.previewCol },
            h('div', { style: styles.previewHead }, tr('生图 · 生效链')),
            h('div', { style: { ...styles.previewValue, marginBottom: 6, color: 'var(--dsw-alias-label-secondary, #bbb)' } },
              plan.gen.chain.length > 0 ? plan.gen.chain.join(' → ') : tr('（空）')),
            renderRows(plan.gen.rows),
          ),
          h('div', { style: styles.previewCol },
            h('div', { style: styles.previewHead }, tr('识图 · 生效链')),
            h('div', { style: { ...styles.previewValue, marginBottom: 6, color: 'var(--dsw-alias-label-secondary, #bbb)' } },
              plan.vision.chain.length > 0 ? plan.vision.chain.join(' → ') : tr('（空）')),
            renderRows(plan.vision.rows),
          ),
        ),
        plan.warnings.length > 0
          ? h('div', { style: styles.warnBox },
              h('div', { style: { fontWeight: 600, marginBottom: 4 } }, tr('提示')),
              plan.warnings.map((warning) => h('div', { key: warning }, `· ${warning}`)))
          : null,
      ),
      h('div', { style: styles.dialogFoot },
        h('button', { style: styles.btn, onClick: onClose }, tr('关闭')),
      ),
    ),
  )
}

/* ================= 试跑：真实生成一张（明确确认后） ================= */

interface TryResult {
  ok?: boolean
  provider?: string
  model?: string
  files?: string[]
  ms?: number
  error?: string
}

function TryDialog({ provider, onClose }: { provider: ProviderItem; onClose: () => void }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TryResult | null>(null)
  const providerId = providerIdOf(provider)
  const run = () => {
    setRunning(true)
    setResult(null)
    void (async () => {
      try {
        const data = (await (await fetch('/dsh-img2img-config/try', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: provider.id }),
        })).json()) as TryResult
        setResult(data)
      } catch (error) {
        setResult({ ok: false, error: tr('请求失败：{p1}', { p1: (error as Error).message }) })
      }
      setRunning(false)
    })()
  }
  return h('div', { style: styles.overlay, onClick: running ? undefined : onClose },
    h('div', { style: styles.dialog, onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() },
      h('div', { style: styles.dialogHead },
        h('div', { style: styles.dialogTitle }, tr('试跑 1 张 · {p1}', { p1: provider.name })),
        h('div', { style: styles.dialogSub },
          tr('走技能自己的 generate_image.mjs，固定 1024×1024 / quality normal，provider = {p1}。', { p1: providerId }),
          tr('会真实调用一次出图（可能消耗 API 额度或订阅出图次数）；ChatGPT 网页通道会开无头浏览器，可能要 1-2 分钟。')),
      ),
      h('div', { style: styles.dialogBody },
        running
          ? h('div', { style: styles.hint }, tr('正在出图…（等待脚本返回，最长 240 秒）'))
          : result
            ? result.ok
              ? h('div', {},
                  h('div', { style: { fontSize: 12, color: '#5cc07a', marginBottom: 6 } },
                    tr('试跑成功：{p1}{p2}{p3}', { p1: result.provider ?? providerId, p2: result.model ? ` · ${result.model}` : '', p3: result.ms ? ` · ${(result.ms / 1000).toFixed(1)}s` : '' })),
                  (result.files ?? []).map((file) => h('div', {
                    key: file,
                    style: { fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace', color: 'var(--dsw-alias-label-secondary, #bbb)', wordBreak: 'break-all' as const, padding: '2px 0' },
                  }, file)),
                )
              : h('div', { style: styles.warnBox }, tr('试跑失败：{p1}', { p1: result.error ?? tr('未知错误') }))
            : h('div', { style: styles.hint }, tr('点“开始试跑”才会真正消耗一次额度。')),
      ),
      h('div', { style: styles.dialogFoot },
        h('button', { style: styles.btn, disabled: running, onClick: onClose }, result ? tr('关闭') : tr('取消')),
        h('button', { style: styles.btnPrimary, disabled: running, onClick: run }, running ? tr('出图中…') : result ? tr('再试一次') : tr('开始试跑')),
      ),
    ),
  )
}

/* ================= 设置面板主体 ================= */

function ConfigPanel() {
  const [providers, setProviders] = useState<ProviderItem[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const [msg, setMsg] = useState('')
  const [dirty, setDirty] = useState(false)
  const [hostVersion, setHostVersion] = useState<number | null>(null)
  const [pickerKind, setPickerKind] = useState<ProviderKind | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [tryTarget, setTryTarget] = useState<ProviderItem | null>(null)
  const [ui, setUi] = useState<Record<string, boolean>>(() => readUiStore())
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragId = useRef<string | null>(null)
  /** 上次从宿主加载/保存成功的通道快照：预览用它判断「哪些是用户删掉的」。 */
  const baseline = useRef<ProviderItem[]>([])
  const hostOk = hostVersion === HOST_PROTOCOL_VERSION

  useEffect(() => { writeUiStore(ui) }, [ui])
  const isOpen = (id: string) => ui[`card:${id}`] === true
  const toggleOpen = (id: string) => setUi((state) => ({ ...state, [`card:${id}`]: state[`card:${id}`] !== true }))
  const isGroupCollapsed = (kind: ProviderKind, level: 1 | 2 | 3) => ui[`group:${kind}:${level}`] === true
  const toggleGroup = (kind: ProviderKind, level: 1 | 2 | 3) =>
    setUi((state) => ({ ...state, [`group:${kind}:${level}`]: state[`group:${kind}:${level}`] !== true }))
  const setAllOpen = (kind: ProviderKind, next: boolean) =>
    setUi((state) => {
      const copy = { ...state }
      for (const p of providers ?? []) {
        if (p.kind !== kind) continue
        if (next) {
          copy[`card:${p.id}`] = true
          delete copy[`group:${kind}:${p.level}`]
        } else {
          delete copy[`card:${p.id}`]
        }
      }
      return copy
    })

  const normalizeList = (list: ProviderItem[]): ProviderItem[] =>
    list.map((p) => ({ ...p, providerId: providerIdOf(p) }))

  const load = () => {
    void (async () => {
      try {
        const data = (await (await fetch('/dsh-img2img-config/providers')).json()) as { providers: ProviderItem[]; hostVersion?: number }
        const list = normalizeList(data.providers)
        baseline.current = list
        setProviders(list)
        setHostVersion(typeof data.hostVersion === 'number' ? data.hostVersion : 0)
        setDirty(false)
      } catch { setMsg(tr('加载配置失败')) }
    })()
  }
  useEffect(() => { load() }, [])

  /** 账号库变更后刷新通道列表；但当前有未保存的通道改动时别把用户编辑冲掉。 */
  const refreshAfterAccountChange = () => {
    if (dirty) {
      setMsg(tr('账号已同步到通道库；当前有未保存的通道改动，先保存再刷新（避免覆盖你的编辑）'))
      return
    }
    load()
  }

  const patch = (id: string, part: Partial<ProviderItem>) => {
    setDirty(true)
    // 输入新 Key 时顺带撤销「清空」标记，避免先点清空再粘贴 Key 又被清掉
    const nextPart = part.apiKey !== undefined && part.clearKey === undefined ? { ...part, clearKey: false } : part
    setProviders((list) => (list ? list.map((p) => (p.id === id ? { ...p, ...nextPart } : p)) : list))
  }
  const remove = (id: string) => {
    setDirty(true)
    setProviders((list) => (list ? list.filter((p) => p.id !== id) : list))
  }

  /** 同组内上移/下移（跨级时自动继承相邻通道的等级） */
  const move = (id: string, dir: -1 | 1) => {
    setDirty(true)
    setProviders((list) => {
      if (!list) return list
      const index = list.findIndex((p) => p.id === id)
      if (index < 0) return list
      const item = list[index]!
      const target = index + dir
      if (target < 0 || target >= list.length) return list
      const neighbor = list[target]!
      const next = [...list]
      next[index] = neighbor
      next[target] = { ...item, level: neighbor.level as 1 | 2 | 3 }
      return next
    })
  }

  /** 从目录条目添加一条通道（同一 provider 可多条：多 Key / 多中转）。 */
  const addChannel = (entry: CatalogEntry, kind: ProviderKind, level: 1 | 2 | 3) => {
    const base = providers ?? []
    const id = channelIdFor(entry.providerId, new Set(base.map((p) => p.id)))
    const channel: ProviderItem = {
      id,
      providerId: entry.providerId,
      name: tr(entry.name),
      kind,
      level,
      enabled: true,
      apiKey: '',
      model: catalogModels(entry.providerId, kind).join(','),
      base: entry.base,
      ...(entry.providerId === 'direct' ? { directProvider: 'dashscope' } : {}),
      status: 'unknown',
      lastChecked: null,
    }
    setProviders([...base, channel])
    setUi((state) => ({ ...state, [`card:${id}`]: true }))
    setDirty(true)
    setMsg(tr('已添加 {p1}（{p2}），展开卡片填配置后保存', { p1: tr(entry.name), p2: entry.providerId }))
  }

  const save = () => {
    if (!providers) return
    const errors = validateProviders(providers)
    if (errors.length > 0) {
      setMsg(tr('保存被拦下: ') + errors.join('；'))
      return
    }
    if (!hostOk) {
      setMsg(tr('宿主插件还是旧版：请重启 DSH 宿主后再保存（否则新通道的 .env 同步不会真正生效）'))
      return
    }
    setSaving(true)
    setMsg('')
    void (async () => {
      try {
        const data = (await (await fetch('/dsh-img2img-config/providers', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ providers }),
        })).json()) as {
          ok?: boolean
          error?: string
          errors?: string[]
          providers?: ProviderItem[]
          warnings?: string[]
          hostVersion?: number
        }
        if (data.ok && data.providers) {
          const list = normalizeList(data.providers)
          baseline.current = list
          setProviders(list)
          setDirty(false)
          if (typeof data.hostVersion === 'number') setHostVersion(data.hostVersion)
        }
        const warningText = data.warnings && data.warnings.length > 0 ? tr('；提示：{p1}', { p1: data.warnings.join('；') }) : ''
        setMsg(data.ok ? tr('已保存，并已同步到两份 .env（新会话生效）{p1}', { p1: warningText }) : tr('保存失败: ') + (data.error || ''))
      } catch { setMsg(tr('保存失败')) }
      setSaving(false)
    })()
  }

  const probe = (id?: string) => {
    if (!providers) return
    setProbing(true)
    setMsg('')
    void (async () => {
      try {
        const data = (await (await fetch('/dsh-img2img-config/probe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(id ? { id } : {}),
        })).json()) as { ok?: boolean; providers?: ProviderItem[]; error?: string }
        if (data.providers) {
          const list = normalizeList(data.providers)
          baseline.current = list
          setProviders(list)
        }
        const arrears = (data.providers ?? []).filter((p) => p.status === 'arrears')
        if (id) {
          const target = (data.providers ?? []).find((p) => p.id === id)
          setMsg(target
            ? tr('测试 {p1}：{p2}{p3}', { p1: target.name, p2: tr(STATUS_META[target.status].label), p3: target.detail ? ` · ${target.detail}` : '' })
            : tr('测试失败: ') + (data.error || tr('通道不存在')))
        } else {
          const counts = { ok: 0, unknown: 0, error: 0, arrears: 0 }
          for (const p of data.providers ?? []) if (p.status in counts) counts[p.status as keyof typeof counts] += 1
          setMsg(data.ok
            ? tr('探测完成：正常 {p1} · 未确认 {p2} · 失败 {p3}{p4}', { p1: counts.ok, p2: counts.unknown, p3: counts.error, p4: counts.arrears ? tr(' · 欠费已关停 {p1}', { p1: counts.arrears }) : '' })
            : tr('探测失败: ') + (data.error || ''))
        }
      } catch { setMsg(tr('探测失败')) }
      setProbing(false)
    })()
  }

  /** 复制「固定走这个通道」的命令，方便交给 agent / 终端复现。 */
  const copyCommand = (id: string) => {
    const provider = providers?.find((item) => item.id === id)
    if (!provider) return
    const providerId = providerIdOf(provider)
    const command = [
      'node "scripts/generate_image.mjs"',
      '--provider', providerId,
      ...(providerId === 'direct' ? ['--direct-provider', String(provider.directProvider || 'dashscope')] : []),
      '--prompt', tr('"<提示词>"'),
      '--image', tr('"<参考图.png>"'),
      '--size', '1:1',
    ].join(' ')
    const clipboard = navigator.clipboard
    if (!clipboard) { setMsg(command); return }
    void clipboard.writeText(command)
      .then(() => setMsg(tr('已复制命令：{p1}', { p1: command })))
      .catch(() => setMsg(command))
  }

  /** 拖拽：卡片拖到卡片 = 插到该位置（跨组自动改级）；拖到组容器 = 改级并追加组尾 */
  const drag = {    start: (e: DragEvent, id: string) => {
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
      setDirty(true)
      setProviders((list) => {
        if (!list) return list
        const moving = list.find((p) => p.id === from)
        const target = list.find((p) => p.id === targetId)
        if (!moving || !target) return list
        const moved = { ...moving, level: target.level as 1 | 2 | 3 }
        const rest = list.filter((p) => p.id !== from)
        const index = rest.findIndex((p) => p.id === targetId)
        const next = [...rest]
        next.splice(index, 0, moved)
        return next
      })
    },
    dropToGroup: (e: DragEvent, level: 1 | 2 | 3) => {
      e.preventDefault()
      setDragOverId(null)
      const from = dragId.current
      dragId.current = null
      if (!from) return
      setDirty(true)
      setProviders((list) => {
        if (!list) return list
        const moving = list.find((p) => p.id === from)
        if (!moving) return list
        const moved = { ...moving, level }
        const rest = list.filter((p) => p.id !== from)
        const groupItems = rest.filter((p) => p.kind === moved.kind && p.level === level)
        const last = groupItems[groupItems.length - 1]
        const index = last !== undefined
          ? rest.findIndex((p) => p.id === last.id) + 1
          : rest.findIndex((p) => p.kind === moved.kind && p.level > level)
        const next = [...rest]
        next.splice(index < 0 ? next.length : index, 0, moved)
        return next
      })
    },
    end: () => { dragId.current = null; setDragOverId(null) },
  }

  if (!providers) return h('div', { style: styles.loading }, msg || tr('加载中…'))

  const byLevel = (kind: ProviderKind, level: 1 | 2 | 3) => providers.filter((p) => p.kind === kind && p.level === level)
  const kindMeta: Array<{ kind: ProviderKind; title: string; desc: string; addLabel: string }> = [
    { kind: 'vision', title: tr('识图通道'), desc: tr('dsh-vision-skill 使用 · 主 → 备 → 兜底依次降级 · 欠费自动关停'), addLabel: tr('＋ 添加识图通道（选择供应商）') },
    { kind: 'gen', title: tr('生图通道'), desc: tr('img2img-studio 使用 · 保存后写入 GEN_PROVIDER_ORDER（脚本 providerId）决定 auto 链顺序'), addLabel: tr('＋ 添加生图通道（选择供应商）') },
  ]
  const enabledCount = providers.filter((p) => p.enabled).length
  const arrearsCount = providers.filter((p) => p.status === 'arrears').length
  const visionCount = providers.filter((p) => p.kind === 'vision').length
  const genCount = providers.filter((p) => p.kind === 'gen').length

  return h('div', {},
    // —— 常驻工具条 ——
    h('div', { style: styles.toolbar },
      h('div', { style: styles.stats },
        h('span', { style: styles.stat }, h('span', { style: { ...styles.dot, background: '#4f8fd0' } }), tr('识图 {p1}', { p1: visionCount })),
        h('span', { style: styles.stat }, h('span', { style: { ...styles.dot, background: '#8a6bd0' } }), tr('生图 {p1}', { p1: genCount })),
        h('span', { style: styles.stat }, h('span', { style: { ...styles.dot, background: '#3a9b5a' } }), tr('启用 {p1}', { p1: enabledCount })),
        arrearsCount ? h('span', { style: styles.stat }, h('span', { style: { ...styles.dot, background: '#d05050' } }), tr('欠费 {p1}', { p1: arrearsCount })) : null,
        dirty ? h('span', { style: styles.dirty }, tr('未保存')) : null,
      ),
      msg ? h('span', { style: styles.msg, title: msg }, msg) : null,
      h('button', { style: styles.btn, onClick: () => setPreviewOpen(true) }, tr('👁 预览 .env')),
      h('button', { style: styles.btn, disabled: probing, onClick: () => probe() }, probing ? tr('探测中…') : tr('🔍 探测全部余额')),
      h('button', {
        style: { ...styles.btnPrimary, ...(hostOk ? {} : { opacity: 0.55, cursor: 'not-allowed' }) },
        disabled: saving || !hostOk,
        title: hostOk ? tr('保存并同步两份 .env') : tr('宿主插件未重载：先重启 DSH 宿主'),
        onClick: save,
      }, saving ? tr('保存中…') : tr('保存配置')),
    ),
    hostOk
      ? null
      : h('div', { style: styles.banner },
          tr('宿主插件仍是旧版（浏览器端已更新）：新的 providerId 归一化 / .env 同步 / 保存校验都在宿主侧。'),
          tr('请重启 DSH 宿主后再保存；重启前可以点「预览 .env」查看计划，但「保存配置」已暂时禁用。')),

    // —— 两类通道 ——
    kindMeta.map((km) => h('div', { key: km.kind, style: styles.section },
      h('div', { style: styles.sectionHead },
        h('div', { style: { minWidth: 0 } },
          h('div', { style: styles.sectionTitle },
            h('span', { style: { ...styles.dot, background: km.kind === 'vision' ? '#4f8fd0' : '#8a6bd0' } }),
            km.title,
          ),
          h('div', { style: styles.sectionSub }, km.desc),
        ),
        h('div', { style: styles.sectionActions },
          h('button', { style: styles.btnGhost, onClick: () => setAllOpen(km.kind, true) }, tr('展开全部')),
          h('button', { style: styles.btnGhost, onClick: () => setAllOpen(km.kind, false) }, tr('收起全部')),
        ),
      ),
      h('div', { style: styles.sectionBody },
        [1, 2, 3].map((lv) => h(LevelGroup, {
          key: lv,
          level: lv as 1 | 2 | 3,
          items: byLevel(km.kind, lv as 1 | 2 | 3),
          collapsed: isGroupCollapsed(km.kind, lv as 1 | 2 | 3),
          onToggleCollapsed: () => toggleGroup(km.kind, lv as 1 | 2 | 3),
          patch,
          remove,
          move,
          drag,
          dragOverId,
          isOpen,
          toggleOpen,
          onTest: (id: string) => probe(id),
          onTry: (id: string) => { const target = providers.find((p) => p.id === id); if (target) setTryTarget(target) },
          onCopyCommand: copyCommand,
        })),
        h(AddCardButton, { label: km.addLabel, onClick: () => setPickerKind(km.kind) }),
      ),
    )),

    // —— ChatGPT 网页账号额度 ——
    h(UsagePanel, {
      isOpen: (id: string) => ui[`acc:${id}`] === true,
      toggleOpen: (id: string) => setUi((state) => ({ ...state, [`acc:${id}`]: state[`acc:${id}`] !== true })),
      expand: (id: string) => setUi((state) => ({ ...state, [`acc:${id}`]: true })),
      setAllOpen: (ids: string[], next: boolean) =>
        setUi((state) => {
          const copy = { ...state }
          for (const id of ids) {
            if (next) copy[`acc:${id}`] = true
            else delete copy[`acc:${id}`]
          }
          return copy
        }),
      onAccountsChanged: refreshAfterAccountChange,
    }),

    h('div', { style: styles.footerHint },
      tr('「保存配置」会把通道按等级/顺序换算成 .env：GEN_PROVIDER_ORDER 用脚本 providerId（重复供应商自动去重），') +
      tr('各 provider 的 key / model / base 写对应变量，识图侧写 VISION_PROVIDERS + 主通道的 VISION_API_KEY。') +
      tr('面板管过、后被删掉或停用的通道才会清 env；面板从没管过的 key 保持原值（手写配置不再被误删）。') +
      tr('「预览 .env」用与宿主完全相同的 planSync()；新配置在技能新会话生效。'),
    ),

    pickerKind
      ? h(ProviderPicker, {
          kind: pickerKind,
          providers,
          onClose: () => setPickerKind(null),
          onAdd: (entry, level) => {
            addChannel(entry, pickerKind, level)
            setPickerKind(null)
          },
        })
      : null,
    previewOpen
      ? h(PreviewDialog, {
          providers,
          previous: baseline.current,
          hostOk,
          onClose: () => setPreviewOpen(false),
        })
      : null,
    tryTarget
      ? h(TryDialog, {
          provider: tryTarget,
          onClose: () => setTryTarget(null),
        })
      : null,
  )
}

/* ================= ChatGPT 网页账号库 ================= */

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

const PLAN_COLOR: Record<ChatGptPlan, string> = {
  free: '#777',
  plus: '#3a9b5a',
  '5x': '#d08a2e',
  '20x': '#8a6bd0',
}

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

function AccountRow({ a, tiers, open, onToggleOpen, onPatch, onAction, onProbe, onAuth, onCodexAuth }: {
  a: AccountStatus
  tiers: TierInfo[]
  open: boolean
  onToggleOpen: () => void
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
      ? tr('✅ {p1} 探测 · 档位 {p2} · 扫过 {p3} 个会话', { p1: fmtTime(a.lastProbeAt), p2: a.detectedPlanType ?? '?', p3: a.scanned ?? 0 }) +
        (a.generatedTimes.length ? tr(' · 出图: {p1}', { p1: a.generatedTimes.join(' / ') }) : tr(' · 窗口内无出图'))
      : a.hasToken ? tr('凭据已保存，点「探测」拉取额度') : tr('未填凭据')
  const cu = a.codexUsage
  const hWin = (w: { usedPercent: number; windowSeconds: number; resetAt: number } | undefined): string => w
    ? tr('{p1}%（{p2}h 窗口，重置 {p3}）', { p1: w.usedPercent, p2: Math.round(w.windowSeconds / 3600), p3: fmtTime(w.resetAt) })
    : ''
  return h('div', { style: { ...styles.card, margin: '6px 0' } },
    // 收起态：账号 / 套餐 / 用量 / 状态
    h('div', { style: styles.cardHead, onClick: onToggleOpen },
      h(Chevron, { open }),
      h('span', { style: { ...styles.avatar, background: PLAN_COLOR[a.plan] + 'cc' } }, a.label.trim().slice(0, 1).toUpperCase() || 'G'),
      h('div', { style: styles.identity },
        h('div', { style: styles.nameRow },
          h('span', { style: styles.name, title: a.label }, a.label),
          h('span', { style: { ...styles.statusTag, color: PLAN_COLOR[a.plan], background: PLAN_COLOR[a.plan] + '18' } }, tr(a.planLabel)),
        ),
        h('div', { style: styles.summaryRow },
          h('span', { style: { color: exhausted ? '#d05050' : 'var(--dsw-alias-label-tertiary, #888)' } },
            a.limitEnforced
              ? tr('已用 {p1} / {p2} 张（{p3}h 滚动{p4}）', { p1: a.used, p2: a.limit, p3: a.windowHours, p4: a.autoProbe ? tr(' · 自动') : '' })
              : tr('已用 {p1} 张（免费版不计额度）', { p1: a.used })),
          h('span', { style: styles.sep }, '·'),
          h('span', { style: { color: a.hasToken ? '#3a9b5a' : '#777' } }, a.hasToken ? (a.codexAuth ? tr('Codex 登录态') : tr('凭据已保存')) : tr('未填凭据')),
          a.lastProbeError ? h('span', { style: { ...styles.statusTag, color: '#d05050', background: '#d0505018' } }, tr('探测失败')) : null,
        ),
      ),
      a.email
        ? h('span', {
          style: { fontSize: 10.5, color: 'var(--dsw-alias-label-tertiary, #888)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
          title: a.email,
        }, a.email)
        : null,
    ),
    // 展开态：完整账号编辑 / 额度 / 凭据
    open
      ? h('div', { style: styles.cardBody },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const } },
          h('input', {
            style: { ...styles.input, width: 150, flexShrink: 0 },
            value: label,
            title: tr('账号备注名（用于区分多个 ChatGPT 账号）'),
            onChange: (e: { target: { value: string } }) => setLabel(e.target.value),
            onBlur: () => { if (label.trim() && label.trim() !== a.label) onPatch({ label: label.trim() }) },
          }),
          h('select', {
            style: { ...styles.levelSelect, flexShrink: 0 },
            value: a.plan,
            title: tr('账号套餐：免费 / Plus / 5x(Pro) / 20x(Business)'),
            onChange: (e: { target: { value: string } }) => onPatch({ plan: e.target.value }),
          }, tiers.map((t) => h('option', { key: t.plan, value: t.plan }, tr(t.label)))),
          h('input', {
            style: { ...styles.input, width: 92, flexShrink: 0 },
            value: limit,
            placeholder: tr('额度 {p1}', { p1: tiers.find((t) => t.plan === a.plan)?.defaultLimit ?? '' }),
            title: tr('窗口额度上限（留空 = 跟随套餐默认值）'),
            onChange: (e: { target: { value: string } }) => setLimit(e.target.value),
            onBlur: commitLimit,
          }),
          h('span', { style: { flex: 1, minWidth: 8 } }),
          h('button', { style: styles.del, title: tr('删除该账号'), onClick: () => onAction('remove') }, '×'),
        ),
        h('div', { style: { ...styles.hint, marginTop: 6 } },
          a.limitEnforced
            ? (exhausted ? tr('⚠️ 已达到窗口额度，等待窗口刷新；用尽时会自动切换下一通道') : a.resetAt ? tr('下次重置：{p1}', { p1: a.resetAt }) : '')
            : tr('免费版只统计用量、不按本地额度卡；真正没额度时由调用方自动切换通道')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const } },
          h('button', { style: styles.btnArrow, onClick: () => onAction('log') }, tr('登记 1 张')),
          h('button', { style: styles.btnArrow, onClick: () => onAction('reset') }, tr('重置窗口')),
          h('button', {
            style: { ...styles.btnArrow, ...(a.autoProbe ? { borderColor: 'var(--dsw-alias-button-info-fill, #4f6ef7)', color: 'var(--dsw-alias-label-primary, #eee)' } : {}) },
            title: tr('自动探测：用 ChatGPT 后端接口统计窗口内出图，代替手动登记'),
            onClick: () => onPatch({ autoProbe: !a.autoProbe }),
          }, a.autoProbe ? tr('自动探测：开') : tr('自动探测：关')),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const } },
          h('input', {
            style: { ...styles.input, flex: 1, minWidth: 180 },
            type: 'password',
            value: token,
            placeholder: a.hasToken && !a.codexAuth ? tr('凭据已保存（粘贴新 token 可替换）') : tr('粘贴 __Secure-next-auth.session-token'),
            title: tr('ChatGPT 网页登录态：DevTools → Application → Cookies → __Secure-next-auth.session-token'),
            onChange: (e: { target: { value: string } }) => setToken(e.target.value),
          }),
          h('button', { style: styles.btnArrow, disabled: !token.trim(), onClick: saveToken }, tr('保存凭据')),
          h('button', {
            style: { ...styles.btnArrow, ...(a.codexAuth ? { borderColor: 'var(--dsw-alias-button-info-fill, #4f6ef7)', color: 'var(--dsw-alias-label-primary, #eee)' } : {}) },
            title: tr('直接读取运行中的 Codex 客户端登录态（~/.codex/auth.json），令牌由客户端自动刷新'),
            onClick: onCodexAuth,
          }, a.codexAuth ? tr('Codex 登录态 ✓') : tr('读取 Codex 登录态')),
          a.hasToken ? h('button', { style: styles.btnArrow, onClick: () => onAuth('') }, tr('清除凭据')) : null,
        ),
        h('div', { style: { ...styles.hint, marginTop: 6 } },
          tr('这个账号会自动投影成生图通道 chatgpt-web@…（在「生图通道」里显示）：改备注/套餐会同步通道名，登录态只存账号库一份；删账号会连带删通道。')),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' as const } },
          h('button', { style: styles.btn, disabled: probing || !a.hasToken, onClick: probe }, probing ? tr('探测中…') : tr('🔍 探测额度')),
          h('span', { style: { ...styles.hint, flex: 1, minWidth: 180 } }, status),
        ),
        cu && (cu.primary || cu.secondary)
          ? h('div', { style: { ...styles.hint, marginTop: 4 } },
            tr('Codex 用量（{p1}{p2}）', { p1: cu.planType ?? a.detectedPlanType ?? '?', p2: cu.email ? ' · ' + cu.email : '' }) +
            (cu.primary ? tr(' · 主窗口 {p1}', { p1: hWin(cu.primary) }) : '') +
            (cu.secondary ? tr(' · 周窗口 {p1}', { p1: hWin(cu.secondary) }) : ''))
          : null,
        h('div', { style: { ...styles.hint, marginTop: 4 } },
          `${tr(a.planLabel)} · ${tr(a.rule)}` + (a.limitOverridden ? tr('（额度已手动覆盖）') : '') + (a.planSource === 'manual' ? tr('（档位手动锁定）') : '')),
      )
      : null,
  )
}

interface UsagePanelProps {
  isOpen: (id: string) => boolean
  toggleOpen: (id: string) => void
  expand: (id: string) => void
  setAllOpen: (ids: string[], open: boolean) => void
  /** 账号变动后让父面板重新拉 providers（账号库是 chatgpt-web 通道的真源）。 */
  onAccountsChanged?: () => void
}

function UsagePanel({ isOpen, toggleOpen, expand, setAllOpen, onAccountsChanged }: UsagePanelProps) {
  const [u, setU] = useState<UsageState | null>(null)
  const [msg, setMsg] = useState('')
  const [proxy, setProxy] = useState('')
  const refreshChannels = () => onAccountsChanged?.()
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
        if (stale.length) setMsg(tr('已自动探测 ') + stale.length + tr(' 个账号'))
      } catch { setU(null) }
    })()
  }, [])
  const apply = (next: UsageState | null, ok: string) => {
    if (!next || !Array.isArray(next.accounts)) { setMsg(tr('操作失败')); return }
    setU(next)
    if (typeof next.proxy === 'string') setProxy(next.proxy)
    setMsg(ok)
  }
  const patch = (id: string, body: Record<string, unknown>) => {
    void (async () => {
      apply(await usageRequest({ action: 'update', id, ...body }), tr('已保存'))
      refreshChannels()
    })()
  }
  const action = (id: string, act: string) => {
    void (async () => {
      const labels: Record<string, string> = { log: tr('已登记 1 张'), reset: tr('已重置窗口'), remove: tr('已删除账号') }
      apply(await usageRequest({ action: act, id }), labels[act] ?? tr('完成'))
      if (act === 'remove' || act === 'auth') refreshChannels()
    })()
  }
  const probe = (id: string) => {
    void (async () => apply(await usageRequest({ action: 'probe', id }), tr('探测完成')))()
  }
  const auth = (id: string, sessionToken: string) => {
    void (async () => {
      apply(await usageRequest({ action: 'auth', id, sessionToken }), sessionToken ? tr('凭据已保存') : tr('凭据已清除'))
      refreshChannels()
    })()
  }
  const codexAuth = (id: string) => {
    void (async () => {
      apply(await usageRequest({ action: 'authCodex', id }), tr('已读取 Codex 客户端登录态'))
      refreshChannels()
    })()
  }
  const add = () => {
    void (async () => {
      const next = await usageRequest({ action: 'add', label: tr('ChatGPT 账号 {p1}', { p1: (u?.accounts.length ?? 0) + 1 }), plan: 'free' })
      apply(next, tr('已添加账号'))
      const created = next?.accounts[next.accounts.length - 1]
      if (created) expand(created.id)
      refreshChannels()
    })()
  }
  const addCodex = () => {
    void (async () => {
      const added = await usageRequest({ action: 'add', label: tr('Codex 客户端账号'), plan: 'free' })
      if (!added?.accounts) { apply(added, tr('操作失败')); return }
      const created = added.accounts[added.accounts.length - 1]!
      apply(await usageRequest({ action: 'authCodex', id: created.id }), tr('已从 Codex 客户端添加账号'))
      expand(created.id)
      refreshChannels()
    })()
  }
  const saveProxy = () => {
    void (async () => apply(await usageRequest({ action: 'settings', proxy }), tr('代理已保存')))()
  }
  if (!u) return null
  const tiers = u.tiers ?? []
  const totalUsed = u.accounts.reduce((sum, a) => sum + a.used, 0)
  return h('div', { style: styles.section },
    h('div', { style: styles.sectionHead },
      h('div', { style: { minWidth: 0 } },
        h('div', { style: styles.sectionTitle },
          h('span', { style: { ...styles.dot, background: '#3a9b5a' } }),
          tr('ChatGPT 网页出图账号'),
          h('span', { style: styles.groupCount }, tr('{p1} 个账号', { p1: u.accounts.length })),
        ),
        h('div', { style: styles.sectionSub },
          tr('多账号额度库 · 24h 滚动窗口 · 窗口内已出图 {p1} 张 · 点账号展开凭据与额度设置', { p1: totalUsed })),
      ),
      h('div', { style: styles.sectionActions },
        h('button', { style: styles.btnGhost, onClick: () => setAllOpen(u.accounts.map((a) => a.id), true) }, tr('展开全部')),
        h('button', { style: styles.btnGhost, onClick: () => setAllOpen(u.accounts.map((a) => a.id), false) }, tr('收起全部')),
      ),
    ),
    h('div', { style: styles.sectionBody },
      u.accounts.length === 0
        ? h('div', { style: styles.groupEmpty }, tr('还没有账号，点下方添加'))
        : u.accounts.map((a) => h(AccountRow, {
          key: a.id,
          a,
          tiers,
          open: isOpen(a.id),
          onToggleOpen: () => toggleOpen(a.id),
          onPatch: (body) => patch(a.id, body),
          onAction: (act) => action(a.id, act),
          onProbe: () => probe(a.id),
          onAuth: (token) => auth(a.id, token),
          onCodexAuth: () => codexAuth(a.id),
        })),
      h('div', { style: { display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' as const } },
        h(AddCardButton, { label: tr('＋ 添加 ChatGPT 账号'), onClick: add, block: false }),
        h(AddCardButton, { label: tr('＋ 从 Codex 客户端添加账号'), onClick: addCodex, block: false }),
      ),
      msg ? h('span', { style: { ...styles.msg, display: 'block', marginTop: 6 } }, msg) : null,
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' as const } },
        h('input', {
          style: { ...styles.input, width: 220 },
          value: proxy,
          placeholder: u.proxyEffective ? tr('自动：{p1}', { p1: u.proxyEffective }) : tr('留空 = 自动读系统代理'),
          title: tr('ChatGPT 探测用代理（Node 不读系统代理，留空则自动读取 Windows 系统代理）'),
          onChange: (e: { target: { value: string } }) => setProxy(e.target.value),
        }),
        h('button', { style: styles.btnArrow, onClick: saveProxy }, tr('保存代理')),
        h('span', { style: { ...styles.hint, marginLeft: 2 } }, u.proxyEffective ? tr('当前生效：{p1}', { p1: u.proxyEffective }) : tr('当前直连（若探测报 fetch 失败，请填代理）')),
      ),
      h('div', { style: { ...styles.hint, marginTop: 6 } },
        tr('套餐默认额度：') + tiers.map((t) => `${tr(t.label)} ${t.defaultLimit}`).join(' / ') +
        tr('（24h 滚动窗口，可在每行展开后直接改数字；自动探测按 ChatGPT 后端返回的实际出图时刻统计）')),
    ),
  )
}

/* ================= 注册 ================= */

/**
 * Register the Settings → 「识图与生图」 section.
 * @param ctx - client root context (the same one the editor dock receives).
 */
export function registerConfigPanel(ctx: ClientContext): void {
  ctx.effect(() => {
    ctx.locale.register(NS, { zh: panelZh, en: panelEn })
    const t = ctx.locale.bind(NS)
    // 面板正文统一走 tr()：zh 显示中文原文，en 走 panel-locales.ts 的英文词典
    setTranslator((key, params) => t(key, params))
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'img2img-config',
      order: 60,
      label: () => t('识图与生图'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(ConfigPanel)))
  }, 'dsh-img2img-config: settings section')
}
