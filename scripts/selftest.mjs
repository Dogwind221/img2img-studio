#!/usr/bin/env node
/**
 * img2img-studio 自测（全离线，不需要任何 API key / 网络 / 浏览器）。
 *
 * 用法:
 *   node scripts/selftest.mjs [--verbose]
 *
 * 覆盖:
 *   - 纯函数：尺寸归一化 / 比例反查 / i2i 像素钳制 / 额度错误词表 / 会话 cookie 切片 / 账号额度摘要
 *   - 通道编排：GEN_PROVIDER_ORDER 排序、未知 id 忽略、账号用尽跳过（--skip-exhausted / IMG_SKIP_EXHAUSTED）
 *   - CLI：--version、--list-providers（含链序、账号额度、**密钥不泄露**）、--accounts、--dry-run、错误路径
 *
 * 退出码: 0 = 全部通过；1 = 有断言失败。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(__dirname, 'generate_image.mjs')
const argv = process.argv.slice(2)
const VERBOSE = argv.includes('--verbose')

const results = []
const ok = (name, detail = '') => results.push({ name, status: 'PASS', detail })
const bad = (name, detail = '') => results.push({ name, status: 'FAIL', detail })
const skip = (name, detail = '') => results.push({ name, status: 'SKIP', detail })
const check = (name, cond, detail = '') => (cond ? ok(name, detail) : bad(name, detail))
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`)

function runCli(args, extraEnv = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, ...extraEnv },
  })
  let json = null
  try { json = JSON.parse(res.stdout) } catch { /* 非 JSON 输出（--version/--help/报错） */ }
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', json }
}

/* ================= 导入被测模块（只导入，不执行 main） ================= */

process.env.GEN_PROVIDER_ORDER = 'chatgpt-web@accA,codex-cli'
const mod = await import(new URL('./generate_image.mjs', import.meta.url).href)
const {
  VERSION, orderedChain, isQuotaError, normSize, clampForI2i, pxToAspect,
  accountQuota, isAccountExhausted, dropExhaustedAccounts, skipExhaustedEnabled,
  systemProxyUrl, splitSessionCookie, chatgptWebAccounts, detectProviders, generateOnce,
} = mod

check('模块可被 import（CLI 守卫生效，不触发 main）', typeof orderedChain === 'function' && typeof VERSION === 'string', `VERSION=${VERSION}`)

/* ================= 纯函数 ================= */

eq('normSize 默认 1:1 → 2K 档', normSize('', '2k'), '2048x2048')
eq('normSize 默认 1:1 → 1K 档', normSize('', 'normal'), '1024x1024')
eq('normSize 16:9 → 2K 档', normSize('16:9', '2k'), '2688x1536')
eq('normSize 显式尺寸透传（不被 quality 档位放大）', normSize('1024x1536', '2k'), '1024x1536')
eq('normSize 显式方图透传', normSize('1024x1024', '2k'), '1024x1024')
eq('normSize 自由比例仍按档位换算', normSize('2.35:1', '2k'), '4813x2048')
eq('normSize 星号写法归一', normSize('1024*1536', '2k'), '1024x1536')
eq('pxToAspect 反查已知尺寸', pxToAspect('1536x2688'), '9:16')
eq('pxToAspect 反查 1:1', pxToAspect('2048x2048'), '1:1')
eq('pxToAspect 非法输入回落 1:1', pxToAspect('abc'), '1:1')
{
  const small = clampForI2i('2048x2048')          // 4.19M ≈ 上限内
  const big = clampForI2i('4096x4096')            // 16.8M → 必须钳制
  const [bw, bh] = big.split('x').map(Number)
  check('clampForI2i 大图钳到 ≤ 4194304 像素', bw * bh <= 4194304, `${big} = ${bw * bh} 像素`)
  check('clampForI2i 小图不动', small === '2048x2048', small)
  check('clampForI2i 保持 16 的倍数', bw % 16 === 0 && bh % 16 === 0, `${bw}x${bh}`)
}

// 额度错误词表：重试无意义 → 直接切通道
for (const msg of ['额度已用尽', 'You have reached the limit', 'out of credits', '402 Payment Required', 'insufficient quota']) {
  check(`isQuotaError 命中「${msg}」`, isQuotaError(msg) === true)
}
for (const msg of ['请求超时', 'ECONNRESET', 'socket hang up', 'missing session token']) {
  check(`isQuotaError 不误判「${msg}」`, isQuotaError(msg) === false)
}

eq('splitSessionCookie 短 token 单片', splitSessionCookie('t', 'x'.repeat(100)).length, 1)
{
  const parts = splitSessionCookie('__Secure-next-auth.session-token', 'y'.repeat(8000))
  check('splitSessionCookie 长 token 分片命名 .0/.1/.2',
    parts.length === 3 && parts[0].name.endsWith('.0') && parts[2].name.endsWith('.2'),
    parts.map((p) => `${p.name}:${p.value.length}`).join(' '))
}
{
  process.env.IMG_CHATGPT_WEB_ACCOUNTS = 'accA:账号甲,accB'
  eq('chatgptWebAccounts 解析 id:label', chatgptWebAccounts(), [{ id: 'accA', label: '账号甲' }, { id: 'accB', label: 'accB' }])
}
{
  const p = systemProxyUrl()
  check('systemProxyUrl 不抛错且形态正确', p === null || /^https?:\/\//.test(p), String(p))
}

/* ================= 通道编排 ================= */

{
  const configured = [{ id: 'qoder' }, { id: 'codex-cli' }, { id: 'chatgpt-web@accA' }]
  eq('orderedChain 按 GEN_PROVIDER_ORDER 排序', orderedChain(configured), ['chatgpt-web@accA', 'codex-cli', 'qoder'])
  process.env.GEN_PROVIDER_ORDER = ''
  eq('orderedChain 无面板顺序时保持原序', orderedChain(configured), ['qoder', 'codex-cli', 'chatgpt-web@accA'])
  process.env.GEN_PROVIDER_ORDER = 'not-exist,chatgpt-web@accA'
  eq('orderedChain 忽略未知 id', orderedChain(configured), ['chatgpt-web@accA', 'qoder', 'codex-cli'])
  process.env.GEN_PROVIDER_ORDER = 'chatgpt-web@accA,codex-cli'
}

/* ================= 账号额度（合成数据，不读真实凭据） ================= */

const now = Date.now()
const SYNTH = [
  { id: 'acc-free', label: '免费号', plan: 'free', windowHours: 24, auth: { sessionToken: 'SECRET_FREE_TOKEN', accountId: 'aaaa-bbbb' }, auto: { generatedAt: [now - 3600e3, now - 2 * 3600e3, now - 48 * 3600e3], lastProbeAt: now - 60e3 } },
  { id: 'acc-plus-full', label: '加号满额', plan: 'plus', windowHours: 24, auth: { accessToken: 'SECRET_PLUS_TOKEN', codexAuth: true, accountId: 'cccc-dddd' }, auto: { codexUsage: { planType: 'plus', credits: '0', primary: { usedPercent: 100, windowSeconds: 18000, resetAt: now + 3600e3 } } } },
  { id: 'acc-plus-ok', label: '加号有余', plan: 'plus', auth: { accessToken: 'SECRET_PLUS2', accountId: 'eeee-ffff' }, auto: { codexUsage: { planType: 'plus', primary: { usedPercent: 8 }, secondary: { usedPercent: 40 } } } },
]

{
  const q = accountQuota(SYNTH[0])
  check('accountQuota 免费档：窗口内计数正确', q.generatedInWindow === 2 && q.generatedTotal === 3, `in=${q.generatedInWindow} total=${q.generatedTotal}`)
  check('accountQuota 免费档永不判定用尽', q.exhausted === false && q.plan === 'free', `plan=${q.plan} exhausted=${q.exhausted}`)
  check('accountQuota 不泄露凭据', !JSON.stringify(q).includes('SECRET'), JSON.stringify(q).slice(0, 80))
  check('accountQuota 识别通道类型', q.kind === 'web' && accountQuota(SYNTH[1]).kind === 'codex', `${q.kind}/${accountQuota(SYNTH[1]).kind}`)
}
{
  check('isAccountExhausted 付费档主窗口满 100% → true', isAccountExhausted(SYNTH[1]) === true)
  check('isAccountExhausted 双窗口未满 → false', isAccountExhausted(SYNTH[2]) === false)
  check('isAccountExhausted 免费档 → false', isAccountExhausted(SYNTH[0]) === false)
  check('isAccountExhausted 无用量的付费档 → false', isAccountExhausted({ id: 'x', plan: 'plus' }) === false)
}
{
  const chain = ['chatgpt-web@accA', 'chatgpt-web@cccc', 'codex-cli', 'qoder']
  const accounts = [{ ...SYNTH[1], id: 'acc-cccc' }]   // 与 chatgpt-web@cccc 的 accountId 前缀匹配
  const { ids, dropped } = dropExhaustedAccounts(chain, accounts)
  eq('dropExhaustedAccounts 剔除已用尽账号通道', ids, ['chatgpt-web@accA', 'codex-cli', 'qoder'])
  eq('dropExhaustedAccounts 记录被剔除项', dropped, ['chatgpt-web@cccc'])
  check('dropExhaustedAccounts 不存在于库中的账号不误删', dropExhaustedAccounts(['chatgpt-web@unknown'], accounts).ids.length === 1)
}
{
  delete process.env.IMG_SKIP_EXHAUSTED
  check('skipExhausted 默认关', skipExhaustedEnabled(false) === false)
  check('skipExhausted 显式 flag 开', skipExhaustedEnabled(true) === true)
  process.env.IMG_SKIP_EXHAUSTED = '1'
  check('skipExhausted 环境变量开', skipExhaustedEnabled(false) === true)
  delete process.env.IMG_SKIP_EXHAUSTED
}

/* ================= CLI ================= */

{
  const v = runCli(['--version'])
  check('CLI --version', v.code === 0 && /^\d+\.\d+\.\d+$/.test(v.stdout.trim()), v.stdout.trim())

  const help = runCli(['--help'])
  check('CLI --help 打印用法', help.code === 0 && help.stdout.length > 50, help.stdout.split('\n')[0])

  const lp = runCli(['--list-providers'])
  const p = lp.json
  check('CLI --list-providers 输出 JSON', lp.code === 0 && p && Array.isArray(p.providers), `${p?.providers?.length ?? 0} 个通道`)
  check('CLI --list-providers 带链序与 skipExhausted 开关',
    Array.isArray(p?.chain) && typeof p?.skipExhausted === 'boolean',
    `chain=[${p?.chain?.join(',')}] skipExhausted=${p?.skipExhausted}`)
  check('CLI --list-providers 带账号额度视图', Array.isArray(p?.accounts), `${p?.accounts?.length ?? 0} 个账号`)
  check('CLI --list-providers 链序与 orderedChain 一致',
    JSON.stringify(p?.chain) === JSON.stringify(orderedChain((p?.providers ?? []).filter((x) => x.configured))),
    `chain=[${p?.chain?.join(',')}]`)

  // 密钥不泄露：把环境里所有像密钥的长值拿去比对输出
  const secrets = Object.entries(process.env)
    .filter(([k, v]) => /(KEY|TOKEN|SECRET)/i.test(k) && typeof v === 'string' && v.length >= 20)
    .map(([, v]) => v)
  const leaked = secrets.filter((s) => lp.stdout.includes(s) || lp.stdout.includes(s.slice(-12)))
  check('CLI --list-providers 不泄露任何密钥', leaked.length === 0, `检查 ${secrets.length} 个疑似密钥，泄露 ${leaked.length} 个`)

  const acc = runCli(['--accounts'])
  check('CLI --accounts 输出 JSON + summary', acc.code === 0 && Array.isArray(acc.json?.accounts) && typeof acc.json?.summary === 'string' && acc.json.summary.length > 0, acc.json?.summary ?? '')

  const skipOn = runCli(['--list-providers'], { IMG_SKIP_EXHAUSTED: '1' })
  check('CLI skipExhausted 反映环境变量', skipOn.json?.skipExhausted === true, String(skipOn.json?.skipExhausted))

  const dry = runCli(['--dry-run', '--prompt', 'a cat', '--size', '16:9'])
  check('CLI --dry-run 给计划不落盘', dry.code === 0 && dry.json?.dryRun === true && Array.isArray(dry.json?.providerChain), `providerChain=[${dry.json?.providerChain?.join(',')}]`)
  eq('CLI --dry-run 尺寸归一化', dry.json?.size, '2688x1536')

  const bad = runCli(['--prompt', 'x', '--provider', 'no-such-provider', '--json'])
  check('CLI 未知供应商 → 退出码 1 且明确报错（不静默回落整链）',
    bad.code === 1 && /未知供应商/.test(bad.stderr + bad.stdout) && bad.json?.ok === false,
    (bad.json?.errors?.[0]?.error ?? (bad.stderr || bad.stdout)).trim().split('\n').slice(-1)[0])

  const noPrompt = runCli([])
  check('CLI 无参数 → 非 0 退出（提示用法）', noPrompt.code !== 0, `exit=${noPrompt.code}`)
}

/* ================= 编排函数存在性（网络路径只做接口断言） ================= */

check('generateOnce 可导出（供编排/扩展单测）', typeof generateOnce === 'function')
check('detectProviders 可导出且返回数组', Array.isArray(detectProviders()))

/* ================= 汇总 ================= */

const passed = results.filter((r) => r.status === 'PASS')
const failed = results.filter((r) => r.status === 'FAIL')
const skipped = results.filter((r) => r.status === 'SKIP')
console.log('img2img-studio 自测')
for (const r of results) {
  if (r.status === 'PASS' && !VERBOSE) continue
  console.log(`  ${r.status === 'PASS' ? 'PASS' : r.status === 'SKIP' ? 'skip' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`)
}
console.log(`\n合计: ${passed.length} 通过 / ${failed.length} 失败 / ${skipped.length} 跳过`)
console.log(JSON.stringify({
  ok: failed.length === 0,
  handler: 'selftest.mjs',
  source: SCRIPT,
  type: 'selftest',
  artifacts: [],
  summary: `img2img 自测 ${passed.length} 通过 / ${failed.length} 失败 / ${skipped.length} 跳过`,
  counts: { pass: passed.length, fail: failed.length, skip: skipped.length },
  failures: failed.map((f) => ({ name: f.name, detail: f.detail })),
}, null, 2))
process.exit(failed.length === 0 ? 0 : 1)
