---
name: img2img-studio
description: >
  图生图工作室：先识图分析输入图片，再按风格模式生成新图。触发：用户给出/上传图片并要求「生成类似风格的新图」「换个风格重绘」「图生图」「以这张图为基础出图」「做成电商图/套图/主图/详情页」「杂志编辑风/抽象艺术/手绘插画/废片焕新」。
  不触发：只是「描述/分析图片」而不要求生成新图（那属于 dsh-vision-skill）。
  模式：photo-art（editorial 编辑杂志风 / revival 白纸手绘风 / 融合风）与 ecommerce（商品主图、卖点图、场景图、详情页、PDP、Amazon/Shopify 图包）。
  生图多供应商自动降级（性能+最新模型优先）：DashScope qwen-image-3.0-pro（可复用识图 key）、OpenAI 兼容 API（gpt-image）、Z.AI GLM-Image、Seedream、MiniMax、本地 chatgpt-web；支持 t2i/i2i、批量并发、质量预设。
---

# 图生图工作室（img2img-studio）

> **路径约定（DSH 0.1.3+）**：本文档相对路径以**本技能资源目录**为基准解析（加载时 harness 给出 `Base directory for this skill`）；跨技能引用写 `..\dsh-vision-skill\...`（三个技能同根安装时成立）。

两层架构：

```
输入图片（附件/路径/URL）
   ↓ Layer 1: 识图（复用 dsh-vision-skill）
  结构化描述（主体/构图/色彩/材质/情绪/文字）
   ↓ 模式路由（按用户要的风格）
  photo-art（照片艺术） | ecommerce（电商）   ← 模式注册表，可扩展
   ↓ Layer 2: 生成
scripts/generate_image.mjs（多供应商自动降级）
```

## 模式注册表

| 模式 id | 用途 | 参考文档 | 路由关键词（命中即选） |
|---|---|---|---|
| `photo-art` | 照片 → 艺术化新图 | `references/photo-art-mode.md` | 杂志、编辑、editorial、抽象、艺术、手绘、插画、白纸、留白、焕新、revival、诗意、文艺、zine、拾景、拼贴、纸刊、极简海报 |
| `ecommerce` | 商品图 → 电商视觉 | `references/ecommerce-mode.md` | 主图、套图、卖点图、场景图、详情页、PDP、listing、Amazon、Shopify、TikTok、A+、广告图、社媒图、直播图、包装图、商品图、电商 |
| `chatgpt-web` | 用 ChatGPT 网页端出图（无 API key） | `references/chatgpt-web-mode.md` | chatgpt 网页、网页出图、用 ChatGPT 账号、gpt-image 网页版 |

路由规则：先看用户明确说的风格词；没提时看图片内容（L1 识图判断是商品照还是生活照）；仍不确定就简短问一句（给两个选项）。用户提到的风格不在注册表里 → 按最接近的模式处理并在回复中说明假设。

**新增模式**：在 `references/` 加一个 `<mode>.md`（写清风格规范、Prompt 模板、硬约束、检查清单），再在本表加一行即可，无需改脚本。

## Step 0：路由门（通道 + 风格 + 细化需求）⛔ 必做

**任何生图任务开始前**，先按 `references/routing-gate.md` 执行路由门：用 AskUserQuestion 问清三件事，再进入对应工作流。**禁止不问直接生成。**

1. **Q1 生成通道**：展示可用通道清单，**一级主通道优先**（`node scripts/generate_image.mjs --list-providers` 看实时状态）：
   - **一级主通道（订阅制，已接入）**：`codex-cli`（Codex 客户端，Plus 账号）· `chatgpt-web@<账号id>`（ChatGPT 网页账号，无头 Edge + 注入登录态，免费版也能出图）
   - **API 通道**：dashscope（默认）· openai · zai · seedream · minimax · local · **direct 直连（12 家官方 API）** · qoder
   - 用户无偏好 → 按 `GEN_PROVIDER_ORDER`（面板排序）走，一级主通道在前；额度用尽/失败自动降级
2. **Q2 风格/场景**：展示 photo-art 六子风格（editorial / revival / fusion / zine-gathered / zine-distill / zine-minimal）与 ecommerce 类型清单，用户选；无偏好 → 看图片内容或默认 fusion。
3. **Q3+ 细化需求**（按需 2-3 个）：画幅比例、质量 1k/2k、图内文字（精确文案）、参考图/主体保留、数量、情绪/变体、平台规范。有合理默认的不追问。
4. **路由执行**：
   - 通道 = `chatgpt-web@<账号id>` → 直接 `generate_image.mjs --provider chatgpt-web@<账号id>`（脚本内部用无头浏览器 + 账号表里的 session token；也可走 `references/chatgpt-web-mode.md` 的可见浏览器流程）
   - 通道 = `codex-cli` → `generate_image.mjs --provider codex-cli`（用 Codex 客户端登录态，无需 API key）
   - 其他通道 → 选风格后读对应 `references/<mode>.md`，用 `generate_image.mjs --provider <id>` 生成
5. 在最终交付里注明：**通道、风格、尺寸、模型** + Assumptions / Defaults。

### 订阅制通道（一级主通道）的账号与凭据

三个账号通道由 **Settings → 识图与生图** 面板统一管理（`dsh-vision-config`），面板保存时同步 `GEN_PROVIDER_ORDER` 与 `IMG_CHATGPT_WEB_ACCOUNTS` 到 `scripts/.env`：

| 通道 id | 账号 | 凭据来源 | 出图方式 |
|---|---|---|---|
| `chatgpt-web@<账号id>` | ChatGPT 网页账号（如 dogwind 免费版 / leeyf221 免费版） | 面板粘贴 `__Secure-next-auth.session-token` | 无头 Edge + 注入 cookie 驱动 chatgpt.com（`playwright-core` 需可解析） |
| `codex-cli` | Codex 客户端账号（Plus） | 实时读 `~/.codex/auth.json` | `codex exec` + imagegen |

- 额度看板：面板按 ChatGPT 后端返回的实际出图时刻统计 24h 窗口用量（自动探测），Codex 账号额外显示 5h/7d 窗口百分比。
- 网页通道若报「登录态已失效」→ 面板重新粘贴 token；`chatgpt-web@<id>` 的 token 来自面板账号表，不额外存副本。

## 主流程

1. **解析输入**：图片来自 Web 附件（`attachmentId` 形如 `sha256:<hex>`）→ 用 `resolve_attachment.mjs` 换出磁盘路径（**i2i 必须**：`--image` 只吃路径；本地路径/URL 直接给）。注意这一步与模型是否多模态无关——多模态模型能用 `read_image` 直接"看"附件，但拿不到可传给生图脚本的路径。
2. **L1 识图（必做，禁止跳过）**：先判定模型是否原生看图——**多模态模型**（`read_image` 可用）直接用它读图；**纯文本模型**走 dsh-vision-skill 的 `vision.js`（见下）。两种情况都必须拿到结构化描述，不能凭空编造图片内容。**多模态 + 只做文生图（不传参考图）时，整个流程不需要 dsh-vision-skill**。
3. **模式确认**：Step 0 已确定通道与风格；此处读取对应 `references/<mode>.md`（photo-art 含 zine 子风格 / ecommerce / chatgpt-web）。
4. **构建 Prompt**：按模式文档的模板 + 识图描述注入。**任何 Prompt 都必须独立可生成**（即使图生图失败回退 t2i 也能用）——把主体描述完整写进文字。
5. **生成**：通道为 chatgpt-web 时走浏览器出图（chatgpt-web-mode.md）；否则调 `scripts/generate_image.mjs --provider <通道>`（用法见下），参考图传原图；供应商自动探测降级。
6. **QA 检查**：见下方清单；不合格修正后重生成。
7. **交付**：给生成文件路径 + **通道/风格/尺寸/模型** + 关键假设；附最终 Prompt 便于用户复现。

## L1 识图

**第一步：判定走哪条路（DSH 0.1.3+，禁止无脑调脚本）**

| 当前模型 | L1 做法 |
|---|---|
| **多模态**（`read_image` 可用，或模型配置 `inputModalities` 含 `image`） | 直接 `read_image` 读图并自己总结主体/构图/色彩/材质/情绪/文字——**不跑 `vision.js`**（省外部额度、免一次网络往返） |
| **纯文本**（`read_image` 报 `does not declare image input` 等） | 走下方脚本识别链（多模型降级 + 备用供应商） |

> 判定方法：调用一次 `read_image`；成功即多模态。也可先跑 `node "..\dsh-vision-skill\scripts\vision.js" guard` 看判定（无显式信号时返回 `null`，仍需按 `howToDecide` 探测）。
> 需要**强结构化 JSON 契约**（`--schema img2img|ecom|ground`，带字段校验与损坏重试）时，即使模型是多模态也值得调一次脚本；只需粗略理解图片时不要调。
> **本技能对 dsh-vision-skill 是条件依赖**：多模态会话直接 `read_image` 即可识图；只有当①会话模型是纯文本、或②要把 Web 附件当参考图（需 `resolve_attachment.mjs` 拿路径）、或③想复用它的识图 key 时，才需要装它。

**纯文本模型 / 需要结构化契约时**（附件先解析成磁盘路径）：

```powershell
# 附件 → 磁盘路径（找不到时加 --search 按片段搜）
node "..\dsh-vision-skill\scripts\resolve_attachment.mjs" "<attachmentId>"

# 识别（本地路径或 URL）
node "..\dsh-vision-skill\scripts\vision.js" "<图片路径>" "<结构化分析问题>"
node "..\dsh-vision-skill\scripts\vision.js" --url "<图片URL>" "<问题>"
```

**photo-art 模式**（用 `--schema img2img` 强制结构化 JSON 契约：summary/subject/composition/visual(hex 主色)/semantics，输出损坏自动重试）：

```powershell
node "..\dsh-vision-skill\scripts\vision.js" "<图片路径>" --schema img2img
```

**ecommerce 模式**（用 `--schema ecom` 输出商品结构化 JSON）：

```powershell
node "..\dsh-vision-skill\scripts\vision.js" "<图片路径>" --schema ecom
```

识图前可先 `vision.js guard` 检查供应商可用性；`--list-providers` 查看已配置供应商（不泄露密钥）。多图逐张识别后合并。识图失败（配额/网络）时如实告知用户，不要编造图片内容。

## L2 生成（generate_image.mjs v2）

```powershell
# 探测已配置的供应商（不泄露密钥；含链序 chain 与账号额度 accounts）
node "scripts\generate_image.mjs" --list-providers

# 各 ChatGPT 账号的档位/额度视图（读「识图与生图」面板库；free 档显示 24h 内探测到的生成数）
node "scripts\generate_image.mjs" --accounts

# 文生图（质量预设：normal=1K / 2k=2K，默认 2k）
node "scripts\generate_image.mjs" --prompt "..." --size 1:1 --quality 2k --output-dir "输出目录"

# 图生图（带参考图，1-3 张最佳；长 Prompt 用 --prompt-file / 多文件用 --promptfiles）
node "scripts\generate_image.mjs" --prompt-file prompt.txt --image "原图路径" --size 3:4 --output-dir "输出目录"

# 批量（电商套图一次出多张；batch.json 为 JSON 数组，字段: prompt/image/size/quality/output）
node "scripts\generate_image.mjs" --batchfile batch.json --jobs 4 --output-dir "输出目录"

# 强制供应商/模型
node "scripts\generate_image.mjs" --prompt "..." --provider dashscope --model qwen-image-3.0-pro --output-dir "输出目录"

# 跳过面板探测到「额度已用尽」的网页账号通道（等价 IMG_SKIP_EXHAUSTED=1）
node "scripts\generate_image.mjs" --prompt "..." --skip-exhausted --output-dir "输出目录"
```

**尺寸语义**：`--size` 给比例（`1:1` / `16:9` / `2.35:1`）时按 `--quality` 档位换算；给显式像素（`1024x1536`）则**原样透传**，不再被档位放大。

**参数错误**：`--provider` 写了不存在的通道会**直接报错退出**（不会静默回落成整链），避免「以为指定了 A 却跑了 B」。

供应商优先级（auto）：`openai` → `dashscope`（默认，复用识图 key）→ `zai`（GLM-Image，文本渲染强）→ `seedream`（豆包）→ `minimax`（海螺）→ `local`（chatgpt-web 类）。可 `--provider <id>` 强制；`codex-cli` 需 codex CLI 已登录（用 Codex/ChatGPT 订阅出图，无 API key）。

**Qoder CLI 生图（2026-08-17 已实测）**：`--provider qoder` 直接让 Qoder 的 **ImageGen 工具**出图（不消耗 DashScope 额度）：
```bash
node scripts/generate_image.mjs --provider qoder --prompt "柴犬戴飞行员眼镜，赛博朋克" --size 1:1 --output-dir "输出目录"
# t2i/i2i 均可（i2i 传 --image 参考图，Qoder 视觉理解后按参考生成）；输出自动复制到 --output-dir
```
- 依赖：`npm i -g @qodercn-ai/qoderclicn` 已装 + `qoderclicn login` 已登录（浏览器授权一次）
- 模型：`QODER_IMAGE_MODEL` 可覆盖（默认 Qwen3.8-Max）；尺寸 ImageGen 内部决定，脚本提示尽量接近
- 注意：CLI 需已登录态；输出文件先落在 `F:\dsh\vibe_images\`，脚本复制到输出目录

### 直连通道 `direct`（12 家官方 API，自有引擎）

第二套生成通道，已并入 `generate_image.mjs` 的供应商链：**12 家官方 API 直连**（OpenAI GPT Image 2 /
Azure / Google / OpenRouter / DashScope / Z.AI / MiniMax / Jimeng 即梦 / Seedream / Replicate / Agnes /
codex-cli）。引擎位于本技能自带目录 `engines/direct-api/`，以 **bun** 运行 TypeScript（已装）。

```powershell
# 走统一入口（推荐）：--provider direct + --direct-provider <子通道>
node "scripts\generate_image.mjs" --provider direct --direct-provider dashscope --prompt "..." --size 1:1 --output-dir "输出目录"
node "scripts\generate_image.mjs" --provider direct --direct-provider google --prompt "..." --image "参考图.png" --size 3:4 --output-dir "输出目录"

# 直接调引擎（需要引擎原生能力时：批量、--ar/--quality 细粒度）
bun "engines\direct-api\scripts\main.ts" --prompt "..." --provider dashscope --image "out.png" --json
bun "engines\direct-api\scripts\main.ts" --prompt "..." --ref "参考图.png" --provider openai --image "out.png"
bun "engines\direct-api\scripts\main.ts" --batchfile batch.json --jobs 4
```

- **子通道**：`openai` / `azure` / `google` / `openrouter` / `dashscope` / `zai` / `minimax` / `jimeng` / `seedream` / `replicate` / `agnes` / `codex-cli`；默认取 `DIRECT_PROVIDER` 环境变量，其次 `dashscope`
- **配置**：`~/.img2img-studio/direct-api/EXTEND.md`（已预置 dashscope + 质量/并发）；key 与 dsh-vision-config 面板/现有 .env 同源，`VISION_API_KEY` 会自动桥接为引擎的 `DASHSCOPE_API_KEY`
- **何时用它**：用户指定 12 家官方 API 中的某个（尤其 Google/Azure/Replicate/即梦）、或需要更细的画幅/批量控制
- 引擎自身文档：`engines/direct-api/GUIDE.md`（CLI、provider 差异、批量与并发、排障）；DSH 适配见 `references/direct-api-guide.md`
- ⚠️ DashScope 账号欠费时 qwen-image 返回 400 Arrearage → 换子通道或充值

**生成模式决策**：单张/1-2 张 → 单图模式；多张且 Prompt 已定稿 → `--batchfile`（并发、统一限流）；每张还需单独构思 → 子代理。

**图片预处理工具**（`scripts/preprocess/`，Windows 内置 System.Drawing，零依赖）：抠图去背景→透明参考图（`cutout.ps1`）、主色提取→Prompt 精确色板（`extract-palette.ps1`）、主体定位裁剪（`vision.js --schema ground` + `crop.ps1`）。电商生成前推荐先抠图 + 取主色（详见 ecommerce-mode.md ⑨）。

### 身份保持参考图准则（重要）

用户要「保留参考图中的人物/物体」时，**不要**用长描述替代参考图（"年轻女性、鹅蛋脸…"会导致模型重新合成一个新主体）。改用短促的身份锁定语言：

- "Use the person/object in the reference image(s) as the same identity. Do not redesign it or create a similar-looking new subject."
- "Only change scene, clothing, pose, lighting, rendering style, and composition. Keep the identity from the references."
- 多参考图时声明它们是同一主体、共同定义身份。
- 参考图取 2-4 张精选即可；不要把新生成的图再当参考图（会累积漂移）。

### 模型策略（性能优先 + 发布时间最近优先）

**生图（dashscope 默认链，自动降级）**：
- t2i：`qwen-image-3.0-pro`（千问图像 3.0 旗舰，文本/小字渲染最强）→ `qwen-image-3.0` → `wan2.7-image-pro` → `wanx2.1-t2i-plus` → `wanx2.1-t2i-turbo`
- i2i：`qwen-image-3.0-pro` → `wan2.7-image-pro`（多图参考/角色一致性）

**识图（dsh-vision-skill）**：`qwen3.8-max`（最新旗舰）→ `qwen3.7-plus` → `qwen3.7-flash` → `qwen-vl-max` → `qwen-vl-plus`（已同步更新 VISION_MODEL）。

升级模型时按「性能优先 + 发布时间最近」从百炼模型广场筛选，把新旗舰放链首。

**已知限制与回退**：
- DashScope 的 compatible-mode `/images/generations` 不存在（404）；qwen-image 系列走**同步 multimodal-generation 端点**（messages 格式），wanx 系列走 native 异步任务 API（均已实测）。
- qwen-image 系列 i2i 已完整可用（content 用 `{image}+{text}`）；个别账号模型不可用时脚本自动降级，全链失败回退「识图描述 + 文生图」（第 4 步保证 Prompt 自带主体描述）。
- Z.AI 不支持参考图；Jimeng 需火山签名未内置（用 seedream 替代）；codex-cli 依赖本机 codex 登录。

## QA 检查清单（交付前）

- [ ] **已走路由门**：通道、风格、细化需求（尺寸/文字/参考图/数量）都已与用户确认或标注 Default
- [ ] 识别结果确实来自 vision.js 输出，无凭空编造
- [ ] Prompt 独立可生成（含完整主体描述），hex 颜色、占比、留白、否定项齐全
- [ ] 保留人物/物体身份时用了身份保持语言，而非长描述替代
- [ ] 多图任务：Campaign Style Lock 一致、角度/景别节奏合规、无连续 3 张同角度
- [ ] 电商详情页 = 信息图结构（`E-commerce infographic` 开头），含强制对比图 + 好评图
- [ ] 图片内文字短且精确（中文放大核对、复杂字换同义字）；qwen-image 3.0 小字渲染强，仍要核验
- [ ] 没有虚构认证/数据/销量/评价
- [ ] 生图失败时按指引回退，不静默降级输出
- [ ] 批量任务输出含成功/失败统计与每张失败原因
- [ ] 输出文件路径、使用的模式/风格/模型、假设清单都已告知用户

## 配置

> **面板优先（DSH 0.1.3+）**：Web 端 **Settings → 识图与生图**（`dsh-vision-config` 插件）填各通道 API Key / 模型 / 端点，保存后自动同步到 `scripts/.env`（`GEN_PROVIDER_ORDER`、各 key、`VISION_PROVIDERS`），新会话生效；手动改文件会被面板下次保存覆盖。技能根目录可用 `DSH_SKILLS_DIR` 覆盖（默认 `~/.agents/skills`）。

在 `scripts/.env` 或环境变量（脚本会自动回退读取 `..\dsh-vision-skill\scripts\.env` 的 `VISION_API_KEY`，所以**零配置也能用 DashScope 出图**）：

| 变量 | 说明 |
|---|---|
| `IMG_BASE_URL` / `IMG_MODEL` / `IMG_API_KEY` | OpenAI 兼容第三方（gpt-image 等） |
| `DASHSCOPE_API_KEY` | DashScope（可选，缺省用 VISION_API_KEY） |
| `ZAI_API_KEY` | Z.AI GLM-Image（open.bigmodel.cn 申请） |
| `ARK_API_KEY` | Seedream 豆包（火山方舟控制台申请） |
| `MINIMAX_API_KEY` | MiniMax 海螺 |
| `IMG_HTTP_URL` | 本地 chatgpt-web 类生图服务地址 |
| `IMG_MODEL` | 覆盖默认生图模型（dashscope t2i 默认 qwen-image-3.0-pro；i2i 默认 qwen-image-3.0-pro） |
| `<PROVIDER>_IMAGE_MODEL` / `<PROVIDER>_BASE_URL` | 各供应商模型/端点覆盖（ZAI_IMAGE_MODEL、SEEDREAM_IMAGE_MODEL 等） |

完整说明见 `scripts/.env.example`。诊断用 `--list-providers`。
