#!/usr/bin/env node
/**
 * 面板 i18n 完整性回归：
 *  1. 面板里所有 tr('…') 的 key 都在 en 词典里；
 *  2. en 词典的值不含中文（漏翻会显示中文原文，这里要求英文态全英文）；
 *  3. key / 译文里的 {pN} 占位符集合一致；
 *  4. 面板里不再有未包裹的 UI 中文字面量（常量与注册函数白名单除外）；
 *  5. catalog 里会被弹层展示的中文名/说明都有英文。
 *
 * 用法：node scripts/verify-i18n.mjs
 */
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const panelFile = join(pluginRoot, 'src', 'client', 'config-panel.tsx')
const localesFile = join(pluginRoot, 'src', 'client', 'panel-locales.ts')
const catalogFile = join(pluginRoot, 'src', 'catalog.ts')
const cjk = /[\u4e00-\u9fff]/

function detectCheckout() {
  const candidates = [process.env.DSH_CHECKOUT, 'F:/dsh/_rc2-src', 'F:/dsh', join(homedir(), 'dsh-harness'), join(homedir(), 'dsh'), join(homedir(), '.dsh', 'dsh-harness')].filter(Boolean)
  for (const candidate of candidates) if (existsSync(join(candidate, 'packages'))) return resolve(candidate)
  return ''
}
const checkout = detectCheckout()
if (!checkout) {
  console.error('verify-i18n: 找不到 dsh checkout（设置 DSH_CHECKOUT）')
  process.exit(1)
}
const require = createRequire(join(checkout, 'package.json'))
const ts = require('typescript')

function parse(file) {
  const source = readFileSync(file, 'utf8')
  return { source, sf: ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) }
}

const errors = []
const { source: panelSource, sf: panelSf } = parse(panelFile)
const { sf: localesSf } = parse(localesFile)
const { sf: catalogSf } = parse(catalogFile)

/* ---------- en 词典 ---------- */
const en = new Map()
let enObject
function findEn(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'en' && ts.isObjectLiteralExpression(node.initializer)) enObject = node.initializer
  ts.forEachChild(node, findEn)
}
findEn(localesSf)
if (!enObject) {
  console.error('verify-i18n: 找不到 panel-locales.ts 的 en 词典')
  process.exit(1)
}
for (const property of enObject.properties) {
  if (!ts.isPropertyAssignment(property)) continue
  const key = ts.isStringLiteral(property.name) || ts.isNoSubstitutionTemplateLiteral(property.name) ? property.name.text : property.name.getText(localesSf)
  const value = ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer) ? property.initializer.text : property.initializer.getText(localesSf)
  en.set(key, value)
}

/* ---------- 面板 tr 调用 key ---------- */
const used = new Set()
function walkPanel(node) {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'tr') {
    const arg = node.arguments[0]
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) used.add(arg.text)
  }
  ts.forEachChild(node, walkPanel)
}
walkPanel(panelSf)

/* ---------- 未包裹的 UI 中文字面量（排除常量与注册函数） ---------- */
const EXCLUDE_CONSTS = new Set(['LEVEL_META', 'STATUS_META', 'AUTH_LABEL', 'I2I_LABEL', 'ACTION_META', 'VENDOR_META', 'PLAN_COLOR', 'UI_STORE_KEY', 'NS'])
const excluded = []
for (const statement of panelSf.statements) {
  if (ts.isVariableStatement(statement)) {
    const names = statement.declarationList.declarations.map((d) => (ts.isIdentifier(d.name) ? d.name.text : ''))
    if (names.some((name) => EXCLUDE_CONSTS.has(name))) excluded.push([statement.getStart(panelSf), statement.getEnd()])
  }
  if (ts.isFunctionDeclaration(statement) && statement.name && statement.name.text === 'registerConfigPanel') {
    excluded.push([statement.getStart(panelSf), statement.getEnd()])
  }
}
const outside = []
function walkLeftover(node) {
  const pos = node.getStart(panelSf)
  if (excluded.some(([start, end]) => pos >= start && pos < end)) return
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && cjk.test(node.text)) {
    const parent = node.parent
    const isTrArg = parent && ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'tr'
    if (!isTrArg) outside.push(node.text.slice(0, 40))
  }
  ts.forEachChild(node, walkLeftover)
}
walkLeftover(panelSf)

/* ---------- 常量/注册函数的 key 也要在词典里 ---------- */
const constantKeys = ['识图与生图', '一级 · 主通道', '二级 · 备用', '三级 · 兜底', '1 级', '2 级', '3 级', '优先使用，失败后依次降级', '主通道失败后自动切换', '最后兜底，欠费自动关停', '正常', '欠费/额度耗尽（已自动关停）', '探测失败', '未探测', 'CLI / 登录态通道，无需探测', '本机 CLI 登录', '账号库登录态', '支持图生图', '仅文生图', '主体参考', '看子通道', '写入', '删除', '保持']
for (const key of constantKeys) if (!en.has(key)) errors.push(`常量文案缺英文：${key}`)

/* ---------- catalog 展示文案 ---------- */
const catalogStrings = []
function walkCatalog(node) {
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && cjk.test(node.text)) catalogStrings.push(node.text)
  ts.forEachChild(node, walkCatalog)
}
walkCatalog(catalogSf)
for (const text of catalogStrings) if (!en.has(text)) errors.push(`catalog 展示文案缺英文：${text.slice(0, 40)}`)

/* ---------- 编辑器词典（locales.ts）与 t() 使用 ---------- */
const editorLocalesSf = parse(join(pluginRoot, 'src', 'client', 'locales.ts')).sf
function readEditorDict(name) {
  const dict = new Map()
  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !ts.isObjectLiteralExpression(declaration.initializer)) continue
        for (const property of declaration.initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const key = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(editorLocalesSf)
          const value = ts.isStringLiteral(property.initializer) ? property.initializer.text : property.initializer.getText(editorLocalesSf)
          dict.set(key, value)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(editorLocalesSf)
  return dict
}
const editorZh = readEditorDict('zh')
const editorEn = readEditorDict('en')
for (const key of editorZh.keys()) if (!editorEn.has(key)) errors.push(`编辑器英文词典缺 key：${key}`)
for (const key of editorEn.keys()) if (!editorZh.has(key)) errors.push(`编辑器中文词典缺 key：${key}`)
for (const [key, value] of editorEn) if (cjk.test(value)) errors.push(`编辑器英文文案含中文：${key} → ${value.slice(0, 60)}`)
const editorUsed = new Set()
for (const editorFile of ['EditorDock.tsx', 'EditorModal.tsx']) {
  const { sf } = parse(join(pluginRoot, 'src', 'client', editorFile))
  function walkT(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
      const arg = node.arguments[0]
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) editorUsed.add(arg.text)
    }
    ts.forEachChild(node, walkT)
  }
  walkT(sf)
}
for (const key of editorUsed) if (!editorZh.has(key) || !editorEn.has(key)) errors.push(`编辑器使用但词典缺失：${key}`)

/* ---------- 断言 ---------- */
for (const key of used) if (!en.has(key)) errors.push(`面板使用但词典缺失：${key}`)
for (const [key, value] of en) {
  if (cjk.test(value)) errors.push(`英文词典仍含中文：${key} → ${value.slice(0, 60)}`)
  const placeholders = (text) => new Set([...text.matchAll(/\{p\d+\}/g)].map((m) => m[0]))
  const keyParams = placeholders(key)
  const valueParams = placeholders(value)
  if (keyParams.size !== valueParams.size || [...keyParams].some((param) => !valueParams.has(param))) {
    errors.push(`占位符不一致：${key} → ${value}`)
  }
}
for (const text of outside) errors.push(`面板还有未包裹的中文：${text}`)

if (errors.length > 0) {
  console.error(`verify-i18n 失败（${errors.length}）：`)
  for (const error of errors) console.error('  - ' + error)
  process.exit(1)
}
console.log(`verify-i18n: OK（面板 tr key ${used.size} 个 / 词典 ${en.size} 条 / catalog 文案 ${catalogStrings.length} 条已覆盖 / 编辑器 ${editorZh.size} 键中英对齐）`)
