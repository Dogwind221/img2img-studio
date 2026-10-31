# Changelog

本文件只记录**实际跑过验证**的改动；没验证的不写。

## 2026-10-31 — 插件 0.6.0：P1（键盘可达性 / resize 遮罩 / 契约与降级 mock 测试）

### 改动（`plugins/dsh-img2img-config` → 0.6.0，技能脚本同步）

1. **标记键盘操作**：`EditorModal.tsx` 的标记行可 Tab 聚焦；↑↓←→ 每次移 1%（Shift 5%），
   Delete/Backspace 删除该标记；只在行本身聚焦时生效，不抢文本框按键。右侧面板加键盘提示（中英）。
2. **resize 遮罩预览**：新增 `raster.ts#drawSizeGuides`——预览画布叠加目标虚线框 + 模式说明：
   `cover` 用红色半透明条标出会被裁掉的边缘，`contain` 压暗留白区域，`stretch` 只画框；
   只进预览、不进导出图。尺寸区提示文案同步更新（中英）。
3. **manifest 契约**：新增 `manifest.schema.json`（JSON Schema draft 2020-12，`version` const 1，
   允许额外字段，随 npm 包分发）；技能脚本 `edit_image.mjs manifest` 新增 `validateManifest()`：
   未知 version / 非 0–1 坐标 / 缺 `files.edited` 都会报字段级错误再退出（仓库与已安装技能同步修改）。
4. **mock 测试**：
   - 插件 `scripts/verify-http.mjs` 增加 `/probe` 路由级 mock（stub `fetch`）：429 普通限流 → `error`
     且通道保持启用；402 → `arrears` 且自动关停；
   - 新增根脚本 `scripts/verify-fallback.mjs`：本地 mock HTTP 服务让 `local` 429、`openai` 200，
     子进程跑 `generate_image.mjs --provider auto --retries 0`，断言 429→备选成功、
     `provider=openai`、`fallbackDepth=1`、`attempts=2`、产物 1 个文件；
   - 新增根脚本 `scripts/verify-manifest.mjs`：schema 合法 + 消费端拒绝未知版本 / 越界坐标 / 缺底图；
   - `.github/workflows/selftest.yml` 加入后两条（PR CI 覆盖，纯离线）。
5. **顺带修复**：`generate_image.mjs` 成功路径不再 `process.exit(0)`，改为自然退出——mock 测试在
   Windows 上复现了「stdout 管道未 flush 就 process.exit 会触发 libuv 断言」的偶发非零退出；
   仓库与已安装技能脚本同步（备份 `*.bak-p1-*`）。
6. **i18n 门禁扩展**：`verify-i18n.mjs` 现在也校验编辑器词典（`locales.ts`）中英 key 对齐、
   英文值不含中文、`EditorDock.tsx`/`EditorModal.tsx` 用到的 `t()` key 全部存在。

### 验证（全绿）

```
node scripts/build.mjs            # ✅ host tsc + client typecheck + tsdown
node scripts/verify-i18n.mjs      # ✅ 面板 216 key / 273 词典 / catalog 28 / 编辑器 47 键中英对齐
node scripts/verify-catalog.mjs   # ✅ 25 项
node scripts/verify-http.mjs      # ✅ 30 项（+ /probe 429 与 402 路由级 mock）
node scripts/selftest.mjs         # ✅ 61 通过
node scripts/verify-fallback.mjs  # ✅ 6 项（429→备选 mock）
node scripts/verify-manifest.mjs  # ✅ 6 项（schema + 消费端校验）
node scripts/sync-skill.mjs       # ✅ 仓库/技能 sha256 一致 + tgz 0.6.0
```

**待重启后肉眼验证**：编辑器标记行 Tab/方向键/Delete；切换 cover/contain/stretch 时预览红/暗遮罩；
（其余契约/降级/mock 均已离线覆盖。）

## 2026-10-31 — 插件 0.5.1：P0 加固（提示 / 探测分类 / 降级可观测 / 原子写 / manifest 文档）

### 改动（`plugins/dsh-img2img-config` → 0.5.1，技能脚本同步）

1. **胶囊退化不再静默**：chip 插不进去时 dock 显示「已切到文本模式…」（`dock.fallback`，中英）
   而不是继续显示「已放回：一个说明胶囊」；`SKILL.md` 同步说明。
2. **欠费判定收紧**：新增纯函数 `classifyHttpProbe(status, body)`（`src/index.ts`）。
   只有 HTTP 402、结构化欠费错误码（`insufficient_quota` / `arrearage` / `payment_required`…）、
   或 429 且正文明确说额度/欠费才判 `arrears`；超时、5xx、普通 429 限流一律 `error`，
   不再因为错误体里偶然出现 balance/credit 就自动关停主通道。
3. **降级可观测**：`scripts/generate_image.mjs` 成功 JSON 增加 `fallbackDepth`（0=首选通道成功）
   与 `attempts`（总尝试次数）；失败 JSON 也带 `attempts`/`errors[]`。仓库与已安装技能
   `~/.agents/skills/img2img-studio/scripts/generate_image.mjs` 同步修改（备份 `*.bak-p0-*`）；
   `SKILL.md` 要求交付时汇报 provider/model/fallbackDepth/attempts。
4. **.env 原子写 + 无效写跳过**：`src/env.ts` 先写同目录临时文件再 `rename`；内容没变直接返回不写盘
   （探测/测试反复 `syncEnv` 不再改 mtime）。顺带修掉「每次重写多一行尾空行」的旧缺陷。
5. **manifest 契约文档**：插件 README 增加 `img2img-manifest.json`（version 1）完整字段表
   （version/createdAt/source/size/bgRemove/erase/markers/files、坐标归一化、mask 颜色约定）。

### 验证（离线全绿）

```
node scripts/build.mjs          # ✅
node scripts/verify-catalog.mjs # ✅ 25 项（+ 写盘不重写 / 无临时文件）
node scripts/verify-http.mjs    # ✅ 28 项（+ 7 项探测分类：402/429/5xx/401/404）
node scripts/verify-i18n.mjs    # ✅ 216 key / 273 词典 / catalog 28 条
node scripts/selftest.mjs       # ✅ 61 通过（技能脚本，含 generate_image import 与 CLI）
node generate_image.mjs --version / --dry-run  # ✅（live 技能脚本）
node scripts/sync-skill.mjs     # ✅ 仓库/技能 lib 一致（sha256 76a234a7f036…）+ tgz 0.5.1
```

**待验证**：重启宿主后，面板里点「测试」对非 429/402 的失败通道确认只标「探测失败」不关停；
编辑器拆掉胶囊服务后确认显示「已切到文本模式」。

## 2026-10-31 — 插件 0.5.0：面板正文全量中英 i18n

### 改动（`plugins/dsh-img2img-config` → 0.5.0）

- **面板正文全部走 locale 词典**：新增 `src/client/i18n.ts`（`tr()` 运行时翻译入口，注册时绑定宿主
  `ctx.locale.bind(NS)`）与 `src/client/panel-locales.ts`（273 条英文词典，key = 中文原文，zh 为 identity）。
  `registerConfigPanel` 注册 `{zh,en}` 两个字典并 `setTranslator()`；设置页「通用设置 → 语言」切换后，
  面板正文、弹层、保存前预览、试跑弹窗、账号库、catalog 展示名/说明都随 locale 立即切换。
- **覆盖范围**：`config-panel.tsx` 225 处文案由 TS AST codemod 自动改为 `tr('原文')`/`tr('原文 {p1}', {…})`，
  另有 24 处常量/数据/嵌套表达式手工包裹（LEVEL_META/STATUS_META/AUTH_LABEL/I2I_LABEL/ACTION_META、
  catalog 厂商名与说明、账号套餐标签/规则、子通道名、planSync 预览行等）。
- **新增回归 `scripts/verify-i18n.mjs`**：校验 tr key 全覆盖、英文值无中文、`{pN}` 占位符一致、
  面板不再有未包裹的 UI 中文字面量、catalog 展示文案都有英文；已并入 `npm run verify`。
- 仍为中文的部分（按设计）：宿主生成的探测说明 / 保存警告 / 扫描错误等诊断文本、用户自填通道名与账号标签。

### 验证（离线，未重启验证英文 UI，下一步由用户重启后切换语言复验）

```
node scripts/build.mjs          # host tsc + client typecheck + tsdown ✅
node scripts/verify-i18n.mjs    # ✅ 面板 tr key 216 个 / 词典 273 条 / catalog 28 条全覆盖
node scripts/verify-catalog.mjs # 23 项 ✅
node scripts/verify-http.mjs    # 21 项 ✅
```

**待验证**：重启宿主 → 设置 → 通用设置 → 语言切 English，检查面板英文排版（英文通常长 20–35%，
窄卡片可能截断，如有问题下一轮修）。

## 2026-10-30 — 插件 P2：真实 UI 复验 / 目录漂移展示 / 分发同步 / 预览修正

### 真实 UI 复验（DSH 桌面端 0.2.x，hostVersion=2，重启后实测）

- 设置 →「识图与生图」：无版本黄条；通道统计「识图 1 / 生图 4 / 启用 5」；卡片显示真实 `providerId`、
  托管通道徽标、模型摘要；账号库投影后的通道名正确（`gmail.com · 免费` / `ChatGPT 账号 1 · 免费`），
  `providers.json` 里已无 token 副本（GET 返回 hasKey=false）。
- 「＋ 添加生图通道」弹层：脚本扫描显示「生图 provider 7/11 已就绪」，逐条标「本机已就绪/依赖未就绪」，
  新增「脚本发现」区；等级默认「三级 · 兜底」；未选供应商时添加按钮禁用。
- 「🔍 探测全部余额」实测：Seedream `GET /models HTTP 200 · 396ms`、DeepSeek `HTTP 200 · 185ms`；
  两个 ChatGPT 网页账号返回「登录态已在账号库（session token）」；Codex 返回「已检测到 ~/.codex/auth.json 登录态」。
- 卡片展开：图生图能力、最近探测详情、测试 / 试跑 1 张 / 复制命令；
  「测试」单通道 → 工具栏 `测试 …：正常 · GET /models HTTP 200 · 402ms`；「复制命令」→ 剪贴板得到固定通道命令；
  「试跑 1 张」弹出真实出图确认（本次取消，未消耗额度）。
- 「保存配置」→ `已保存，并已同步到两份 .env`；保存后 `GEN_PROVIDER_ORDER` 与两份 `.env` 内容实测正确
  （`VISION_API_KEY` 等未被误删）。

### 修复（UI 复验发现）

- **预览把掩码 Key 误判成删除**：client 拿到的是 `sk-b••••0f4f` 这类掩码值，`planSync()` 选识图主通道时
  排除了掩码值，导致预览显示「删除 VISION_API_KEY / VISION_MODEL / VISION_BASE_URL」，而宿主实际保存是保留。
  现在掩码值也算已配置主通道；新增回归用例（23 项里的「预览场景（client 掩码 key）」）。

### P2 改动（`plugins/dsh-img2img-config` → 0.4.0）

- **目录以脚本为真源的第一步**：`/scan` 结果里「脚本支持但静态目录未收录」的 provider 在添加弹层单独列出
  （只读 + 「升级插件目录」提示），不再假装能配；静态目录继续负责 env 映射。
- **账号刷新不覆盖未保存编辑**：账号库变更后的自动刷新改为「有 dirty 改动时只提示、不重载」，
  避免把用户正在编辑的通道冲掉。
- **分发同步脚本 `scripts/sync-skill.mjs`**：一条命令完成构建 → 覆盖已安装技能里的插件包 →
  同步 SKILL/README/CHANGELOG → 重打 `dsh-img2img-config-<version>.tgz`（旧 tgz 删除）；
  不改技能运行时 `scripts/` `references/` `engines/`（线上可能比仓库新）。
  已实际执行：仓库与 `~\.agents\skills\img2img-studio\plugins\dsh-img2img-config` 的
  `lib/client.js` sha256 一致（`7572e08808bf…`），tgz 更新为 0.4.0。
- **评估后不做 i2i 自动链过滤**：脚本里只有 Z.AI 明确不支持参考图，且它在发请求前就抛错、
  自动链已即时降级；Qoder CLI 实际支持 `--attachment`，没必要按能力预跳过（改了反而多一处需要维护的能力表）。

### 仍未做

- **面板正文 i18n**：约 200 条中文文案分布在 8 个组件里，需要先做「props 传 t + 文案 key 化」的重构，
  再逐条补英文；当前只在 README/已知限制里标注，留作独立一轮（不做半吊子翻译）。

### 验证

```
node scripts/build.mjs          # host tsc + client typecheck + tsdown ✅
node scripts/verify-catalog.mjs # 23 项 ✅（新增掩码预览回归）
node scripts/verify-http.mjs    # 21 项 ✅
node scripts/sync-skill.mjs     # 构建 + 同步 + tgz + sha256 校验 ✅
```

合计 44 项离线断言 + 上述真实 UI 操作（真机、未消耗出图额度）。

## 2026-10-30 — 插件 P1：账号库联动 / 每行测试与试跑 / 脚本扫描

### 改动（`plugins/dsh-img2img-config` → 0.3.0）

- **账号库 = chatgpt-web 通道唯一真源**（`planAccountChannels()`，纯函数放 `src/catalog.ts`）：
  新增账号 / 改备注 / 改套餐 → 自动补或更新 `chatgpt-web@<账号UUID前8位>` 生图通道；删账号连带删通道；
  账号库 GET/任何写操作后都会投影一次。`providers.json` 不再保存 token 副本（旧数据首次读取时自动清空），
  登录态只存 `chatgpt-accounts.json` 一份；`applyWire` 也强制 chatgpt-web 行 apiKey 为空。
  只有 **session token** 的账号才建网页通道——只有 access token（Codex 探测写入）的账号无法注入浏览器 cookie，
  不生成 `chatgpt-web@` 行（实测 DOGWIND 账号就是这种）。
- **每行「测试」（探活，不花钱）**：托管通道查本机依赖（qoderclicn bundle、`~/.codex/auth.json`、
  bun + `engines/direct-api`、账号库 session token）；API 通道 `GET {base}/models` 并分类为
  正常 / Key 无效(401/403) / 欠费(错误码) / 端点无 `/models`(404/405) / 不可达，`detail` 回传面板显示。
- **每行「试跑 1 张」**：确认弹窗后由宿主 spawn `generate_image.mjs --provider <providerId>`
  （direct 带 `--direct-provider`），固定 1024×1024 / normal 档 / `--json`，240s 超时；
  返回 provider/model/文件路径/耗时，失败带 stderr 末三行。
- **`GET /scan` + 弹层「本机已就绪/依赖未就绪」**：宿主跑两份脚本的 `--list-providers`（15s 超时），
  面板供应商弹层据此标注本机真实可用的通道；脚本缺失时只在弹层提示，不影响手动添加。
- **每行「复制命令」**：复制固定该通道的 `--provider …` 命令行（direct 带子通道）。
- **图生图能力标注**：卡片展开显示「支持图生图 / 仅文生图 / 主体参考 / 看子通道」+ 最近探测说明。
- 账号行新增提示：该账号会投影成生图通道、改备注/套餐同步通道名、删账号连带删通道。

### 清理

- 已从技能 `.env` 删除两个**没有任何脚本读取**的手写变量：`IMG_BLOCKED_PROVIDERS`、
  `IMG_CHATGPT_WEB_WAIT_MS`（全仓 + 已装技能 grep 无消费方；停用通道现在由面板 enabled 开关负责）。
- 已对当前机器执行一次账号→通道迁移（先备份到 `providers.json.bak-p1-*` / 两份 `.env.bak-p1-*` 与 `*.bak-p1b-*`）：
  清掉 `providers.json` 里两个 chatgpt-web 行的 token 副本、通道名对齐账号库、补 `providerId`；
  误为 DOGWIND（只有 access token）建出的 `chatgpt-web@d8fcafde` 行已删除。`.env` 里的
  `IMG_CHATGPT_WEB_ACCOUNTS` 标签也随之修正，`GEN_PROVIDER_ORDER` 保持原顺序。

### 验证（离线，未花额度、未动真实用户数据）

```
node scripts/build.mjs          # host tsc + client typecheck + tsdown
node scripts/verify-catalog.mjs # 22 项（新增账号投影/匹配/清 token）
node scripts/verify-http.mjs    # 21 项（新增 GET 投影、access-token-only 不建通道、删账号、/probe detail、/scan、/try 错误路径）
```

两项合计 43 项全过；`scan` 的解析逻辑另用真实脚本 `--list-providers` 输出验证过（无需联网）。
真实「试跑」出图与浏览器 UI 需重启宿主后人工点一次验证（本次未调用，避免消耗额度）。

## 2026-10-30 — 插件 P0：供应商选择 / providerId 归一化 / 保存前预览

### 问题（实机确认）

- 面板「＋ 添加生图通道」没有选择器：按内置 `TEMPLATES` 顺序补第一条没加过的，等级也照抄模板
  （MiniMax=三级 / Seedream=二级），所以只能「按梯队自动加入」，加不到想要的供应商；
- 新通道 id = 模板 id + 时间戳，宿主 `GEN_ENV_KEYS` 精确匹配不上 → key 不写、
  `GEN_PROVIDER_ORDER` 里的 id 被脚本 `orderedChain` 忽略；删过行再保存还会把「面板不认识的 provider」
  对应 env 写空（`''` = 删行），误删手写 Key；
- 生图模板只有 Seedream/MiniMax/Qoder 三家，且 Qoder 模板 id 是 `qoder-gen`（脚本认 `qoder`），
  DashScope/OpenAI/Z.AI/直连引擎等脚本支持的 provider 在面板里加不出来；
- Seedream/Z.AI/MiniMax 的「模型链」面板改了不落盘（宿主只写 key，不写 `*_IMAGE_MODEL`）。

### 改动（`plugins/dsh-img2img-config` → 0.2.0）

- **新增 `src/catalog.ts`（双端唯一真源）**：供应商目录（dashscope/openai/zai/seedream/minimax/qoder/
  codex-cli/direct/local/deepseek/qoder-cli，含认证方式、生图 env 映射、i2i 能力、直连 12 子通道）、
  `normalizeProviderId()`、`channelIdFor()`、`planSync()`（同一份 .env 写入计划）、`validateProviders()`；
- **添加通道 = 供应商选择弹层**：可搜索、显示 providerId/认证方式/图生图能力/「已配置 N 条」，选完再选等级；
  同一 provider 可加多条（id `providerId#2`），`GEN_PROVIDER_ORDER` 按 providerId 去重；
- **保存前预览**：面板「👁 预览 .env」用与宿主相同的 `planSync()` 展示写入/删除/保持的每一条 env、
  两条生效链与警告；保存前校验未知生图 providerId / 非法直连子通道，不再「保存成功但链是死的」；
- **providerId 归一化**：旧 `qoder-gen` → `qoder`，旧时间戳后缀 / `#2` 重复通道都能映射回脚本 id；
- **env 同步策略**：补 `SEEDREAM_IMAGE_MODEL/BASE_URL`、`ZAI_IMAGE_MODEL/BASE_URL`、
  `MINIMAX_IMAGE_MODEL/BASE_URL`、`QODER_IMAGE_MODEL`、`DIRECT_PROVIDER`、`IMG_HTTP_URL`；
  不再对「面板没管过」的 provider 写空删 Key；空 Key 保存=保持原值，只有「清空」按钮（`clearKey`）才删；
- **KeyChip / 卡片**：头部显示真实 providerId；DashScope 生图与直连引擎不再显示会误导的模型链编辑；
  托管通道不显示 Key 输入；Base URL 只读范围按认证方式判断；
- **宿主版本握手**：`GET /providers` 返回 `hostVersion`；新客户端连旧宿主时顶部提示「请重启 DSH Web」并禁用保存
  （客户端 bundle 在激活时快照，必须重启宿主才换新代码）。

### 验证（离线，未花额度）

```
node scripts/build.mjs                  # host tsc + client typecheck + tsdown + banner 归一化
node scripts/verify-catalog.mjs         # 19 项：归一化 / 链与 env 计划 / 删-停用-保持 / 校验 / 写盘冒烟
node scripts/verify-http.mjs            # 15 项：真实 handler + mock ctx + 临时 HOME，GET/POST/校验/掩码/clearKey
```

两项合计 34 项全过；真实出图与浏览器 UI 需重启宿主后人工复验（本次未重启，避免打断当前会话）。

## 2026-09-30 — DSH 0.2.0 适配收尾

### 环境（实测）

| 项 | 值 | 获取方式 |
|---|---|---|
| DSH 桌面端 | `0.2.0-rc.2` | `dsh --version` |
| 运行时 Node / bun | `v24.18.0` / `1.3.14` | `node -v` / `bun -v` |
| 平台 | Windows（PowerShell 5.1 + pwsh） | — |

### 原生能力复验（0.2.0-rc.2）

- `read_image` 原生识图**可用**：本会话用本地图片路径直读成功（800×660 JPEG 正常显示），
  并回传 `Normalized copy (read-only; may be resized or re-encoded): <路径>` + `sha256:<hex>`。
  结论不变：多模态会话直接读图，不需要 dsh-vision-skill。
- 官方没有内置生图工具 → 本技能的 `generate_image.mjs` / `engines/direct-api` 仍是唯一出图手段。

### 文档改动（`SKILL.md`）

1. **精简已被原生替代的段落**（不改任何脚本、命令、通道名、provider id、`.env` 变量名）：
   - 「L1 识图」的三段判定说明压成两行；结论保留（多模态 → `read_image`；纯文本 → `vision.js`），
     删除重复论证；明确 0.2.x 下调用一次 `read_image` 即知走哪条路。
   - 主流程第 1 步的附件路径取法（①`Normalized copy` ②`attachmentId` ③本地路径/URL）保留三步顺序，
     压缩措辞；重申报质警告的交叉引用，去掉与下方表格重复的论证。
   - 明确写出：**多模态会话不需要 dsh-vision-skill，只有纯文本模型才走识别链**。
2. **版本声明口径**：`DSH 0.1.3+` → `基线 DSH 0.1.3+，0.2.x 适配 —— 0.2.0-rc.2 复验`（两处：
   路径约定、L1 判定行）。历史事实（0.1.3 引入面板、0.1.5 起原生给归一化副本）原样保留，不篡改。

结果：`SKILL.md` 26123 B → 25826 B（`git diff --stat`: 10 insertions, 11 deletions）；
frontmatter 的 `description` 未改动，**432 字符 ≤ 500**（`catalogDescriptionMaxLength` 默认值 500，
见 `@deepseek-ai/dsh-tool-skill/lib/index.js` 的 `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH`，
其 `catalogDescription` 先 `replaceAll(/\s+/g,' ').trim()` 再按长度截断）。

### 插件 `plugins/dsh-img2img-config` 在 0.2.0-rc.2 上的兼容性

- **声明**（`package.json`，未改动）：`version 0.1.0`、`private: true`，
  peer `@deepseek-ai/cordis >=4.0.0-rc <5`、`@deepseek-ai/dsh-client-ui-slots >=0.0.1-rc <2`。
- **桌面端实际内置**（从 `resources/app.asar` 内 `package.json` 读出）：
  `@deepseek-ai/cordis@4.0.4`、`@deepseek-ai/dsh-client-ui-slots@0.2.0-rc.2`。
- **区间判定**：用 dsh 自带的 `semver@7.8.5`（同样从 app.asar 解出，路径 `/dsh/node_modules/semver`）：
  `satisfies('4.0.4', '>=4.0.0-rc <5', {includePrerelease:true}) === true`；
  `satisfies('0.2.0-rc.2', '>=0.0.1-rc <2', {includePrerelease:true}) === true`
  （对照组 `^0.1.7-rc.1` vs `0.2.0-rc.2` → `false`，说明判定器确实在比对版本）。
  注意 `dsh-app-boot` 的 `evaluatePluginCompatibility()` 对 peer 只比对 `@deepseek-ai/dsh` 与
  `@deepseek-ai/dsh-*` 两类名字、且用 `{includePrerelease:true}`；`@deepseek-ai/cordis` 不在其覆盖范围内，
  但 `@deepseek-ai/dsh-client-ui-slots` 在内且区间满足。
- **装配**：插件已用
  `dsh plugin --profile desktop add link:F:/dsh/img2img-studio/plugins/dsh-img2img-config`
  挂进 desktop profile（`~/.dsh/profiles/desktop/package.json` 的 `dependencies` 里有该 link，
  `dsh.profile.bundles` 数组末位有 `dsh-img2img-config`）。
- **组合干跑**：`dsh --profile desktop --dump-config` 会被拒绝
  （`error: profile "desktop" is managed exclusively by the Electron application`），
  于是按该 profile 的文件原样（`package.json` / `cordis.yml` / `cordis.patch.yml` / `pnpm-workspace.yaml`
  + `node_modules` junction）在 `%TEMP%` 下复制成一个临时同名结构并指定 `DSH_HOME`：
  **`dsh --profile imgsynccheck --dump-config` → exit 0，1378 行组合结果，
  无 `skipping profile bundle`、无 incompatible 告警**，且末段明确出现：

  ```yaml
  # == dsh-img2img-config
  - id: dsh-img2img-config
    name: dsh-img2img-config
  ```

  （`loadProfileDirectory()` 在组合期对每个 bundle 跑 `evaluatePluginCompatibility()`，
  不通过就写进 `skippedBundles`；干跑无该输出即表示通过。）

### 自测（纯离线，未改一行业务代码）

```
> node scripts/selftest.mjs --verbose
合计: 61 通过 / 0 失败 / 0 跳过
{"ok": true, "summary": "img2img 自测 61 通过 / 0 失败 / 0 跳过", "counts": {"pass":61,"fail":0,"skip":0}}

> bun test engines/direct-api/scripts
 106 pass
 0 fail
Ran 106 tests across 14 files. [845.00ms]
```

（bun 通过 `bun.ps1` shim 启动时 PowerShell 会打一条 `NativeCommandError` 噪声，
但标准输出完整、`bun test` 自身汇总为 106 pass / 0 fail。）

### 未验证 / 存疑

- **没能对 desktop profile 直接跑 `--dump-config`**（Electron 独占管理），只做了同构临时 profile 的干跑等价验证。
- **没有在运行中的 GUI 里目视确认**设置页「识图与生图」面板与输入框「图片编辑」条是否正常渲染——
  只证明了插件参与并通过组合。
- 引擎 provider 的**真实出图**未复验（会花钱/联网），只跑了离线单测。

### ⚠️ 同步事故记录：安装副本里一个未提交的 `generate_image.mjs` 被覆盖

- **事实**：同步前安装副本 `scripts\generate_image.mjs` = **64154 B**（CRLF），仓库工作区 = 58425 B（CRLF）/ HEAD blob = 57282 B（LF，差值是行尾）。
  按"仓库 → 安装副本"方向同步后，副本那个大约多 5.7 KB（`git diff --stat`：103 insertions / 29 deletions）的版本被覆盖。
- **恢复尝试（全部失败）**：全盘按文件名搜索、git 历史/全部对象/stash/分支、卷影副本（需管理员，查询被拒）、
  12 个近期会话日志（zstd 逐帧解压后只有体积统计与 4 个 hunk 头）、`%TEMP%` 溢出文件；**未找到可恢复副本**。
- **丢失内容是什么**（据历史会话日志残留片段与 hunk 头可确认，属 **chatgpt-web 网页通道的登录/会话失效诊断**）：
  - `LOGIN_SIGNAL`（页面登录失效文案正则）—— 当前版本不存在
  - `loginDiag(reason)` 异步诊断助手 —— 当前版本不存在
  - 额度用尽分支追加"页面同时出现登录相关文案，也可能需要重新登录"提示（当前 L909 无此分支）
  - 超时分支文案：`页面没有登录失效文案，判断为「网页出图慢或网络/Cloudflare 卡住」，可换通道或稍后重试（可用 IMG_CHATGPT_WEB_WAIT_MS 调整等待时长，当前 ${waitMs}ms）`
  - 另触及 `detectProviders()` / `loadPlaywrightCore()` / `chatgptAccountsFile()` / `chatgptWebToken()` 四个函数
- **影响**：网页通道在"登录态失效 / Cloudflare 卡住"场景下的**可诊断性退回到仓库版水平**；生图主流程与其余通道不受影响
  （离线自测 61 通过 / 0 失败，`bun test engines/direct-api/scripts` 106 通过）。
- **下次同步必做**：先逐文件判定哪边更新，再决定方向；**不要**对可能"副本领先"的目录直接 `/MIR`。
  ```powershell
  # 同步前扫描：列出两边体积不同的文件，逐个判断方向
  $repo='F:\dsh\img2img-studio'; $inst="$env:USERPROFILE\.agents\skills\img2img-studio"
  Get-ChildItem $repo -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\|\\node_modules\\' } | ForEach-Object {
    $rel=$_.FullName.Substring($repo.Length+1); $i=Join-Path $inst $rel
    if ((Test-Path $i) -and (Get-Item $i).Length -ne $_.Length) { "{0,-46} repo={1} inst={2}" -f $rel,$_.Length,(Get-Item $i).Length }
  }
  ```
- **可选补救**：按上述片段在仓库版上重新实现 `LOGIN_SIGNAL` / `loginDiag` / `IMG_CHATGPT_WEB_WAIT_MS`（属新代码，需先确认再动）。
