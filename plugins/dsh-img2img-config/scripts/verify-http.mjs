#!/usr/bin/env node
/**
 * 宿主 HTTP 路由的端到端回归（不联网、不碰真实用户数据）。
 *
 * 用临时 USERPROFILE + DSH_SKILLS_DIR 把 providers.json / chatgpt-accounts.json / 两份 .env
 * 全隔离，然后 mock 掉 cordis 的 ctx / webServer，直接驱动真实 handler：
 *  /providers   GET：账号库 → chatgpt-web 通道投影、旧数据补 providerId、清重复登录态
 *               POST：校验拦截 / providerId 归一化 / 写盘 / .env 同步 / 掩码 Key 保留 / clearKey
 *  /chatgpt-usage POST：删账号 → 连带删通道
 *  /probe       POST：托管通道给「本机依赖/账号库」说明（不联网）
 *  /scan        GET：脚本缺失时优雅失败
 *  /try         POST：脚本缺失 / 通道不存在时优雅报错（不花钱）
 *
 * 用法：node scripts/verify-http.mjs
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'img2img-http-home-'))
const skills = join(home, 'skills')
const storeDir = join(home, '.dsh', 'dsh-img2img-config')
const genEnvPath = join(skills, 'img2img-studio', 'scripts', '.env')
const visionEnvPath = join(skills, 'dsh-vision-skill', 'scripts', '.env')

process.env.USERPROFILE = home
process.env.HOME = home
process.env.DSH_SKILLS_DIR = skills

mkdirSync(storeDir, { recursive: true })
mkdirSync(join(skills, 'img2img-studio', 'scripts'), { recursive: true })
mkdirSync(join(skills, 'dsh-vision-skill', 'scripts'), { recursive: true })
writeFileSync(genEnvPath, 'ARK_API_KEY=ark-old\nMINIMAX_API_KEY=mm-key\nIMG_API_KEY=manual-key\n# keep me\n', 'utf8')
writeFileSync(visionEnvPath, '# vision keep me\n', 'utf8')

/* ---------- 旧 providers.json：含历史 chatgpt-web 行（内嵌登录态） ---------- */
const legacy = [
  { id: 'seedream', name: 'Seedream 豆包', kind: 'gen', level: 1, enabled: true, apiKey: 'ark-old', model: 'old-model', base: 'https://ark.cn-beijing.volces.com/api/v3' },
  { id: 'minimax', name: 'MiniMax 海螺', kind: 'gen', level: 3, enabled: true, apiKey: 'mm-key', model: 'image-01', base: 'https://api.minimaxi.com/v1' },
  { id: 'qoder-gen', name: 'Qoder CLI ImageGen', kind: 'gen', level: 2, enabled: true, apiKey: '', model: 'Qwen3.8-Max', base: 'qoderclicn' },
  { id: 'codex-cli', name: 'Codex 客户端', kind: 'gen', level: 2, enabled: true, apiKey: '', model: 'imagegen', base: 'codex-cli' },
  { id: 'deepseek', name: 'DeepSeek 识图', kind: 'vision', level: 1, enabled: true, apiKey: 'sk-ds', model: 'deepseek-flash', base: 'https://api.deepseek.com/v1' },
  { id: 'chatgpt-web@7f110f06', name: '旧名字 1', kind: 'gen', level: 1, enabled: true, apiKey: '{"sessionToken":"leak-1"}', model: 'gpt-image（网页）', base: 'chatgpt-web:7f110f06' },
  { id: 'chatgpt-web@7050b804', name: '旧名字 2', kind: 'gen', level: 1, enabled: true, apiKey: '{"sessionToken":"leak-2"}', model: 'gpt-image（网页）', base: 'chatgpt-web:7050b804' },
]
writeFileSync(join(storeDir, 'providers.json'), JSON.stringify(legacy, null, 2), 'utf8')

/* ---------- ChatGPT 账号库：两个网页账号 + 一个新账号 + 一个 codex-only ---------- */
const account = (id, label, plan, auth) => ({
  id, label, plan, limit: null, windowHours: 24, timestamps: [], planSource: 'auto', autoProbe: false, auth,
})
writeFileSync(join(storeDir, 'chatgpt-accounts.json'), JSON.stringify({
  version: 1,
  settings: { proxy: '' },
  accounts: [
    account('acc-a', '账号 A', 'free', { sessionToken: 'token-a', accountId: '7f110f06-976a-4786-9dd6-e07d0eab0d65' }),
    account('acc-d', '账号 D', 'free', { sessionToken: 'token-d', accountId: '7050b804-dd9b-4a81-9e43-91f6a6439825' }),
    account('acc-b', '账号 B', 'plus', { sessionToken: 'token-b', accountId: 'aabbccdd-1111-2222-3333-444455556666' }),
    account('acc-c', 'Codex Only', 'plus', { codexAuth: true }),
    // 只有 access token（Codex 探测/后端统计用）→ 不能注入浏览器 cookie，不应生成网页通道
    account('acc-e', 'Access Only', 'plus', { accessToken: 'token-e', accountId: 'eeeeeeee-1111-2222-3333-444455556666' }),
  ],
}, null, 2), 'utf8')

const host = await import(pathToFileURL(join(pluginRoot, 'lib', 'index.js')).href)

/* ---------- mock cordis ctx + webServer ---------- */
const routes = []
const fakeCtx = {
  inject(_deps, callback) {
    callback({
      effect(fn) {
        const disposer = fn()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    })
  },
}
host.apply(fakeCtx)

function mockRequest(method, body) {
  const listeners = {}
  return {
    method,
    on(event, listener) {
      listeners[event] = listener
      return this
    },
    start() {
      if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body)))
      listeners.end?.()
    },
  }
}

async function callRoute(path, method, body) {
  const route = routes.find((item) => item.path === path)
  assert.ok(route, `${path} 路由未注册`)
  const response = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(chunk) {
      this.body = String(chunk ?? '')
    },
  }
  const request = mockRequest(method, body)
  const pending = route.handler(request, response)
  request.start()
  await pending
  return { status: response.status, json: response.body ? JSON.parse(response.body) : null }
}

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

const envLine = (file, key) => {
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((item) => item.startsWith(`${key}=`))
  return line === undefined ? null : line.slice(key.length + 1)
}
const providersNow = async () => (await callRoute('/dsh-img2img-config/providers', 'GET')).json

/* ---------- GET /providers：账号库投影 + 旧数据归一化 ---------- */
const got = await callRoute('/dsh-img2img-config/providers', 'GET')
check('GET 返回 hostVersion=2', () => assert.equal(got.json.hostVersion, 2))
check('旧行补 providerId（qoder-gen → qoder）', () => {
  const byId = Object.fromEntries(got.json.providers.map((p) => [p.id, p]))
  assert.equal(byId['qoder-gen'].providerId, 'qoder')
  assert.equal(byId['seedream'].providerId, 'seedream')
})
check('chatgpt-web 行清掉内嵌登录态（凭据只在账号库）', () => {
  const rows = got.json.providers.filter((p) => (p.providerId ?? '').startsWith('chatgpt-web@'))
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => row.apiKey === ''))
})
check('只有 access token 的账号不生成网页通道', () => {
  assert.ok(!got.json.providers.some((p) => (p.providerId ?? '').includes('eeeeeeee')))
})
check('账号库改名同步到通道名，新账号补通道', () => {
  const byId = Object.fromEntries(got.json.providers.map((p) => [p.id, p]))
  assert.equal(byId['chatgpt-web@7f110f06'].name, '账号 A · 免费')
  assert.equal(byId['chatgpt-web@7050b804'].name, '账号 D · 免费')
  const added = byId['chatgpt-web@aabbccdd']
  assert.ok(added)
  assert.equal(added.name, '账号 B · Plus')
  assert.equal(added.level, 1)
})
check('GET 同步 GEN_PROVIDER_ORDER / IMG_CHATGPT_WEB_ACCOUNTS', () => {
  assert.equal(
    envLine(genEnvPath, 'GEN_PROVIDER_ORDER'),
    'seedream,chatgpt-web@7f110f06,chatgpt-web@7050b804,chatgpt-web@aabbccdd,qoder,codex-cli,minimax',
  )
  assert.equal(
    envLine(genEnvPath, 'IMG_CHATGPT_WEB_ACCOUNTS'),
    '7f110f06:账号 A · 免费,7050b804:账号 D · 免费,aabbccdd:账号 B · Plus',
  )
})

/* ---------- POST /providers：校验 / 保存 / 掩码 / clearKey ---------- */
const invalid = structuredClone(got.json.providers)
invalid.push({ id: 'bogus', providerId: 'bogus', name: '不存在', kind: 'gen', level: 1, enabled: true, apiKey: '', model: '', base: '' })
const rejected = await callRoute('/dsh-img2img-config/providers', 'POST', { providers: invalid })
check('POST 未知生图 providerId → 400 且带 errors', () => {
  assert.equal(rejected.status, 400)
  assert.ok(rejected.json.errors.some((error) => error.includes('未知生图供应商')))
})

const next = structuredClone(got.json.providers).filter((p) => p.id !== 'minimax')
const seedream = next.find((p) => p.id === 'seedream')
seedream.model = 'doubao-seedream-5-0-pro-260628'
seedream.apiKey = 'ark-new'
next.push({
  id: 'dashscope', providerId: 'dashscope', name: 'DashScope 通义千问 / 万相', kind: 'gen', level: 3, enabled: true,
  apiKey: 'sk-dash', model: 'qwen-image-3.0-pro', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
})
const saved = await callRoute('/dsh-img2img-config/providers', 'POST', { providers: next })
check('POST 合法配置 → 200', () => {
  assert.equal(saved.status, 200)
  assert.equal(saved.json.ok, true)
})
check('GEN_PROVIDER_ORDER 用 providerId、去重、按等级排序', () => {
  assert.equal(
    envLine(genEnvPath, 'GEN_PROVIDER_ORDER'),
    'seedream,chatgpt-web@7f110f06,chatgpt-web@7050b804,chatgpt-web@aabbccdd,qoder,codex-cli,dashscope',
  )
})
check('Seedream key/model/base + DashScope key 落盘', () => {
  assert.equal(envLine(genEnvPath, 'ARK_API_KEY'), 'ark-new')
  assert.equal(envLine(genEnvPath, 'SEEDREAM_IMAGE_MODEL'), 'doubao-seedream-5-0-pro-260628')
  assert.equal(envLine(genEnvPath, 'SEEDREAM_BASE_URL'), 'https://ark.cn-beijing.volces.com/api/v3')
  assert.equal(envLine(genEnvPath, 'DASHSCOPE_API_KEY'), 'sk-dash')
  assert.equal(envLine(genEnvPath, 'QODER_IMAGE_MODEL'), 'Qwen3.8-Max')
})
check('删掉的 minimax 清 env，手写的 IMG_API_KEY / 注释保持原样', () => {
  assert.equal(envLine(genEnvPath, 'MINIMAX_API_KEY'), null)
  assert.equal(envLine(genEnvPath, 'IMG_API_KEY'), 'manual-key')
  assert.match(readFileSync(genEnvPath, 'utf8'), /# keep me/)
})
check('识图侧 VISION_PROVIDERS / 掩码 Key 保留后落盘', () => {
  assert.equal(envLine(visionEnvPath, 'VISION_API_KEY'), 'sk-ds')
  assert.deepEqual(JSON.parse(envLine(visionEnvPath, 'VISION_PROVIDERS')), [
    { id: 'deepseek', key: 'sk-ds', model: 'deepseek-flash', base: 'https://api.deepseek.com/v1' },
  ])
})
check('providers.json 落盘带 providerId，且 chatgpt-web 行没有 token 副本', () => {
  const stored = JSON.parse(readFileSync(join(storeDir, 'providers.json'), 'utf8'))
  assert.ok(stored.every((p) => typeof p.providerId === 'string' && p.providerId.length > 0))
  assert.ok(stored.filter((p) => p.providerId.startsWith('chatgpt-web@')).every((p) => p.apiKey === ''))
})

const maskedSave = await callRoute('/dsh-img2img-config/providers', 'POST', { providers: saved.json.providers })
check('回传掩码 Key 保存后 ARK_API_KEY 仍是真值', () => {
  assert.equal(maskedSave.status, 200)
  assert.equal(envLine(genEnvPath, 'ARK_API_KEY'), 'ark-new')
})

const cleared = structuredClone(maskedSave.json.providers)
cleared.find((p) => p.id === 'seedream').clearKey = true
const clearResult = await callRoute('/dsh-img2img-config/providers', 'POST', { providers: cleared })
check('clearKey=true → ARK_API_KEY 被显式清空并给出提示', () => {
  assert.equal(clearResult.status, 200)
  assert.equal(envLine(genEnvPath, 'ARK_API_KEY'), null)
  assert.ok(clearResult.json.warnings.some((warning) => warning.includes('还没填 API Key')))
})

/* ---------- 删账号 → 连带删通道 ---------- */
const removed = await callRoute('/dsh-img2img-config/chatgpt-usage', 'POST', { action: 'remove', id: 'acc-d' })
check('删除账号请求成功', () => {
  assert.equal(removed.status, 200)
  assert.equal(removed.json.ok, true)
})
const afterRemove = await providersNow()
check('删账号后通道行消失、GEN_PROVIDER_ORDER 同步', () => {
  assert.ok(!afterRemove.providers.some((p) => p.id === 'chatgpt-web@7050b804'))
  assert.ok(!envLine(genEnvPath, 'GEN_PROVIDER_ORDER').includes('7050b804'))
  assert.ok(envLine(genEnvPath, 'IMG_CHATGPT_WEB_ACCOUNTS').includes('aabbccdd'))
})

/* ---------- /probe：托管通道给本机依赖说明（不联网） ---------- */
const probed = await callRoute('/dsh-img2img-config/probe', 'POST', { id: 'codex-cli' })
check('/probe 单通道返回 cli + detail（codex 登录态说明）', () => {
  assert.equal(probed.status, 200)
  const row = probed.json.providers.find((p) => p.id === 'codex-cli')
  assert.equal(row.status, 'cli')
  assert.match(row.detail, /Codex|auth\.json/i)
})

/* ---------- 探测分类（纯函数）：超时/5xx/普通 429 不能误判欠费 ---------- */
const classify = host.classifyHttpProbe
check('探测分类：200 → ok', () => {
  assert.equal(classify(200, '{}').status, 'ok')
})
check('探测分类：402 → arrears', () => {
  assert.equal(classify(402, '{"error":{"message":"Payment required"}}').status, 'arrears')
})
check('探测分类：429 普通限流 → error（不误判欠费、不关停）', () => {
  const result = classify(429, '{"error":{"message":"Rate limit reached for requests"}}')
  assert.equal(result.status, 'error')
  assert.match(result.detail, /限流/)
})
check('探测分类：429 + insufficient_quota → arrears', () => {
  const result = classify(429, '{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}')
  assert.equal(result.status, 'arrears')
})
check('探测分类：500 正文含 balance/credit → error（回归：5xx 不判欠费）', () => {
  const result = classify(500, 'upstream balance service unavailable, credit ledger timeout')
  assert.equal(result.status, 'error')
})
check('探测分类：401 → error / 404 → unknown', () => {
  assert.equal(classify(401, '{}').status, 'error')
  assert.equal(classify(404, '{}').status, 'unknown')
})
check('探测分类：400 + 结构化欠费码 → arrears', () => {
  assert.equal(classify(400, '{"error":{"code":"arrearage"}}').status, 'arrears')
})

/* ---------- /scan：脚本缺失时优雅失败 ---------- */
const scanned = await callRoute('/dsh-img2img-config/scan', 'GET')
check('/scan 脚本缺失 → ok:false 且带错误说明', () => {
  assert.equal(scanned.status, 200)
  assert.equal(scanned.json.ok, false)
  assert.equal(scanned.json.gen.ok, false)
  assert.match(scanned.json.gen.error, /未找到脚本/)
})

/* ---------- /try：不花钱的错误路径 ---------- */
const tryUnknown = await callRoute('/dsh-img2img-config/try', 'POST', { id: 'nope' })
check('/try 未知通道 → 400', () => {
  assert.equal(tryUnknown.status, 400)
  assert.match(tryUnknown.json.error, /通道不存在/)
})
const tryMissingScript = await callRoute('/dsh-img2img-config/try', 'POST', { id: 'codex-cli' })
check('/try 脚本缺失 → 200 + ok:false（不会真的出图）', () => {
  assert.equal(tryMissingScript.status, 200)
  assert.equal(tryMissingScript.json.ok, false)
  assert.match(tryMissingScript.json.error, /未找到生成脚本/)
})

/* ---------- /probe：HTTP 错误分类（stub fetch，不联网） ---------- */
const realFetch = globalThis.fetch
try {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'Rate limit reached for requests', type: 'rate_limit' } }),
    { status: 429, headers: { 'content-type': 'application/json' } },
  )
  const rateLimited = await callRoute('/dsh-img2img-config/probe', 'POST', { id: 'deepseek' })
  check('/probe 429 普通限流 → error 且通道保持启用（不误关停）', () => {
    const row = rateLimited.json.providers.find((p) => p.id === 'deepseek')
    assert.equal(rateLimited.status, 200)
    assert.equal(row.status, 'error')
    assert.match(row.detail, /限流/)
    assert.equal(row.enabled, true)
  })

  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'Payment required', code: 'payment_required' } }),
    { status: 402, headers: { 'content-type': 'application/json' } },
  )
  const arrearsProbe = await callRoute('/dsh-img2img-config/probe', 'POST', { id: 'deepseek' })
  check('/probe 402 → arrears 且自动关停', () => {
    const row = arrearsProbe.json.providers.find((p) => p.id === 'deepseek')
    assert.equal(row.status, 'arrears')
    assert.equal(row.enabled, false)
  })
} finally {
  globalThis.fetch = realFetch
}

rmSync(home, { recursive: true, force: true })
console.log(`\nverify-http: ${passed} 项全部通过`)
