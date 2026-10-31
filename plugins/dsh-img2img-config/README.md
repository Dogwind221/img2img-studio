# dsh-img2img-config

img2img-studio 的 **DSH 插件**：一个包，两个 UI 面，一套宿主路由。

> 本包原名 `dsh-img2img-editor`（只有编辑器）与 `dsh-vision-config`（只有设置面板），
> 现合并为 `dsh-img2img-config`。装技能就装它，两个面一起有。

| UI 面 | 位置 | 干什么 |
|---|---|---|
| **图片编辑器** | 输入框上方 dock「图片编辑」 | 对输入框里的图片做标记 / 抠图 / 涂抹擦除 / 改尺寸，结果回填输入框 |
| **供应商面板** | 设置 → **识图与生图** | 配识图与生图的 API Key / 模型 / 端点 / 优先级 / ChatGPT 网页账号额度 |

两个面共用一份「配置即写回 `.env`」的契约：面板保存时把供应商写进
`~/.agents/skills/img2img-studio/scripts/.env`（生图）与
`~/.agents/skills/dsh-vision-skill/scripts/.env`（识图），技能脚本无需再读别处。

---

## 面 ①：图片编辑器

图片放进对话输入框后，在输入框上方的「图片编辑」条上打开全屏编辑器，做四件事：

1. **标记修改点**：在图上点一下加一个带编号的标记（可拖动），右侧每个标记配一个输入框写「这一处要怎么改」；
   标记行支持键盘：Tab 聚焦，↑↓←→ 每次移 1%（Shift 5%），Delete/Backspace 删除；
2. **移除背景**：本地纯色背景抠图即时预览（复杂背景交给云端抠图，见技能脚本）；
3. **涂抹擦除**：画笔涂抹要处理/重绘的区域，可「擦回」、撤销一笔、全部清除，并写涂抹区域的统一处理要求；
4. **调整大小**：比例预设（原图 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16）+ 宽高 + 裁切填满 / 完整放入 / 拉伸；
   预览画布会叠加视觉提示——cover 的红色边缘是会被裁掉的部分，contain 的深色区域是留白。

点「放回输入框」后：编辑结果作为**附件**回到输入框（`marked-*.png` 带标记的位置图 /
`edited-*.png` 干净底图 / `mask-*.png` 涂抹掩码 / `img2img-manifest.json` 机器可读清单），
草稿里只多出**一个胶囊**「图片编辑 · N 处标记」。JSON 不写进输入框正文——胶囊的载荷里带着完整
brief（附件清单 + 标记坐标与改法 + 请求动作 + 一行 `JSON:` manifest），发送那一刻由胶囊所属
reference source 的 codec 展开成模型文本，所以**模型看到的与旧版写块时完全一致**，用户看到的只有一个胶囊。

胶囊插不进去时（客户端没有触发服务、或草稿版本已变）退化为正文里一段 `[img2img] … [/img2img]`
文本块：内容同上但不含 `JSON:` 行（清单已在附件里），再次编辑会整块替换而不是叠加；
dock 上会显示「已切到文本模式」提示，不是静默降级。
用户按发送，agent 据此调 `img2img-studio/scripts/edit_image.mjs` 交给生图供应商。

### `img2img-manifest.json` 字段（version 1）

机器可读清单，附件同名文件；下游（agent / `edit_image.mjs`）以这些结构化字段为准，不要从胶囊文案反推坐标。

| 字段 | 类型 | 说明 |
|---|---|---|
| `version` | `1` | 清单格式版本；消费方先检查，未知版本按宽松方式解析 |
| `createdAt` | ISO 字符串 | 生成时刻 |
| `source` | `{ name, width, height }` | 原图文件名与像素尺寸 |
| `size` | `{ width, height, mode, changed }` | 输出尺寸；`mode` = `cover` / `contain` / `stretch`；`changed` = 是否做过尺寸调整 |
| `bgRemove` | `{ requested, localPreview, tolerance }` | 是否请求去背景、是否本地预览、容差（8–90） |
| `erase` | `{ strokes, prompt }` | 涂抹笔数与统一处理要求 |
| `markers[]` | `{ id, x, y, text }` | 标记：`x`/`y` 是 **0–1 归一化坐标**（左上 0,0），`text` 为该处改法 |
| `files` | `{ edited, marked?, mask? }` | 附件文件名（与输入框附件同名）；`marked`/`mask` 仅在有标记/涂抹时存在 |

`mask-*.png` 约定：白色 = 要处理/重绘区域，黑色 = 保留；尺寸与 `edited-*` 一致。

机器可读定义：插件包内的 [`manifest.schema.json`](manifest.schema.json)（JSON Schema draft 2020-12，
`version` 固定为 1，允许额外字段）；技能脚本 `edit_image.mjs manifest` 会先按 version 1 校验再执行。
后续版本只新增字段、不改已有字段语义；消费方遇到未知 version 应显式报错而不是猜测。

## 面 ②：设置 → 识图与生图

多供应商管理面板，识图与生图**各一条链**，每个通道可开关、可拖拽排序、可跨组改级。

界面按「厂商卡片」组织，**长面板可折叠**：

- **添加通道 = 选择供应商**：点「＋ 添加生图/识图通道」弹出供应商目录（可搜索），列表项带
  `providerId`、认证方式（API Key / 本机 CLI 登录 / 账号库登录态）、图生图能力与「已配置 N 条」标记；
  打开时还会跑一遍脚本 `--list-providers`，用「本机已就绪 / 依赖未就绪」标出本机真的能用的通道；
  脚本里存在、静态目录没收录的 provider 会单独列在「脚本发现」区（只读展示 + 升级插件提示，
  不再假装能配）。选完再选等级（主/备/兜底）添加。目录与 `src/catalog.ts` 同一份数据，
  生图侧只列 `generate_image.mjs` 真正支持的 provider，不再靠「按模板顺序自动补一条」；
- **账号库驱动 chatgpt-web 通道**：ChatGPT 网页账号是「唯一真源」——在下方账号库新增账号/改备注/改套餐，
  会自动补/更新对应 `chatgpt-web@<账号UUID前8位>` 生图通道；删账号连带删通道；
  `providers.json` 不再保存登录态副本（旧数据里的 token 副本在首次读取时自动清掉），
  登录态只在 `chatgpt-accounts.json` 存一份；账号变更后的自动刷新会避开未保存的通道编辑
  （有改动时先提示保存，不覆盖）；
- **每行测试 / 试跑 / 复制命令**：卡片展开后
  「测试」= 探活不花钱（API 通道按 正常 / Key 无效 / 欠费 / 端点无 `/models` / 限流 / 不可达 分类；
  超时、5xx、普通 429 限流只算「探测失败」，不判欠费；
  CLI/账号通道查本机 qoderclicn、`~/.codex/auth.json`、bun + 直连引擎、账号库 session token）；
  「试跑 1 张」= 明确确认后走 `generate_image.mjs` 真实生成一张 1024×1024（会消耗额度，最长 240s）；
  「复制命令」= 复制固定该通道的 `--provider …` 命令行；
- **一条供应商可多条通道**：同一 provider 可以加多条（多 Key / 多中转），通道 id 用
  `providerId#2` 之类区分，`.env` 按链序取第一条的 Key/端点；卡片头部显示真实 `providerId`，
  就是 `--provider` / `GEN_PROVIDER_ORDER` 认的值；
- **厂商卡片**：一个通道 = 一张卡片。收起时只显示 厂商名 / 模型链摘要 / **掩码 Key** / 等级 / 开关，
  展开后才出现模型链编辑、Key、Base URL 与上下移/删除，默认全部收起，面板一眼看完；
- **模型链**：卡片内是该厂商对应的模型链（按降级顺序），chip 带序号，可增删；常用模型按厂商给建议，
  收起摘要直接显示 `模型 N · 第一个 → 第二个 +N`；DashScope 生图链由脚本内置、直连引擎用子通道选择，
  这两种卡片不显示模型链编辑（避免「改了不生效」）；
- **Key 掩码**：配置过的通道在卡片右侧显示 `🔑 sk-b••••0f4f`（前端展示用掩码，明文不出浏览器）；
  没配置就什么都不显示；托管通道（Qoder CLI / Codex 登录态 / ChatGPT 网页账号 / 直连引擎）显示 `🔐 凭据已存`；
  留空保存 = 保持原值，点「清空」才删 Key；
- **三级优先级**：一级「主通道」→ 二级「备用」→ 三级「兜底」，`auto` 链按此顺序依次降级；
  分组标题也可点开/收起；
- **拖拽排序**：拖卡片在组内排序，拖到别的等级组自动改级，也可用卡内 ▲▼ 与等级下拉；
- **保存前预览**：工具条「👁 预览 .env」用与宿主完全相同的 `planSync()` 展示将写入/删除/保持的
  每一行 env 与两条生效链，保存前的警告（重复供应商、启用但没填 Key、直连子通道非法）也在里面；
- **保存校验**：未知生图 `providerId`、非法直连子通道会被拦下并给出可用清单，不再「保存成功但链里是死 id」；
- **写盘安全**：`.env` 先写同目录临时文件再 `rename` 原子替换（写一半被杀不会留半截文件）；
  内容没变就不写盘——探测/测试反复 `syncEnv` 不会无谓改 mtime；
- **余额探测**：`GET /models` 只把三种证据当欠费——HTTP 402、结构化欠费错误码
  （`insufficient_quota` / `arrearage` / `payment_required`…）、或 429 且正文明确说额度/欠费；
  欠费通道自动关停并标红；超时、5xx、普通 429 限流只标「探测失败」，不会误关停主通道；
  CLI / 账号类通道跳过 HTTP 探测；
- **ChatGPT 网页出图账号库**：逐账号可折叠（摘要显示套餐与 24h 已用张数），展开后可贴
  `__Secure-next-auth.session-token`、按后端实际出图时刻统计滚动窗口，Codex 账号额外显示 5h/7d 窗口百分比；
- **保存即写回** `.env`：`VISION_PROVIDERS` / `VISION_API_KEY` / 各 `*_API_KEY` /
  `*_IMAGE_MODEL` / `*_BASE_URL` / `GEN_PROVIDER_ORDER` / `DIRECT_PROVIDER` /
  `IMG_CHATGPT_WEB_ACCOUNTS`，**技能新会话生效**；面板管过、后被删掉或停用的通道才清 env，
  面板从没管过的 key 保持原值（手写配置不再被误删）；
- **常驻工具条**（sticky）：通道统计、未保存提示、预览 .env、探测全部余额、保存配置。

> **升级插件后必须重启宿主**（桌面 App 或 `dsh web` 进程）：客户端 bundle 在插件激活时做快照，
> 只刷新页面不会换新代码。新客户端连到旧宿主时面板顶部会出现版本提示，并暂时禁用「保存配置」。 

折叠状态写 `localStorage`（键 `dsh-img2img-config:ui-collapse:v1`），跨刷新记忆。

面板只服务本机两个 skill，因此**两个 skill 只装一个也能用**：写 `.env` 前会先把目标目录建出来
（早前版本会以 `ENOENT` 失败并拖垮整次保存）。

---

## 结构

| 半边 | 位置 | 作用 |
|---|---|---|
| 供应商目录 | `src/catalog.ts` | **双端唯一真源**：供应商目录（providerId / 认证方式 / 默认模型 / 生图 env 映射 / 图生图能力）+ `planSync()` 同步计划器 + `validateProviders()` 保存校验 + 旧 id 归一化；host 与 client 共用同一份 |
| host 入口 | `src/index.ts` | 注册 `webServer` 路由 `/dsh-img2img-config/{providers,probe,scan,try,chatgpt-usage}`；供应商库与 ChatGPT 账号库的读写、账号→通道投影、执行 `planSync()` 写 `.env`、探测 / 试跑 / 脚本扫描 |
| host `.env` 工具 | `src/env.ts` | `.env` 解析 / 合并写回（保留注释与未知行，`''` = 删行） |
| client 入口 | `src/client/index.tsx` | 注册 dock 条目 + 触发源编解码，并把设置面板一并 `registerConfigPanel(ctx)` |
| client 面板 | `src/client/config-panel.tsx` | 设置页「识图与生图」整块 UI（供应商选择弹层、保存前预览、三级通道卡片、账号库） |
| 编辑器 UI | `src/client/EditorDock.tsx` / `EditorModal.tsx` | dock 条目与全屏编辑器（标记行键盘操作、resize 遮罩提示） |
| 光栅核心 | `src/client/raster.ts` | 本地抠图（边界泛洪）、resize/cover/contain/stretch、涂抹掩码回放、编号标记绘制、size 遮罩提示、导出 `edited`/`marked`/`mask` |
| 交付格式 | `src/client/manifest.ts` | 生成 brief（两种载体）、清单文件、草稿合并规则 |
| manifest 契约 | `manifest.schema.json` | `img2img-manifest.json` 的 JSON Schema（draft 2020-12，version 1）；随 npm 包分发，技能脚本按它校验 |
| 胶囊编解码 | `src/client/brief-source.ts` | 注册一个不产出菜单行的触发源，只为持有胶囊 codec |
| 回归测试 | `scripts/verify-i18n.mjs` / `scripts/verify-catalog.mjs` / `scripts/verify-http.mjs` | 离线跑：文案词典 / id 归一化 / 链与 env 计划 / 删-停用-保持语义 / 保存校验 / 真实 HTTP handler（临时 HOME + mock ctx + stub fetch 探测分类）；`npm run verify` |
| 分发同步 | `scripts/sync-skill.mjs` | 构建 + 覆盖已安装技能里的插件包 + 同步技能文档 + 重打 `dsh-img2img-config-<ver>.tgz`（不改运行时 scripts/references/engines）；`npm run sync` |
| 文案词典 | `src/client/i18n.ts` / `src/client/panel-locales.ts` | 面板正文 `tr()` 翻译入口 + 中/英词典（key = 中文原文，zh identity、en 英文）；`scripts/verify-i18n.mjs` 校验漏翻/占位符/未包裹中文 |

配置持久化目录：`~/.dsh/dsh-img2img-config/`（`providers.json` + `chatgpt-accounts.json`）。
首次启动若发现旧的 `~/.dsh/dsh-vision-config/` 而新目录还不存在，会**整体复制**一次过来
（旧目录保留不删），老用户不必重配。

客户端只用三处 DSH 内部面（编辑器部分）：

- `resolveDraftAttachments(ids)` —— 把输入框里的图片草稿解析成 `{file, previewUrl}`；
- `createDrafts(sessionId, files)` / `releaseDraftAttachment(id)` —— 把编辑结果（含清单文件）登记成新的草稿附件；
- `sessions.scope(sessionId)` → `conversation.input.for(actx).insertReference(...)` —— 往输入框插一个胶囊（与 `@文件` 同一套引用机制）。

前两者是**惰性 `ctx.get('conversation')` 读取**（与 dsh-better-sidebar 同样的做法），第三处同理惰性读取；
`inputTriggers`（胶囊 codec 的注册处）走 `ctx.inject`，因为批量启动时该服务可能晚于本插件的 `apply`
——一次性 `ctx.get` 会看不到它，于是静默留下一个**展开不了**的胶囊，发送被拒。
服务缺失或方法改名时降级为正文文本块 + 可见提示，不崩。

## 构建与安装

```bash
# 1) 构建（host tsc + client tsdown + banner 归一化；Node 版脚本，沙箱里无需 bash）
node scripts/build.mjs
# 2) 离线回归（不联网、不碰真实 ~/.dsh 与技能 .env）
node scripts/verify-i18n.mjs && node scripts/verify-catalog.mjs && node scripts/verify-http.mjs
# 3) 同步到已安装技能（构建 + 覆盖 skill 里的插件包 + 同步 SKILL/README/CHANGELOG + 重打 tgz）
node scripts/sync-skill.mjs
# 4) 运行时注入（免重启）或写进 profile 的 bundles 列表持久化：
#    dev_inject_plugin <本目录>
#    dev_install_package <本目录>
# 已按 profile bundles 装配的情况：改完必须重启宿主进程，客户端 bundle 才会换成新快照
```

构建依赖从 DSH checkout 链接（`@types/node`、`@deepseek-ai/cordis`、`@types/react`、`tsdown`）；
`scripts/build.sh` 是同一流程的 bash 版本，供注入器的 `dev_build_plugin` 调用。

> `@deepseek-ai/cordis` 必须能解析：宿主半边声明 `apply(ctx: Context)`，类型找不到时
> `ctx.*` 会**静默退化成 `any`**，`webServer` 的 handler 参数也一起丢掉上下文类型，
> 于是编译期什么都发现不了——两个 build 脚本都显式链接了它。

打包后 `scripts/normalize-client-banner.mjs` 把 tsdown 折成多行的 banner 压回一行，
保证 `lib/client.js` 以 `window.__ModuleLoader__.load({ id: "dsh-img2img-config", …` 精确开头。

## 已知限制

- **升级插件后必须重启宿主**：客户端 bundle 在插件激活时做快照、rev 不可变，刷新页面拿到的仍是旧 bundle；
  新客户端连旧宿主时顶部提示版本不匹配并禁用保存（避免新通道的 `.env` 同步走旧逻辑）。
- **生图 model/base 的落点跟随脚本**：openai→`IMG_MODEL/IMG_BASE_URL`、seedream→`SEEDREAM_IMAGE_MODEL/SEEDREAM_BASE_URL`、
  zai/minimax 同理；DashScope 生图链由脚本内置（面板模型只作记录）、`direct` 由子通道决定（写 `DIRECT_PROVIDER`）。
- **`.env` 不再自动删除面板不认识的 Key**：只有「面板里管理过、后来被删掉或停用」的通道才清 env；
  想删 Key 请点卡片里的「清空」（保存时带 `clearKey`）。
- **「试跑 1 张」会花钱**：它走真实出图链路（固定 1024×1024 / normal 档），点确认才开始；
  ChatGPT 网页通道会开无头浏览器，可能要 1-2 分钟，最长 240 秒超时。
- **「本机已就绪」依赖技能脚本**：`scan` 路由跑的是 `~/.agents/skills/img2img-studio/scripts/generate_image.mjs --list-providers`；
  脚本缺失（只装了插件没装技能）时只在弹层里显示「脚本扫描失败」，不影响手工添加。
- **脚本比插件新时只提示不改装**：脚本 `--list-providers` 多出来的 provider 会列在弹层「脚本发现」区，
  但不允许添加（静态目录没有它的 env 映射）；需要先升级插件目录，再重新扫描。
- **面板已中/英双语**：面板正文、弹层、预览、试跑、账号库文案都走 locale 词典
  （`src/client/panel-locales.ts`，zh = 中文原文，en = 英文）；设置页「通用设置 → 语言」切换后立即生效。
  仍为中文的部分：宿主生成的探测说明 / 保存警告 / 脚本扫描错误（诊断文本，按服务器语言输出）、
  用户自己填的通道名与账号标签（数据，不翻译）。新增文案漏英文时 `scripts/verify-i18n.mjs` 会拦。
- **账号库只投影网页账号**：Codex-only 账号（只有 `codexAuth`）与只有 access token 的账号不生成
  `chatgpt-web@` 通道（浏览器出图必须有 session token）；Codex 出图走独立的 `codex-cli` 通道（读 `~/.codex/auth.json`）。
- **不做任意矩形裁剪**：`cover` 居中裁切覆盖了绝大多数改比例需求；自由裁剪框未做。
- **本地抠图只对纯色/近色背景有效**（边界泛洪 + 容差），复杂背景请用云端抠图通道。
- **依赖 DSH 客户端的非公开方法**：`conversation.resolveDraftAttachments` / `createDrafts`，
  以及 `sessions.scope(id)` + `conversation.input.for(actx)`。它们在 0.1.5-rc.2 上是
  `ConversationController` / `ClientSessions` 的公开方法但不在 `IConversation` 声明里；
  升级 DSH 后若被改动，面板会退化成「编辑条不显示」或走正文文本块，不会报错崩掉。
- **胶囊不会被替换，只会叠加**：一次编辑回填后源图附件即被移除，所以「同一张图再编辑」走不到；
  但若草稿里还留着未发送的胶囊，又拖进第二张图再编辑，输入框会有两个胶囊、两组附件。
  两条 brief 都在，文件按名字对应，模型仍能分辨；没有删除胶囊的客户端接口，故不做去重。
- **标记是位置指引，不是掩码**：面板只输出标记坐标与文字；把标记转成可重绘区域由技能脚本
  `mask-from-markers` 完成。
- 编辑器文案注册在 `img2imgEditor` 命名空间，面板文案注册在 `dsh-img2img-config` 命名空间（均 zh/en），随 GUI 语言切换。
