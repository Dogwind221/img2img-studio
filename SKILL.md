---
name: img2img-studio
description: >
  图生图工作室（img2img-studio）：第一层用识图（dsh-vision-skill）分析输入图片，第二层按用户要的风格模式生成新图。
  当用户上传/给出图片并要求「生成类似风格的新图」「换个风格重绘」「做成电商图/套图/主图/详情页」「做成杂志编辑风/抽象艺术/手绘插画/废片焕新」「图生图」「以这张图为基础出图」时触发。
  支持两种内置模式：photo-art（照片艺术：editorial 编辑杂志风 / revival 白纸手绘风 / 融合风）与 ecommerce（电商：商品主图、卖点图、场景图、详情页、PDP、Amazon/Shopify 图包）。
  生图走多供应商自动降级（性能+最新模型优先）：DashScope 通义千问（qwen-image-3.0-pro，可复用识图 key）、OpenAI 兼容 API（gpt-image 等）、Z.AI GLM-Image、Seedream 豆包、MiniMax、本地 chatgpt-web 类服务；支持 t2i/i2i、批量并发、质量预设。
  仅当用户只是想「描述/分析图片」而不要求生成新图时，不应触发（那属于 dsh-vision-skill）。
---

# 图生图工作室（img2img-studio）

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

1. **Q1 生成通道**：展示可用通道清单（dashscope 默认推荐 / chatgpt-web / openai / zai / seedream / minimax / local / codex-cli），用户选一个；无偏好 → dashscope。
2. **Q2 风格/场景**：展示 photo-art 六子风格（editorial / revival / fusion / zine-gathered / zine-distill / zine-minimal）与 ecommerce 类型清单，用户选；无偏好 → 看图片内容或默认 fusion。
3. **Q3+ 细化需求**（按需 2-3 个）：画幅比例、质量 1k/2k、图内文字（精确文案）、参考图/主体保留、数量、情绪/变体、平台规范。有合理默认的不追问。
4. **路由执行**：
   - 通道 = chatgpt-web → `references/chatgpt-web-mode.md` 的浏览器出图流程（不走 generate_image.mjs）
   - 其他通道 → 选风格后读对应 `references/<mode>.md`，用 `generate_image.mjs --provider <id>` 生成
5. 在最终交付里注明：**通道、风格、尺寸、模型** + Assumptions / Defaults。

## 主流程

1. **解析输入**：图片来自 Web 附件（`attachmentId` 形如 `sha256:<hex>`）→ 先用 `resolve_attachment.mjs` 解析出磁盘路径；或用户直接给路径/URL。
2. **L1 识图（必做，禁止跳过）**：调用 dsh-vision-skill 的 vision.js 拿到结构化描述（见下）。纯文本模型不能「看到」图片，必须走脚本。
3. **模式确认**：Step 0 已确定通道与风格；此处读取对应 `references/<mode>.md`（photo-art 含 zine 子风格 / ecommerce / chatgpt-web）。
4. **构建 Prompt**：按模式文档的模板 + 识图描述注入。**任何 Prompt 都必须独立可生成**（即使图生图失败回退 t2i 也能用）——把主体描述完整写进文字。
5. **生成**：通道为 chatgpt-web 时走浏览器出图（chatgpt-web-mode.md）；否则调 `scripts/generate_image.mjs --provider <通道>`（用法见下），参考图传原图；供应商自动探测降级。
6. **QA 检查**：见下方清单；不合格修正后重生成。
7. **交付**：给生成文件路径 + **通道/风格/尺寸/模型** + 关键假设；附最终 Prompt 便于用户复现。

## L1 识图

```powershell
# 附件 → 磁盘路径（找不到时加 --search 按片段搜）
node "$env:USERPROFILE\.agents\skills\dsh-vision-skill\scripts\resolve_attachment.mjs" "<attachmentId>"

# 识别（本地路径或 URL）
node "$env:USERPROFILE\.agents\skills\dsh-vision-skill\scripts\vision.js" "<图片路径>" "<结构化分析问题>"
node "$env:USERPROFILE\.agents\skills\dsh-vision-skill\scripts\vision.js" --url "<图片URL>" "<问题>"
```

**photo-art 模式**（用 `--schema img2img` 强制结构化 JSON 契约：summary/subject/composition/visual(hex 主色)/semantics，输出损坏自动重试）：

```powershell
node "$env:USERPROFILE\.agents\skills\dsh-vision-skill\scripts\vision.js" "<图片路径>" --schema img2img
```

**ecommerce 模式**（用 `--schema ecom` 输出商品结构化 JSON）：

```powershell
node "$env:USERPROFILE\.agents\skills\dsh-vision-skill\scripts\vision.js" "<图片路径>" --schema ecom
```

识图前可先 `vision.js guard` 检查供应商可用性；`--list-providers` 查看已配置供应商（不泄露密钥）。多图逐张识别后合并。识图失败（配额/网络）时如实告知用户，不要编造图片内容。

## L2 生成（generate_image.mjs v2）

```powershell
# 探测已配置的供应商（不泄露密钥）
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --list-providers

# 文生图（质量预设：normal=1K / 2k=2K，默认 2k）
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --prompt "..." --size 1:1 --quality 2k --output-dir "输出目录"

# 图生图（带参考图，1-3 张最佳；长 Prompt 用 --prompt-file / 多文件用 --promptfiles）
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --prompt-file prompt.txt --image "原图路径" --size 3:4 --output-dir "输出目录"

# 批量（电商套图一次出多张；batch.json 为 JSON 数组，字段: prompt/image/size/quality/output）
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --batchfile batch.json --jobs 4 --output-dir "输出目录"

# 强制供应商/模型
node "$env:USERPROFILE\.agents\skills\img2img-studio\scripts\generate_image.mjs" --prompt "..." --provider dashscope --model qwen-image-3.0-pro --output-dir "输出目录"
```

供应商优先级（auto）：`openai` → `dashscope`（默认，复用识图 key）→ `zai`（GLM-Image，文本渲染强）→ `seedream`（豆包）→ `minimax`（海螺）→ `local`（chatgpt-web 类）。可 `--provider <id>` 强制；`codex-cli` 需 codex CLI 已登录（用 Codex/ChatGPT 订阅出图，无 API key）。

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

在 `scripts/.env` 或环境变量（脚本会自动回退读取 `dsh-vision-skill/scripts/.env` 的 `VISION_API_KEY`，所以**零配置也能用 DashScope 出图**）：

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
