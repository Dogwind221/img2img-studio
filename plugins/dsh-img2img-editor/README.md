# dsh-img2img-editor

img2img-studio 的 **GUI 编辑入口**：图片放进对话输入框后，在输入框上方的「图片编辑」条上打开全屏编辑器，做四件事——

1. **标记修改点**：在图上点一下加一个带编号的标记（可拖动），右侧每个标记配一个输入框写「这一处要怎么改」（ChatGPT add-marker 的体验）；
2. **移除背景**：本地纯色背景抠图即时预览（复杂背景交给云端抠图，见技能脚本）；
3. **涂抹擦除**：画笔涂抹要处理/重绘的区域，可「擦回」、撤销一笔、全部清除，并写涂抹区域的统一处理要求；
4. **调整大小**：比例预设（原图 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16）+ 宽高 + 裁切填满 / 完整放入 / 拉伸。

点「放回输入框」后：编辑结果作为**附件**回到输入框（`marked-*.png` 带标记的位置图 / `edited-*.png` 干净底图 / `mask-*.png` 涂抹掩码），草稿里写入一段 `<!-- img2img-editor:begin --> … <!-- img2img-editor:end -->` 说明块（附件清单 + 标记坐标与改法 + 请求动作 + 一行 `JSON:` manifest）。用户按发送，agent 据此调 `img2img-studio/scripts/edit_image.mjs` 交给生图供应商。

## 结构

| 半边 | 位置 | 作用 |
|---|---|---|
| host | `src/index.ts` | 空 `apply()`：编辑器是纯浏览器面，不注册服务/工具/路由（包需要一个 Loader 入口） |
| client | `src/client/` | 注册 `conversation.input.dock` 一个条目（`id: img2img-editor`, `order: 20`），输入框里没有图片时**不渲染任何东西** |
| 光栅核心 | `src/client/raster.ts` | 本地抠图（边界泛洪）、resize/cover/contain/stretch、涂抹掩码回放、编号标记绘制、导出 `edited`/`marked`/`mask` |
| 交付格式 | `src/client/manifest.ts` | 生成说明块与 JSON manifest，重编辑时替换旧块而不是叠加 |

客户端只用两处 DSH 内部面，都是**惰性 `ctx.get('conversation')` 读取**（与 dsh-better-sidebar 同样的做法）：

- `resolveDraftAttachments(ids)` —— 把输入框里的图片草稿解析成 `{file, previewUrl}`；
- `createDrafts(sessionId, files)` / `releaseDraftAttachment(id)` —— 把编辑结果登记成新的草稿附件。

草稿文本与附件增删走 slot 标准座位（`useInput` / `inputActions`）；服务缺失或方法改名时降级为可见提示，不崩。

## 构建与安装

```bash
# 1) 构建（host tsc + client tsdown；Node 版脚本，沙箱里无需 bash）
node scripts/build.mjs
# 2) 运行时注入（免重启）或写进 profile 的 bundles 列表持久化：
#    dev_inject_plugin <本目录>
#    dev_install_package <本目录>
```

构建依赖从 DSH checkout 链接（`@types/node`、`@types/react`、`tsdown`）；`scripts/build.sh` 是同一流程的 bash 版本，供注入器的 `dev_build_plugin` 调用。

## 已知限制

- **不做任意矩形裁剪**：`cover` 居中裁切覆盖了绝大多数改比例需求；自由裁剪框未做。
- **本地抠图只对纯色/近色背景有效**（边界泛洪 + 容差），复杂背景请用云端抠图通道。
- **依赖 DSH 客户端的非公开方法**：`conversation.resolveDraftAttachments` / `createDrafts`。它们在 0.1.5-rc.2 上是 `ConversationController` 的公开方法但不在 `IConversation` 声明里；升级 DSH 后若被改动，面板会退化成「编辑条不显示」，不会报错崩掉。
- **标记是位置指引，不是掩码**：面板只输出标记坐标与文字；把标记转成可重绘区域由技能脚本 `mask-from-markers` 完成。
- 面板文案注册在 `img2imgEditor` 命名空间（zh/en），随 GUI 语言切换。
