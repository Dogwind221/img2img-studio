# 路由门（Step 0：通道 + 风格 + 细化需求）

**在开始任何生图之前**，先用 AskUserQuestion（或等价的用户输入工具）问清三件事：**生成通道、风格/场景、细化需求**。
不要跳过询问直接生成；也不要一次抛 10 个问题——按下面的优先级分 2 轮问（每轮 2-4 个问题）。

## 第一轮：通道 + 风格（必问）

### Q1 生成通道（默认 `dashscope`）

| 通道 id | 说明 | 前置条件 | 适合 |
|---|---|---|---|
| `dashscope`（默认推荐） | 通义千问 qwen-image-3.0-pro，国内直连，t2i+i2i 全支持，性能+最新 | **零配置**（复用识图 key） | 大多数场景 |
| `chatgpt-web` | ChatGPT 网页 gpt-image（用户账号额度） | 浏览器登录态在线 | 想要 ChatGPT 出图、无额外 key |
| `openai` | OpenAI 兼容 API（gpt-image 等） | `IMG_BASE_URL`+`IMG_MODEL`+`IMG_API_KEY` | 有第三方中转 key |
| `zai` | Z.AI GLM-Image，中英文文字/海报渲染强 | `ZAI_API_KEY` | 中文海报、文字密集图（**不支持参考图**） |
| `seedream` | 豆包，OpenAI 兼容，4.0+ 支持参考图 | `ARK_API_KEY` | 国内直连备选 |
| `minimax` | 海螺 image-01，人物一致性 | `MINIMAX_API_KEY` | 人像/角色一致性 |
| `local` | 本地 chatgpt-web 类生图服务 | `IMG_HTTP_URL` | 本地代理已配置 |
| `codex-cli` | Codex/ChatGPT 订阅出图 | codex CLI + imagegen 权限（当前环境不可用） | 有 Codex 订阅 |

- 用户没偏好 → 用 `dashscope`（零配置）或用户上次的选择
- 展示通道时附上可用性（`generate_image.mjs --list-providers` 可查已配置状态；chatgpt-web 需检查浏览器登录态）

### Q2 风格 / 场景（photo-art 子风格或 ecommerce 类型）

**photo-art（照片艺术）子风格：**

| 子风格 | 效果 | 触发词示例 |
|---|---|---|
| `editorial` | 保留原片 + 抽象色块面板 + 精确英文大标题的杂志页 | 编辑/杂志/abstract |
| `revival` | 白纸 80-88% 留白 + 小面积手绘插画 + 手写小字 | 焕新/手绘/白纸留白 |
| `fusion`（默认） | editorial × revival 融合：主体忠实 + 编辑版式 + 手绘质感 | 融合/混合 |
| `zine-gathered` | 3:5 实景拼贴：真景为锚 + 抽象插画 + 单一高纯色 + 手撕纤维边 | 拾景/zine/拼贴 |
| `zine-distill` | 原片不进成品，提取情绪/隐喻重创作 | 蒸馏/重新创作 |
| `zine-minimal` | 大负空间 + 单焦点 + 实验排版 + 单色强调 | 极简海报/GC |

**ecommerce（电商）类型：** 白底主图 / 卖点副图 / 场景图 / 细节图 / 对比图 / 平铺图 / 模特图 / 详情页(PDP) / 社媒图 / 直播图 / 包装图 / 海报横幅

- 用户没明确 → 看图片内容判断（商品照→电商，生活照→photo-art）或默认 `fusion`
- 用户提到的风格不在清单 → 按最接近的选并在 Assumptions 里说明

## 第二轮：细化需求（按需问，有合理默认就默认）

按优先级只问缺的关键项（一次 2-3 个）：

1. **画幅比例**：`1:1`（默认）/ `3:4` / `3:5`（zine 默认）/ `16:9` / `4:3` / `9:16` 等
2. **质量档**：`1k`（normal）/ `2k`（默认，2048 级）
3. **图内文字**：要不要文字？要的话给**精确文案**（中文 ≤8 字/屏，英文 ≤5 词，复杂字换同义字）
4. **参考图/主体保留**：是否有原图要保留主体/人物/产品？（有 → i2i，Layer 1 识图 + 身份保持准则）
5. **数量与输出**：单张还是套图（几张）？输出目录？
6. **情绪/语气方向**（photo-art 可选）：安静/活泼/怀旧/极简…；**风格变体**（ecommerce 可选）：luxury/minimal/fresh/tech
7. **平台/渠道**（ecommerce）：淘宝/京东/拼多多/抖音/Amazon/Shopify…

规则：
- 有默认值的（尺寸 1:1、质量 2k、无文字、单张）不追问，直接默认并在最终输出列出
- 影响结果的（图内文字、参考图、平台规范）必须确认
- 不要为补全配置无限追问；不确定的先 `Assumption` 标注

## 询问后的路由

```
通道选择 ── chatgpt-web ──→ references/chatgpt-web-mode.md 流程
         ├─ dashscope/openai/zai/seedream/minimax/local/codex-cli
         │      └─ 风格选择
         │           ├─ photo-art 子风格 ──→ references/photo-art-mode.md（含 zine 三风格）
         │           └─ ecommerce 类型 ──→ references/ecommerce-mode.md
         └─ 细化需求注入 Prompt（尺寸/文字/参考图/平台/变体）
```

- 通道=chatgpt-web：跳过 generate_image.mjs，走浏览器出图流程
- 其他通道：`generate_image.mjs --provider <id>`（参考图传 `--image`，尺寸/质量传参）
- 全部路由完成后才进入 Layer 2 生成，并遵守对应模式文档的 QA 检查清单

## 输出要求

- 展示给用户的通道/风格清单要**可读、带说明**（如上表），不要只给 id
- 最终交付时在回复里注明：**使用的通道、风格、尺寸、模型**、关键 Assumptions / Defaults
