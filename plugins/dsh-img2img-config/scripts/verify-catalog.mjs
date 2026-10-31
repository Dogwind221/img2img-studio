#!/usr/bin/env node
/**
 * 目录 / .env 同步计划器的离线回归测试（不联网、不写盘）。
 *
 * 覆盖这次 P0 修的几类回归：
 *  1. 旧通道 id 归一化（qoder-gen → qoder、`-<时间戳>` 后缀、`#2` 重复通道）；
 *  2. GEN_PROVIDER_ORDER 必须是脚本认的 providerId；
 *  3. 面板删掉/停用的供应商要清 env，没管过的供应商要保持原值；
 *  4. 模型/端点按 provider 写对应 env（SEEDREAM_IMAGE_MODEL 等）；
 *  5. 未知生图 providerId 在校验阶段被拦下。
 *
 * 用法：node scripts/verify-catalog.mjs
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const catalog = await import(pathToFileURL(join(pluginRoot, 'lib', 'catalog.js')).href)
const {
  planSync,
  validateProviders,
  normalizeProviderId,
  providerIdOf,
  channelIdFor,
  planAccountChannels,
  accountChannelId,
  accountChannelMatches,
} = catalog

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

const base = (part) => ({ status: 'unknown', lastChecked: null, apiKey: '', model: '', base: '', ...part })

/* ---------- 1. id 归一化 ---------- */
check('旧 qoder-gen 归一化为 qoder', () => {
  assert.equal(normalizeProviderId('qoder-gen'), 'qoder')
  assert.equal(providerIdOf(base({ id: 'qoder-gen', providerId: undefined })), 'qoder')
})
check('旧时间戳后缀归一化', () => {
  assert.equal(normalizeProviderId('seedream-m1abcde'), 'seedream')
  assert.equal(normalizeProviderId('minimax-m4xyz12'), 'minimax')
})
check('重复通道 id 归一化', () => {
  assert.equal(normalizeProviderId('seedream#2'), 'seedream')
  assert.equal(channelIdFor('seedream', new Set(['seedream'])), 'seedream#2')
  assert.equal(channelIdFor('seedream', new Set(['seedream', 'seedream#2'])), 'seedream#3')
  assert.equal(channelIdFor('openai', new Set(['seedream'])), 'openai')
})
check('chatgpt-web@ 账号 id 原样保留', () => {
  assert.equal(normalizeProviderId('chatgpt-web@7050b804'), 'chatgpt-web@7050b804')
})

/* ---------- 2. 现有线上数据的同步计划 ---------- */
const legacy = [
  base({ id: 'seedream', providerId: 'seedream', name: 'Seedream 豆包', kind: 'gen', level: 1, enabled: true, apiKey: 'ark-test', model: 'doubao-seedream-5-0-pro-260628', base: 'https://ark.cn-beijing.volces.com/api/v3' }),
  base({ id: 'chatgpt-web@7050b804', providerId: 'chatgpt-web@7050b804', name: 'ChatGPT 网页 1', kind: 'gen', level: 1, enabled: true, apiKey: '{"token":"a"}', model: 'gpt-image（网页）', base: 'chatgpt-web:7050b804' }),
  base({ id: 'chatgpt-web@7f110f06', providerId: 'chatgpt-web@7f110f06', name: 'ChatGPT 网页 2', kind: 'gen', level: 1, enabled: true, apiKey: '{"token":"b"}', model: 'gpt-image（网页）', base: 'chatgpt-web:7f110f06' }),
  base({ id: 'codex-cli', providerId: 'codex-cli', name: 'Codex 客户端', kind: 'gen', level: 2, enabled: true, apiKey: '', model: 'imagegen', base: 'codex-cli' }),
  base({ id: 'qoder-gen', providerId: undefined, name: 'Qoder CLI ImageGen', kind: 'gen', level: 2, enabled: true, apiKey: '', model: 'Qwen3.8-Max', base: 'qoderclicn' }),
  base({ id: 'deepseek', providerId: 'deepseek', name: 'DeepSeek 识图', kind: 'vision', level: 1, enabled: true, apiKey: 'sk-deepseek', model: 'deepseek-flash', base: 'https://api.deepseek.com/v1' }),
]
const plan = planSync(legacy, legacy)

check('GEN_PROVIDER_ORDER 用脚本 providerId 且去重', () => {
  const row = plan.gen.rows.find((item) => item.key === 'GEN_PROVIDER_ORDER')
  assert.ok(row)
  assert.equal(row.action, 'set')
  assert.deepEqual(row.value.split(','), ['seedream', 'chatgpt-web@7050b804', 'chatgpt-web@7f110f06', 'codex-cli', 'qoder'])
})
check('Seedream 的 key/model/base 写进各自 env', () => {
  const byKey = Object.fromEntries(plan.gen.rows.filter((r) => r.action === 'set').map((r) => [r.key, r.value]))
  assert.equal(byKey.ARK_API_KEY, 'ark-test')
  assert.equal(byKey.SEEDREAM_IMAGE_MODEL, 'doubao-seedream-5-0-pro-260628')
  assert.equal(byKey.SEEDREAM_BASE_URL, 'https://ark.cn-beijing.volces.com/api/v3')
  assert.equal(byKey.QODER_IMAGE_MODEL, 'Qwen3.8-Max')
  assert.equal(byKey.IMG_CHATGPT_WEB_ACCOUNTS, '7050b804:ChatGPT 网页 1,7f110f06:ChatGPT 网页 2')
})
check('识图主 provider 同步 VISION_API_KEY / VISION_PROVIDERS', () => {
  const byKey = Object.fromEntries(plan.vision.rows.filter((r) => r.action === 'set').map((r) => [r.key, r.value]))
  assert.equal(byKey.VISION_API_KEY, 'sk-deepseek')
  assert.deepEqual(JSON.parse(byKey.VISION_PROVIDERS), [{ id: 'deepseek', key: 'sk-deepseek', model: 'deepseek-flash', base: 'https://api.deepseek.com/v1' }])
})
check('预览场景（client 掩码 key）不会把识图主通道误判成删除', () => {
  const masked = planSync(
    [base({ id: 'deepseek', providerId: 'deepseek', name: 'DeepSeek', kind: 'vision', level: 1, enabled: true, apiKey: 'sk-d••••0f4f', model: 'deepseek-flash', base: 'https://api.deepseek.com/v1' })],
    [],
  )
  const rows = Object.fromEntries(masked.vision.rows.map((r) => [r.key, r]))
  assert.equal(rows.VISION_API_KEY?.action, 'set')
  assert.equal(rows.VISION_MODEL?.action, 'set')
  assert.equal(rows.VISION_BASE_URL?.action, 'set')
})
check('旧数据首次保存不误删（无删除行）', () => {
  assert.equal(plan.gen.rows.filter((r) => r.action === 'delete').length, 0)
})

/* ---------- 3. 面板管过的供应商被删/停用才清 env ---------- */
check('删掉 seedream 通道 → 清 ARK_API_KEY 等三行', () => {
  const next = planSync(legacy.filter((p) => p.id !== 'seedream'), legacy)
  const deletes = next.gen.rows.filter((r) => r.action === 'delete').map((r) => r.key).sort()
  assert.deepEqual(deletes, ['ARK_API_KEY', 'SEEDREAM_BASE_URL', 'SEEDREAM_IMAGE_MODEL'])
})
check('停用 seedream 通道 → 同样清 env，且链里不再出现', () => {
  const next = planSync(legacy.map((p) => (p.id === 'seedream' ? { ...p, enabled: false } : p)), legacy)
  assert.ok(next.gen.rows.some((r) => r.key === 'ARK_API_KEY' && r.action === 'delete'))
  assert.ok(!next.gen.chain.includes('seedream'))
})
check('面板从没管过的供应商（IMG_API_KEY）保持原值', () => {
  assert.ok(!plan.gen.rows.some((r) => r.key === 'IMG_API_KEY'))
})
check('新加一条停用通道 → 不碰手写 env（首次保存不误删）', () => {
  const disabledNew = planSync(
    [base({ id: 'zai', providerId: 'zai', name: 'Z.AI', kind: 'gen', level: 3, enabled: false })],
    [],
  )
  assert.ok(!disabledNew.gen.rows.some((r) => r.key === 'ZAI_API_KEY'))
  const disabledDirect = planSync(
    [base({ id: 'direct', providerId: 'direct', name: '直连', kind: 'gen', level: 1, enabled: false })],
    [],
  )
  assert.ok(!disabledDirect.gen.rows.some((r) => r.key === 'DIRECT_PROVIDER'))
})
check('direct 通道写 DIRECT_PROVIDER', () => {
  const next = planSync([base({ id: 'direct', providerId: 'direct', name: '直连引擎', kind: 'gen', level: 1, enabled: true, model: '', base: 'engines/direct-api', directProvider: 'google' })], [])
  const row = next.gen.rows.find((r) => r.key === 'DIRECT_PROVIDER')
  assert.equal(row?.value, 'google')
})

/* ---------- 3. 账号库 → chatgpt-web 通道 ---------- */
check('accountChannelId 用账号 UUID 前 8 位（无 UUID 回退账号 id）', () => {
  assert.equal(accountChannelId({ id: 'acc-mtu27hou-rz3e', label: 'x', accountId: '7050b804-dd9b-4a81' }), 'chatgpt-web@7050b804')
  assert.equal(accountChannelId({ id: 'acc-abc', label: 'x' }), 'chatgpt-web@acc-abc')
})
check('accountChannelMatches 与脚本的匹配规则一致', () => {
  const account = { id: 'acc-mtu27hou-rz3e', label: 'x', accountId: '7050b804-dd9b' }
  assert.equal(accountChannelMatches(account, '7050b804'), true)
  assert.equal(accountChannelMatches(account, 'mtu27hou'), true)
  assert.equal(accountChannelMatches(account, '7f110f06'), false)
})
check('账号库投影：旧通道改名 + 清掉重复登录态 + 新账号补通道', () => {
  const providers = [
    base({
      id: 'chatgpt-web@7f110f06',
      name: '旧名字',
      kind: 'gen',
      level: 1,
      enabled: true,
      apiKey: '{"sessionToken":"leak"}',
      model: 'gpt-image（网页）',
      base: 'chatgpt-web:7f110f06',
    }),
  ]
  const accounts = [
    { id: 'acc-a', label: '账号 A', planLabel: '免费 Free', accountId: '7f110f06-976a', webToken: true },
    { id: 'acc-b', label: '账号 B', planLabel: 'Plus', accountId: 'aabbccdd-1111', webToken: true },
    { id: 'acc-c', label: 'Codex Only', planLabel: 'Plus', accountId: 'd8fcafde-2222', webToken: false },
  ]
  const plan = planAccountChannels(providers, accounts)
  assert.deepEqual(plan.clearedCredentials, ['chatgpt-web@7f110f06'])
  const matched = plan.rows.find((row) => row.id === 'chatgpt-web@7f110f06')
  assert.equal(matched.name, '账号 A · 免费 Free')
  assert.equal(matched.apiKey, '')
  const added = plan.rows.find((row) => row.id === 'chatgpt-web@aabbccdd')
  assert.ok(added)
  assert.equal(added.level, 1)
  assert.equal(added.enabled, true)
  assert.equal(added.base, 'chatgpt-web:aabbccdd')
  assert.deepEqual(plan.added, ['chatgpt-web@aabbccdd'])
  assert.ok(!plan.rows.some((row) => row.base === 'chatgpt-web:d8fcafde'))
})

/* ---------- 4. 保存校验 ---------- */
check('未知生图 providerId 被拦下', () => {
  const errors = validateProviders([base({ id: 'bogus', providerId: 'bogus', name: 'x', kind: 'gen', level: 1, enabled: true })])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /未知生图供应商/)
})
check('合法 providerId 全部通过校验', () => {
  assert.deepEqual(validateProviders(legacy), [])
})
check('直连子通道非法被拦下', () => {
  const errors = validateProviders([base({ id: 'direct', providerId: 'direct', name: '直连', kind: 'gen', level: 1, enabled: true, directProvider: 'nope' })])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /直连子通道/)
})

/* ---------- 5. 写盘冒烟（DSH_SKILLS_DIR 指向临时目录） ---------- */
const tmpRoot = mkdtempSync(join(tmpdir(), 'img2img-catalog-'))
try {
  process.env.DSH_SKILLS_DIR = tmpRoot
  const host = await import(pathToFileURL(join(pluginRoot, 'lib', 'index.js')).href)
  const { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } = await import('node:fs')
  for (const kind of ['img2img-studio', 'dsh-vision-skill']) {
    mkdirSync(join(tmpRoot, kind, 'scripts'), { recursive: true })
    writeFileSync(join(tmpRoot, kind, 'scripts', '.env'), '# keep this comment\nIMG_API_KEY=manual-key\n', 'utf8')
  }
  host.syncEnv(legacy, [])
  const genEnv = readFileSync(join(tmpRoot, 'img2img-studio', 'scripts', '.env'), 'utf8')
  const visionEnv = readFileSync(join(tmpRoot, 'dsh-vision-skill', 'scripts', '.env'), 'utf8')
  check('写盘：GEN_PROVIDER_ORDER / ARK_API_KEY 落盘', () => {
    assert.match(genEnv, /GEN_PROVIDER_ORDER=seedream,chatgpt-web@7050b804,chatgpt-web@7f110f06,codex-cli,qoder/)
    assert.match(genEnv, /ARK_API_KEY=ark-test/)
    assert.match(genEnv, /SEEDREAM_IMAGE_MODEL=doubao-seedream-5-0-pro-260628/)
  })
  check('写盘：手写的 IMG_API_KEY 与注释保持原样（不再被空值删掉）', () => {
    assert.match(genEnv, /IMG_API_KEY=manual-key/)
    assert.match(genEnv, /# keep this comment/)
  })
  check('写盘：识图 .env 写入 VISION_PROVIDERS', () => {
    assert.match(visionEnv, /VISION_PROVIDERS=\[\{"id":"deepseek"/)
    assert.match(visionEnv, /VISION_API_KEY=sk-deepseek/)
  })
  const genEnvPath = join(tmpRoot, 'img2img-studio', 'scripts', '.env')
  const beforeMtime = statSync(genEnvPath).mtimeMs
  host.syncEnv(legacy, [])
  check('写盘：内容没变不重写（探测/测试不会反复改 mtime）', () => {
    assert.equal(statSync(genEnvPath).mtimeMs, beforeMtime)
  })
  check('写盘：原子替换不留临时文件', () => {
    assert.deepEqual(readdirSync(join(tmpRoot, 'img2img-studio', 'scripts')).filter((name) => name.includes('.tmp-')), [])
  })
} finally {
  rmSync(tmpRoot, { recursive: true, force: true })
}

console.log(`\nverify-catalog: ${passed} 项全部通过`)
