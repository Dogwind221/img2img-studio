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
2. **移除背景**：本地纯色背景抠图即时预览（复杂背景交给云端抠图，见技能脚本）；
3. **涂抹擦除**：画笔涂抹要处理/重绘的区域，可「擦回」、撤销一笔、全部清除，并写涂抹区域的统一处理要求；
4. **调整大小**：比例预设（原图 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16）+ 宽高 + 裁切填满 / 完整放入 / 拉伸。

点「放回输入框」后：编辑结果作为**附件**回到输入框（`marked-*.png` 带标记的位置图 /
`edited-*.png` 干净底图 / `mask-*.png` 涂抹掩码 / `img2img-manifest.json` 机器可读清单），
草稿里只多出**一个胶囊**「图片编辑 · N 处标记」。JSON 不写进输入框正文——胶囊的载荷里带着完整
brief（附件清单 + 标记坐标与改法 + 请求动作 + 一行 `JSON:` manifest），发送那一刻由胶囊所属
reference source 的 codec 展开成模型文本，所以**模型看到的与旧版写块时完全一致**，用户看到的只有一个胶囊。

胶囊插不进去时（客户端没有触发服务、或草稿版本已变）退化为正文里一段 `[img2img] … [/img2img]`
文本块：内容同上但不含 `JSON:` 行（清单已在附件里），再次编辑会整块替换而不是叠加。
用户按发送，agent 据此调 `img2img-studio/scripts/edit_image.mjs` 交给生图供应商。

## 面 ②：设置 → 识图与生图

多供应商管理面板，识图与生图**各一条链**，每个通道可开关、可拖拽排序、可跨组改级：

- **三级优先级**：一级「主通道」→ 二级「备用」→ 三级「兜底」，`auto` 链按此顺序依次降级；
- **拖拽排序**：拖把手在组内排序，拖到别的等级组自动改级，也可用每行的 ▲▼ 与等级下拉；
- **模型链**：每行可写完整降级链（逗号分隔），并给常用模型快捷 chip；
- **余额探测**：`GET /models` 识别欠费错误码（Arrearage / quota exhausted / insufficient balance…），
  欠费通道自动关停，避免每次出图白等超时；
- **ChatGPT 网页出图账号库**：每个账号标套餐档位（免费 / Plus / 5x / 20x），可粘贴
  `__Secure-next-auth.session-token`、按 ChatGPT 后端返回的实际出图时刻统计 24h 滚动出图数，
  也可手动「登记 1 张」；Codex 账号额外显示 5h/7d 窗口百分比；
- **保存即写回** `.env`：`VISION_PROVIDERS` / `VISION_API_KEY` / 各 `*_API_KEY` /
  `GEN_PROVIDER_ORDER` / `IMG_CHATGPT_WEB_ACCOUNTS`，**新会话生效**。

面板只服务本机两个 skill，因此**两个 skill 只装一个也能用**：写 `.env` 前会先把目标目录建出来
（早前版本会以 `ENOENT` 失败并拖垮整次保存）。

---

## 结构

| 半边 | 位置 | 作用 |
|---|---|---|
| host 入口 | `src/index.ts` | 注册 `webServer` 路由 `/dsh-img2img-config/{providers,probe,chatgpt-usage}`；供应商库与 ChatGPT 账号库的读写、`.env` 同步、额度探测 |
| host `.env` 工具 | `src/env.ts` | `.env` 解析 / 合并写回（保留注释与未知行，`''` = 删行） |
| client 入口 | `src/client/index.tsx` | 注册 dock 条目 + 触发源编解码，并把设置面板一并 `registerConfigPanel(ctx)` |
| client 面板 | `src/client/config-panel.tsx` | 设置页「识图与生图」整块 UI |
| 编辑器 UI | `src/client/EditorDock.tsx` / `EditorModal.tsx` | dock 条目与全屏编辑器 |
| 光栅核心 | `src/client/raster.ts` | 本地抠图（边界泛洪）、resize/cover/contain/stretch、涂抹掩码回放、编号标记绘制、导出 `edited`/`marked`/`mask` |
| 交付格式 | `src/client/manifest.ts` | 生成 brief（两种载体）、清单文件、草稿合并规则 |
| 胶囊编解码 | `src/client/brief-source.ts` | 注册一个不产出菜单行的触发源，只为持有胶囊 codec |

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
# 2) 运行时注入（免重启）或写进 profile 的 bundles 列表持久化：
#    dev_inject_plugin <本目录>
#    dev_install_package <本目录>
```

构建依赖从 DSH checkout 链接（`@types/node`、`@deepseek-ai/cordis`、`@types/react`、`tsdown`）；
`scripts/build.sh` 是同一流程的 bash 版本，供注入器的 `dev_build_plugin` 调用。

> `@deepseek-ai/cordis` 必须能解析：宿主半边声明 `apply(ctx: Context)`，类型找不到时
> `ctx.*` 会**静默退化成 `any`**，`webServer` 的 handler 参数也一起丢掉上下文类型，
> 于是编译期什么都发现不了——两个 build 脚本都显式链接了它。

打包后 `scripts/normalize-client-banner.mjs` 把 tsdown 折成多行的 banner 压回一行，
保证 `lib/client.js` 以 `window.__ModuleLoader__.load({ id: "dsh-img2img-config", …` 精确开头。

## 已知限制

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
