/**
 * 双端共用的「供应商目录」+「.env 同步计划器」。
 *
 * 同一份数据被两个 bundle 使用：
 *  - host（src/index.ts）：保存时用 planSync() 生成两份 .env 的写入计划；
 *  - client（src/client/config-panel.tsx）：「添加通道」选择弹层用 CATALOG，
 *    保存前预览用同一个 planSync()。
 *
 * 纯数据 + 纯函数：不 import node / react，tsc（host）与 tsdown（browser）都能编。
 *
 * 关键约束：生图侧的 providerId 必须与 img2img-studio/scripts/generate_image.mjs
 * 的 detectProviders() 完全一致（openai/dashscope/zai/seedream/minimax/qoder/
 * codex-cli/direct/chatgpt-web@<账号id>），否则 GEN_PROVIDER_ORDER 会被脚本忽略。
 * 旧的「模板 id + 时间戳」就是因此失效的；channel 的唯一性改由 id 承担，
 * providerId 永远是脚本认的那个 id。
 */

/** 通道所属技能半边。 */
export type ProviderKind = 'vision' | 'gen'
/** 余额探测状态。 */
export type ProviderStatus = 'ok' | 'arrears' | 'error' | 'unknown' | 'cli'

/** 一条已配置的通道（持久化在 ~/.dsh/dsh-img2img-config/providers.json）。 */
export interface ProviderItem {
  /** 通道 id（行主键）。新通道优先用 providerId，重复添加时用 `providerId#2`。 */
  id: string
  /** 脚本 provider id（generate_image.mjs / vision.js 认的值）。旧数据由 id 推导。 */
  providerId?: string
  name: string
  kind: ProviderKind
  level: 1 | 2 | 3
  enabled: boolean
  apiKey: string
  model: string
  base: string
  /** 仅 providerId === 'direct'：直连引擎的子通道，写入 DIRECT_PROVIDER。 */
  directProvider?: string
  /** 仅客户端使用：保存时要求宿主清空该通道已存的 Key（空 key 默认是「保持原值」）。 */
  clearKey?: boolean
  /** 最近一次探测/测试的说明（人类可读，例如「HTTP 200」「未检测到 qoderclicn」）。 */
  detail?: string
  status: ProviderStatus
  lastChecked: number | null
}

/** 认证方式：API Key / 本机 CLI 登录态 / 账号库（ChatGPT 网页、Codex）。 */
export type ProviderAuth = 'apiKey' | 'cli' | 'account'

/** 生图侧 provider → .env 变量映射（识图侧的 key 走 VISION_PROVIDERS，不在此列）。 */
export interface CatalogEnv {
  key?: string
  model?: string
  base?: string
}

export interface DirectSubProvider {
  id: string
  name: string
}

export interface CatalogEntry {
  providerId: string
  name: string
  /** 该供应商可用于哪种通道；dashscope/openai/zai 同时是识图与生图供应商。 */
  kinds: readonly ProviderKind[]
  auth: ProviderAuth
  base: string
  /** 生图模型建议（chips）。 */
  models: readonly string[]
  /** 识图模型建议（chips）；缺省回退 models。 */
  visionModels?: readonly string[]
  /** 生图侧 .env 映射；无 key/base/model 可写时省略。 */
  env?: CatalogEnv
  /** 图生图能力：yes=支持参考图，no=不支持，subject=主体参考，direct=看子通道。 */
  i2i?: 'yes' | 'no' | 'subject' | 'direct'
  note?: string
  subProviders?: readonly DirectSubProvider[]
}

/** 直连引擎（engines/direct-api）的子通道，与脚本 DIRECT_PROVIDERS 同源。 */
export const DIRECT_SUB_PROVIDERS: readonly DirectSubProvider[] = [
  { id: 'dashscope', name: 'DashScope 通义 / 万相' },
  { id: 'openai', name: 'OpenAI GPT Image' },
  { id: 'azure', name: 'Azure OpenAI' },
  { id: 'google', name: 'Google Gemini' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'zai', name: 'Z.AI GLM' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'jimeng', name: '即梦 Jimeng' },
  { id: 'seedream', name: 'Seedream 豆包' },
  { id: 'replicate', name: 'Replicate' },
  { id: 'agnes', name: 'Agnes' },
  { id: 'codex-cli', name: 'Codex CLI' },
]

/**
 * 供应商目录（单一真源）。
 *
 * 面板「添加通道」直接按这里的条目生成选项；宿主按 env 字段写 .env；
 * hostVersion 跟着目录协议走，旧宿主没有该字段时面板会提示重启。
 */
export const CATALOG: readonly CatalogEntry[] = [
  {
    providerId: 'dashscope',
    name: 'DashScope 通义千问 / 万相',
    kinds: ['vision', 'gen'],
    auth: 'apiKey',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-image-3.0-pro', 'qwen-image-3.0', 'wan2.7-image-pro'],
    visionModels: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.7-flash', 'qwen3.6-plus', 'qwen-vl-max', 'qwen-vl-plus'],
    env: { key: 'DASHSCOPE_API_KEY' },
    i2i: 'yes',
    note: '生图模型链由脚本内置（qwen-image-3.0-pro → qwen-image-3.0 → wan2.7-image-pro），面板里的模型只作记录',
  },
  {
    providerId: 'openai',
    name: 'OpenAI 兼容 API',
    kinds: ['vision', 'gen'],
    auth: 'apiKey',
    base: '',
    models: ['gpt-image-2'],
    visionModels: ['gpt-4o'],
    env: { key: 'IMG_API_KEY', model: 'IMG_MODEL', base: 'IMG_BASE_URL' },
    i2i: 'yes',
    note: '任意 OpenAI 兼容中转：填 Base URL + Key 即可；i2i 走 /images/edits',
  },
  {
    providerId: 'zai',
    name: 'Z.AI GLM（智谱）',
    kinds: ['vision', 'gen'],
    auth: 'apiKey',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-image'],
    visionModels: ['glm-4v-plus', 'glm-4v', 'glm-4-plus'],
    env: { key: 'ZAI_API_KEY', model: 'ZAI_IMAGE_MODEL', base: 'ZAI_BASE_URL' },
    i2i: 'no',
    note: 'GLM-Image 不支持参考图，i2i 会被跳过',
  },
  {
    providerId: 'seedream',
    name: 'Seedream 豆包（火山方舟）',
    kinds: ['gen'],
    auth: 'apiKey',
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-260128'],
    env: { key: 'ARK_API_KEY', model: 'SEEDREAM_IMAGE_MODEL', base: 'SEEDREAM_BASE_URL' },
    i2i: 'yes',
  },
  {
    providerId: 'minimax',
    name: 'MiniMax 海螺',
    kinds: ['gen'],
    auth: 'apiKey',
    base: 'https://api.minimaxi.com/v1',
    models: ['image-01'],
    env: { key: 'MINIMAX_API_KEY', model: 'MINIMAX_IMAGE_MODEL', base: 'MINIMAX_BASE_URL' },
    i2i: 'subject',
    note: '参考图走 subject_reference（主体一致性）',
  },
  {
    providerId: 'qoder',
    name: 'Qoder CLI ImageGen',
    kinds: ['gen'],
    auth: 'cli',
    base: 'qoderclicn',
    models: ['Qwen3.8-Max'],
    env: { model: 'QODER_IMAGE_MODEL' },
    i2i: 'no',
    note: '需已安装 qoderclicn 并登录，无需 API Key',
  },
  {
    providerId: 'codex-cli',
    name: 'Codex CLI（ChatGPT 订阅）',
    kinds: ['gen'],
    auth: 'account',
    base: 'codex-cli',
    models: ['imagegen'],
    i2i: 'yes',
    note: '读 ~/.codex/auth.json 登录态，无需 API Key',
  },
  {
    providerId: 'direct',
    name: '直连引擎（12 家官方 API）',
    kinds: ['gen'],
    auth: 'cli',
    base: 'engines/direct-api',
    models: [],
    i2i: 'direct',
    subProviders: DIRECT_SUB_PROVIDERS,
    note: '需要 bun + engines/direct-api；子通道在卡片里选，写入 DIRECT_PROVIDER',
  },
  {
    providerId: 'local',
    name: '本地生图服务（chatgpt-web 类）',
    kinds: ['gen'],
    auth: 'apiKey',
    base: '',
    models: [],
    env: { base: 'IMG_HTTP_URL' },
    i2i: 'yes',
    note: '不用 Key，只填 Base URL（写入 IMG_HTTP_URL），指向本机 chatgpt-web 类服务',
  },
  {
    providerId: 'deepseek',
    name: 'DeepSeek 识图',
    kinds: ['vision'],
    auth: 'apiKey',
    base: 'https://api.deepseek.com/v1',
    models: [],
    visionModels: ['deepseek-flash', 'deepseek-chat', 'deepseek-vl2'],
    note: '任意 OpenAI 兼容识图端点都可以这样加；识图侧不写固定 env，走 VISION_PROVIDERS',
  },
  {
    providerId: 'qoder-cli',
    name: 'Qoder CLI（识图）',
    kinds: ['vision'],
    auth: 'cli',
    base: 'qoderclicn',
    models: [],
    visionModels: ['Qwen3.8-Max'],
    note: '无需 API Key，走 qoderclicn 附件识图',
  },
]

const CATALOG_BY_ID = new Map(CATALOG.map((entry) => [entry.providerId, entry]))

/** 目录协议版本：宿主在 GET /providers 里回传，旧宿主没有该字段。 */
export const HOST_PROTOCOL_VERSION = 2

/** 生图 provider id 白名单（脚本 detectProviders() 的 id）。 */
export const GEN_PROVIDER_IDS: readonly string[] = CATALOG.filter((entry) => entry.kinds.includes('gen')).map(
  (entry) => entry.providerId,
)

/** 识图目录 id（识图侧允许目录外的自定义 id，仅用于提示）。 */
export const VISION_PROVIDER_IDS: readonly string[] = CATALOG.filter((entry) => entry.kinds.includes('vision')).map(
  (entry) => entry.providerId,
)

export function catalogEntry(providerId: string): CatalogEntry | undefined {
  return CATALOG_BY_ID.get(providerId)
}

/** 生图通道的 providerId 是否会被 generate_image.mjs 识别。 */
export function isGenProviderId(providerId: string): boolean {
  return GEN_PROVIDER_IDS.includes(providerId) || providerId.startsWith('chatgpt-web@')
}

export function catalogModels(providerId: string, kind: ProviderKind): readonly string[] {
  const entry = catalogEntry(providerId)
  if (!entry) return []
  return kind === 'vision' ? (entry.visionModels ?? entry.models) : entry.models
}

export function authFor(providerId: string): ProviderAuth {
  const entry = catalogEntry(providerId)
  if (entry) return entry.auth
  return providerId.startsWith('chatgpt-web@') ? 'account' : 'apiKey'
}

/** 凭据由账号库 / 本机登录态托管，面板不显示 Key 输入框。 */
export function isManagedProvider(providerId: string): boolean {
  return authFor(providerId) !== 'apiKey'
}

export function managedReason(providerId: string): string {
  if (providerId.startsWith('chatgpt-web@')) return 'ChatGPT 网页账号'
  if (providerId === 'codex-cli') return 'Codex 客户端登录态'
  if (providerId === 'direct') return '本机直连引擎（bun）'
  return 'Qoder CLI'
}

export function isAccountProvider(providerId: string): boolean {
  return providerId === 'codex-cli' || providerId.startsWith('chatgpt-web@')
}

/** 把历史 id 归一化成脚本 provider id。 */
export function normalizeProviderId(rawId: string): string {
  const raw = String(rawId ?? '').trim()
  if (!raw) return raw
  if (raw.startsWith('chatgpt-web@')) return raw
  // 旧面板把 Qoder ImageGen 模板写成了 qoder-gen，脚本真正认的是 qoder
  if (raw === 'qoder-gen') return 'qoder'
  if (CATALOG_BY_ID.has(raw)) return raw
  // 新面板重复通道：providerId#2
  const hash = /^(.+?)#\d+$/.exec(raw)
  if (hash?.[1]) return CATALOG_BY_ID.has(hash[1]) ? hash[1] : hash[1]
  // 旧面板添加通道时拼的 `-<base36 时间戳>` 后缀
  const legacy = /^(.+?)-[a-z0-9]{4,}$/i.exec(raw)
  if (legacy?.[1] && CATALOG_BY_ID.has(legacy[1])) return legacy[1]
  return raw
}

/** 通道行的真实 provider id（新数据取 providerId，旧数据从 id 推导）。 */
export function providerIdOf(provider: ProviderItem): string {
  return normalizeProviderId(provider.providerId ?? provider.id)
}

/** 新通道 id：providerId 未被占用就直接用，重复添加用 `providerId#2`。 */
export function channelIdFor(providerId: string, taken: ReadonlySet<string>): string {
  if (!taken.has(providerId)) return providerId
  let index = 2
  while (taken.has(`${providerId}#${index}`)) index += 1
  return `${providerId}#${index}`
}

/** 键值是否已经打码（预览/回传场景不当作新 Key）。 */
export function isMaskedValue(value: string): boolean {
  return String(value ?? '').includes('••••')
}

/* ================= 账号库 → chatgpt-web 通道行 ================= */

/** 宿主从 ChatGPT 账号库投影给纯函数的最小字段。 */
export interface AccountLike {
  id: string
  label: string
  /** 账号档位展示名（如「免费 Free」），拼进通道名。 */
  planLabel?: string
  /** ChatGPT 账号 UUID（auth.accountId）；旧通道用其前 8 位做 providerId。 */
  accountId?: string
  /** 是否有网页会话登录态（session token）。注意：access token 只够后端统计，浏览器出图必须有 session token。 */
  webToken?: boolean
}

/** 账号 → 通道 id：优先用账号 UUID 前 8 位（与脚本的历史约定一致）。 */
export function accountChannelId(account: AccountLike): string {
  const uuid = String(account.accountId ?? '').trim()
  const short = /^[0-9a-f]{8}/i.exec(uuid)?.[0]
  return `chatgpt-web@${short ?? account.id}`
}

/** 通道 providerId 后缀是否指向该账号（与 generate_image.mjs 的匹配规则一致）。 */
export function accountChannelMatches(account: AccountLike, suffix: string): boolean {
  const value = String(suffix ?? '').trim()
  if (!value) return false
  if (account.id.includes(value)) return true
  return String(account.accountId ?? '').startsWith(value)
}

/**
 * 账号库是 ChatGPT 网页通道的唯一真源：
 *  - 有网页登录态的账号 → 确保有对应 gen 通道（没有就补、名字跟账号走）；
 *  - 所有 chatgpt-web@ 通道行清掉 apiKey（登录态只在账号库里存一份，避免 providers.json 重复泄漏 token）。
 *
 * 不做删除：删账号的清理由调用方传 removedAccount 显式处理，避免误删手写/孤儿行。
 */
export function planAccountChannels(
  providers: readonly ProviderItem[],
  accounts: readonly AccountLike[],
): { rows: ProviderItem[]; added: string[]; updated: string[]; clearedCredentials: string[] } {
  const rows = providers.map((provider) => ({ ...provider }))
  const added: string[] = []
  const updated: string[] = []
  const clearedCredentials: string[] = []

  for (const row of rows) {
    const providerId = providerIdOf(row)
    if (!providerId.startsWith('chatgpt-web@')) continue
    if (row.apiKey) {
      row.apiKey = ''
      clearedCredentials.push(providerId)
    }
  }

  for (const account of accounts) {
    if (account.webToken !== true) continue
    const desiredId = accountChannelId(account)
    const suffix = desiredId.slice('chatgpt-web@'.length)
    const label = account.planLabel ? `${account.label} · ${account.planLabel}` : account.label
    const existing = rows.find((row) => {
      const providerId = providerIdOf(row)
      if (!providerId.startsWith('chatgpt-web@')) return false
      return accountChannelMatches(account, providerId.slice('chatgpt-web@'.length))
    })
    if (!existing) {
      rows.push({
        id: desiredId,
        providerId: desiredId,
        name: label,
        kind: 'gen',
        level: 1,
        enabled: true,
        apiKey: '',
        model: 'gpt-image（网页）',
        base: `chatgpt-web:${suffix}`,
        status: 'unknown',
        lastChecked: null,
      })
      added.push(desiredId)
      continue
    }
    if (existing.name !== label) {
      existing.name = label
      updated.push(existing.id)
    }
  }

  return { rows, added, updated, clearedCredentials }
}

/* ================= .env 同步计划器 ================= */

export type EnvAction = 'set' | 'delete' | 'keep'

export interface EnvRow {
  key: string
  action: EnvAction
  value?: string
}

export interface SyncPlan {
  vision: { rows: EnvRow[]; chain: string[] }
  gen: { rows: EnvRow[]; chain: string[] }
  warnings: string[]
}

function sortEnabled(list: readonly ProviderItem[]): ProviderItem[] {
  // Array.prototype.sort 在现代 JS / Node 里是稳定排序：同级保持拖拽顺序
  return list
    .filter((provider) => provider.enabled)
    .slice()
    .sort((a, b) => Number(a.level) - Number(b.level))
}

function setOrDelete(key: string | undefined, value: string | undefined): EnvRow | null {
  if (!key) return null
  const trimmed = String(value ?? '').trim()
  return trimmed ? { key, action: 'set', value: trimmed } : { key, action: 'delete' }
}

function defaultVisionModel(providerId: string): string {
  return catalogModels(providerId, 'vision')[0] ?? 'qwen-vl-plus'
}

/**
 * 由通道列表推导两份 skill .env 的写入计划。
 *
 * `previous` 用来区分「用户删掉了这个供应商」与「面板从来没管过它」：
 *  - 从没管过 → 不动 .env（保护手写配置）；
 *  - 面板里管理过、现在没了 / 全部停用 → 删除对应 env 行。
 *
 * 纯函数：宿主直接执行；客户端拿同一份计划做保存前预览。
 */
export function planSync(providers: readonly ProviderItem[], previous: readonly ProviderItem[] = []): SyncPlan {
  const warnings: string[] = []
  const enabled = sortEnabled(providers)
  const genChannels = providers.filter((provider) => provider.kind === 'gen')
  const visionChannels = providers.filter((provider) => provider.kind === 'vision')
  const wasGen = previous.some((provider) => provider.kind === 'gen')
  const wasVision = previous.some((provider) => provider.kind === 'vision')

  const genEnabled = enabled.filter((provider) => provider.kind === 'gen')
  const visionEnabled = enabled.filter((provider) => provider.kind === 'vision')

  /* ---------- 生图链 ---------- */
  const chain: string[] = []
  for (const provider of genEnabled) {
    const providerId = providerIdOf(provider)
    if (!chain.includes(providerId)) chain.push(providerId)
  }

  const counts = new Map<string, number>()
  for (const providerId of genEnabled.map(providerIdOf)) {
    counts.set(providerId, (counts.get(providerId) ?? 0) + 1)
  }
  for (const [providerId, count] of counts) {
    if (count > 1) {
      warnings.push(
        `生图供应商「${catalogEntry(providerId)?.name ?? providerId}」启用了 ${count} 条通道：一份 .env 只能保存一条 Key/端点，按链序取第一条`,
      )
    }
  }

  for (const provider of enabled) {
    const providerId = providerIdOf(provider)
    if (authFor(providerId) !== 'apiKey') continue
    // 预览时 client 里是掩码值（说明宿主已有真 key），不算「没填」
    const hasKey = Boolean(provider.apiKey.trim()) && !isMaskedValue(provider.apiKey)
    const keepStored = isMaskedValue(provider.apiKey)
    if (!hasKey && !keepStored) {
      warnings.push(`通道「${provider.name}」已启用但还没填 API Key，脚本会判定为未配置并跳过`)
    }
  }

  const genRows: EnvRow[] = []
  for (const entry of CATALOG) {
    if (!entry.kinds.includes('gen')) continue
    const mine = genChannels.filter((provider) => providerIdOf(provider) === entry.providerId)
    const live = genEnabled.filter((provider) => providerIdOf(provider) === entry.providerId)
    const existed =
      mine.length > 0 || previous.some((provider) => provider.kind === 'gen' && providerIdOf(provider) === entry.providerId)
    if (!existed) continue
    // 「面板真的管过这个 provider」才清 env：之前启用过，或面板里存着 Key。
    // 只是新加了一条停用通道（还没填 Key）时，不碰现有手写 env。
    const wasLive = previous.some(
      (provider) => provider.kind === 'gen' && providerIdOf(provider) === entry.providerId && provider.enabled,
    )
    const hadStoredKey = mine.some((provider) => Boolean(provider.apiKey) && !isMaskedValue(provider.apiKey))
    const ownedByPanel = wasLive || hadStoredKey

    if (entry.providerId === 'direct') {
      if (live.length > 0) {
        const sub = String(live[0]!.directProvider || 'dashscope').toLowerCase()
        genRows.push({ key: 'DIRECT_PROVIDER', action: 'set', value: sub })
        if (!DIRECT_SUB_PROVIDERS.some((candidate) => candidate.id === sub)) {
          warnings.push(`直连子通道「${sub}」不在引擎支持列表里，出图会报未知子通道`)
        }
      } else if (ownedByPanel) {
        genRows.push({ key: 'DIRECT_PROVIDER', action: 'delete' })
      }
      continue
    }
    if (!entry.env) continue
    if (live.length === 0) {
      if (ownedByPanel) {
        for (const key of [entry.env.key, entry.env.model, entry.env.base]) {
          if (key) genRows.push({ key, action: 'delete' })
        }
      }
      continue
    }
    const first = live[0]!
    const keyRow = setOrDelete(entry.env.key, first.apiKey)
    if (keyRow) genRows.push(keyRow)
    const modelRow = setOrDelete(entry.env.model, first.model || catalogModels(entry.providerId, 'gen')[0] || '')
    if (modelRow) genRows.push(modelRow)
    const baseRow = setOrDelete(entry.env.base, first.base || entry.base)
    if (baseRow) genRows.push(baseRow)
  }

  if (chain.length > 0) {
    genRows.push({ key: 'GEN_PROVIDER_ORDER', action: 'set', value: chain.join(',') })
  } else if (genChannels.length > 0 || wasGen) {
    genRows.push({ key: 'GEN_PROVIDER_ORDER', action: 'delete' })
  }

  const webAccounts = genEnabled.filter((provider) => providerIdOf(provider).startsWith('chatgpt-web@'))
  if (webAccounts.length > 0) {
    genRows.push({
      key: 'IMG_CHATGPT_WEB_ACCOUNTS',
      action: 'set',
      value: webAccounts
        // 脚本按 `id:label,id:label` 解析：label 里的逗号/换行必须清掉（冒号在第一个之后是安全的）
        .map((provider) => `${providerIdOf(provider).slice('chatgpt-web@'.length)}:${provider.name.replace(/[,\r\n]/g, ' ')}`)
        .join(','),
    })
  } else if (
    genChannels.some((provider) => providerIdOf(provider).startsWith('chatgpt-web@')) ||
    previous.some((provider) => providerIdOf(provider).startsWith('chatgpt-web@'))
  ) {
    genRows.push({ key: 'IMG_CHATGPT_WEB_ACCOUNTS', action: 'delete' })
  }

  /* ---------- 识图链 ---------- */
  const visionRows: EnvRow[] = []
  const wires = visionEnabled.map((provider) => {
    const providerId = providerIdOf(provider)
    const isCli = providerId === 'qoder-cli' || provider.base === 'qoderclicn'
    if (isCli) {
      return { type: 'cli', id: providerId, cmd: 'qoderclicn', model: provider.model || defaultVisionModel(providerId) }
    }
    const base = provider.base || catalogEntry(providerId)?.base || ''
    return {
      id: providerId,
      key: provider.apiKey,
      model: provider.model || defaultVisionModel(providerId),
      ...(base ? { base } : {}),
    }
  })
  if (visionEnabled.length > 0) {
    visionRows.push({ key: 'VISION_PROVIDERS', action: 'set', value: JSON.stringify(wires) })
  } else if (visionChannels.length > 0 || wasVision) {
    visionRows.push({ key: 'VISION_PROVIDERS', action: 'delete' })
  }

  const main = visionEnabled.find(
    // 预览时 client 拿到的是掩码 key（宿主有真值），也算主通道，否则预览会误报「删除 VISION_API_KEY」
    (provider) => authFor(providerIdOf(provider)) === 'apiKey' && Boolean(provider.apiKey),
  )
  if (main) {
    const providerId = providerIdOf(main)
    visionRows.push({ key: 'VISION_API_KEY', action: 'set', value: main.apiKey })
    const model = main.model || defaultVisionModel(providerId)
    visionRows.push(model ? { key: 'VISION_MODEL', action: 'set', value: model } : { key: 'VISION_MODEL', action: 'delete' })
    const base = main.base || catalogEntry(providerId)?.base || ''
    visionRows.push(base ? { key: 'VISION_BASE_URL', action: 'set', value: base } : { key: 'VISION_BASE_URL', action: 'delete' })
  } else if (visionChannels.length > 0 || wasVision) {
    visionRows.push({ key: 'VISION_API_KEY', action: 'delete' })
    visionRows.push({ key: 'VISION_MODEL', action: 'delete' })
    visionRows.push({ key: 'VISION_BASE_URL', action: 'delete' })
  }

  return {
    vision: { rows: visionRows, chain: visionEnabled.map(providerIdOf) },
    gen: { rows: genRows, chain },
    warnings,
  }
}

/** 保存前校验：只有「写进 .env 后必然跑不通」的硬错误才拦保存。 */
export function validateProviders(providers: readonly ProviderItem[]): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const provider of providers) {
    const providerId = providerIdOf(provider)
    if (!provider.id) errors.push('存在缺少 id 的通道')
    if (ids.has(provider.id)) errors.push(`通道 id 重复：${provider.id}`)
    ids.add(provider.id)
    if (provider.kind !== 'gen' && provider.kind !== 'vision') {
      errors.push(`通道「${provider.name}」的 kind 非法：${String(provider.kind)}`)
    }
    if (![1, 2, 3].includes(Number(provider.level))) {
      errors.push(`通道「${provider.name}」的等级非法：${String(provider.level)}`)
    }
    if (provider.kind === 'gen' && !isGenProviderId(providerId)) {
      errors.push(
        `未知生图供应商「${providerId}」：generate_image.mjs 只认 ${GEN_PROVIDER_IDS.join(' / ')} / chatgpt-web@<账号id>`,
      )
    }
    if (providerId === 'direct') {
      const sub = String(provider.directProvider || 'dashscope').toLowerCase()
      if (!DIRECT_SUB_PROVIDERS.some((candidate) => candidate.id === sub)) {
        errors.push(`直连子通道「${sub}」不存在；可用：${DIRECT_SUB_PROVIDERS.map((candidate) => candidate.id).join(' / ')}`)
      }
    }
  }
  return errors
}

/** EnvRow[] → writeEnv 需要的 updates 表（keep 不出现，set/delete 才带键）。 */
export function envUpdates(rows: readonly EnvRow[]): Record<string, string> {
  const updates: Record<string, string> = {}
  for (const row of rows) {
    if (row.action === 'set') updates[row.key] = row.value ?? ''
    else if (row.action === 'delete') updates[row.key] = ''
  }
  return updates
}
