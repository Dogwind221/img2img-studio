/**
 * 面板文案翻译入口：`registerConfigPanel()` 绑定前是恒等函数，绑定后读取当前 locale。
 *
 * 文案 key 使用中文原文（zh 字典是 identity），英文在 panel-locales.ts 里逐条给出；
 * 这样新增文案漏翻译时最多显示中文，不会显示 key 本身。
 */

export type TranslateParams = Record<string, string | number>

type Translator = (key: string, params?: TranslateParams) => string

const identity: Translator = (key) => key

let current: Translator = identity

/** 由 registerConfigPanel() 在注册/重载时调用，绑定宿主 locale 服务的 t。 */
export function setTranslator(next: Translator): void {
  current = next
}

/** 翻译一条面板文案；未绑定时原样返回 key（中文原文）。 */
export function tr(key: string, params?: TranslateParams): string {
  if (!key) return key
  return current(key, params)
}
