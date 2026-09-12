# GUI 图像编辑模式（image-editor）

来源：**dsh-img2img-editor** 面板（输入框 dock 里的「标记·编辑」）+ 本技能 `scripts/edit_image.mjs`。
一句话：用户在**输入框里**对图片做「标记 / 抠图 / 涂抹擦除 / 改尺寸」，点「放回输入框」后，编辑结果作为附件回到输入框，并附一段机器可读的**编辑请求块**；agent 读块 → 落地 → 交给生图供应商。

适合：局部改图（换掉某处的物件/文字/颜色）、去背景出透明 PNG、涂抹擦除多余元素、改画幅尺寸后再出图。
不适合：整图重绘（那是 photo-art / ecommerce 模式）、精修人像、像素级修复。

---

## 模式定位

| 维度 | 说明 |
|---|---|
| 入口 | 输入框下方 dock 条目「图片编辑」（`conversation.input.dock`，id `img2img-editor`）。**输入框里有图片时才出现** |
| 用户动作 ① | **编号标记**：在图上点一下加一个编号标记（可拖动），右侧每个标记一个输入框写「这一处要怎么改」 |
| 用户动作 ② | **移除背景**：面板内先给本地纯色背景预览（勾选即 `bgRemove.requested=true`） |
| 用户动作 ③ | **涂抹擦除**：笔刷涂抹要处理的区域（涂抹 / 擦回 / 撤销一笔 / 全部清除），并填「涂抹区域要怎么处理」 |
| 用户动作 ④ | **调整大小**：`cover` 裁切填满 / `contain` 完整放入 / `stretch` 拉伸变形（改尺寸会同时缩放标记与涂抹区域） |
| 交付动作 | 点 **「放回输入框」** → 导出图片作为**新附件**回填输入框（替换被编辑的原图草稿）+ 把说明块写进草稿（重复编辑时**替换**旧块，不叠加） |
| agent 拿到什么 | ① 附件（PNG）② `<!-- img2img-editor:begin --> … <!-- img2img-editor:end -->` 块：附件清单 + 标记坐标 + 请求动作 + `JSON:` manifest 一行 |

### 面板导出的文件（附件清单语义）

| 文件 | 何时有 | 说明 |
|---|---|---|
| `edited-<stamp>.png` | 总是 | **编辑后的底图**（已应用改尺寸 + 抠图，**无**标记）——出图用这张作基底 |
| `marked-<stamp>.png` | 有标记时 | 带编号标记的位置图（**只用于指示位置，不要画进成图**） |
| `mask-<stamp>.png` | 有涂抹时 | 涂抹掩码：**白色 = 要处理/重绘的区域，黑色 = 保留** |

> `<stamp>` 是 `Date.now().toString(36)`，例如 `edited-m1abcd2x.png`。

### 编辑请求块（示例）

```text
<!-- img2img-editor:begin -->
【图片编辑请求 · img2img-studio】
附件1 marked-m1abcd2x.png：带编号标记的位置图（标记只用于指示位置，不要画进成图）
附件2 edited-m1abcd2x.png：编辑后的底图（1024×1024，出图用这张作基底）
附件3 mask-m1abcd2x.png：涂抹掩码（白色 = 要处理/重绘的区域，黑色 = 保留）
标记修改点（坐标为归一化百分比，原点左上角）：
  1. (x 50.0%, y 47.0%) 把这块的花换成玫瑰
  2. (x 12.3%, y 80.1%) 删掉这行字
请求动作：移除背景（云端抠图，输出透明 PNG）；涂抹擦除/局部重绘 2 笔：抹掉并补背景；调整大小到 1024×1024（裁切填满）
给生图供应商：按标记与掩码做局部重绘，再做整体 i2i；标记与掩码只用于定位，不要出现在成图里。
JSON: {"version":1,"createdAt":"...","source":{"name":"in.jpg","width":1600,"height":1200},"size":{"width":1024,"height":1024,"mode":"cover","changed":true},"bgRemove":{"requested":true,"localPreview":true,"tolerance":36},"erase":{"strokes":2,"prompt":"抹掉并补背景"},"markers":[{"id":1,"x":0.5,"y":0.47,"text":"把这块的花换成玫瑰"}],"files":{"edited":"edited-m1abcd2x.png","marked":"marked-m1abcd2x.png","mask":"mask-m1abcd2x.png"}}
<!-- img2img-editor:end -->
```

### manifest 字段（`JSON:` 那行）

| 字段 | 类型 | 含义 |
|---|---|---|
| `version` | number | 固定 `1` |
| `createdAt` | string | 导出时刻（ISO） |
| `source` | `{name,width,height}` | 用户拖入的原图名与原始像素尺寸 |
| `size` | `{width,height,mode,changed}` | 底图当前尺寸；`mode` = `cover`/`contain`/`stretch`；`changed` = 是否与源图尺寸不同 |
| `bgRemove` | `{requested,localPreview,tolerance}` | 是否要移除背景；`localPreview` 表示面板只给了本地预览，**建议云端重做**；`tolerance` 默认 36 |
| `erase` | `{strokes,prompt}` | 涂抹笔数与用户填的处理要求 |
| `markers` | `[{id,x,y,text}]` | **归一化坐标**（0-1，原点左上角）+ 该处改法 |
| `files` | `{edited,marked?,mask?}` | 导出文件名（与附件同名） |

---

## agent 接活流程

**收到编辑请求块时，先读附件、再动手。** 顺序固定：

1. **读附件**：用 `read_image` 逐张看（多模态模型）；纯文本模型走 `..\dsh-vision-skill\scripts\vision.js`。至少确认：底图内容、标记位置（`marked-*.png`）、涂抹区域（`mask-*.png`）是否与块里描述一致。**不要凭块内文字想象图片内容。**
2. **取 manifest**：从块里 `JSON: ` 开头那一行解析出 JSON（块里也把它拆成了可读文本，两条信息等价；以 `JSON:` 行为准）。
3. **收拢附件到一个目录，文件名必须与 `files.*` 完全一致**：manifest 是按 `path.join(manifestDir, files.edited)` 拼路径的。若附件落在对象目录里（名字是 sha256 hex，不是 `edited-*.png`），**先把它们按 `files.*` 的名字复制/重命名到一个工作目录**。
4. **落地编辑**：
   ```powershell
   # 本地文件方式（推荐：文件已按 files.* 命名在同一目录）
   node "scripts\edit_image.mjs" manifest --manifest edit.json --image-dir "附件目录" --out-dir "输出目录"

   # 直接把块里的 JSON 粘成字符串（此时用 --image-dir 指定附件目录）
   node "scripts\edit_image.mjs" manifest --manifest '{"version":1,...}' --image-dir "附件目录" --out-dir "输出目录"
   ```
   产物：`<out-dir>/01-resized.png`（仅当传了 `--size`）、`02-bg-removed.png`（`bgRemove.requested` 时）、`03-erased.png`（有掩码且笔数 > 0 时）；返回里的 `base` = 最后一步的底图。
5. **按需补步**（manifest 不做标记 → 掩码的转换）：
   ```powershell
   # 标记 → 圆形掩码（标记是位置指引，转成可重绘的区域）
   node "scripts\edit_image.mjs" mask-from-markers --markers markers.json --like "03-erased.png" --out mask.png --radius 0.03
   # 再局部重绘（掩码必须与基底同尺寸）
   node "scripts\edit_image.mjs" erase --image "03-erased.png" --mask mask.png --prompt "把这块的花换成玫瑰" --out "04-marked-edit.png"
   ```
6. **整体出图**：`scripts/generate_image.mjs --image <底图> --prompt "<风格 + 标记说明（含坐标与改法）>"`。也可以让 `manifest` 一步带出（`--generate --prompt "..."`，自动把标记坐标+改法拼进 prompt，并声明「标记只作位置指引，不要出现在成图里」）。

### 附件路径怎么来

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 消息里的 `Normalized copy (read-only...)` 路径 | 可直接读；**当素材**时注意它可能被重编码/缩放 |
| 2 | 对象路径 `<DSH_HOME>\attachments\v1\objects\<hex前2位>\<hex>` | 原始字节副本 |
| 3 | `..\dsh-vision-skill\scripts\resolve_attachment.mjs "<attachmentId>"` | 只有 `attachmentId`（`sha256:<hex>`）时换路径；找不到加 `--search` |

> manifest 里的 `files.*` 是**面板导出的文件名**，与附件**同名**（`edited-<stamp>.png` / `marked-<stamp>.png` / `mask-<stamp>.png`）。落地的对象目录文件名是 hash，所以「收拢 + 改名」这一步是常规操作。

---

## CLI 参考表（`scripts/edit_image.mjs`）

> 通用：`--json` 输出机器可读 JSON（人类可读行静默）；`--help` / `-h`；`--version`。全局默认：`--mode cover`、`--provider auto`、`--tolerance 36`、`--radius 0.03`、`--threshold 128`、`--quality normal`。

| op | 用法 | 关键参数（默认） | 输入 → 输出 |
|---|---|---|---|
| `info` | `info --image in.png` | — | PNG/JPEG → `{width,height,format}`（JPEG **只读尺寸**） |
| `resize` | `resize --image in.png --size 1024x1024 --mode cover --out out.png` | `--size` 像素 `1024x1024` 或比例 `1:1`；`--mode cover\|contain\|stretch`（cover）；`--quality normal\|2k` | PNG → PNG（cover 居中裁切 / contain 透明补边 / stretch 直接拉伸） |
| `bg-remove` | `bg-remove --image in.png --out cutout.png [--provider auto\|cloud\|local] [--tolerance 36]` | `--provider auto`（auto/cloud/local）；`--tolerance`（36） | PNG → 透明 PNG（alpha=0 为背景） |
| `erase` | `erase --image in.png --mask mask.png --prompt "抹掉并补背景" --out out.png [--provider auto\|dashscope\|openai\|i2i]` | `--provider auto`；`--prompt`（默认「移除涂抹区内容并用周围背景自然填补」）；`--threshold 128` | 底图+掩码 → 重绘后的 PNG |
| `markers` | `markers --image in.png --markers markers.json --out marked.png` | — | PNG + 标记 JSON → 带编号徽章的 PNG（位置指引图） |
| `mask-from-markers` | `mask-from-markers --markers markers.json --like in.png --out mask.png [--radius 0.03]` | `--like <图>` 或 `--size WxH`（二选一，必需）；`--radius`（0.03，圆半径 = `max(8, min(w,h)×radius)`） | 标记 JSON → 黑底白圆的圆形掩码 PNG |
| `local-edit` | `local-edit --image in.png --markers markers.json --prompt "..." --out out.png [--radius 0.12] [--padding 0.6] [--highlight overlay\|none] [--crop x,y,w,h] [--mask-rect x,y,w,h] [--mask-ellipse x,y,w,h] [--feather 2] [--gen-provider <id>]` | `--radius`（0.12，标记半径 = `min(w,h)×radius`）；`--padding`（0.6）；`--highlight`（overlay/none）；`--crop`/`--mask-rect`/`--mask-ellipse`（图像像素坐标，显式指定裁剪框与可改区域）；`--feather`（2，边界羽化像素，接缝生硬就加大）；`--gen-provider`（透传给 generate_image.mjs 指定通道） | 底图 + 标记 → 只改指定区域的整图（**推荐用于「换/加某个细节」**） |
| `manifest` | `manifest --manifest edit.json --out-dir out [--generate] [--size 1:1] [--prompt "..."]` | `--manifest` 可给**文件路径或直接粘 JSON 字符串**；`--image-dir`（inline JSON 时的附件目录，默认 cwd）；`--out-dir`（默认 `<manifest 所在目录>/edited`）；`--size`/`--mode`/`--quality`；`--generate`；`--provider` | manifest → `01-resized.png` / `02-bg-removed.png` / `03-erased.png` + `base` 路径 + `markers` + `steps` |

标记文件格式（`markers.json`，`x`/`y` 为**归一化坐标**）：

```json
[{"id":1,"x":0.5,"y":0.47,"text":"把这里换成..."}]
```

`erase` 的 `i2i` 兜底通道需要掩码与底图**同尺寸**（overlay 阶段按两图最小宽高裁剪），`dashscope` 通道**硬校验**同尺寸且宽高在 **512–4096**。

---

## 掩码语义转换表

面板/涂抹掩码统一是「**白 = 要处理**」，脚本在调用点转换，`scripts/edit/raster.mjs` 不做供应商相关转换。

| 通道 | 要求的编码 | 脚本怎么做 | 结果语义 |
|---|---|---|---|
| 面板 / 涂抹掩码（源） | 白(255) = 要处理，黑(0) = 保留 | — | 人类直觉语义 |
| DashScope `wanx2.1-imageedit` | **白 = 重绘**；要求同尺寸 + 二值化 + 宽高 512–4096 | `binarizeRaster(mask, --threshold)`（亮度 ≥ 阈值 → 255，其余 → 0，alpha 强制 255）**自动** | 白 = 重绘（与面板一致，转换只做二值化） |
| OpenAI `images/edits` | **alpha = 0（透明）= 重绘** | `maskToAlphaRaster()`：RGB 置 0，`alpha = 255 - 亮度` **自动** | 透明区 = 重绘 |
| 无 mask 通道（兜底） | 无掩码参数 | `overlayMaskRaster(image, mask, alpha=0.45)` 把涂抹区**涂红半透明**做成参考图，走整体 i2i，prompt 明确「只改红色高亮区，其余像素/构图/颜色/文字完全不变，不要保留高亮本身」 | 红色高亮 = 要改的区域 |

> 一句话：**白=要处理 → wanx 直接可用 / OpenAI 转 alpha=0 / 都没有就涂红走 i2i。** 掩码与基底**必须同尺寸**，否则先 `resize` 掩码（改动尺寸会让标记与涂抹区域一起失配，慎用）。

### 局部细节修改：优先 `local-edit`（两道守边）

标记只给「位置 + 改法」，要改成「只动这一处、别处一像素不变」时用 `local-edit`：

1. 按标记半径 + `--padding` 裁出一块局部放大图（短边 ≥768px，让模型有足够像素与上下文）；
2. 在这块裁剪图上做局部重绘（`erase` 的通道链，或 `--highlight none` 把裁剪图直接交给模型并说明「目标在本图正中心」）；
3. **两道守边**：补丁 → 裁剪图（只取掩码圆内），裁剪图 → 原图（整块贴回）。结果里裁剪框与掩码之外的像素与原图**逐字节一致**；
4. 结果里给出 `changedRatio`（掩码内改动比例）。**< 5% 会打 ⚠️ 警告**，说明模型没按要求改（典型原因：通道把上传的参考图当成了结果、或需要走掩码通道）。

实测经验（1774×887 角色设定图，面部加金链）：`--highlight none` + 局部放大图比涂红高亮更可靠——涂红的圆形高亮容易被模型当成「内容」画进结果，而**局部放大图 + 裁剪框本身就传达了位置**；`--highlight overlay` 更适合「抹掉某物」这类需要明确边界的诉求。

**把改动范围钉死（人像/设定图必看）**：默认的圆形标记半径按 `min(w,h)×--radius` 算，`0.12` 在近景人像上会**圈到眼睛**——模型于是把眼睛/眉毛一起重画，设定图直接报废（实测踩过）。要「只改眼睛以下」这类诉求，用显式几何：

```powershell
# 椭圆掩码（眼睛以下的面纱带）+ 12px 羽化：边界自然，眼睛逐字节不动
node "scripts\edit_image.mjs" local-edit --image base.png --markers m.json --highlight none `
  --mask-ellipse 1370,215,260,145 --feather 12 --prompt "...面纱保持完整覆盖，眼睛与眉毛完全不动"
```

- 矩形硬边 + 小羽化会在布料上留一条可见补丁边界（实测出现过「露出一条皮肤色横带」），**优先椭圆 + `--feather 8~16`**；
- prompt 里明确「不要露出皮肤 / 保持材质与褶皱」能显著降低越界重绘；
- 交付前核对：`changedRatio` 之外，另用掩码对结果与原图做**掩码外像素比对**（`scripts/edit/raster.mjs` 的 mask* + 逐像素 diff），眼睛/文字这类关键区域必须 0 像素漂移。

> ⚠️ **通道返回原图 = 失败**：`generate_image.mjs` 的网页通道曾经按「页面里最后一张 >200px 的图」取结果，会把**自己上传的参考图**当成生成结果（图生图静默返回原图）。现已按回合 role 排除用户上传图、只取助手回合的图；`edit_image.mjs` 另外硬校验「生成结果与输入逐字节相同 → 直接判失败并报错」，不允许静默返回原图。

---

## 通道与降级

### `erase --provider auto` 的顺序

`dashscope`（有 `DASHSCOPE_API_KEY`/`VISION_API_KEY`）→ `openai`（有 `IMG_BASE_URL`+`IMG_API_KEY`，或 `OPENAI_*`）→ `i2i`（本地涂红兜底）。逐个尝试，前一个抛错就记进 `attempts` 并继续；**全链失败时直接报错退出**，错误里逐条列出「通道: 错误」。

| 通道 | 端点 / 模型 | 必需配置 |
|---|---|---|
| `dashscope` | `POST {DASHSCOPE_BASE_URL\|https://dashscope.aliyuncs.com}/api/v1/services/aigc/image2image/image-synthesis`（`X-DashScope-Async: enable`）+ 轮询 `/api/v1/tasks/<id>`，模型 `EDIT_IMAGE_MODEL` 默认 `wanx2.1-imageedit`，`function=description_edit_with_mask` | `DASHSCOPE_API_KEY` 或 `VISION_API_KEY`（`DASHSCOPE_BASE_URL` 可选） |
| `openai` | `POST {base}/images/edits`（form：`image` + `mask` + `prompt`），模型 `IMG_MODEL` 默认 `gpt-image-2` | `IMG_BASE_URL`（或 `OPENAI_BASE_URL`/`OPENAI_API_BASE`）+ `IMG_API_KEY`（或 `OPENAI_API_KEY`）；`IMG_MODEL` 可选 |
| `i2i` | 本地生成红色高亮参考图，再调 `generate_image.mjs`（走它的供应商链） | 生图通道凭据（同 SKILL.md 的通道配置） |

### `bg-remove --provider auto` 的顺序

**云端抠图** → **本地纯色背景抠图**。

| 通道 | 做法 | 触发条件 |
|---|---|---|
| `cloud` | OpenAI 兼容 `POST {base}/images/edits`，form 带 `background=transparent` + `output_format=png` + `input_fidelity=high`，模型 `IMG_MODEL` 默认 `gpt-image-2` | `IMG_BASE_URL`（或 `OPENAI_BASE_URL`/`OPENAI_API_BASE`）与 `IMG_API_KEY`（或 `OPENAI_API_KEY`）都已配置 |
| `local` | 取边框参考色（中位数）→ flood fill 容差 `--tolerance` 内背景 → 这些像素 alpha=0，接缝一圈 alpha=150；**纯色/近色背景商品图**适用，复杂背景会糊 | 未配置云端通道，或云端失败降级 |

- `--provider auto`：云端失败**降级本地**并在结果 `note` 里说明原因（**不静默**）；未配置云端时 note 里写明「已用本地纯色背景抠图」。
- `--provider cloud`：云端失败**直接报错**（不降级）；`--provider local`：只走本地。
- 像素数 > 1200 万时本地抠图直接原样返回（不处理）。

### 配置项一览

| 变量 | 用于 | 说明 |
|---|---|---|
| `DASHSCOPE_API_KEY` | erase/抠图通道 | 缺省回退 `VISION_API_KEY` |
| `VISION_API_KEY` | 同上 | 与 dsh-vision-skill 同源（脚本会自动读它 `.env`） |
| `DASHSCOPE_BASE_URL` | 同上 | 默认 `https://dashscope.aliyuncs.com` |
| `EDIT_IMAGE_MODEL` | erase | 默认 `wanx2.1-imageedit` |
| `IMG_BASE_URL` / `OPENAI_BASE_URL` / `OPENAI_API_BASE` | 云端抠图 / OpenAI erase | 三者按序回退 |
| `IMG_API_KEY` / `OPENAI_API_KEY` | 同上 | 按序回退 |
| `IMG_MODEL` / `OPENAI_IMAGE_MODEL` | 同上 | 默认 `gpt-image-2` |

脚本按顺序加载 `.env`：`scripts/.env` → 技能根 `.env` → `..\dsh-vision-skill\scripts\.env` → `~\.agents\skills\dsh-vision-skill\scripts\.env` → `$DSH_SKILLS_DIR/dsh-vision-skill/scripts/.env`（已存在的环境变量优先，不被覆盖）。

---

## 本地零子进程约束（重要）

**像素级操作一律在进程内完成，不 spawn 任何子进程**——DSH 文件沙箱禁止管道 stdio（piped stdio 会 EPERM），也禁止从 Node 派生解释器。因此 `scripts/edit/` 用纯 Node 实现：

| 文件 | 职责 |
|---|---|
| `scripts/edit/png.mjs` | 零依赖 PNG 编解码（8 位、非隔行；gray / RGB / palette / gray+alpha / RGBA 解码，RGBA 编码，`node:zlib`），外加 **JPEG 尺寸探测** |
| `scripts/edit/raster.mjs` | 光栅算法：双线性缩放、resize(cover/contain/stretch)、二值化、白→alpha 掩码、标记圆点/编号（内置 5×7 数字字形，无字体依赖）、标记→圆形掩码、涂红 overlay、本地纯色抠图（边框 flood fill） |

- **输入只支持 PNG**（面板导出的都是 PNG）；**JPEG 只能读尺寸**（`info` 可用），要做像素操作请先转 PNG。
- **备用通道**：`scripts/preprocess/raster.ps1`（Windows 内置 System.Drawing，零依赖）是给 agent **用 PowerShell 直接调用**的（本机若有 pwsh 用 `pwsh -File`，只有 Windows PowerShell 时用 `powershell -File`），支持 JPEG，op 为 `info / resize / binarize / mask-alpha / mask-from-markers / markers / overlay-mask`。适合非 PNG 输入或想绕开 Node 的场合。
- **交付副本**：`scripts/preprocess/to-jpeg.ps1 -ImagePath x.png -OutputPath y.jpg [-Quality 88] [-Width 1400]` 生成轻量 JPG（PNG 母版留档；JPEG 无 alpha，透明区按 `-Background` 压平，默认黑）。
- ⚠️ **已知偏差（照实说）**：`edit_image.mjs` 的 header 注释写着「本脚本不启动任何子进程」，但实现里有**两处**子进程调用——`erase --provider i2i` 的兜底、`manifest --generate`——都是 `spawnSync(process.execPath, [generate_image.mjs, ...], { stdio: "inherit" })`，即**只复用同目录的 Node 脚本、只用了沙箱允许的 `inherit` stdio**。像素处理本身确实零子进程；引用这条约束时按本表描述，别照抄 header 的原话。

---

## 面板安装 / 注入

插件目录：`plugins/dsh-img2img-editor/`（`@dsh-external/dsh-img2img-editor`）。

```powershell
# 1) 构建：探测 dsh checkout → 链接构建期依赖 → tsc 编译 host → tsdown 打包 client
node "plugins\dsh-img2img-editor\scripts\build.mjs"
#   （bash 可用时等价：DSH_CHECKOUT=<checkout> bash scripts/build.sh）

# 2) 注入（dsh-super-injector 运行时装配，免重启）
#   dev_inject_plugin F:/dsh/img2img-studio/plugins/dsh-img2img-editor
```

- 只注册 **一个** UI 挂载点：`ctx.slots.inject('conversation.input.dock', ...)`（`id: 'img2img-editor'`，`order: 20`，`inject: ['slots','locale']`）。
- **不注册 host 工具、不注册路由、不注册服务**：host 半边 `src/index.ts` 的 `apply()` 是空的（只为了让 bundle 插件有个 Loader 入口）。
- 输入框没有图片时 dock 整条不渲染；回填失败（输入框忙 / 图片失效）会显示提示而不是崩。

---

## 硬约束

- **标记只作位置指引，绝不画进成图。** `marked-*.png` 是给模型看的位置图；可以传作参考，但 prompt 必须写明「标记只是位置指引，不要出现在成图里」（`--generate` 已自动加这句）。
- **掩码必须与基底同尺寸**。尺寸不一致时 DashScope 通道直接报错；要改尺寸就先改基底，再按新尺寸重建掩码（`mask-from-markers --like <新基底>`），不要用旧掩码。
- **抠图后基底 alpha 变了**：先与背景合成（或按透明区重新出图）再做 i2i，并把「保留透明背景」写进 prompt，否则供应商会把透明区当黑/白实底重画。
- **DashScope 结果 URL 24 小时有效**，脚本任务成功即下载到本地；**交付本地文件路径，不要把 URL 当产物**。
- **免费额度 500 张**（`wanx2.1-imageedit`，约 0.14 元/张）。批量任务先算笔数，别把额度烧在试错上。
- **失败要如实报通道与错误**：`auto` 会给出 `attempts`（`provider✗ error`），交付时把「哪个通道失败、为什么、最后用了哪个」讲清楚。**不要静默降级**、不要谎称云端口了图而实际是本地纯色抠图。
- 参数错误直接报错退出（未知 op / 缺必填参数），不要「以为改了 A 其实没改」。

## 检查清单（交付前）

- [ ] **先读了附件**（`read_image` / `vision.js`），内容与块里描述一致，没有凭空想象图片
- [ ] manifest 解析成功，`files.*` 对应的附件都已按原名收拢好，`base` 是**底图 `edited-*` 而不是 `marked-*`**
- [ ] 掩码与基底**同尺寸**；`erase` 走到 DashScope 时宽高在 512–4096
- [ ] 成图里**没有编号标记/徽章残留**（标记只是位置指引）
- [ ] 抠图产物确实是**透明通道** PNG（不是白底伪透明）；本地纯色抠图的结果已如实标注为本地降级
- [ ] 失败链如实汇报（通道 + 错误原文摘要），没有静默降级/假称成功
- [ ] 交付里写明：用了哪些 op、通道、尺寸、输出文件路径 + 关键假设
