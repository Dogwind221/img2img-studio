# 电商模式（ecommerce）

融合来源（5 个电商技能，各取其精华）：
- **ecommerce-image-suite** → 输入引导、商品分析三级策略、7 种标准套图类型、国内/跨境平台尺寸规范
- **ecom-details-image** → 25 场景模板匹配、Campaign Style Lock、GPT-Image-2 Prompt 铁律、详情页信息图结构、多角度/景别节奏、anti-AI 技巧
- **1click-ecom-detailpage** → Minimum Input Resolution Gate、Buyer Reason Card、转化驱动力诊断、英文基准文案、Product Angle Sheet 管线、强制对比图+好评图、Self-review Scorecard
- **gpt-image2-ecommerce** → 意图识别 → 模板匹配 → 精简 Prompt 的组装方式
- **designkit-skills（美图）** → 抠图/去背景/画质修复作为可选预处理（需 DESIGNKIT 凭据）

触发：商品主图、套图、卖点图、场景图、详情页、PDP、Amazon/Shopify/TikTok Shop、A+ content、广告图、社媒图、直播场景图、包装图等任何电商视觉需求。

---

## 完整管线（10 步）

```
① 输入收集（商品图 + 需求；缺图先引导）
② L1 识图 → 商品结构化描述（调用 vision.js）
③ 最小输入补齐（Resolution Gate）
④ 转化驱动力诊断 + Buyer Reason Card
⑤ 平台/渠道 + 套图类型 + 场景模板选择
⑥ 建立 Campaign Style Lock
⑦ 逐张写 Prompt（铁律 + 角度节奏 + 信息图结构）
⑧ 详情页序列（含强制对比图 + 好评图）
⑨ （可选）抠图/修复预处理（designkit）
⑩ 生成 + 自审 Scorecard
```

---

## ① 输入收集与引导（来自 suite）

用户没上传图片就要求做套图时，先给一张输入方式表让他选（不要直接开工）：

| 输入方式 | 效果 | 适用 |
|---|---|---|
| 正面+背面（平铺） | ⭐⭐⭐⭐⭐ | 服装/鞋类强烈推荐 |
| 单张正面（平铺） | ⭐⭐⭐⭐ | 仅一张时首选 |
| 正面+背面（挂拍） | ⭐⭐⭐⭐ | 有衣架的商家 |
| 单张挂拍 | ⭐⭐⭐ | 效果较平铺略差 |
| 模特实拍 | ⭐⭐⭐ | 自动提取商品特征去模特 |

多图必须同一商品；不同颜色/款式分批处理。CLI 环境接受：本地路径 / URL / base64。

## ② L1 识图 → 商品结构化描述

调用 dsh-vision-skill 的 vision.js，问题用：

```
请用中文输出这段 JSON（不要其他文字）：
{"product_name":"商品名称","category":"品类","material":"材质","color":"主色(hex)","shape":"形状结构","key_features":["核心卖点3-5条"],"text_in_image":"图上文字","background":"背景描述","defects":["瑕疵/需去除元素"],"target_audience":"适用人群"}
```

多张图逐张识别后合并。识别结果用于卖点提炼与 Prompt 注入；不确定的字段标记 `Inferred`。

## ③ 最小输入补齐（来自 1click 的 Resolution Gate）

按权重从高到低：**用户输入/附件 > 追问用户 > 联网研究（可查事实）> 逻辑推理 > 假设/默认**。
每个非用户提供的信息都要打来源标签：`User-provided / Attachment / Web-researched / Inferred / Assumption / Default`。
只要用了后三者，最终输出必须带 **Assumptions / Defaults Used** 列表。

最小输入：产品名+品类+价位、受众与购买语境、目标市场与渠道（Amazon/Shopify/TikTok Shop/淘宝/京东/拼多多/抖音）、核心差异化卖点、证据素材（测试数据/认证/评论主题/质保）、当前转化短板、促销权益（折扣/组合/包邮/保障）、是否需要本地化、输出需求（策略/Prompt/图包/直接出图）。

合规偏好默认忽略；用户明确要求「合规检查」时才启用严格模式（对比图/好评图只能用真实素材，否则用 placeholder）。

## ④ 转化驱动力诊断 + Buyer Reason Card（来自 1click + ecom-details）

先选一个主驱动力（必要时一个次级）：

- **A 视觉驱动**：靠「看见」成交——外观、质感、光泽、前后对比、礼品感
- **B 痛点驱动**：反复烦恼/风险/低效/损失明确——强制顺序：痛点挖掘 → 解决方案 → 信任证据 → 优惠+CTA
- **C 情感价值驱动**：身份、向往、归属、情绪价值、冲动

然后输出 **Buyer Reason Card**（8 字段）：Target Buyer / Purchase Trigger / Core Belief Shift / Primary Selling Reason（只选一个）/ Proof Material（无证据写 proof placeholder）/ Review Material / Offer Lever / Evidence-Bound Claims（有证据才用）。

## ⑤ 平台 + 套图类型 + 场景模板（来自 suite + ecom-details + gpt-image2）

**7 种标准套图类型**（suite）：白底主图 / 卖点图 / 场景图 / 细节图 / 对比图 / 平铺图 / 模特图。

**平台尺寸规范**：

| 平台 | 主图 | 详情页 |
|---|---|---|
| 淘宝/天猫 | 800x800 / 750x1000 | 750 宽长图 |
| 京东 | 800x800 | 750 宽 |
| 拼多多 | 750x1000 | 750 宽 |
| 抖音小店 | 800x800 / 750x1000 | 750 宽 |
| Amazon | 2000x2000（白底，产品占比 85%+） | A+ 模块 970x600 |
| Shopify/独立站 | 1024x1024 / 2048x2048 | 详情长图 2:3 |

**场景模板匹配表**（触发词 → 模板类型，来自 ecom-details / gpt-image2 的 25 模板；只匹配一个，不批量读取）：

| 触发词 | 模板类型 |
|---|---|
| 白底图/主图/hero/packshot | hero-image |
| 场景图/生活图/lifestyle | lifestyle-scene |
| 平铺图/flat lay/俯拍 | flat-lay |
| 细节图/微距/特写 | detail-macro |
| 海报/poster/banner/促销 | poster-banner |
| 社媒/小红书/Instagram/TikTok | social-media |
| UGC/买家秀 | ugc-style |
| 模特/model | model-showcase |
| 对比/before after | before-after |
| 包装/packaging/礼盒 | packaging |
| 信息图/A+/详情页 | infographic |
| 创意/概念 | creative-concept |
| 尺寸/规格/使用步骤 | size-spec |
| 套装/组合/bundle | multi-product |
| 直播/livestream | livestream |
| 试穿/try on | try-on-virtual |
| 拆解/爆炸图 | exploded-view |
| 隐形模特/ghost mannequin | ghost-mannequin |
| 多角度/网格/多色 | multi-angle-grid |
| 杂志/editorial | magazine-editorial |
| 季节/campaign | seasonal-campaign |
| 奢华/氛围/烟雾 | luxury-atmospherics |
| mockup/APP/SaaS | device-mockup |
| 店铺/门面/storefront | storefront |
| 运动/健身 | sports-campaign |

无匹配 → hero-image。模板结构：`prompt_template`（基础结构）+ `variants`（luxury/minimal/fresh/tech 风格变体）+ `category_tips`（品类建议）+ `anti_ai_tips`。

## ⑥ Campaign Style Lock（整套图的视觉合同，多图必做）

10 个必填字段：视觉方向 / 固定色板（2-3 主色+1 强调，hex）/ 冷暖调 / 字体系统（默认 modern geometric sans-serif）/ 背景系统 / 光线系统 / 布局系统 / 图标系统 / 产品呈现规则 / 禁止漂移项。

默认 Style Lock（无品牌规范时原样使用）：

```text
Campaign Style Lock: consistent premium ecommerce visual system across the entire image set; fixed palette of clean off-white background, deep charcoal text, one product-matched accent color, and one soft secondary accent; neutral-cool studio lighting; modern geometric sans-serif headline placeholders only; consistent rounded rectangular info labels; consistent thin-line icon style; clean high-end product photography mixed with minimal infographic elements; stable product scale and placement; generous whitespace; no color palette changes, no mixed fonts, no random backgrounds, no inconsistent lighting, no mismatched icon styles.
```

规则：每张图 Prompt 第一段必须原样复用同一段 Style Lock；单张只能改画面目的/主体动作/局部构图/短文案；重生单张必须复用原 Style Lock。

## ⑦ 逐张写 Prompt：GPT-Image 铁律（来自 ecom-details 实战验证）

1. **颜色用 hex 不用形容词**：白底 `#FFFFFF`、深灰字 `#2D2D2D`、金 `#D4AF37`、浅米 `#F5F1E8`、深绿 `#1A3A2E`
2. **产品占比数字化**：白底主图 35-40% / 卖点副图 25-30% / 场景图 20-25% / 信息流广告 40% / 搜索广告 45% / SKU 多规格卡 60-70%
3. **显式声明留白**：主图/副图/广告 ≥45%，场景图 ≥50%，详情页 50%+（不写必被填满）
4. **否定清单不能省**：每条 Prompt 结尾写具体禁止项，如 `不要添加：道具、手、水印、假logo、额外文字、装饰元素、渐变背景`
5. **平台预留空间**：国内主图写 `顶部中央 200x100 区域留空（价格区）`、`左上角 200x100 完全留白（logo区）`
6. **3 层信息架构**：核心承诺 ≤15 字主标题 + 2-3 个图标短标签证据 + ≤8 字 CTA
7. **批量出图优于反复调参**：一次 2K 出图，让 CTR 数据选风格

**多角度/景别节奏**（多图必做，否则千篇一律）：主图序列 ≥3 种角度（含 1 张特写/微距），详情页 ≥4 种（含 2 张特写/微距）；不能连续 3 张同角度；全景 ≤40%；每张 Prompt 显式写角度词（`from above 90-degree`、`side profile`、`low angle`、`extreme close-up macro`、`45-degree rear angle`）。

**精简原则**：只留核心信息；自然语言优先；材质纹理写具体（磨砂玻璃/拉丝金属/哑光）；光线方向和色温必写（`5500K`）；中文用「」包裹；复杂字换简单同义字。

## ⑧ 详情页序列（PDP，默认 5 主图 + 7-9 详情页图）

通用 10 屏模板：① 首屏承接（为谁解决什么问题）→ ② 痛点/欲望放大 → ③ 机制解释（不虚构数据）→ ④ 核心利益信息图（2-4 条易扫读）→ ⑤ 使用步骤 3-4 步 → ⑥ 场景覆盖 → ⑦ **对比图（强制独立一张）** → ⑧ **用户好评图（强制独立一张）** → ⑨ 信任背书（材料/质保，无证据写 placeholder）→ ⑩ FAQ/风险逆转/CTA。

**详情页图片 = 电商信息图，不是多角度产品照**：每屏 Prompt 以 `E-commerce infographic [screen]` 开头，包含布局关键词（`two-column layout` / `timeline` / `comparison layout`）、标题文案（`headline in #2D2D2D at 28pt reading 「...」`）、信息图元素（`feature callout icons` / `numbered circles` / `trust badges` / `CTA button placeholder`）。产品在不同屏展示不同角度，角度服务于信息图内容。

**图内文字规则**：主标题 3-7 英文词或 6-12 中文字；说明文字 2-4 个短标签；单区文字 ≤50 字；字体大小标题 28-48pt / 副标 16-20pt / 标注 10-14pt；主标题衬线（Didot）+ 正文无衬线（SF Pro）两种字体封顶；乱码风险高时写 `clean layout with short readable headline placeholders, no dense body text`；出图后放大 200% 逐字核对中文。

**视觉节奏**：连续图背景色交替 2-3 种（`#FFFFFF` / `#F5F1E8` / 品牌深色），防视觉疲劳。

## ⑨ 可选预处理（designkit 能力）

用户要求「先抠图/去背景/变清晰再生成」、或商品图带杂乱背景时：
- 若有 DESIGNKIT 凭据（美图设计室）：走 designkit 抠图/修复能力，返回透明底/增强图作为生成参考图
- 否则：在 Prompt 中要求 `clean cutout product on transparent or solid background`，用 vision 描述替代

## ⑩ 生成 + 自审

生成用 `generate_image.mjs`：
- 参考图策略：单张商品图直接 `--image`（保一致性）；实物产品整套图优先先做 **Product Angle Sheet**（一张临时角度基准图锁定产品身份，正式图只引用一句 `Use the product angle sheet only as product identity reference.`）
- 尺寸：主图 `1:1`，详情页 `2:3`；平台有规范时按 ⑤ 表
- 输出目录：`<产品slug>-pack-<日期时间>/`，每张图独立 Prompt、独立出图
- 供应商自动降级；DashScope i2i 不可用时回退「识图描述 + t2i」
- **生成模式决策**：1-2 张 → 单图模式；整套图（5 主图 + 7-9 详情页）Prompt 定稿后 → `--batchfile batch.json --jobs 4`（每张一个 task：prompt/image/size/quality）；每张还需单独构思文案 → 子代理逐张
- 批量输出含成功/失败统计，失败任务单独重跑

> **wanx 模型已知限制（实测）**：对「纯白 `#FFFFFF` 背景」执行不佳（常出浅灰/米灰背景），图内小文字支持也差。白底主图（尤其 Amazon）优先配置 openai/local 供应商；用 wanx 时出图后必须做像素级检查（四角/边缘颜色），必要时后处理白底化（中性灰 flood fill + 产品连通域 + 放大到规范占比），并在交付说明中告知用户做了后处理。

**Self-review Scorecard**（交付前逐项自审）：转化清晰度（1 秒看懂）/ Buyer Reason 贴合 / 英文基准自然度 / 移动端可读性 / Style Lock 一致性 / 平台适配 / 强制帧齐全（对比+好评）/ 证据诚实（不虚构认证数据销量评分）。

## 输出格式（Generate 模式）

1. 匹配模板与场景类型 → 2. 转化驱动力诊断 → 3. Buyer Reason Card → 4. 英文基准文案（默认先英文）→ 5. Campaign Style Lock → 6. Image Pack Plan（每张图编号/用途/尺寸/短文案）→ 7. 逐张 Final Prompt → 8. 生成文件路径 → 9. Assumptions / Defaults Used → 10. Self-review Scorecard

不要虚构：认证、实验数据、销量、评分、真实评价、品牌授权；缺证据就写 placeholder。
