/**
 * dsh-img2img-config host entry — the img2img-studio skill's plugin.
 *
 * One package, two browser surfaces, one host half:
 *  - `./client` renders the composer image editor (dock entry) *and* the
 *    Settings → 「识图与生图」 panel. Neither needs a host service, so the
 *    editor contributes nothing here.
 *  - This entry owns what the panel talks to: the provider store and the HTTP
 *    routes behind `/dsh-img2img-config/*` — multi-provider management with
 *    three priority levels (main / backup / fallback), manual switches,
 *    drag ordering, and auto-disable on arrears — plus the ChatGPT web-account
 *    and Codex usage probes.
 *
 * The panel configures BOTH halves of the toolchain: 识图 (dsh-vision-skill)
 * and 生图 (this skill). Saving writes each provider back to the matching
 * skill's `scripts/.env`, so the skill's own scripts pick the settings up with
 * no extra step.
 *
 * 配置持久化: ~/.dsh/dsh-img2img-config/providers.json（含 ChatGPT 账号库），
 * 保存时同步两个 skill 的 .env。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readEnv, skillEnvPath, writeEnv, type EnvMap } from './env.js'
import {
  HOST_PROTOCOL_VERSION,
  accountChannelMatches,
  catalogEntry,
  catalogModels,
  envUpdates,
  isMaskedValue,
  isManagedProvider,
  normalizeProviderId,
  planAccountChannels,
  planSync,
  providerIdOf,
  validateProviders,
  type AccountLike,
  type ProviderItem,
  type ProviderKind,
  type ProviderStatus,
} from './catalog.js'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'

export const name = 'dsh-img2img-config'

/**
 * 老包名（dsh-vision-config）的数据目录。本插件从那个包合并过来，首次启动时
 * 把旧目录整体搬过来，老用户不丢已配好的供应商 / ChatGPT 账号 / 额度窗口。
 */
const LEGACY_STORE_DIR = join(homedir(), '.dsh', 'dsh-vision-config')
let storeMigrated = false

/** 一次性把旧包的数据目录搬到本包名下（只搬一次，旧目录保留不删）。 */
function migrateLegacyStore(): void {
  if (storeMigrated) return
  storeMigrated = true
  try {
    const target = join(homedir(), '.dsh', 'dsh-img2img-config')
    if (existsSync(target) || !existsSync(LEGACY_STORE_DIR)) return
    cpSync(LEGACY_STORE_DIR, target, { recursive: true })
  } catch (error) {
    console.warn('[dsh-img2img-config] 迁移旧数据目录失败（不影响使用）:', error)
  }
}

/* ================= 供应商存储（目录与同步逻辑见 ./catalog.ts） ================= */

export type { ProviderItem, ProviderKind, ProviderStatus } from './catalog.js'
export { HOST_PROTOCOL_VERSION } from './catalog.js'

interface SeedChannel {
  providerId: string
  kind: ProviderKind
  level: 1 | 2 | 3
  enabled: boolean
}

/**
 * 首次运行种下的默认通道（沿用旧版七条模板的等级/开关，但 Qoder 已修正成
 * 脚本真正认的 provider id `qoder`，不再是死 id `qoder-gen`）。
 * 已有 providers.json 的用户不受影响。
 */
const SEED_CHANNELS: SeedChannel[] = [
  { providerId: 'dashscope', kind: 'vision', level: 1, enabled: true },
  { providerId: 'qoder-cli', kind: 'vision', level: 2, enabled: true },
  { providerId: 'openai', kind: 'vision', level: 3, enabled: false },
  { providerId: 'zai', kind: 'vision', level: 3, enabled: false },
  { providerId: 'seedream', kind: 'gen', level: 2, enabled: false },
  { providerId: 'minimax', kind: 'gen', level: 3, enabled: false },
  { providerId: 'qoder', kind: 'gen', level: 2, enabled: true },
]

function providersFile(): string {
  return join(homedir(), '.dsh', 'dsh-img2img-config', 'providers.json')
}

function readProviders(): ProviderItem[] {
  try {
    if (existsSync(providersFile())) {
      const arr = JSON.parse(readFileSync(providersFile(), 'utf8')) as ProviderItem[]
      if (Array.isArray(arr)) return arr
    }
  } catch {}
  return []
}

function writeProviders(list: ProviderItem[]): void {
  mkdirSync(join(homedir(), '.dsh', 'dsh-img2img-config'), { recursive: true })
  writeFileSync(providersFile(), JSON.stringify(list, null, 2), 'utf8')
}

/** 旧数据补 providerId（只在内存里补，保存时自然写回）。 */
function withProviderIds(list: ProviderItem[]): ProviderItem[] {
  return list.map((item) => ({ ...item, providerId: providerIdOf(item) }))
}

/** 首次初始化：目录默认值 + 从现有 .env 导入已配置的 key/模型。 */
function seedFromEnv(): ProviderItem[] {
  const vision = readEnv(skillEnvPath('vision'))
  const gen = readEnv(skillEnvPath('gen'))
  const keyFor: Record<string, string> = {
    dashscope: vision.VISION_API_KEY || vision.DASHSCOPE_API_KEY || gen.DASHSCOPE_API_KEY || '',
    openai: vision.OPENAI_API_KEY || gen.IMG_API_KEY || '',
    zai: gen.ZAI_API_KEY || vision.ZAI_API_KEY || '',
    seedream: gen.ARK_API_KEY || '',
    minimax: gen.MINIMAX_API_KEY || '',
  }
  const visionModelFor: Record<string, string> = {
    dashscope: vision.VISION_MODEL || '',
    openai: vision.OPENAI_MODEL || '',
  }
  return SEED_CHANNELS.map((seed) => {
    const entry = catalogEntry(seed.providerId)
    const envBase = entry?.env?.base ? gen[entry.env.base] ?? '' : ''
    const envModel = entry?.env?.model ? gen[entry.env.model] ?? '' : ''
    const model =
      seed.kind === 'vision'
        ? visionModelFor[seed.providerId] || catalogModels(seed.providerId, 'vision')[0] || ''
        : envModel || catalogModels(seed.providerId, 'gen')[0] || ''
    return {
      id: seed.providerId,
      providerId: seed.providerId,
      name: entry?.name ?? seed.providerId,
      kind: seed.kind,
      level: seed.level,
      enabled: seed.enabled,
      apiKey: keyFor[seed.providerId] || '',
      model,
      base: envBase || entry?.base || '',
      ...(seed.providerId === 'direct' ? { directProvider: 'dashscope' } : {}),
      status: 'unknown' as ProviderStatus,
      lastChecked: null,
    }
  })
}

/** 首次运行：用目录默认值初始化（已存在则只补 providerId，不写盘）。 */
function ensureProviders(): ProviderItem[] {
  migrateLegacyStore()
  const list = readProviders()
  if (list.length) return withProviderIds(list)
  const seed = seedFromEnv()
  writeProviders(seed)
  return seed
}

/* ================= .env 同步 ================= */

function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return value.slice(0, 4) + '••••' + value.slice(-4)
}

function isMasked(v: string): boolean {
  return isMaskedValue(v)
}

/**
 * 把 providers 同步到 .env（vision + gen）。
 *
 * 真正的「哪些键写入/删除/保持」由 catalog.ts 的 planSync() 决定
 * （同一份计划也用于面板的保存前预览）：
 *  - 面板管理过、现在删掉或全部停用的供应商 → 删除其 env 行；
 *  - 面板从来没管过的供应商 → 保持原值，避免抹掉手写配置。
 */
/** 导出给离线回归测试（scripts/verify-catalog.mjs）使用。 */
export function syncEnv(list: ProviderItem[], previous: ProviderItem[] = []): void {
  const plan = planSync(list, previous)
  const visionUpdates = envUpdates(plan.vision.rows) as EnvMap
  const genUpdates = envUpdates(plan.gen.rows) as EnvMap
  if (Object.keys(visionUpdates).length > 0) writeEnv(skillEnvPath('vision'), visionUpdates)
  if (Object.keys(genUpdates).length > 0) writeEnv(skillEnvPath('gen'), genUpdates)
}

/* ================= 探测 / 测试 / 试跑 / 脚本扫描 ================= */

const execFileAsync = promisify(execFile)

/** 结构化错误码里的额度/欠费信号（不拿正文裸文本当依据）。 */
const BILLING_CODE_RE = /insufficient[_-]?quota|quota[_-]?exceeded|billing[_-]?(?:hard|soft)?[_-]?limit|arrearage|arrears|payment[_-]?required|balance[_-]?(?:insufficient|low)|欠费|额度(?:已)?(?:用尽|耗尽)|余额不足/i
/** 只在 402/429 且正文明确说额度/欠费时才采信正文（避免 5xx 正文偶然词误判）。 */
const BILLING_MESSAGE_RE = /insufficient (?:quota|balance|credits?)|quota (?:exceeded|exhausted)|out of (?:image )?(?:quota|credits)|exceeded (?:your )?(?:current )?quota|额度|欠费|余额不足|充值|达到(?:了)?(?:本次)?(?:上限|限制)/i
const CODEX_AUTH_FILE = join(homedir(), '.codex', 'auth.json')

/** 生图/识图脚本路径（与 .env 同目录，DSH_SKILLS_DIR 可覆盖）。 */
function genScriptPath(): string {
  return join(dirname(skillEnvPath('gen')), 'generate_image.mjs')
}
function visionScriptPath(): string {
  return join(dirname(skillEnvPath('vision')), 'vision.js')
}

function qoderBundleFile(): string {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  return join(appData, 'npm', 'node_modules', '@qodercn-ai', 'qoderclicn', 'bundle', 'qoderclicn.js')
}

/** 与 generate_image.mjs 同口径的 bun 探测（Windows 上 npm 只有 .cmd shim，直接找 bun.exe）。 */
function bunBinary(): string | null {
  if (process.env.BUN_BINARY && existsSync(process.env.BUN_BINARY)) return process.env.BUN_BINARY
  const executable = process.platform === 'win32' ? 'bun.exe' : 'bun'
  const candidates = [
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'bun', 'bin', executable),
    join(homedir(), '.bun', 'bin', executable),
    ...String(process.env.PATH ?? process.env.Path ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((dir) => join(dir, executable)),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function directEngineDir(): string {
  return join(dirname(skillEnvPath('gen')), '..', 'engines', 'direct-api')
}

/** ChatGPT 网页通道的凭据来自账号库；返回账号说明（探测/测试共用）。 */
function chatgptChannelCredential(providerId: string): { hasToken: boolean; detail: string } {
  const suffix = providerId.slice('chatgpt-web@'.length)
  const store = readStoreIfExists()
  const account = store?.accounts.find((item) =>
    accountChannelMatches(
      { id: item.id, label: item.label, ...(item.auth?.accountId ? { accountId: item.auth.accountId } : {}) },
      suffix,
    ),
  )
  if (!account) return { hasToken: false, detail: `账号库里找不到 ${providerId} 对应账号（可能已删除）` }
  const hasToken = Boolean(account.auth?.sessionToken || account.auth?.accessToken)
  return {
    hasToken,
    detail: hasToken
      ? `${account.label}：登录态已在账号库（session token）`
      : `${account.label}：没有 session token（在下方账号库粘贴）`,
  }
}

/** 探测结果（导出给离线回归测试 scripts/verify-http.mjs）。 */
export interface ProbeResult {
  status: ProviderStatus
  detail: string
}

/**
 * 从一次 HTTP 探测响应判断通道状态。
 *
 * 欠费只在三种证据下判定：HTTP 402、结构化错误码（`insufficient_quota` 等）、
 * 或 429 且正文明确说额度/欠费。超时、5xx、普通 429 限流一律是 `error`——
 * 网络抖动不能把主通道自动关停。
 * @param status - HTTP 状态码。
 * @param bodyText - 响应正文原始文本（可能是 JSON、纯文本或空）。
 * @returns 探测状态与中文说明（诊断文本，不参与面板 i18n）。
 */
export function classifyHttpProbe(status: number, bodyText: string): ProbeResult {
  const text = String(bodyText ?? '').trim()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch { /* 非 JSON 响应：只按状态码分类 */ }
  const body = (raw ?? {}) as {
    error?: { message?: unknown; code?: unknown; type?: unknown }
    message?: unknown
    code?: unknown
    type?: unknown
  }
  const message = String(body.error?.message ?? body.message ?? text).replace(/\s+/g, ' ').trim().slice(0, 140)
  const codeText = [body.error?.code, body.error?.type, body.code, body.type]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  const billingCode = BILLING_CODE_RE.test(codeText)
  // 正文只在「可能表示额度」的 402/429 上采信；5xx 正文里出现 balance/credit 不算欠费。
  const billingMessage = (status === 402 || status === 429) && BILLING_MESSAGE_RE.test(`${codeText} ${message}`)

  if (status >= 200 && status < 300) return { status: 'ok', detail: `GET /models HTTP ${status}` }
  if (status === 402) return { status: 'arrears', detail: `额度/欠费（HTTP 402）${message ? `：${message}` : ''}` }
  if (status === 401 || status === 403) return { status: 'error', detail: `Key 无效或无权限（HTTP ${status}）` }
  if (status === 404 || status === 405) {
    return { status: 'unknown', detail: `端点可达但没有 /models（HTTP ${status}）；请用「试跑」验证` }
  }
  if (billingCode || billingMessage) {
    return { status: 'arrears', detail: `额度/欠费（HTTP ${status}）${message ? `：${message}` : ''}` }
  }
  if (status === 429) return { status: 'error', detail: `限流（HTTP 429），稍后重试${message ? `：${message}` : ''}` }
  if (status >= 500) return { status: 'error', detail: `服务端错误（HTTP ${status}）${message ? `：${message}` : ''}` }
  return { status: 'error', detail: `HTTP ${status}${message ? `：${message}` : ''}` }
}

/**
 * 单通道探测（不花钱）：
 *  - 托管/登录态通道：查本机依赖（qoderclicn / codex auth / bun + 引擎）或账号库凭据；
 *  - API 通道：GET {base}/models，区分「正常 / Key 无效 / 欠费 / 端点无 /models / 不可达」，
 *    不再把所有非 200 一律标成「探测失败」。
 */
async function probeOne(p: ProviderItem): Promise<ProbeResult> {
  const providerId = providerIdOf(p)

  if (providerId.startsWith('chatgpt-web@')) {
    const credential = chatgptChannelCredential(providerId)
    return { status: 'cli', detail: credential.detail }
  }
  if (providerId === 'qoder' || providerId === 'qoder-cli' || p.base === 'qoderclicn') {
    return {
      status: 'cli',
      detail: existsSync(qoderBundleFile())
        ? '已检测到 qoderclicn（需已登录）'
        : '未检测到 qoderclicn：npm i -g @qodercn-ai/qoderclicn 并 login',
    }
  }
  if (providerId === 'codex-cli' || p.base === 'codex-cli') {
    return {
      status: 'cli',
      detail: existsSync(CODEX_AUTH_FILE)
        ? '已检测到 ~/.codex/auth.json 登录态'
        : '未检测到 ~/.codex/auth.json（先在 Codex 客户端登录）',
    }
  }
  if (providerId === 'direct') {
    const engine = existsSync(directEngineDir())
    const bun = bunBinary()
    return {
      status: 'cli',
      detail: !engine
        ? '缺少 engines/direct-api（仓库未完整检出）'
        : !bun
          ? '已找到直连引擎，但未检测到 bun'
          : '直连引擎与 bun 已就绪',
    }
  }
  if (isManagedProvider(providerId)) return { status: 'cli', detail: '登录态通道，无需 HTTP 探测' }
  if (!p.base) return { status: 'unknown', detail: '缺少 Base URL' }
  if (!p.apiKey || isMasked(p.apiKey)) return { status: 'unknown', detail: '缺少 API Key' }

  const url = `${String(p.base).replace(/\/?$/, '')}/models`
  const started = Date.now()
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${p.apiKey}` },
      signal: AbortSignal.timeout(12000),
    })
    const ms = Date.now() - started
    const probe = classifyHttpProbe(res.status, await res.text())
    return probe.status === 'ok' ? { status: 'ok', detail: `GET /models HTTP 200 · ${ms}ms` } : probe
  } catch (error) {
    return { status: 'error', detail: `不可达或超时：${(error as Error).message.slice(0, 140)}` }
  }
}

/** 探测全部（或单个）；arrears 自动关停（enabled=false）并持久化。 */
async function probeAll(list: ProviderItem[], onlyId?: string): Promise<ProviderItem[]> {
  const targets = onlyId ? list.filter((p) => p.id === onlyId) : list
  const results = await Promise.all(
    targets.map(async (p) => {
      const probe = await probeOne(p)
      return {
        id: p.id,
        status: probe.status,
        detail: probe.detail,
        enabled: probe.status === 'arrears' ? false : p.enabled,
        lastChecked: Date.now(),
      }
    }),
  )
  const merged = list.map((p) => {
    const result = results.find((item) => item.id === p.id)
    return result ? { ...p, ...result } : p
  })
  writeProviders(merged)
  syncEnv(merged)
  return merged
}

/** 跑 `<skill script> --list-providers`，返回脚本真实识别的 provider 列表。 */
async function scanScriptProviders(kind: 'gen' | 'vision'): Promise<{ ok: boolean; providers?: unknown[]; error?: string }> {
  const script = kind === 'gen' ? genScriptPath() : visionScriptPath()
  if (!existsSync(script)) return { ok: false, error: `未找到脚本：${script}` }
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, '--list-providers'], {
      cwd: dirname(script),
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
      env: process.env,
    })
    const start = stdout.indexOf('{')
    const end = stdout.lastIndexOf('}')
    if (start < 0 || end <= start) return { ok: false, error: '脚本输出不是 JSON' }
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as { providers?: unknown[] }
    return { ok: true, providers: Array.isArray(parsed.providers) ? parsed.providers : [] }
  } catch (error) {
    const err = error as { message?: string }
    return { ok: false, error: String(err.message ?? '脚本执行失败').split('\n')[0] }
  }
}

interface TryResult {
  ok: boolean
  provider?: string
  model?: string
  files?: string[]
  ms?: number
  error?: string
}

/**
 * 真实试跑一张 1:1 低质量图（会消耗额度，必须由用户明确确认后调用）。
 * 走的是技能自己的 generate_image.mjs，参数与 agent 出图完全一致，所以测到的就是实际链路。
 */
async function runTry(provider: ProviderItem): Promise<TryResult> {
  const script = genScriptPath()
  if (!existsSync(script)) return { ok: false, error: `未找到生成脚本：${script}` }
  const providerId = providerIdOf(provider)
  const outDir = join(tmpdir(), 'dsh-img2img-selftest')
  mkdirSync(outDir, { recursive: true })
  const args = [
    script,
    '--provider', providerId,
    '--prompt', '通道自检：一张干净的蓝紫渐变测试图，无文字',
    '--size', '1024x1024',
    '--quality', 'normal',
    '--output-dir', outDir,
    '--json',
  ]
  if (providerId === 'direct') args.push('--direct-provider', String(provider.directProvider || 'dashscope'))
  const started = Date.now()
  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: dirname(script),
      timeout: 240000,
      maxBuffer: 32 * 1024 * 1024,
      env: process.env,
    })
    const start = stdout.indexOf('{')
    const end = stdout.lastIndexOf('}')
    const parsed = start >= 0 && end > start
      ? (JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>)
      : {}
    if (parsed.ok === false) {
      const errors = Array.isArray(parsed.errors) ? parsed.errors : []
      const text = errors
        .map((item) => `${String((item as { provider?: string }).provider ?? '?')}: ${String((item as { error?: string }).error ?? '')}`)
        .join('; ')
      return { ok: false, error: (text || '脚本返回失败').slice(0, 400) }
    }
    const files = Array.isArray(parsed.files) ? parsed.files.map(String) : []
    return {
      ok: files.length > 0,
      provider: String(parsed.provider ?? providerId),
      ...(parsed.model ? { model: String(parsed.model) } : {}),
      files,
      ms: Date.now() - started,
      ...(files.length > 0 ? {} : { error: '脚本没有返回图片路径（看宿主日志）' }),
    }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; killed?: boolean; message?: string }
    if (err.killed) return { ok: false, error: '试跑超时（240s）' }
    const tail = String(err.stderr || err.stdout || err.message || '')
      .split('\n')
      .filter(Boolean)
      .slice(-3)
      .join(' | ')
    return { ok: false, error: `试跑失败：${tail.slice(0, 400)}` }
  }
}

/* ================= HTTP 工具 ================= */

interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
  }): () => void
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    request.on('data', (c) => (data += c))
    request.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch { reject(new Error('invalid json')) }
    })
    request.on('error', reject)
  })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

/** 输出给前端的形态：key 打码 + 状态 + 归一化后的 providerId */
function toWire(list: ProviderItem[]): ProviderItem[] {
  return list.map((p) => ({ ...p, providerId: providerIdOf(p), apiKey: mask(p.apiKey) }))
}

/**
 * 前端提交时：
 *  - masked/空 key → 保留原值（空 key 不再等于「删 key」）；
 *  - clearKey === true → 用户显式清空；
 *  - providerId 归一化（旧数据/重复通道 id 都能映射回脚本 id）。
 */
function applyWire(list: ProviderItem[], wire: ProviderItem[]): ProviderItem[] {
  return wire.map((w) => {
    const id = String(w.id ?? '').trim()
    const old = list.find((p) => p.id === id)
    const providerId = normalizeProviderId(w.providerId ?? id)
    const clearKey = w.clearKey === true
    // chatgpt-web@ 通道的登录态只存账号库：providers.json 里永远不保留 token 副本
    const apiKey = providerId.startsWith('chatgpt-web@')
      ? ''
      : clearKey
        ? ''
        : w.apiKey === '' || isMasked(w.apiKey)
          ? (old?.apiKey ?? '')
          : String(w.apiKey ?? '')
    const level = Number(w.level)
    const next: ProviderItem = {
      id,
      providerId,
      name: String(w.name ?? providerId),
      kind: w.kind,
      level: (level === 2 || level === 3 ? level : 1) as 1 | 2 | 3,
      enabled: w.enabled === true,
      apiKey,
      model: String(w.model ?? ''),
      base: String(w.base ?? ''),
      status: old?.status ?? 'unknown',
      lastChecked: old?.lastChecked ?? null,
    }
    if (providerId === 'direct') next.directProvider = String(w.directProvider || 'dashscope').toLowerCase()
    if (typeof w.detail === 'string') next.detail = w.detail
    else if (old?.detail) next.detail = old.detail
    return next
  })
}

/* ================= ChatGPT 网页出图账号（多账号 + 套餐标注） ================= */

/** ChatGPT 套餐档位：免费 / Plus / 5x(Pro) / 20x(Business)。 */
export type ChatGptPlan = 'free' | 'plus' | '5x' | '20x'

const PLAN_ORDER: ChatGptPlan[] = ['free', 'plus', '5x', '20x']
const DEFAULT_WINDOW_HOURS = 24

/**
 * 套餐预设：默认 24h 出图额度上限。数字是经验值，面板可逐账号覆盖
 * （`limit: null` 表示跟随套餐预设），以用户账号的真实额度为准。
 */
export const PLAN_PRESETS: Record<ChatGptPlan, { label: string; limit: number; note: string }> = {
  free: { label: '免费 Free', limit: 3, note: '免费版：约 2-3 张 / 24h' },
  plus: { label: 'Plus', limit: 50, note: 'Plus：额度显著高于免费版' },
  '5x': { label: '5x（Pro）', limit: 250, note: 'Pro / 5x：约为 Plus 的 5 倍' },
  '20x': { label: '20x（Business）', limit: 1000, note: 'Business / 20x：约为 Plus 的 20 倍' },
}

/** ChatGPT 网页账号的探测凭据：session cookie、已换取的 access token，或 Codex 客户端登录态。 */
export interface ChatGptAuth {
  /** `__Secure-next-auth.session-token` 的值（DevTools → Application → Cookies）。 */
  sessionToken?: string
  /** 由 session 换取的 Bearer token（约 1 小时有效，自动续期）。 */
  accessToken?: string
  accessTokenExpires?: number
  accountId?: string
  planType?: string
  /** true = 每次探测实时读取 `~/.codex/auth.json`（Codex 桌面/CLI 的登录态）。 */
  codexAuth?: boolean
  /** Codex 账号的邮箱（仅展示）。 */
  email?: string
}

/** Codex 用量（/backend-api/codex/usage）。 */
export interface CodexUsage {
  planType?: string
  email?: string
  primary?: { usedPercent: number; windowSeconds: number; resetAt: number }
  secondary?: { usedPercent: number; windowSeconds: number; resetAt: number }
  credits?: string
}

/** 一次自动探测的结果。 */
export interface ChatGptAutoState {
  lastProbeAt?: number
  lastError?: string
  /** 窗口内检测到的生成时刻（毫秒），倒序无关，服务端按窗口过滤。 */
  generatedAt?: number[]
  /** 最近一次探测扫过的会话数。 */
  scanned?: number
  /** 探测诊断（会话/节点/图片计数与样本）。 */
  debug?: string[]
  /** Codex 客户端账号的实时用量。 */
  codexUsage?: CodexUsage
}

export interface ChatGptAccount {
  id: string
  label: string
  plan: ChatGptPlan
  /** 覆盖该账号的窗口额度上限；null = 跟随套餐预设。 */
  limit: number | null
  /** 滚动窗口长度（小时）。 */
  windowHours: number
  /** 已登记的生成时刻（毫秒）。 */
  timestamps: number[]
  /** 档位来源：auto = 探测写入，manual = 用户手选（探测不再覆盖）。 */
  planSource?: 'auto' | 'manual'
  /** 该账号是否用自动探测代替手动登记。 */
  autoProbe?: boolean
  auth?: ChatGptAuth
  auto?: ChatGptAutoState
}

interface ChatGptStore {
  version: 1
  accounts: ChatGptAccount[]
  settings?: { proxy?: string }
}

function storeDir(): string {
  return join(homedir(), '.dsh', 'dsh-img2img-config')
}
function accountsFile(): string {
  return join(storeDir(), 'chatgpt-accounts.json')
}
function legacyUsageFile(): string {
  return join(storeDir(), 'chatgpt-web-usage.json')
}

function newAccountId(): string {
  return `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}
function normalizePlan(value: unknown): ChatGptPlan {
  return PLAN_ORDER.includes(value as ChatGptPlan) ? (value as ChatGptPlan) : 'free'
}
function normalizeLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}
function freshAccount(label: string): ChatGptAccount {
  return { id: newAccountId(), label, plan: 'free', limit: null, windowHours: DEFAULT_WINDOW_HOURS, timestamps: [] }
}

function writeStore(store: ChatGptStore): void {
  mkdirSync(storeDir(), { recursive: true })
  writeFileSync(accountsFile(), JSON.stringify(store, null, 2), 'utf8')
}

/** 读取账号表；旧版单账号时间戳文件自动迁移为「ChatGPT 账号 1」（免费档）。 */
function readStore(): ChatGptStore {
  try {
    if (existsSync(accountsFile())) {
      const raw = JSON.parse(readFileSync(accountsFile(), 'utf8')) as Partial<ChatGptStore>
      if (Array.isArray(raw?.accounts)) {
        return {
          version: 1,
          settings: raw.settings && typeof raw.settings === 'object' ? { proxy: typeof raw.settings.proxy === 'string' ? raw.settings.proxy : '' } : { proxy: '' },
          accounts: raw.accounts.map((a) => ({
            id: typeof a.id === 'string' && a.id ? a.id : newAccountId(),
            label: typeof a.label === 'string' && a.label.trim() ? a.label.trim() : '未命名账号',
            plan: normalizePlan(a.plan),
            limit: normalizeLimit(a.limit),
            windowHours: Number(a.windowHours) > 0 ? Number(a.windowHours) : DEFAULT_WINDOW_HOURS,
            timestamps: Array.isArray(a.timestamps) ? a.timestamps.filter((t): t is number => typeof t === 'number') : [],
            ...(a.planSource === 'manual' ? { planSource: 'manual' as const } : { planSource: 'auto' as const }),
            autoProbe: a.autoProbe === true,
            ...(a.auth && typeof a.auth === 'object' ? { auth: a.auth } : {}),
            ...(a.auto && typeof a.auto === 'object' ? { auto: a.auto } : {}),
          })),
        }
      }
    }
    if (existsSync(legacyUsageFile())) {
      const arr = JSON.parse(readFileSync(legacyUsageFile(), 'utf8')) as unknown
      const migrated: ChatGptStore = {
        version: 1,
        settings: { proxy: '' },
        accounts: [{
          ...freshAccount('ChatGPT 账号 1'),
          timestamps: Array.isArray(arr) ? arr.filter((t): t is number => typeof t === 'number') : [],
        }],
      }
      writeStore(migrated)
      return migrated
    }
  } catch {}
  return { version: 1, settings: { proxy: '' }, accounts: [freshAccount('ChatGPT 账号 1')] }
}

/* ================= 账号库 → chatgpt-web 通道行 ================= */

/** 账号套餐的短名（拼进通道名，避免写成「免费 Free」这么长）。 */
const PLAN_SHORT: Record<ChatGptPlan, string> = { free: '免费', plus: 'Plus', '5x': '5x', '20x': '20x' }

/** ChatGptAccount → 纯函数用的 AccountLike。 */
function accountLikes(store: ChatGptStore): AccountLike[] {
  return store.accounts.map((account) => ({
    id: account.id,
    label: account.label,
    planLabel: PLAN_SHORT[account.plan] ?? account.plan,
    ...(account.auth?.accountId ? { accountId: account.auth.accountId } : {}),
    // 浏览器出图只认 session token；access token（Codex 探测来的）不能注入网页 cookie，不建网页通道
    webToken: Boolean(account.auth?.sessionToken),
  }))
}

/** 读取账号库（仅在文件已存在时；避免 GET /providers 顺手创建空账号库）。 */
function readStoreIfExists(): ChatGptStore | undefined {
  return existsSync(accountsFile()) ? readStore() : undefined
}

/**
 * 账号变更后把账号库投影到 providers.json：
 *  - 有网页登录态的账号 → 自动补/更新 chatgpt-web@ 通道；
 *  - removedAccount → 连带删掉它对应的通道行；
 *  - chatgpt-web 行上的 apiKey 一律清空（登录态只存账号库，避免重复泄漏 token）。
 */
function applyAccountChannels(store: ChatGptStore, removedAccount?: ChatGptAccount): void {
  const current = ensureProviders()
  const base = removedAccount
    ? current.filter((provider) => {
        const providerId = providerIdOf(provider)
        if (!providerId.startsWith('chatgpt-web@')) return true
        const like: AccountLike = {
          id: removedAccount.id,
          label: removedAccount.label,
          ...(removedAccount.auth?.accountId ? { accountId: removedAccount.auth.accountId } : {}),
        }
        return !accountChannelMatches(like, providerId.slice('chatgpt-web@'.length))
      })
    : current
  const plan = planAccountChannels(base, accountLikes(store))
  const changed =
    base.length !== current.length ||
    plan.added.length > 0 ||
    plan.updated.length > 0 ||
    plan.clearedCredentials.length > 0
  if (!changed) return
  writeProviders(plan.rows)
  syncEnv(plan.rows, current)
}

function accountStatus(account: ChatGptAccount) {
  const windowMs = account.windowHours * 60 * 60 * 1000
  const now = Date.now()
  const limit = account.limit ?? PLAN_PRESETS[account.plan].limit
  const auto = account.auto ?? {}
  const useAuto = account.autoProbe === true && Array.isArray(auto.generatedAt)
  const stamps = useAuto ? auto.generatedAt! : account.timestamps
  const recent = stamps.filter((t) => now - t < windowMs).sort((a, b) => a - b)
  const autoRecent = (auto.generatedAt ?? []).filter((t) => now - t < windowMs).sort((a, b) => a - b)
  const nextReset = recent.length ? recent[0]! + windowMs : null
  return {
    id: account.id,
    label: account.label,
    plan: account.plan,
    planLabel: PLAN_PRESETS[account.plan].label,
    planSource: account.planSource ?? 'auto',
    limit,
    limitOverridden: account.limit !== null,
    /** 免费版不按本地额度卡：只统计用量，真正没额度时由调用方自动切换通道。 */
    limitEnforced: account.plan !== 'free',
    windowHours: account.windowHours,
    used: recent.length,
    remaining: Math.max(0, limit - recent.length),
    nextReset,
    resetAt: nextReset ? new Date(nextReset).toLocaleString('zh-CN', { hour12: false }) : null,
    rule: PLAN_PRESETS[account.plan].note,
    autoProbe: account.autoProbe === true,
    hasToken: Boolean(account.auth?.sessionToken || account.auth?.accessToken || account.auth?.codexAuth),
    codexAuth: account.auth?.codexAuth === true,
    email: account.auth?.email ?? null,
    detectedPlanType: account.auth?.planType ?? null,
    codexUsage: auto.codexUsage ?? null,
    lastProbeAt: auto.lastProbeAt ?? null,
    lastProbeError: auto.lastError ?? null,
    scanned: auto.scanned ?? null,
    debug: auto.debug ?? null,
    /** 探测到的窗口内出图数（与是否开启自动探测无关，供状态行展示）。 */
    autoUsed: autoRecent.length,
    autoGeneratedAt: autoRecent.slice(-5).map((t) => new Date(t).toLocaleString('zh-CN', { hour12: false })),
    lastGeneratedAt: recent.length ? recent[recent.length - 1]! : null,
    generatedTimes: recent.slice(-5).map((t) => new Date(t).toLocaleString('zh-CN', { hour12: false })),
  }
}

function usagePayload(store: ChatGptStore) {
  return {
    accounts: store.accounts.map(accountStatus),
    tiers: PLAN_ORDER.map((plan) => ({
      plan,
      label: PLAN_PRESETS[plan].label,
      defaultLimit: PLAN_PRESETS[plan].limit,
      note: PLAN_PRESETS[plan].note,
    })),
    proxy: store.settings?.proxy ?? '',
    proxyEffective: resolveProxy(store.settings?.proxy) ?? '',
  }
}

interface UsageAction {
  action?: 'log' | 'add' | 'update' | 'reset' | 'remove' | 'auth' | 'authCodex' | 'probe' | 'settings'
  id?: string
  label?: string
  plan?: string
  limit?: number | null
  ts?: number
  autoProbe?: boolean
  /** session cookie 值；空串 = 清除凭据。 */
  sessionToken?: string
  proxy?: string
}

/* ================= ChatGPT 账号自动探测（token → backend-api） ================= */

const CHATGPT_BASE = 'https://chatgpt.com'
/** ChatGPT 的 planType → 面板档位。 */
const PLAN_TYPE_MAP: Record<string, ChatGptPlan> = {
  free: 'free',
  plus: 'plus',
  pro: '5x',
  team: '20x',
  business: '20x',
  enterprise: '20x',
  edu: 'plus',
}

/** 系统代理（Windows 注册表）——Node 的 fetch 不读系统代理，探测需要显式 CONNECT。 */
function systemProxy(): string | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
    const out = execFileSync('reg', ['query', key], { encoding: 'utf8', timeout: 5000 })
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(out)) return undefined
    const m = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(out)
    if (!m) return undefined
    const raw = m[1]!.trim()
    // 形如 "http=127.0.0.1:7897;https=127.0.0.1:7897" 或 "127.0.0.1:7897"
    const https = /https=([^;]+)/i.exec(raw)?.[1]
    const http = /http=([^;]+)/i.exec(raw)?.[1]
    const hostPort = (https ?? http ?? raw).trim()
    return /^https?:\/\//i.test(hostPort) ? hostPort : `http://${hostPort}`
  } catch {
    return undefined
  }
}

function resolveProxy(explicit?: string): string | undefined {
  const raw = (explicit ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.ALL_PROXY ?? '').trim()
  if (raw) return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  return systemProxy()
}

interface JsonResponse {
  status: number
  text: string
}

/** 经 CONNECT 隧道的 HTTPS GET/POST（无第三方依赖，支持系统代理）。 */
function httpsJson(urlStr: string, opts: { method?: string; headers?: Record<string, string>; body?: string; proxy?: string; timeoutMs?: number } = {}): Promise<JsonResponse> {
  const url = new URL(urlStr)
  const method = opts.method ?? 'GET'
  const timeoutMs = opts.timeoutMs ?? 20000
  const headers: Record<string, string> = { host: url.hostname, ...opts.headers }
  if (opts.body !== undefined) headers['content-length'] = String(Buffer.byteLength(opts.body))
  return new Promise((resolve, reject) => {
    const send = (socket?: import('node:net').Socket): void => {
      const req = httpsRequest({
        host: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: url.pathname + url.search,
        method,
        headers,
        servername: url.hostname,
        ...(socket ? { socket, agent: false } : {}),
      }, (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }))
      })
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`请求超时 ${timeoutMs}ms`)))
      req.on('error', reject)
      if (opts.body !== undefined) req.write(opts.body)
      req.end()
    }
    if (!opts.proxy) {
      send()
      return
    }
    const proxy = new URL(opts.proxy)
    const connectReq = httpRequest({
      host: proxy.hostname,
      port: proxy.port ? Number(proxy.port) : 8080,
      method: 'CONNECT',
      path: `${url.hostname}:443`,
      headers: { host: `${url.hostname}:443` },
    })
    connectReq.setTimeout(timeoutMs, () => connectReq.destroy(new Error(`代理连接超时 ${timeoutMs}ms`)))
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`代理 CONNECT 失败: HTTP ${res.statusCode ?? 0}`))
        return
      }
      send(socket)
    })
    connectReq.on('error', reject)
    connectReq.end()
  })
}

function parseJson<T>(text: string): T | undefined {
  try { return JSON.parse(text) as T } catch { return undefined }
}

/** 读取 Codex 桌面/CLI 的登录态（`~/.codex/auth.json`）。 */
function readCodexAuth(): { accessToken: string; accountId?: string; planType?: string; email?: string; expires?: number } {
  const file = join(homedir(), '.codex', 'auth.json')
  if (!existsSync(file)) throw new Error('未找到 ~/.codex/auth.json（Codex 客户端未登录？）')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { tokens?: { access_token?: string; account_id?: string; id_token?: string } }
  const accessToken = raw.tokens?.access_token
  if (!accessToken) throw new Error('~/.codex/auth.json 里没有 access_token（可能用的是 API key 模式）')
  let planType: string | undefined
  let email: string | undefined
  let expires: number | undefined
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as Record<string, unknown>
    const claims = (payload['https://api.openai.com/auth'] ?? {}) as Record<string, unknown>
    planType = typeof claims.chatgpt_plan_type === 'string' ? claims.chatgpt_plan_type : undefined
    const profile = (payload['https://api.openai.com/profile'] ?? {}) as Record<string, unknown>
    email = typeof profile.email === 'string' ? profile.email : undefined
    expires = typeof payload.exp === 'number' ? payload.exp * 1000 : undefined
  } catch { /* 令牌解析失败不影响使用 */ }
  return { accessToken, accountId: raw.tokens?.account_id, planType, email, expires }
}

/** 用 session cookie 换取 access token（约 1 小时有效）。 */
async function refreshAccessToken(account: ChatGptAccount, proxy?: string): Promise<ChatGptAuth> {
  const sessionToken = account.auth?.sessionToken
  if (!sessionToken) throw new Error('未填写 session token')
  const res = await httpsJson(`${CHATGPT_BASE}/api/auth/session`, {
    headers: {
      cookie: `__Secure-next-auth.session-token=${sessionToken}`,
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    },
    proxy,
  })
  if (res.status !== 200) throw new Error(`session 换取失败（HTTP ${res.status}）——token 可能已失效，请重新复制`)
  const data = parseJson<{ accessToken?: string; account?: { id?: string; planType?: string }; expires?: string }>(res.text)
  if (!data?.accessToken) throw new Error('session 响应缺少 accessToken（token 已过期？）')
  return {
    sessionToken,
    accessToken: data.accessToken,
    accessTokenExpires: Date.now() + 50 * 60 * 1000,
    accountId: data.account?.id,
    planType: data.account?.planType,
  }
}

interface ConversationItem { id?: string; title?: string; create_time?: number | string; update_time?: number | string }

/** 会话时间戳可能是秒（number）或 ISO 字符串，统一成毫秒。 */
function toMillis(value: unknown): number {
  if (typeof value === 'number') return value * 1000
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * 探测一个账号：套餐档位 + 窗口内的出图时刻。
 * 出图判定：非 user 消息里带 `sediment://` 图片资源的节点，其 create_time 即生成时刻
 * （用户自己上传的参考图属于 user 消息，不计入）。
 * @param account - 目标账号（读取其 auth）。
 * @param proxy - 代理地址；缺省时按账号设置 / 环境变量 / 系统代理。
 * @returns 探测结果，含档位、出图时刻与扫描到的会话数。
 */
async function probeChatGptAccount(account: ChatGptAccount, proxy?: string): Promise<{ auth: ChatGptAuth; generatedAt: number[]; scanned: number; debug: string[]; codexUsage?: CodexUsage }> {
  let auth = account.auth ?? {}
  if (auth.codexAuth === true) {
    // 每次实时读客户端登录态：Codex 客户端刷新令牌后自动跟随
    const codex = readCodexAuth()
    auth = { codexAuth: true, accessToken: codex.accessToken, accountId: codex.accountId, planType: codex.planType, email: codex.email, accessTokenExpires: codex.expires }
  } else if (!auth.accessToken || (auth.accessTokenExpires ?? 0) < Date.now() + 60_000) {
    auth = await refreshAccessToken(account, proxy)
  }
  const authHeaders: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${auth.accessToken}`,
    // 带上 session cookie：与浏览器请求一致，列表接口在仅 Bearer 时可能少返回会话
    ...(auth.sessionToken ? { cookie: `__Secure-next-auth.session-token=${auth.sessionToken}` } : {}),
    ...(auth.accountId ? { 'chatgpt-account-id': auth.accountId } : {}),
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  }
  const windowMs = account.windowHours * 60 * 60 * 1000
  const cutoff = Date.now() - windowMs

  const listRes = await httpsJson(`${CHATGPT_BASE}/backend-api/conversations?offset=0&limit=30&order=updated`, { headers: authHeaders, proxy })
  if (listRes.status === 401 || listRes.status === 403) {
    throw new Error(`未授权（HTTP ${listRes.status}）——token 已失效，请重新复制`)
  }
  if (listRes.status !== 200) throw new Error(`会话列表失败（HTTP ${listRes.status}）`)
  const list = parseJson<{ items?: ConversationItem[] }>(listRes.text)
  let items = (list?.items ?? []).filter((it) => typeof it.id === 'string')
  // 列表接口偶发少返回（实测：最新会话缺失）——空或过少时重试一次
  if (items.length === 0) {
    await new Promise((r) => setTimeout(r, 800))
    const retry = await httpsJson(`${CHATGPT_BASE}/backend-api/conversations?offset=0&limit=30&order=updated`, { headers: authHeaders, proxy })
    if (retry.status === 200) items = (parseJson<{ items?: ConversationItem[] }>(retry.text)?.items ?? []).filter((it) => typeof it.id === 'string')
  }

  const generatedAt: number[] = []
  let scanned = 0
  const debug: string[] = []
  for (const item of items) {
    const updated = toMillis(item.update_time)
    if (updated && updated < cutoff) continue // 窗口外的会话不可能含窗口内出图
    const convRes = await httpsJson(`${CHATGPT_BASE}/backend-api/conversation/${item.id}`, { headers: authHeaders, proxy })
    if (convRes.status !== 200) continue
    scanned += 1
    const conv = parseJson<{ mapping?: Record<string, { message?: { author?: { role?: string }; create_time?: number; content?: { parts?: unknown[] } } }> }>(convRes.text)
    const nodes = Object.values(conv?.mapping ?? {})
    let imageNodes = 0
    for (const node of nodes) {
      const msg = node?.message
      if (!msg || msg.author?.role === 'user') continue
      const parts = Array.isArray(msg.content?.parts) ? msg.content.parts : []
      const hasImage = parts.some((p) => (p && typeof p === 'object' && typeof (p as { asset_pointer?: unknown }).asset_pointer === 'string')
        || (typeof p === 'string' && p.startsWith('sediment://')))
      if (!hasImage) continue
      imageNodes += 1
      const t = typeof msg.create_time === 'number' ? msg.create_time * 1000 : 0
      if (t >= cutoff) generatedAt.push(t)
    }
    if (debug.length < 4) debug.push(`${item.id?.slice(0, 8)} nodes=${nodes.length} img=${imageNodes}`)
  }

  // Codex 客户端账号额外取实时用量（/backend-api/codex/usage 提供真实窗口百分比）
  let codexUsage: CodexUsage | undefined
  if (auth.codexAuth === true) {
    const usageRes = await httpsJson(`${CHATGPT_BASE}/backend-api/codex/usage`, { headers: authHeaders, proxy })
    if (usageRes.status === 200) {
      const u = parseJson<{
        plan_type?: string
        email?: string
        credits?: { balance?: string }
        rate_limit?: { primary_window?: { used_percent?: number; limit_window_seconds?: number; reset_at?: number }; secondary_window?: { used_percent?: number; limit_window_seconds?: number; reset_at?: number } | null }
      }>(usageRes.text)
      if (u) {
        codexUsage = {
          ...(u.plan_type ? { planType: u.plan_type } : {}),
          ...(u.email ? { email: u.email } : {}),
          ...(u.credits?.balance ? { credits: u.credits.balance } : {}),
          ...(u.rate_limit?.primary_window ? {
            primary: {
              usedPercent: Number(u.rate_limit.primary_window.used_percent ?? 0),
              windowSeconds: Number(u.rate_limit.primary_window.limit_window_seconds ?? 0),
              resetAt: Number(u.rate_limit.primary_window.reset_at ?? 0) * 1000,
            },
          } : {}),
          ...(u.rate_limit?.secondary_window ? {
            secondary: {
              usedPercent: Number(u.rate_limit.secondary_window.used_percent ?? 0),
              windowSeconds: Number(u.rate_limit.secondary_window.limit_window_seconds ?? 0),
              resetAt: Number(u.rate_limit.secondary_window.reset_at ?? 0) * 1000,
            },
          } : {}),
        }
      }
    }
  }
  return { auth, generatedAt: generatedAt.sort((a, b) => a - b), scanned, debug, ...(codexUsage ? { codexUsage } : {}) }
}

export function registerUsageRoutes(host: { webServer: WebServerService }): () => void {
  return host.webServer.register({
    kind: 'exact',
    path: '/dsh-img2img-config/chatgpt-usage',
    handler: async (request, response) => {
      if (request.method === 'GET') {
        const store = readStore()
        try { applyAccountChannels(store) } catch (error) { console.warn('[dsh-img2img-config] 同步账号通道失败:', error) }
        sendJson(response, 200, usagePayload(store))
        return
      }
      if (request.method === 'POST') {
        try {
          const body = (await readJsonBody(request)) as UsageAction
          const store = readStore()
          const action = body.action ?? 'log'
          let removedAccount: ChatGptAccount | undefined
          const find = (): ChatGptAccount => {
            const account = body.id ? store.accounts.find((a) => a.id === body.id) : store.accounts[0]
            if (!account) throw new Error('账号不存在')
            return account
          }
          switch (action) {
            case 'add': {
              const account = freshAccount(body.label?.trim() || `ChatGPT 账号 ${store.accounts.length + 1}`)
              account.plan = normalizePlan(body.plan)
              account.limit = normalizeLimit(body.limit)
              store.accounts.push(account)
              break
            }
            case 'update': {
              const account = find()
              if (typeof body.label === 'string' && body.label.trim()) account.label = body.label.trim()
              if (body.plan !== undefined) {
                account.plan = normalizePlan(body.plan)
                account.planSource = 'manual'
              }
              if (body.limit !== undefined) account.limit = normalizeLimit(body.limit)
              if (body.autoProbe !== undefined) account.autoProbe = body.autoProbe === true
              break
            }
            case 'auth': {
              const account = find()
              const token = typeof body.sessionToken === 'string' ? body.sessionToken.trim() : ''
              if (!token) {
                account.auth = undefined
                account.auto = { ...account.auto, lastError: undefined, generatedAt: undefined, codexUsage: undefined }
                break
              }
              account.auth = { sessionToken: token }
              // 填了凭据就意味着要自动统计：默认打开自动探测（面板可关）
              account.autoProbe = true
              account.auto = { ...account.auto, lastError: undefined }
              break
            }
            case 'authCodex': {
              // 直接从运行中的 Codex 客户端读登录态（~/.codex/auth.json）
              const account = find()
              const codex = readCodexAuth()
              account.auth = {
                codexAuth: true,
                accountId: codex.accountId,
                planType: codex.planType,
                ...(codex.email ? { email: codex.email } : {}),
                accessTokenExpires: codex.expires,
              }
              if (codex.email) account.label = codex.email
              if (codex.planType && account.planSource !== 'manual') {
                const mapped = PLAN_TYPE_MAP[codex.planType.toLowerCase()]
                if (mapped) account.plan = mapped
              }
              account.autoProbe = true
              account.auto = { ...account.auto, lastError: undefined }
              break
            }
            case 'settings':
              store.settings = { proxy: typeof body.proxy === 'string' ? body.proxy.trim() : (store.settings?.proxy ?? '') }
              break
            case 'probe': {
              const account = find()
              const proxy = resolveProxy(store.settings?.proxy)
              try {
                const result = await probeChatGptAccount(account, proxy)
                account.auth = result.auth
                account.auto = {
                  lastProbeAt: Date.now(),
                  lastError: undefined,
                  generatedAt: result.generatedAt,
                  scanned: result.scanned,
                  debug: result.debug,
                  ...(result.codexUsage ? { codexUsage: result.codexUsage } : {}),
                }
                const planType = result.auth.planType
                if (planType && account.planSource !== 'manual') {
                  const mapped = PLAN_TYPE_MAP[planType.toLowerCase()]
                  if (mapped) account.plan = mapped
                }
              } catch (error) {
                account.auto = { ...account.auto, lastProbeAt: Date.now(), lastError: (error as Error).message }
              }
              break
            }
            case 'reset':
              find().timestamps = []
              break
            case 'remove':
              removedAccount = store.accounts.find((a) => a.id === body.id)
              store.accounts = store.accounts.filter((a) => a.id !== body.id)
              break
            case 'log':
              find().timestamps.push(typeof body.ts === 'number' ? body.ts : Date.now())
              break
            /* v8 ignore next 2 -- 前端只发送上面八个 action；未知 action 直接报错。 */
            default:
              throw new Error(`未知 action: ${String(action)}`)
          }
          writeStore(store)
          try {
            applyAccountChannels(store, removedAccount)
          } catch (error) {
            // 账号操作本身已成功；通道同步失败只记日志，不让整个请求报错
            console.warn('[dsh-img2img-config] 同步账号通道失败:', error)
          }
          sendJson(response, 200, { ok: true, ...usagePayload(store) })
        } catch (e) {
          sendJson(response, 400, { ok: false, error: (e as Error).message })
        }
        return
      }
      response.writeHead(405, { allow: 'GET, POST' })
      response.end()
    },
  })
}

/* ================= 主路由 ================= */

export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (hostCtx: Context) => {
    const host = hostCtx as unknown as Context & { webServer: WebServerService }
    host.effect(() => {
      const disposers = [
        registerUsageRoutes(host),
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-img2img-config/providers',
          handler: async (request, response) => {
            if (request.method === 'GET') {
              // 账号库 → chatgpt-web 通道行（账号新增/改名/凭据变更后自动落到面板）
              let list = ensureProviders()
              const store = readStoreIfExists()
              if (store) {
                const plan = planAccountChannels(list, accountLikes(store))
                const changed =
                  plan.added.length > 0 || plan.updated.length > 0 || plan.clearedCredentials.length > 0
                if (changed) {
                  writeProviders(plan.rows)
                  syncEnv(plan.rows, list)
                }
                list = plan.rows
              }
              sendJson(response, 200, { providers: toWire(list), hostVersion: HOST_PROTOCOL_VERSION })
              return
            }
            if (request.method === 'POST') {
              try {
                const body = (await readJsonBody(request)) as { providers?: ProviderItem[] }
                if (!Array.isArray(body.providers)) throw new Error('providers 需为数组')
                const current = ensureProviders()
                const merged = applyWire(current, body.providers)
                const errors = validateProviders(merged)
                if (errors.length > 0) {
                  sendJson(response, 400, {
                    ok: false,
                    error: errors.join('；'),
                    errors,
                    providers: toWire(current),
                    hostVersion: HOST_PROTOCOL_VERSION,
                  })
                  return
                }
                const plan = planSync(merged, current)
                writeProviders(merged)
                syncEnv(merged, current)
                sendJson(response, 200, {
                  ok: true,
                  providers: toWire(merged),
                  warnings: plan.warnings,
                  plan,
                  hostVersion: HOST_PROTOCOL_VERSION,
                })
              } catch (e) {
                sendJson(response, 400, { ok: false, error: (e as Error).message })
              }
              return
            }
            response.writeHead(405, { allow: 'GET, POST' })
            response.end()
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-img2img-config/probe',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              response.writeHead(405, { allow: 'POST' })
              response.end()
              return
            }
            try {
              const body = (await readJsonBody(request)) as { id?: string }
              const merged = await probeAll(ensureProviders(), body?.id)
              sendJson(response, 200, { ok: true, providers: toWire(merged) })
            } catch (e) {
              sendJson(response, 400, { ok: false, error: (e as Error).message })
            }
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-img2img-config/scan',
          handler: async (request, response) => {
            if (request.method !== 'GET') {
              response.writeHead(405, { allow: 'GET' })
              response.end()
              return
            }
            const [gen, vision] = await Promise.all([scanScriptProviders('gen'), scanScriptProviders('vision')])
            sendJson(response, 200, { ok: gen.ok || vision.ok, gen, vision })
          },
        }),
        host.webServer.register({
          kind: 'exact',
          path: '/dsh-img2img-config/try',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              response.writeHead(405, { allow: 'POST' })
              response.end()
              return
            }
            try {
              const body = (await readJsonBody(request)) as { id?: string }
              if (!body.id) throw new Error('缺少通道 id')
              const provider = ensureProviders().find((item) => item.id === body.id)
              if (!provider) throw new Error('通道不存在（可能已被删除）')
              if (provider.kind !== 'gen') throw new Error('只有生图通道可以试跑')
              const result = await runTry(provider)
              sendJson(response, 200, result)
            } catch (e) {
              sendJson(response, 400, { ok: false, error: (e as Error).message })
            }
          },
        }),
      ]
      return () => disposers.forEach((d) => d())
    }, 'dsh-img2img-config: http routes')
  })
}
