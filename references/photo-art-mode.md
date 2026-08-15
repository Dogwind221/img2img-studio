# 照片艺术模式（photo-art）

融合来源：
- **photo-abstract-editorial**（照片 → 编辑杂志风竖向构图）
- **photo-revival / 废片焕新**（照片 → 白纸大留白手绘诗意插画）

适合：日常照片、废片、旅行碎片、器物、建筑、街角、旧店、宠物、食物、传统文化、民俗物件等「记忆感」照片。
不适合：写真人像精修、商业产品大海报、密集信息图、需要像素级修复的任务。

## 子风格注册

| 子风格 | 关键词（用户说这些就选它） | 一句话效果 |
|---|---|---|
| `editorial` | editorial、编辑、杂志、抽象、abstract、排版 | 保留原片 + 抽象色块面板 + 精确英文大标题的竖向杂志页 |
| `revival` | revival、焕新、手绘、插画、白纸、留白、诗意、文艺 | 白纸 80-88% 留白 + 小面积手绘插画 + 手写小字 |
| `fusion`（默认） | 融合、结合、两种都要、混合 | 原片主体忠实 + 编辑页版式 + 手绘质感 + 大留白（editorial × revival） |
| `zine-gathered` | zine、拾景、纸刊、拼贴、gathered、手撕、实景 | 3:5 实景拼贴海报：真实摄影为锚 + 抽象插画场 + 单一高纯度色彩 + 手撕纤维边 + 微型文字 |
| `zine-distill` | 蒸馏、distill、重新创作、不保留照片、隐喻 | 从照片提取情绪/隐喻重创作，原片完全不进成品，极简编辑插画 |
| `zine-minimal` | 极简海报、minimal、GC、负空间、焦点元素 | 大负空间 + 小焦点元素 + 实验排版 + 单一色彩强调的纸上海报系统 |

未明确指定时默认 `fusion`；用户指定了具体风格关键词时用对应子风格。

## 通用约束（三种子风格都要遵守）

- 输出 3:4 竖构图（尺寸传 `3:4` → 960x1280；2k 传 `3:4` 配合 --size 1080x1440 或直接传 1024x1536）
- 中文文字用「」包裹，避免生僻复杂字；英文标题逐字母核对
- 禁止：色卡、logo、地点标签、水印、来源无关的装饰元素、额外大段文字
- 生成后必须放大检查：主体保留度、文字拼写、留白比例、颜色是否铺满

---

## editorial 子风格

来自 photo-abstract-editorial 的核心约束（原版用本地脚本逐像素合成并验证摄影区域；本 skill 用 API 生图，原片作为参考图输入，视觉上保留主体与色彩，但不保证像素级一致）。

### Prompt 模板（英文为主）

```
Create a vertical editorial magazine composition (3:4) from the reference photo.

PHOTO: Keep the original photograph as the dominant element — preserve the subject, its colors, and the scene faithfully. Do not redraw the photo area into something else.

ABSTRACT PANEL: Derive a small abstract panel from the photo's palette and geometry (flat color blocks, subtle gradients, negative-space cutouts). Place it beside or overlapping the photo edge.

TYPOGRAPHY: Set one exact English headline in a high-contrast serif font (e.g. Didot / Bodoni), whole words, generous letter-spacing; optionally one connector word smaller and italic.

LAYOUT: Vertical editorial page, optical spacing between photo, panel and title; one primary and one secondary vertical anchor when the source has decisive vertical structures; negative gaps and horizontal offsets dominant elsewhere.

RESTRICT: no color swatches, no logos, no place labels, no watermarks, no extra text, no unsourced decoration.
```

### 检查清单

- 原片主体/色彩是否保留（与参考图一致）
- 标题拼写逐字母正确、无乱码
- 无 logo/水印/色卡/多余装饰
- 面板颜色确实来自原片（视觉上同源）

---

## revival 子风格

来自 photo-revival。效果参数是硬约束：

- 3:4 竖构图；白色或近白纸张底
- 主体插画只占画面 **10-16%**（绝对上限 18%）
- 画面 **80-88% 留白**
- 颜色只集中在小块插画区，不扩散到留白区
- 手绘笔触：铅笔、水彩、干刷、蜡笔、轻微 risograph 颗粒
- 少量手写小字：一句中文短诗 + 英文 `FIELD NOTE / DATE`

### Prompt 模板

```text
Transform the reference photo into a 3:4 vertical poetic hand-drawn illustration page on clean white textured paper.

Preserve:
<照片中必须保留的主体、姿态、空间、物件、氛围（来自 L1 识图）>

Redraw:
Turn the photo into a fresh hand-drawn illustration, not a photorealistic edit and not a filter.

Composition:
The illustrated subject occupies only 10-16% of the full page, absolute maximum 18%.
Keep 80-88% of the page as untouched blank white paper.
Place the small illustration slightly below center or gently off-center.

Texture:
Use pencil line, watercolor wash, dry brush, wax pastel edges, light print grain, and subtle paper texture.

Color:
Use vivid color only inside the small illustrated area.
Do not spread color into the blank white-paper field.

Text:
Add tiny handwritten caption: "<一句短中文诗句>"
Add tiny English note: "<FIELD NOTE / DATE>"
The text must be very small, handwritten, imperfect, and part of the image.

Avoid:
full-bleed photo, photo-filter look, large portrait crop, subject larger than 18%, dense collage, old yellow paper, big typography, duplicated text.
```

中文诗句示例：圆镜里藏着今天 / 猫把夜晚抱住 / 风从旧店门口经过 / 蓝里藏着风 / 竹声很轻 / 影子也会唱戏。
英文档案感小字示例：`FIELD NOTE / 08.02`、`SOFT MEMORY`、`PAPER STUDY`、`DAILY ARCHIVE`。

### 翻车防护

| 翻车 | 修复 |
|---|---|
| 主体太大 | 重新生成并硬性重申「10-16%，最大 18%，留白 80-88%」 |
| 文字重复/乱码 | 只保留一句中文 + 一个英文日期，强调「小、少、手写批注」 |
| 像照片滤镜 | 强调「newly redrawn as an illustration, not a filtered version」 |
| 颜色铺满 | 强调「Color must stay localized; the blank paper field remains white」 |
| 手写小字完全缺失 | **wanx 系模型对极小手写字支持差（可能完全不渲染）**。文字是硬需求时：优先配置 openai/local 供应商重跑；否则生成无文字版本后人工叠加，并如实告知用户 |

> 已知限制（实测）：DashScope wanx 模型多次尝试均无法渲染 revival 风格的手写小字（中文诗句 + FIELD NOTE）。交付前用 vision.js 复核文字是否真的出现；缺失时按上表处理，不要谎称有文字。

---

## fusion 子风格（editorial × revival 融合，默认）

把两边的核心约束合成「诗意编辑页」：**原片主体忠实呈现 + 编辑页版式 + 手绘质感 + 大留白**。

### 硬约束

- 3:4 竖构图；白/米白纸底（`#FAF7F2` 或 `#FFFFFF` 系）
- 主体（原片内容）占画面 **25-35%**（介于 editorial 的全片与 revival 的 16% 之间）
- 留白 **≥55%**，颜色局部化（集中在大标题、抽象面板与主体插画区）
- 版式：原片主体 + 一个从原片派生的抽象/手绘面板 + 高对比衬线大标题 + 一句手写小注
- 手绘质感：铅笔/水彩边缘、纸纹、轻微颗粒（可叠加在主体边缘过渡）

### Prompt 模板

```text
Create a 3:4 vertical poetic editorial page from the reference photo, fusing editorial magazine layout with hand-drawn white-paper minimalism.

PRESERVE the photo's subject faithfully — same subject, pose, mood, and color identity as the reference. The subject occupies 25-35% of the page.

LAYOUT: editorial page with generous whitespace (at least 55% of the page stays blank paper), one small abstract panel derived from the photo's palette, and one exact serif headline (e.g. Didot), plus one tiny handwritten Chinese or English note.

TEXTURE: hand-drawn feel — pencil line, watercolor edges, dry brush, subtle paper grain; the abstract panel may carry illustration texture.

COLOR: palette locked to the photo's dominant colors (hex: <从识图提取的主色>) plus paper white; color stays localized.

RESTRICT: no logos, no watermarks, no place labels, no color swatches, no dense collage, no full-bleed photo look, no extra text beyond the headline and one note; text must be exact and correctly spelled.
```

### 检查清单

- 主体与原片一致（含色彩倾向）
- 留白 ≥55%、颜色未铺满
- 标题精确、手写小字无乱码
- 抽象面板与主体视觉同源

---

## zine 系列子风格（gathered / distill / minimal）

融合来源：**gathered-scenes-zine**（拾景纸刊，Zeejay0）+ **gc-minimal-zine-poster**（LiamGvchi）。
共同语言：纸刊拼贴、手撕/印刷质感、大负空间、单一高纯度色彩、微型文字。注意 zine-gathered 原作者许可为**个人非商业**，商用前需授权。

### zine-gathered（实景拼贴 · Gathered Scenes）

**真景为锚、插画成场、色彩成结构、撕纸成界、纸面会呼吸**。默认 3:5 竖版、暖奶油纸、平扫质感。

硬约束：
- 摄影区占画面 25-50% 且**必须保真**（核心主体/空间关系/主手势不丢失）
- 插画区 45-70%：把复杂细节（树叶/人群/纹理）压缩成少量大的安静形（**中抽象：删 60-80% 细节**）
- 只用**一种插画语法**（silhouette/contour/field/rhythm/cut-paper 选一，最多一个辅助）
- **单一高纯度色**做构图结构（精确 hue，如纯钴蓝/番茄红/柠檬黄；源生形状延续，面积 2-20%）；其他中性墨色不超过 2 档
- **手撕纤维边**：摄影→纸面边界可见不规则手撕轮廓 + 纤维毛边（占短边 1-4%，覆盖摄影周长 35-70%）
- 微型文字：默认英文 ≤5 词（或中文 ≤8 字），打字机/手写/油印质感，放在留白区，绝不抢主体
- 硬避免：完整描摹、逐叶渲染、贴纸边框、干净数字裁切、多色、装饰性角块、商业广告层级、3D/景深、AI 平滑

Prompt 四段式（画布与注意力几何 → 场景保真 → 插画场/色彩/撕边/微文字 → 复现质感与硬避免）。质量门：缩略图下应能读成"真实场景的克制纸拼贴"，色彩拿掉后构图变弱（结构性色彩测试）。

### zine-distill（影像蒸馏 · Scene Distillation）

**原片不进入成品**，只作为语义/情绪来源。从照片提取：核心命题、张力、视觉隐喻，再用纸张/插画/色彩/自由文字重创作。

- 输出表达优先的极简编辑插画；构图允许完全脱离原片比例
- 保留：情绪余韵、1-2 个关键关系（如"靠近与错过"）、一个视觉隐喻
- 同样遵守：单一高纯度色彩做结构、手撕/印刷质感、微型文字、大负空间
- 流程：识图提取语义 → 选隐喻 → 四段式 Prompt → 生成 → 质量门

### zine-minimal（极简杂志海报 · GC Minimal Zine Poster）

大负空间 + 小焦点元素 + 实验排版 + 一个色彩强调的纸上海报系统。

硬约束：
- 竖版、纸质感（纸纹/印刷/扫描噪点）、**单一焦点视觉事件**（照片裁切、标本、剪影、印刷插画、文字对象——不要完整插画场景）
- 一个清晰高色相强调（精确 hue），位置/面积写进 Prompt；其余颜色克制
- 文字：实验排版但短（图像模型会扭曲长文字）；不复制源文字/品牌/水印/签名
- **照片输入分角色**：edit target（必须出现在成品，高保真）/ reference（只取风格）/ supporting insert（取某人/物放进新构图）；「把这张照片做成海报」默认为 edit target，保真级别 high（保留身份/结构/可识别特征）
- 变体纪律：不要反复用"居中照片+蓝点+微文字"；多张时相邻图换布局族/焦点结构/排版分布
- 质量门：必须是稀疏竖版纸海报 + 一个清晰视觉事件，不是商业广告或通用拼贴模板

### zine 通用工作流

1. L1 识图 → Scene Card：核心主体/空间不变项/主手势/视觉重量/原生色彩氛围/安静区/可延续的源生形状
2. 选路径：用户要保留现场 → gathered；要原创插画 → distill；要极简海报 → minimal
3. 构建 Abstraction Map（retain ≤1-2 形 / merge 重复 / omit 次要 / transform 转扁平 / expose 留白）
4. 组装四段式 Prompt（含精确 hue、手撕边/质感、微文字措辞）
5. 生成（`--image` 原片 + `--size 3:5` 或 `2:3`）+ 质量门检查；不合格只针对性重生成一次

---

## 工作流

1. L1 识图（SKILL.md 的 Layer 1）→ 结构化描述：主体、姿态、情绪、构图、主色（hex）、画面文字
2. 确定子风格（editorial / revival / fusion / zine-gathered / zine-distill / zine-minimal）
3. 组装 Prompt（模板 + 识图描述注入；主色转 hex 写进 Color 段）
4. 调 `generate_image.mjs`：
   - 有原片路径/附件 → 传 `--image`（图生图；DashScope 不支持时按脚本指引回退 t2i）
   - 尺寸：`--size 3:4`（或 1024x1536）
5. QA：放大检查主体保留、文字、留白、颜色；不合格则修正约束重新生成
