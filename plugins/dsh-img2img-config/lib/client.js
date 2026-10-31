window.__ModuleLoader__.load({ id: "dsh-img2img-config", factory: (require) => {


		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/manifest.ts
		/** Opening delimiter written by plugin versions that printed the block into the draft. */
		const LEGACY_BLOCK_BEGIN = "<!-- img2img-editor:begin -->";
		/** Closing delimiter of that legacy block. */
		const LEGACY_BLOCK_END = "<!-- img2img-editor:end -->";
		/** Leading token of every brief; the marker `mergeDraft` replaces in place. */
		const BRIEF_MARK = "[img2img]";
		/** Closing token of a draft-carried brief, so a re-edit removes the whole block. */
		const BRIEF_END = "[/img2img]";
		/** First line of every brief: the header, and the whole clipboard projection of a chip. */
		const BRIEF_HEADER = `${BRIEF_MARK} 图片编辑请求 · img2img-studio`;
		/** Reference-source name owning the brief chip (unique within its trigger). */
		const SOURCE_NAME = "img2img-brief";
		/** Draft-attachment filename carrying the machine-readable manifest. */
		const MANIFEST_FILENAME = "img2img-manifest.json";
		/** Percent label of one normalized coordinate, one decimal. */
		function percent(value) {
			return `${(value * 100).toFixed(1)}%`;
		}
		/**
		* Compose the brief the model reads.
		* @param manifest - the exported facts.
		* @param parts - attachment legend and the carrier the brief is built for.
		* @returns the brief text, whose first line is {@link BRIEF_HEADER}.
		*/
		function buildBrief(manifest, parts) {
			const lines = [BRIEF_HEADER];
			parts.legend.forEach((label, index) => {
				lines.push(`附件${index + 1} ${label}`);
			});
			if (manifest.markers.length > 0) {
				lines.push("标记修改点（坐标为归一化百分比，原点左上角）：");
				for (const marker of manifest.markers) {
					const text = marker.text.trim() === "" ? "(未填写改法)" : marker.text.trim();
					lines.push(`  ${marker.id}. (x ${percent(marker.x)}, y ${percent(marker.y)}) ${text}`);
				}
			}
			const actions = [];
			if (manifest.bgRemove.requested) actions.push(manifest.bgRemove.localPreview ? "移除背景（已给本地纯色背景预览，建议云端抠图重做得到透明 PNG）" : "移除背景（云端抠图，输出透明 PNG）");
			if (manifest.erase.strokes > 0) actions.push(`涂抹擦除/局部重绘 ${manifest.erase.strokes} 笔：${manifest.erase.prompt}`);
			if (manifest.size.changed) actions.push(`调整大小到 ${manifest.size.width}×${manifest.size.height}（${modeLabel(manifest.size.mode)}）`);
			lines.push(`请求动作：${actions.length > 0 ? actions.join("；") : "仅按标记做局部修改"}`);
			lines.push("给生图供应商：按标记与掩码做局部重绘，再做整体 i2i；标记与掩码只用于定位，不要出现在成图里。");
			lines.push(parts.carrier === "chip" ? `JSON: ${JSON.stringify(manifest)}` : BRIEF_END);
			return lines.join("\n");
		}
		/**
		* Wrap the manifest as the draft attachment the model reads verbatim.
		* @param manifest - the exported facts.
		* @returns the JSON file to stage alongside the exported images.
		*/
		function manifestFile(manifest) {
			return new File([JSON.stringify(manifest, null, 2)], MANIFEST_FILENAME, { type: "application/json" });
		}
		/** Chinese label of one size mode. */
		function modeLabel(mode) {
			if (mode === "cover") return "裁切填满";
			if (mode === "contain") return "完整放入";
			return "拉伸变形";
		}
		/**
		* Replace whatever hand-off text a previous edit left, keeping the user's own
		* text intact. Three leftovers are removed in place: the legacy comment block an
		* older plugin version printed, a previous draft brief between its markers, and
		* — defensively, for a brief whose closing token went missing — its header line
		* alone.
		* @param draft - current composer draft.
		* @param brief - freshly generated draft-carried brief.
		* @returns the next draft text.
		*/
		function mergeDraft(draft, brief) {
			let text = stripLegacyBlock(draft);
			const start = text.indexOf(BRIEF_MARK);
			if (start >= 0) {
				const close = text.indexOf(BRIEF_END, start);
				if (close >= 0) text = `${text.slice(0, start)}${text.slice(close + 10)}`;
				else {
					const end = text.indexOf("\n", start);
					text = end < 0 ? text.slice(0, start) : `${text.slice(0, start)}${text.slice(end + 1)}`;
				}
			}
			const trimmed = text.replace(/\n{3,}/gu, "\n\n").trim();
			return trimmed === "" ? brief : `${trimmed}\n\n${brief}`;
		}
		/** Remove the legacy `<!-- img2img-editor:begin --> … end` block, if a draft still holds one. */
		function stripLegacyBlock(draft) {
			const start = draft.indexOf(LEGACY_BLOCK_BEGIN);
			if (start < 0) return draft;
			const end = draft.indexOf(LEGACY_BLOCK_END);
			if (end <= start) return draft;
			return `${draft.slice(0, start)}${draft.slice(end + 27)}`;
		}
		//#endregion
		//#region src/client/brief-source.ts
		/**
		* Build the brief chip's owning source.
		* @returns the source to register with `inputTriggers`.
		*/
		function briefSource() {
			return {
				trigger: "@",
				name: SOURCE_NAME,
				order: 900,
				showGroupTitle: false,
				candidates: () => Promise.resolve([]),
				onPick: () => void 0,
				codec: {
					clipboardText: (ref) => {
						const first = ref.split("\n", 1)[0];
						return first === void 0 || first === "" ? BRIEF_MARK : first;
					},
					serialize: (ref) => Promise.resolve(ref)
				}
			};
		}
		/** Pin colour, matching the marker list accent. */
		const PIN_FILL = "rgba(255, 59, 48, 0.92)";
		/** Translucent stroke colour used by the on-canvas mask overlay. */
		const MASK_OVERLAY = "rgba(255, 90, 60, 0.55)";
		/** Create an offscreen canvas of the given pixel size. */
		function createCanvas(width, height) {
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(width));
			canvas.height = Math.max(1, Math.round(height));
			return canvas;
		}
		/** 2D context of a canvas, failing loud when the browser refuses one. */
		function context2d(canvas) {
			const ctx = canvas.getContext("2d");
			if (ctx === null) throw new Error("img2img-editor: 2D canvas context unavailable");
			return ctx;
		}
		/** Draw an image element into a fresh canvas at its natural size. */
		function sourceCanvas(image) {
			const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
			context2d(canvas).drawImage(image, 0, 0);
			return canvas;
		}
		/**
		* Local flat-background cutout: flood the border inward while pixels stay within
		* `tolerance` of the border reference colour, then zero their alpha and soften
		* the seam by one pixel.
		*
		* The reference colour is the median of border samples, so a subject that
		* touches the frame edge keeps its pixels unless they match the background.
		* Complex or gradient backgrounds need the cloud channel; the editor says so
		* instead of pretending otherwise.
		*/
		function applyCutout(source, tolerance) {
			const width = source.width;
			const height = source.height;
			const out = createCanvas(width, height);
			const ctx = context2d(out);
			ctx.drawImage(source, 0, 0);
			const total = width * height;
			if (total > 6e6) return out;
			const frame = ctx.getImageData(0, 0, width, height);
			const pixels = frame.data;
			const reference = borderReference(pixels, width, height);
			const removed = new Uint8Array(total);
			const queue = new Int32Array(total);
			let head = 0;
			let tail = 0;
			const tolerance2 = tolerance * tolerance;
			const push = (index) => {
				if (removed[index] === 1) return;
				removed[index] = 1;
				queue[tail] = index;
				tail += 1;
			};
			for (let x = 0; x < width; x += 1) {
				push(x);
				push((height - 1) * width + x);
			}
			for (let y = 0; y < height; y += 1) {
				push(y * width);
				push(y * width + width - 1);
			}
			while (head < tail) {
				const index = queue[head];
				head += 1;
				const x = index % width;
				const y = (index - x) / width;
				const neighbours = [
					x > 0 ? index - 1 : -1,
					x < width - 1 ? index + 1 : -1,
					y > 0 ? index - width : -1,
					y < height - 1 ? index + width : -1
				];
				for (const neighbour of neighbours) {
					if (neighbour < 0 || removed[neighbour] === 1) continue;
					const offset = neighbour * 4;
					const dr = pixels[offset] - reference[0];
					const dg = pixels[offset + 1] - reference[1];
					const db = pixels[offset + 2] - reference[2];
					if (dr * dr + dg * dg + db * db <= tolerance2) push(neighbour);
				}
			}
			const alpha = new Uint8Array(total);
			for (let index = 0; index < total; index += 1) alpha[index] = removed[index] === 1 ? 0 : 255;
			for (let index = 0; index < total; index += 1) {
				if (removed[index] === 1) continue;
				const x = index % width;
				const y = (index - x) / width;
				if (x > 0 && removed[index - 1] === 1 || x < width - 1 && removed[index + 1] === 1 || y > 0 && removed[index - width] === 1 || y < height - 1 && removed[index + width] === 1) alpha[index] = 150;
			}
			for (let index = 0; index < total; index += 1) pixels[index * 4 + 3] = alpha[index];
			ctx.putImageData(frame, 0, 0);
			return out;
		}
		/** Median border colour of an RGBA buffer, sampled every few pixels. */
		function borderReference(pixels, width, height) {
			const reds = [];
			const greens = [];
			const blues = [];
			const stride = Math.max(1, Math.round(Math.min(width, height) / 128));
			const sample = (x, y) => {
				const offset = (y * width + x) * 4;
				reds.push(pixels[offset]);
				greens.push(pixels[offset + 1]);
				blues.push(pixels[offset + 2]);
			};
			for (let x = 0; x < width; x += stride) {
				sample(x, 0);
				sample(x, height - 1);
			}
			for (let y = 0; y < height; y += stride) {
				sample(0, y);
				sample(width - 1, y);
			}
			const median = (values) => {
				values.sort((a, b) => a - b);
				return values[Math.floor(values.length / 2)] ?? 0;
			};
			return [
				median(reds),
				median(greens),
				median(blues)
			];
		}
		/**
		* Produce the edited base bitmap: optional local cutout first (at source
		* resolution, where the flood fill has the most detail), then the resize rule.
		*/
		function drawBase(image, size, cutout) {
			const source = sourceCanvas(image);
			const staged = cutout.enabled ? applyCutout(source, cutout.tolerance) : source;
			const out = createCanvas(size.width, size.height);
			const ctx = context2d(out);
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			const sw = staged.width;
			const sh = staged.height;
			if (size.mode === "stretch") {
				ctx.drawImage(staged, 0, 0, size.width, size.height);
				return out;
			}
			const scale = size.mode === "cover" ? Math.max(size.width / sw, size.height / sh) : Math.min(size.width / sw, size.height / sh);
			const dw = sw * scale;
			const dh = sh * scale;
			ctx.drawImage(staged, (size.width - dw) / 2, (size.height - dh) / 2, dw, dh);
			return out;
		}
		/**
		* Replay the brush strokes into a canvas.
		*
		* `overlay` is the translucent on-canvas guide; `binary` is the exported mask
		* the providers need (white = the region to redraw, black = keep), which is the
		* `wanx2.1-imageedit` mask convention.
		*/
		function renderMask(strokes, width, height, style) {
			const canvas = createCanvas(width, height);
			const ctx = context2d(canvas);
			if (style === "binary") {
				ctx.fillStyle = "#000000";
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}
			for (const stroke of strokes) {
				const paint = style === "binary" ? stroke.mode === "paint" ? "#ffffff" : "#000000" : MASK_OVERLAY;
				ctx.save();
				if (style === "overlay" && stroke.mode === "restore") ctx.globalCompositeOperation = "destination-out";
				ctx.strokeStyle = paint;
				ctx.fillStyle = paint;
				ctx.lineWidth = Math.max(1, stroke.radius * Math.min(canvas.width, canvas.height) * 2);
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				const points = stroke.points;
				const first = points[0];
				if (first !== void 0 && points.length === 1) {
					ctx.beginPath();
					ctx.arc(first[0] * canvas.width, first[1] * canvas.height, ctx.lineWidth / 2, 0, Math.PI * 2);
					ctx.fill();
				} else if (first !== void 0) {
					ctx.beginPath();
					ctx.moveTo(first[0] * canvas.width, first[1] * canvas.height);
					for (let index = 1; index < points.length; index += 1) {
						const point = points[index];
						ctx.lineTo(point[0] * canvas.width, point[1] * canvas.height);
					}
					ctx.stroke();
				}
				ctx.restore();
			}
			return canvas;
		}
		/** Draw the numbered pins that tell the model where each change belongs. */
		function paintMarkers(ctx, markers, width, height, activeId) {
			const radius = Math.max(11, Math.min(width, height) * .026);
			for (const marker of markers) {
				const cx = marker.x * width;
				const cy = marker.y * height;
				ctx.save();
				ctx.beginPath();
				ctx.arc(cx, cy, marker.id === activeId ? radius * 1.18 : radius, 0, Math.PI * 2);
				ctx.fillStyle = PIN_FILL;
				ctx.fill();
				ctx.lineWidth = Math.max(2, radius * .2);
				ctx.strokeStyle = marker.id === activeId ? "#ffd60a" : "rgba(255, 255, 255, 0.95)";
				ctx.stroke();
				ctx.fillStyle = "#ffffff";
				ctx.font = `600 ${Math.round(radius * 1.1)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
				ctx.textAlign = "center";
				ctx.textBaseline = "middle";
				ctx.fillText(String(marker.id), cx, cy + 1);
				ctx.restore();
			}
		}
		/**
		* 在预览画布上画「裁切填满 / 完整放入 / 拉伸」的视觉提示；只影响预览，不进导出图。
		* cover 用红色半透明条标出会被裁掉的边缘，contain 压暗留白区域，stretch 只画目标框。
		* @param ctx - 预览画布 2D 上下文。
		* @param width - 画布宽度（目标尺寸）。
		* @param height - 画布高度（目标尺寸）。
		* @param natural - 原图像素尺寸。
		* @param mode - 尺寸模式。
		* @param label - 已本地化的一句说明文字。
		*/
		function drawSizeGuides(ctx, width, height, natural, mode, label) {
			const line = Math.max(2, Math.round(Math.min(width, height) / 300));
			const shade = (x, y, w, h, color) => {
				if (w <= 0 || h <= 0) return;
				ctx.setLineDash([]);
				ctx.fillStyle = color;
				ctx.fillRect(x, y, w, h);
			};
			ctx.save();
			ctx.setLineDash([line * 4, line * 3]);
			ctx.lineWidth = line;
			ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
			ctx.strokeRect(line, line, Math.max(1, width - line * 2), Math.max(1, height - line * 2));
			const sourceAspect = natural.width / Math.max(1, natural.height);
			const targetAspect = width / Math.max(1, height);
			if (mode === "cover" && Math.abs(sourceAspect - targetAspect) > .001) if (sourceAspect > targetAspect) {
				const band = Math.max(2, Math.round((1 - targetAspect / sourceAspect) / 2 * width));
				shade(0, 0, band, height, "rgba(255, 69, 58, 0.35)");
				shade(width - band, 0, band, height, "rgba(255, 69, 58, 0.35)");
			} else {
				const band = Math.max(2, Math.round((1 - sourceAspect / targetAspect) / 2 * height));
				shade(0, 0, width, band, "rgba(255, 69, 58, 0.35)");
				shade(0, height - band, width, band, "rgba(255, 69, 58, 0.35)");
			}
			else if (mode === "contain") {
				const scale = Math.min(width / natural.width, height / natural.height);
				const w = Math.round(natural.width * scale);
				const h = Math.round(natural.height * scale);
				const x = Math.round((width - w) / 2);
				const y = Math.round((height - h) / 2);
				shade(0, 0, x, height, "rgba(0, 0, 0, 0.45)");
				shade(width - x, 0, x, height, "rgba(0, 0, 0, 0.45)");
				shade(0, 0, width, y, "rgba(0, 0, 0, 0.45)");
				shade(0, height - y, width, y, "rgba(0, 0, 0, 0.45)");
			}
			const fontSize = Math.max(12, Math.round(Math.min(width, height) / 26));
			ctx.setLineDash([]);
			ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
			const padding = Math.round(fontSize * .55);
			const boxWidth = Math.min(width - padding * 2, ctx.measureText(label).width + padding * 2);
			const boxHeight = fontSize + padding * 2;
			const boxX = Math.round((width - boxWidth) / 2);
			const boxY = Math.round(height - boxHeight - padding);
			ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
			ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
			ctx.fillStyle = "#ffffff";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(label, width / 2, boxY + boxHeight / 2);
			ctx.restore();
		}
		/** The exported edited bitmap: base pixels plus the marker pins. */
		function composeEdited(base, markers) {
			const canvas = createCanvas(base.width, base.height);
			const ctx = context2d(canvas);
			ctx.drawImage(base, 0, 0);
			paintMarkers(ctx, markers, canvas.width, canvas.height);
			return canvas;
		}
		/** PNG blob of a canvas, for composer attachments and downloads. */
		function canvasToBlob(canvas) {
			return new Promise((resolve, reject) => {
				canvas.toBlob((blob) => {
					if (blob === null) reject(/* @__PURE__ */ new Error("img2img-editor: canvas encode failed"));
					else resolve(blob);
				}, "image/png");
			});
		}
		/** Largest size fitting `width`×`height` inside a box, preserving the ratio. */
		function fitWithin(width, height, maxWidth, maxHeight) {
			const scale = Math.min(1, maxWidth / width, maxHeight / height);
			return {
				width: Math.max(1, Math.round(width * scale)),
				height: Math.max(1, Math.round(height * scale))
			};
		}
		//#endregion
		//#region src/client/EditorModal.tsx
		/**
		* The full-screen image editor: numbered change markers, a brush mask, a local
		* cutout preview, and deterministic resize/crop.
		*
		* All editing state is component-local (one editor session, one component), so
		* nothing here needs a store seat. The modal only produces files and a manifest;
		* staging them into the composer belongs to the dock entry.
		*/
		/** Canvas box the preview is fitted into. */
		const VIEW_MAX_WIDTH = 720;
		const VIEW_MAX_HEIGHT = 540;
		/** Ratio presets offered by the size panel. */
		const RATIO_PRESETS = [
			{
				key: "original",
				label: "原图",
				ratio: null
			},
			{
				key: "1:1",
				label: "1:1",
				ratio: 1
			},
			{
				key: "4:3",
				label: "4:3",
				ratio: 4 / 3
			},
			{
				key: "3:4",
				label: "3:4",
				ratio: 3 / 4
			},
			{
				key: "16:9",
				label: "16:9",
				ratio: 16 / 9
			},
			{
				key: "9:16",
				label: "9:16",
				ratio: 9 / 16
			}
		];
		const clamp01 = (value) => Math.min(1, Math.max(0, value));
		const panelStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 10,
			width: 300,
			minWidth: 300,
			maxHeight: "78vh",
			overflowY: "auto",
			paddingRight: 4
		};
		const sectionStyle = {
			border: "1px solid var(--dsw-alias-border-l2, #3a3a40)",
			borderRadius: 10,
			padding: "10px 12px",
			display: "flex",
			flexDirection: "column",
			gap: 8,
			background: "var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.02))"
		};
		const sectionTitleStyle = {
			fontSize: 13,
			fontWeight: 600,
			color: "var(--dsw-alias-label-primary, #e8e8ea)"
		};
		const hintStyle$1 = {
			fontSize: 12,
			lineHeight: 1.5,
			color: "var(--dsw-alias-label-tertiary, #9a9aa2)"
		};
		const buttonStyle = {
			padding: "6px 10px",
			borderRadius: 8,
			cursor: "pointer",
			fontSize: 12,
			border: "1px solid var(--dsw-alias-border-l2, #3a3a40)",
			background: "var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04))",
			color: "var(--dsw-alias-label-primary, #e8e8ea)"
		};
		const primaryButtonStyle = {
			...buttonStyle,
			background: "var(--dsw-alias-button-primary-fill, #4d6bfe)",
			borderColor: "transparent",
			color: "var(--dsw-alias-label-primary-foreground, #ffffff)",
			fontWeight: 600
		};
		const activeButtonStyle = {
			...buttonStyle,
			background: "var(--dsw-alias-button-ghost-active-fill, rgba(77,107,254,0.18))",
			borderColor: "var(--dsw-alias-brand-primary, #4d6bfe)"
		};
		const inputStyle = {
			padding: "5px 8px",
			borderRadius: 8,
			fontSize: 12,
			width: "100%",
			boxSizing: "border-box",
			border: "1px solid var(--dsw-alias-border-l2, #3a3a40)",
			background: "var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.2))",
			color: "var(--dsw-alias-label-primary, #e8e8ea)"
		};
		/** The editor modal itself. */
		function EditorModal({ source, t, onCancel, onApply }) {
			const previewRef = (0, react.useRef)(null);
			const drag = (0, react.useRef)(null);
			const nextId = (0, react.useRef)(1);
			const [image, setImage] = (0, react.useState)(null);
			const [natural, setNatural] = (0, react.useState)({
				width: 1,
				height: 1
			});
			const [size, setSize] = (0, react.useState)({
				width: 1,
				height: 1,
				mode: "cover"
			});
			const [draftSize, setDraftSize] = (0, react.useState)({
				width: "1",
				height: "1"
			});
			const [cutout, setCutout] = (0, react.useState)({
				enabled: false,
				tolerance: 36
			});
			const [markers, setMarkers] = (0, react.useState)([]);
			const [strokes, setStrokes] = (0, react.useState)([]);
			const [tool, setTool] = (0, react.useState)("marker");
			const [brush, setBrush] = (0, react.useState)(.05);
			const [eraseMode, setEraseMode] = (0, react.useState)("paint");
			const [erasePrompt, setErasePrompt] = (0, react.useState)("抹掉涂抹区域的内容，用周围背景自然填补");
			const [activeId, setActiveId] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const element = new Image();
				element.onload = () => {
					setImage(element);
					setNatural({
						width: element.naturalWidth,
						height: element.naturalHeight
					});
					setSize({
						width: element.naturalWidth,
						height: element.naturalHeight,
						mode: "cover"
					});
					setDraftSize({
						width: String(element.naturalWidth),
						height: String(element.naturalHeight)
					});
				};
				element.onerror = () => {
					setError(t("editor.loadFail"));
				};
				element.src = source.previewUrl;
				return () => {
					element.onload = null;
				};
			}, [source.previewUrl, t]);
			(0, react.useEffect)(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onCancel();
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, [onCancel]);
			const base = (0, react.useMemo)(() => image === null ? null : drawBase(image, size, cutout), [
				image,
				size.width,
				size.height,
				size.mode,
				cutout.enabled,
				cutout.tolerance
			]);
			const display = base === null ? null : fitWithin(base.width, base.height, VIEW_MAX_WIDTH, VIEW_MAX_HEIGHT);
			const guideLabel = size.mode === "cover" ? t("editor.guideCover") : size.mode === "contain" ? t("editor.guideContain") : t("editor.guideStretch");
			(0, react.useEffect)(() => {
				const target = previewRef.current;
				if (base === null || target === null) return;
				const ctx = context2d(target);
				ctx.clearRect(0, 0, target.width, target.height);
				ctx.drawImage(base, 0, 0, target.width, target.height);
				if (strokes.length > 0) ctx.drawImage(renderMask(strokes, target.width, target.height, "overlay"), 0, 0);
				paintMarkers(ctx, markers, target.width, target.height, activeId ?? void 0);
				drawSizeGuides(ctx, target.width, target.height, natural, size.mode, guideLabel);
			}, [
				base,
				markers,
				strokes,
				activeId,
				natural,
				size.mode,
				guideLabel
			]);
			const pointerAt = (0, react.useCallback)((event) => {
				const rect = event.currentTarget.getBoundingClientRect();
				return {
					x: clamp01((event.clientX - rect.left) / Math.max(1, rect.width)),
					y: clamp01((event.clientY - rect.top) / Math.max(1, rect.height))
				};
			}, []);
			const hitMarker = (0, react.useCallback)((point, event) => {
				const rect = event.currentTarget.getBoundingClientRect();
				return markers.find((marker) => {
					const dx = (marker.x - point.x) * rect.width;
					const dy = (marker.y - point.y) * rect.height;
					return Math.hypot(dx, dy) <= 18;
				});
			}, [markers]);
			/**
			* 标记行键盘操作：方向键微调（1%，Shift 5%）、Delete/Backspace 删除。
			* 只在行本身获得焦点时生效，避免抢走文本框里的退格/方向键。
			*/
			const onMarkerKeyDown = (0, react.useCallback)((event, marker) => {
				if (event.target !== event.currentTarget) return;
				if (event.key === "Delete" || event.key === "Backspace") {
					event.preventDefault();
					setMarkers((previous) => previous.filter((item) => item.id !== marker.id));
					if (activeId === marker.id) setActiveId(null);
					return;
				}
				const step = event.shiftKey ? .05 : .01;
				let dx = 0;
				let dy = 0;
				if (event.key === "ArrowLeft") dx = -step;
				else if (event.key === "ArrowRight") dx = step;
				else if (event.key === "ArrowUp") dy = -step;
				else if (event.key === "ArrowDown") dy = step;
				else return;
				event.preventDefault();
				setMarkers((previous) => previous.map((item) => item.id === marker.id ? {
					...item,
					x: Math.min(1, Math.max(0, item.x + dx)),
					y: Math.min(1, Math.max(0, item.y + dy))
				} : item));
			}, [activeId]);
			const onPointerDown = (0, react.useCallback)((event) => {
				if (busy) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				const point = pointerAt(event);
				if (tool === "marker") {
					const hit = hitMarker(point, event);
					if (hit !== void 0) {
						setActiveId(hit.id);
						drag.current = {
							kind: "marker",
							id: hit.id
						};
						return;
					}
					const id = nextId.current;
					nextId.current += 1;
					setMarkers((previous) => [...previous, {
						id,
						x: point.x,
						y: point.y,
						text: ""
					}]);
					setActiveId(id);
					drag.current = {
						kind: "marker",
						id
					};
					return;
				}
				setStrokes((previous) => [...previous, {
					mode: eraseMode,
					radius: brush,
					points: [[point.x, point.y]]
				}]);
				drag.current = { kind: "stroke" };
			}, [
				brush,
				busy,
				eraseMode,
				hitMarker,
				pointerAt,
				tool
			]);
			const onPointerMove = (0, react.useCallback)((event) => {
				const current = drag.current;
				if (current === null) return;
				const point = pointerAt(event);
				if (current.kind === "marker") {
					setMarkers((previous) => previous.map((marker) => marker.id === current.id ? {
						...marker,
						x: point.x,
						y: point.y
					} : marker));
					return;
				}
				setStrokes((previous) => {
					const last = previous[previous.length - 1];
					if (last === void 0) return previous;
					const tail = last.points[last.points.length - 1];
					if (tail !== void 0 && Math.hypot(tail[0] - point.x, tail[1] - point.y) < .002) return previous;
					last.points.push([point.x, point.y]);
					return [...previous];
				});
			}, [pointerAt]);
			const endDrag = (0, react.useCallback)(() => {
				drag.current = null;
			}, []);
			const commitDimension = (0, react.useCallback)((key, raw) => {
				setDraftSize((previous) => ({
					...previous,
					[key]: raw
				}));
				const value = Number.parseInt(raw, 10);
				if (!Number.isFinite(value)) return;
				const clamped = Math.min(4096, Math.max(64, value));
				setSize((previous) => ({
					...previous,
					[key]: clamped
				}));
			}, []);
			const applyRatio = (0, react.useCallback)((ratio) => {
				if (ratio === null) {
					setSize((previous) => ({
						...previous,
						width: natural.width,
						height: natural.height
					}));
					setDraftSize({
						width: String(natural.width),
						height: String(natural.height)
					});
					return;
				}
				const long = Math.max(natural.width, natural.height, 512);
				const width = ratio >= 1 ? long : Math.round(long * ratio);
				const height = ratio >= 1 ? Math.round(long / ratio) : long;
				setSize((previous) => ({
					...previous,
					width,
					height
				}));
				setDraftSize({
					width: String(width),
					height: String(height)
				});
			}, [natural.height, natural.width]);
			const confirm = (0, react.useCallback)(async () => {
				if (base === null) return;
				setBusy(true);
				setError(null);
				try {
					const stamp = Date.now().toString(36);
					const ordered = [...markers].sort((a, b) => a.id - b.id);
					const files = [];
					const legend = [];
					const editedName = `edited-${stamp}.png`;
					const markedName = ordered.length > 0 ? `marked-${stamp}.png` : void 0;
					const maskName = strokes.length > 0 ? `mask-${stamp}.png` : void 0;
					if (markedName !== void 0) {
						const markedBlob = await canvasToBlob(composeEdited(base, ordered));
						files.push(new File([markedBlob], markedName, { type: "image/png" }));
						legend.push(`${markedName}：带编号标记的位置图（标记只用于指示位置，不要画进成图）`);
					}
					const editedBlob = await canvasToBlob(base);
					files.push(new File([editedBlob], editedName, { type: "image/png" }));
					legend.push(`${editedName}：编辑后的底图（${base.width}×${base.height}，出图用这张作基底）`);
					if (maskName !== void 0) {
						const maskBlob = await canvasToBlob(renderMask(strokes, base.width, base.height, "binary"));
						files.push(new File([maskBlob], maskName, { type: "image/png" }));
						legend.push(`${maskName}：涂抹掩码（白色 = 要处理/重绘的区域，黑色 = 保留）`);
					}
					onApply({
						files,
						legend,
						manifest: {
							version: 1,
							createdAt: (/* @__PURE__ */ new Date()).toISOString(),
							source: {
								name: source.file.name,
								width: natural.width,
								height: natural.height
							},
							size: {
								width: base.width,
								height: base.height,
								mode: size.mode,
								changed: base.width !== natural.width || base.height !== natural.height
							},
							bgRemove: {
								requested: cutout.enabled,
								localPreview: cutout.enabled,
								tolerance: cutout.tolerance
							},
							erase: {
								strokes: strokes.length,
								prompt: erasePrompt.trim()
							},
							markers: ordered.map((marker) => ({
								id: marker.id,
								x: marker.x,
								y: marker.y,
								text: marker.text
							})),
							files: {
								edited: editedName,
								...markedName === void 0 ? {} : { marked: markedName },
								...maskName === void 0 ? {} : { mask: maskName }
							}
						}
					});
				} catch (caught) {
					setError(caught instanceof Error ? caught.message : String(caught));
				} finally {
					setBusy(false);
				}
			}, [
				base,
				cutout,
				erasePrompt,
				markers,
				natural.height,
				natural.width,
				onApply,
				size.mode,
				source.file.name,
				strokes
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 4e3,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					background: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.62))"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						width: "min(1120px, 96vw)",
						maxHeight: "92vh",
						display: "flex",
						flexDirection: "column",
						gap: 12,
						padding: 16,
						borderRadius: 14,
						boxSizing: "border-box",
						background: "var(--dsw-alias-bg-layer-2, #1c1c20)",
						border: "1px solid var(--dsw-alias-border-l2, #3a3a40)",
						color: "var(--dsw-alias-label-primary, #e8e8ea)",
						boxShadow: "0 18px 60px rgba(0,0,0,0.45)"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 10
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: { fontSize: 14 },
									children: t("editor.title")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: hintStyle$1,
									children: source.file.name
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: buttonStyle,
									onClick: onCancel,
									disabled: busy,
									children: t("editor.cancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: primaryButtonStyle,
									onClick: () => {
										confirm();
									},
									disabled: busy || base === null,
									children: busy ? t("editor.busy") : t("editor.apply")
								})
							]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								color: "var(--dsw-alias-state-error-primary, #ff6b6b)",
								fontSize: 12
							},
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 14,
								alignItems: "flex-start",
								overflow: "hidden"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									flex: 1,
									minWidth: 0,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									background: "repeating-conic-gradient(rgba(255,255,255,0.04) 0% 25%, transparent 0% 50%) 50% / 18px 18px",
									borderRadius: 10,
									minHeight: 300,
									padding: 8
								},
								children: base === null || display === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: hintStyle$1,
									children: t("editor.loading")
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
									ref: previewRef,
									width: base.width,
									height: base.height,
									style: {
										width: display.width,
										height: "auto",
										maxWidth: "100%",
										maxHeight: "68vh",
										touchAction: "none",
										cursor: tool === "erase" ? "crosshair" : "copy",
										userSelect: "none",
										outline: "1px solid var(--dsw-alias-border-l2, #3a3a40)",
										borderRadius: 6
									},
									onPointerDown,
									onPointerMove,
									onPointerUp: endDrag,
									onPointerCancel: endDrag
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: panelStyle,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: sectionStyle,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: sectionTitleStyle,
												children: t("editor.toolTitle")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													gap: 8
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													style: tool === "marker" ? activeButtonStyle : buttonStyle,
													onClick: () => {
														setTool("marker");
													},
													children: t("editor.toolMarker")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													style: tool === "erase" ? activeButtonStyle : buttonStyle,
													onClick: () => {
														setTool("erase");
													},
													children: t("editor.toolErase")
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: hintStyle$1,
												children: tool === "marker" ? t("editor.markerHint") : t("editor.eraseHint")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: sectionStyle,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: sectionTitleStyle,
												children: `${t("editor.markerTitle")} (${markers.length})`
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: hintStyle$1,
												children: t("editor.markerKeyboard")
											}),
											markers.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: hintStyle$1,
												children: t("editor.markerEmpty")
											}),
											[...markers].sort((a, b) => a.id - b.id).map((marker) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												role: "group",
												tabIndex: 0,
												"aria-label": `${t("editor.markerTitle")} ${marker.id}`,
												onFocus: () => {
													setActiveId(marker.id);
												},
												onKeyDown: (event) => {
													onMarkerKeyDown(event, marker);
												},
												style: {
													display: "flex",
													flexDirection: "column",
													gap: 4,
													padding: 4,
													borderRadius: 6
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 6
													},
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: {
																width: 20,
																height: 20,
																borderRadius: "50%",
																background: "#ff3b30",
																color: "#fff",
																fontSize: 11,
																display: "flex",
																alignItems: "center",
																justifyContent: "center",
																flex: "0 0 auto"
															},
															children: marker.id
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: hintStyle$1,
															children: `${(marker.x * 100).toFixed(0)}%, ${(marker.y * 100).toFixed(0)}%`
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															style: {
																...buttonStyle,
																padding: "2px 6px"
															},
															onClick: () => {
																setMarkers((previous) => previous.filter((item) => item.id !== marker.id));
																if (activeId === marker.id) setActiveId(null);
															},
															children: "✕"
														})
													]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
													value: marker.text,
													placeholder: t("editor.markerPlaceholder"),
													onChange: (event) => {
														const value = event.target.value;
														setMarkers((previous) => previous.map((item) => item.id === marker.id ? {
															...item,
															text: value
														} : item));
													},
													onFocus: () => {
														setActiveId(marker.id);
													},
													rows: 2,
													style: {
														...inputStyle,
														resize: "vertical",
														fontFamily: "inherit"
													}
												})]
											}, marker.id))
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: sectionStyle,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: sectionTitleStyle,
												children: `${t("editor.eraseTitle")} (${strokes.length})`
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												style: {
													...hintStyle$1,
													display: "flex",
													alignItems: "center",
													gap: 8
												},
												children: [t("editor.brush"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "range",
													min: .01,
													max: .16,
													step: .005,
													value: brush,
													onChange: (event) => {
														setBrush(Number(event.target.value));
													},
													style: { flex: 1 }
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													gap: 8
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													style: eraseMode === "paint" ? activeButtonStyle : buttonStyle,
													onClick: () => {
														setEraseMode("paint");
													},
													children: t("editor.erasePaint")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													style: eraseMode === "restore" ? activeButtonStyle : buttonStyle,
													onClick: () => {
														setEraseMode("restore");
													},
													children: t("editor.eraseRestore")
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													gap: 8
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													style: buttonStyle,
													onClick: () => {
														setStrokes((previous) => previous.slice(0, -1));
													},
													disabled: strokes.length === 0,
													children: t("editor.eraseUndo")
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													style: buttonStyle,
													onClick: () => {
														setStrokes([]);
													},
													disabled: strokes.length === 0,
													children: t("editor.eraseClear")
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												value: erasePrompt,
												onChange: (event) => {
													setErasePrompt(event.target.value);
												},
												rows: 2,
												placeholder: t("editor.erasePromptPlaceholder"),
												style: {
													...inputStyle,
													resize: "vertical",
													fontFamily: "inherit"
												}
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: sectionStyle,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: sectionTitleStyle,
												children: t("editor.bgTitle")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: {
													display: "flex",
													gap: 8
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													style: cutout.enabled ? activeButtonStyle : buttonStyle,
													onClick: () => {
														setCutout((previous) => ({
															...previous,
															enabled: !previous.enabled
														}));
													},
													children: cutout.enabled ? t("editor.bgOff") : t("editor.bgOn")
												})
											}),
											cutout.enabled && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												style: {
													...hintStyle$1,
													display: "flex",
													alignItems: "center",
													gap: 8
												},
												children: [
													t("editor.bgTolerance"),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														type: "range",
														min: 8,
														max: 90,
														step: 2,
														value: cutout.tolerance,
														onChange: (event) => {
															setCutout((previous) => ({
																...previous,
																tolerance: Number(event.target.value)
															}));
														},
														style: { flex: 1 }
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: cutout.tolerance })
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: hintStyle$1,
												children: t("editor.bgHint")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: sectionStyle,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: sectionTitleStyle,
												children: t("editor.sizeTitle")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												style: {
													display: "flex",
													flexWrap: "wrap",
													gap: 6
												},
												children: RATIO_PRESETS.map((preset) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													style: buttonStyle,
													onClick: () => {
														applyRatio(preset.ratio);
													},
													children: preset.label
												}, preset.key))
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 6
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														style: inputStyle,
														value: draftSize.width,
														onChange: (event) => {
															commitDimension("width", event.target.value);
														}
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: hintStyle$1,
														children: "×"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
														style: inputStyle,
														value: draftSize.height,
														onChange: (event) => {
															commitDimension("height", event.target.value);
														}
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
												value: size.mode,
												onChange: (event) => {
													setSize((previous) => ({
														...previous,
														mode: event.target.value
													}));
												},
												style: inputStyle,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "cover",
														children: t("editor.sizeCover")
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "contain",
														children: t("editor.sizeContain")
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
														value: "stretch",
														children: t("editor.sizeStretch")
													})
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: hintStyle$1,
												children: t("editor.sizeHint")
											})
										]
									})
								]
							})]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/EditorDock.tsx
		/**
		* The composer dock strip: one chip per image already staged in the composer,
		* each opening the full-screen editor.
		*
		* The strip renders nothing while the composer holds no image, so it never
		* competes with the queue/todo/goal docks. Confirming the editor stages the
		* exported files as new draft attachments (replacing the edited source) and
		* hands the brief to the composer as one reference chip — the JSON never enters
		* the draft. When the chip path is unavailable (a client build without the
		* trigger registry, or a stale revision), the same brief lands in the draft as
		* text instead, and a re-edit replaces that line rather than stacking.
		*/
		const stripStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			flexWrap: "wrap",
			padding: "6px 2px",
			fontSize: 12,
			color: "var(--dsw-alias-label-secondary, #b9b9c0)"
		};
		const chipStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 6,
			padding: "3px 8px 3px 4px",
			borderRadius: 999,
			cursor: "pointer",
			fontSize: 12,
			border: "1px solid var(--dsw-alias-border-l2, #3a3a40)",
			background: "var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04))",
			color: "var(--dsw-alias-label-primary, #e8e8ea)"
		};
		const hintStyle = { color: "var(--dsw-alias-label-tertiary, #9a9aa2)" };
		const noticeStyle = { color: "var(--dsw-alias-state-success-primary, #4ec9a0)" };
		/**
		* One short chip label naming what the edit asked for.
		* @param manifest - the exported facts.
		* @param t - the plugin's translator.
		* @returns the label.
		*/
		function chipLabel(manifest, t) {
			const parts = [];
			if (manifest.markers.length > 0) parts.push(`${manifest.markers.length} ${t("brief.markers")}`);
			if (manifest.erase.strokes > 0) parts.push(`${manifest.erase.strokes} ${t("brief.strokes")}`);
			if (manifest.bgRemove.requested) parts.push(t("brief.bg"));
			if (manifest.size.changed) parts.push(`${manifest.size.width}×${manifest.size.height}`);
			const detail = parts.length > 0 ? parts.join(" · ") : t("brief.plain");
			return `${t("brief.title")} · ${detail}`;
		}
		/** Composer dock entry. */
		function EditorDock({ sessionId, useInput, inputActions, editor, t }) {
			const attachmentIds = useInput((state) => state.attachmentIds);
			const draft = useInput((state) => state.draft);
			const draftRev = useInput((state) => state.draftRev);
			const [targetId, setTargetId] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const images = (0, react.useMemo)(() => editor.resolveImages(sessionId, attachmentIds), [
				editor,
				sessionId,
				attachmentIds.join(",")
			]);
			const target = images.find((image) => image.id === targetId) ?? null;
			(0, react.useEffect)(() => {
				if (notice === null) return;
				const timer = setTimeout(() => {
					setNotice(null);
				}, 6e3);
				return () => {
					clearTimeout(timer);
				};
			}, [notice]);
			const apply = (0, react.useCallback)((result) => {
				const files = [...result.files, manifestFile(result.manifest)];
				const legend = [...result.legend, t("brief.manifest")];
				const staged = editor.stageFiles(sessionId, files);
				if (staged.length !== files.length) {
					editor.releaseDrafts(staged);
					setNotice(t("dock.fail"));
					return;
				}
				if (!inputActions.addAttachments(staged)) {
					editor.releaseDrafts(staged);
					setNotice(t("dock.fail"));
					return;
				}
				if (target !== null) inputActions.removeAttachment(target.id);
				if (!editor.insertBrief(sessionId, {
					label: chipLabel(result.manifest, t),
					payload: buildBrief(result.manifest, {
						legend,
						carrier: "chip"
					}),
					clipboardText: BRIEF_HEADER,
					draftRev
				})) {
					inputActions.setDraft(mergeDraft(draft, buildBrief(result.manifest, {
						legend,
						carrier: "draft"
					})));
					setTargetId(null);
					setNotice(t("dock.fallback"));
					return;
				}
				setTargetId(null);
				setNotice(t("dock.done"));
			}, [
				draft,
				draftRev,
				editor,
				inputActions,
				sessionId,
				t,
				target
			]);
			if (images.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: stripStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { fontWeight: 600 },
						children: t("dock.title")
					}),
					images.map((image, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						style: chipStyle,
						title: image.file.name,
						onClick: () => {
							setTargetId(image.id);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
							src: image.previewUrl,
							alt: image.file.name,
							style: {
								width: 20,
								height: 20,
								objectFit: "cover",
								borderRadius: 4,
								display: "block"
							}
						}), `${t("dock.edit")} ${index + 1}`]
					}, image.id)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: hintStyle,
						children: t("dock.hint")
					}),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: noticeStyle,
						children: notice
					})
				]
			}), target !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EditorModal, {
				source: target,
				t,
				onCancel: () => {
					setTargetId(null);
				},
				onApply: apply
			})] });
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Product copy of the editor surface. Both dictionaries are registered under
		* one namespace, so the active GUI locale selects the strings at render time.
		*/
		/** Chinese dictionary (default locale of this deployment). */
		const zh$1 = {
			"dock.title": "图片编辑",
			"dock.edit": "标记·编辑",
			"dock.hint": "点缩略图打开编辑器：加编号标记 / 移除背景 / 涂抹擦除 / 调整大小",
			"dock.done": "已放回输入框：编辑图 + 清单附件 + 一个说明胶囊，发送即可出图",
			"dock.fallback": "已切到文本模式：当前环境不支持说明胶囊，说明已写进正文（附件与清单照常回填），发送即可出图",
			"dock.fail": "回填失败：输入框正忙或图片已失效，请重试",
			"editor.title": "图片编辑",
			"editor.cancel": "取消",
			"editor.apply": "放回输入框",
			"editor.busy": "处理中…",
			"editor.loading": "正在读取图片…",
			"editor.loadFail": "图片读取失败，请重新拖入",
			"editor.toolTitle": "编辑工具",
			"editor.toolMarker": "标记修改点",
			"editor.toolErase": "涂抹擦除",
			"editor.markerHint": "在图上点一下加一个编号标记，拖动可挪位置；再在右侧写这一处要怎么改。",
			"editor.eraseHint": "在图上按住拖动画笔涂抹要处理的区域；「擦回」可撤销多涂的部分。",
			"editor.markerTitle": "编号标记",
			"editor.markerKeyboard": "Tab 聚焦标记行；↑↓←→ 每次移 1%（Shift 5%），Delete/Backspace 删除该标记。",
			"editor.markerEmpty": "还没有标记。选「标记修改点」后在图上点一下即可。",
			"editor.markerPlaceholder": "这一处要怎么改？例如：把这块的花换成玫瑰",
			"editor.eraseTitle": "涂抹区域",
			"editor.brush": "笔刷",
			"editor.erasePaint": "涂抹",
			"editor.eraseRestore": "擦回",
			"editor.eraseUndo": "撤销一笔",
			"editor.eraseClear": "全部清除",
			"editor.erasePromptPlaceholder": "涂抹区域要怎么处理？",
			"editor.bgTitle": "移除背景",
			"editor.bgOn": "移除背景（本地预览）",
			"editor.bgOff": "恢复背景",
			"editor.bgTolerance": "容差",
			"editor.bgHint": "本地抠图适合纯色/近色背景商品图；出图时脚本会优先用云端抠图重做透明背景。",
			"editor.sizeTitle": "调整大小",
			"editor.sizeCover": "裁切填满（cover）",
			"editor.sizeContain": "完整放入（contain）",
			"editor.sizeStretch": "拉伸变形（stretch）",
			"editor.sizeHint": "改尺寸会同时缩放标记与涂抹区域；预览上的红/暗色区域分别是裁掉/留白部分。",
			"editor.guideCover": "裁切填满：红色区域会被裁掉",
			"editor.guideContain": "完整放入：深色区域是留白",
			"editor.guideStretch": "拉伸变形：不裁切、不留白",
			"brief.title": "图片编辑",
			"brief.markers": "处标记",
			"brief.strokes": "笔涂抹",
			"brief.bg": "移除背景",
			"brief.plain": "仅底图",
			"brief.manifest": "img2img-manifest.json：机器可读清单（标记坐标 / 尺寸 / 涂抹 / 文件清单），结构化字段以它为准"
		};
		/** English dictionary. */
		const en$1 = {
			"dock.title": "Image editor",
			"dock.edit": "Mark & edit",
			"dock.hint": "Open the editor: numbered markers / background removal / brush erase / resize",
			"dock.done": "Sent back to the composer: edited image + manifest attachment + one brief chip. Press send to generate.",
			"dock.fallback": "Switched to text mode: the composer chip is unavailable here, so the brief was written into the draft (attachments and manifest are staged as usual). Press send to generate.",
			"dock.fail": "Could not stage the result: the composer is busy or the image is gone. Retry.",
			"editor.title": "Image editor",
			"editor.cancel": "Cancel",
			"editor.apply": "Send back to composer",
			"editor.busy": "Working…",
			"editor.loading": "Loading image…",
			"editor.loadFail": "The image could not be read. Drop it again.",
			"editor.toolTitle": "Tools",
			"editor.toolMarker": "Change markers",
			"editor.toolErase": "Brush erase",
			"editor.markerHint": "Click the image to drop a numbered marker, drag to move it, then write what should change there.",
			"editor.eraseHint": "Drag on the image to brush the area to rework; \"Restore\" paints back.",
			"editor.markerTitle": "Markers",
			"editor.markerKeyboard": "Tab to a marker row; arrows nudge 1% (Shift 5%); Delete/Backspace removes that marker.",
			"editor.markerEmpty": "No marker yet. Pick \"Change markers\" and click the image.",
			"editor.markerPlaceholder": "What should change here? e.g. replace the flower with a rose",
			"editor.eraseTitle": "Brushed area",
			"editor.brush": "Brush",
			"editor.erasePaint": "Paint",
			"editor.eraseRestore": "Restore",
			"editor.eraseUndo": "Undo stroke",
			"editor.eraseClear": "Clear all",
			"editor.erasePromptPlaceholder": "What should happen in the brushed area?",
			"editor.bgTitle": "Remove background",
			"editor.bgOn": "Remove background (local preview)",
			"editor.bgOff": "Restore background",
			"editor.bgTolerance": "Tolerance",
			"editor.bgHint": "The local cutout suits flat-background product shots; the generation script retries with cloud matting for a transparent PNG.",
			"editor.sizeTitle": "Resize",
			"editor.sizeCover": "Fill and crop (cover)",
			"editor.sizeContain": "Fit inside (contain)",
			"editor.sizeStretch": "Stretch",
			"editor.sizeHint": "Resizing scales markers and brushed areas too; the red/dark areas in the preview are cropped/padded parts.",
			"editor.guideCover": "Fill and crop: red areas are cropped away",
			"editor.guideContain": "Fit inside: dark areas are padding",
			"editor.guideStretch": "Stretch: no crop, no padding",
			"brief.title": "Image edit",
			"brief.markers": "markers",
			"brief.strokes": "strokes",
			"brief.bg": "background removal",
			"brief.plain": "base image only",
			"brief.manifest": "img2img-manifest.json: machine-readable manifest (marker coordinates / size / strokes / file list); structured fields follow it"
		};
		//#endregion
		//#region src/client/i18n.ts
		const identity = (key) => key;
		let current = identity;
		/** 由 registerConfigPanel() 在注册/重载时调用，绑定宿主 locale 服务的 t。 */
		function setTranslator(next) {
			current = next;
		}
		/** 翻译一条面板文案；未绑定时原样返回 key（中文原文）。 */
		function tr(key, params) {
			if (!key) return key;
			return current(key, params);
		}
		//#endregion
		//#region src/client/panel-locales.ts
		/**
		* 面板文案词典。
		*
		* key = 中文原文（zh 字典是 identity，缺英文时最多显示中文）；en 给英文。
		* 参数占位符形如 `{p1}`，中英文两边必须一致（scripts/verify-i18n.mjs 会校验）。
		*/
		const en = {
			" · 出图: {p1}": " · Generated: {p1}",
			" · 窗口内无出图": " · No images in window",
			" · 欠费已关停 {p1}": " · {p1} disabled for arrears",
			" · 未指定模型": " · No model set",
			" · 周窗口 {p1}": " · Weekly {p1}",
			" · 主窗口 {p1}": " · Primary {p1}",
			" · 自动": " · auto",
			" 个账号": " accounts",
			"；提示：{p1}": "; notes: {p1}",
			"\"<参考图.png>\"": "\"{reference.png}\"",
			"\"<提示词>\"": "\"{prompt}\"",
			"（24h 滚动窗口，可在每行展开后直接改数字；自动探测按 ChatGPT 后端返回的实际出图时刻统计）": " (24h rolling window; edit the number per account; auto-probe counts actual generation times reported by the ChatGPT backend)",
			"（档位手动锁定）": " (plan pinned manually)",
			"（额度已手动覆盖）": " (quota overridden)",
			"（空 · 可把其他等级的行拖到这里自动改级，或点下方添加通道）": " (empty · drag a row from another tier here to retier it, or add a channel below)",
			"（空）": "(empty)",
			"（托管/固定通道，只读）": " (managed/fixed channel, read-only)",
			"{p1} 个": "{p1}",
			"{p1} 个账号": "{p1} accounts",
			"{p1} 级": "Tier {p1}",
			"{p1}：凭据由对应账号库托管，不在此处明文展示": "{p1}: credentials are managed by the matching account library and never shown here",
			"{p1}%（{p2}h 窗口，重置 {p3}）": "{p1}% ({p2}h window, resets {p3})",
			"「保存配置」会把通道按等级/顺序换算成 .env：GEN_PROVIDER_ORDER 用脚本 providerId（重复供应商自动去重），": "Save converts channels into .env by tier/order: GEN_PROVIDER_ORDER uses script providerIds (duplicate providers deduped),",
			"「预览 .env」用与宿主完全相同的 planSync()；新配置在技能新会话生效。": "Preview .env uses the exact same planSync() as the host; new settings apply in the skill's next session.",
			"＋ 从 Codex 客户端添加账号": "＋ Add account from Codex client",
			"+ 输入模型名，回车添加": "+ type a model, Enter to add",
			"＋ 添加 ChatGPT 账号": "＋ Add ChatGPT account",
			"＋ 添加生图通道（选择供应商）": "＋ Add image channel (choose provider)",
			"＋ 添加识图通道（选择供应商）": "＋ Add vision channel (choose provider)",
			"▲ 上移": "▲ Up",
			"▼ 下移": "▼ Down",
			"⚠️ 已达到窗口额度，等待窗口刷新；用尽时会自动切换下一通道": "⚠️ Window quota reached; waiting for reset. The next channel takes over automatically.",
			"✅ {p1} 探测 · 档位 {p2} · 扫过 {p3} 个会话": "✅ probed {p1} · plan {p2} · scanned {p3} conversations",
			"👁 预览 .env": "👁 Preview .env",
			"🔍 探测额度": "🔍 Probe quota",
			"🔍 探测全部余额": "🔍 Probe all balances",
			"🔐 凭据已存": "🔐 Credentials stored",
			"1 级": "Tier 1",
			"2 级": "Tier 2",
			"3 级": "Tier 3",
			"20x（Business）": "20x (Business)",
			"5x（Pro）": "5x (Pro)",
			"按顺序降级 · 点击 × 删除，回车添加": "Fallback order · click × to remove, Enter to add",
			"保持": "Keep",
			"保存被拦下: ": "Save blocked: ",
			"保存并同步两份 .env": "Save and sync both .env files",
			"保存代理": "Save proxy",
			"保存配置": "Save",
			"保存凭据": "Save credentials",
			"保存前预览：将写入的 .env": "Preview before save: .env changes",
			"保存失败": "Save failed",
			"保存失败: ": "Save failed: ",
			"保存中…": "Saving…",
			"本地生图服务（chatgpt-web 类）": "Local image service (chatgpt-web style)",
			"本机 CLI 登录": "Local CLI login",
			"本机已就绪": "Ready locally",
			"本机直连引擎（bun）": "Local direct engine (bun)",
			"不用 Key，只填 Base URL（写入 IMG_HTTP_URL），指向本机 chatgpt-web 类服务": "No key needed; set Base URL (written to IMG_HTTP_URL) for a local chatgpt-web style service",
			"参考图走 subject_reference（主体一致性）": "Reference images use subject_reference (identity consistency)",
			"操作失败": "Operation failed",
			"测试": "Test",
			"测试 {p1}：{p2}{p3}": "Test {p1}: {p2}{p3}",
			"测试失败: ": "Test failed: ",
			"常用": "Common",
			"出图中…": "Generating…",
			"窗口额度上限（留空 = 跟随套餐默认值）": "Window quota (empty = plan default)",
			"存在缺少 id 的通道": "A channel is missing its id",
			"代理已保存": "Proxy saved",
			"当前生效：{p1}": "Effective: {p1}",
			"当前直连（若探测报 fetch 失败，请填代理）": "Direct connection (fill in a proxy if probes fail)",
			"登记 1 张": "Log 1 image",
			"等级": "Tier",
			"点“开始试跑”才会真正消耗一次额度。": "Nothing is spent until you click Start test run.",
			"点击关闭（停用该通道）": "Click to disable this channel",
			"点击开启": "Click to enable",
			"点击追加 {p1}": "Click to append {p1}",
			"读 ~/.codex/auth.json 登录态，无需 API Key": "Reads ~/.codex/auth.json; no API key",
			"读取 Codex 登录态": "Read Codex login",
			"多账号额度库 · 24h 滚动窗口 · 窗口内已出图 {p1} 张 · 点账号展开凭据与额度设置": "Account quota library · 24h rolling window · {p1} images this window · expand an account for credentials and quota settings",
			"额度 {p1}": "Quota {p1}",
			"二级 · 备用": "Tier 2 · Backup",
			"复制固定该通道的命令，交给 agent / 终端执行": "Copy the command that pins this channel, for an agent or terminal",
			"复制命令": "Copy command",
			"该通道使用「{p1}」，不需要 API Key；凭据由对应的账号库 / 客户端登录态提供。": "This channel uses {p1}; no API key needed. Credentials come from the matching account library or client login.",
			"各 provider 的 key / model / base 写对应变量，识图侧写 VISION_PROVIDERS + 主通道的 VISION_API_KEY。": "Each provider's key/model/base goes to its own env vars; vision writes VISION_PROVIDERS plus VISION_API_KEY for the main channel.",
			"关闭": "Close",
			"还没有账号，点下方添加": "No accounts yet — add one below",
			"会真实调用一次出图（可能消耗 API 额度或订阅出图次数）；ChatGPT 网页通道会开无头浏览器，可能要 1-2 分钟。": "Runs one real generation (may consume API quota or subscription image credits). ChatGPT web channels launch a headless browser and can take 1-2 minutes.",
			"即梦 Jimeng": "Jimeng",
			"加载配置失败": "Failed to load configuration",
			"加载中…": "Loading…",
			"将添加：{p1}（{p2}）": "Will add: {p1} ({p2})",
			"脚本 providerId：{p1}（GEN_PROVIDER_ORDER / --provider 用这个）": "Script providerId: {p1} (used by GEN_PROVIDER_ORDER / --provider)",
			"脚本发现 {p1} 个插件目录尚未收录的 provider（脚本比插件新）：升级插件目录后才能在这里添加。": "Script found {p1} provider(s) missing from the plugin catalog (the script is newer than the plugin): upgrade the plugin before adding them here.",
			"脚本扫描：生图 provider {p1}/{p2} 已就绪": "Script scan: {p1}/{p2} image providers ready",
			"脚本扫描失败：{p1}": "Script scan failed: {p1}",
			"仅文生图": "Text-to-image only",
			"仅文生图（i2i 会被跳过）": "Text-to-image only (i2i is skipped)",
			"静态目录没有这个 provider 的 env 映射：先手写 .env，或升级插件后再在面板管理": "The static catalog has no env mapping for this provider: edit .env by hand, or upgrade the plugin to manage it here.",
			"开始试跑": "Start test run",
			"看子通道": "Depends on sub-provider",
			"列表来自 generate_image.mjs 真正支持的 provider；同一供应商可加多条（多 Key / 多中转），.env 按链序取第一条。": "Only providers supported by generate_image.mjs are listed; the same provider can be added multiple times (multiple keys / proxies), and .env takes the first one in chain order.",
			"留空 = 自动读系统代理": "Empty = auto-detect the system proxy",
			"没有匹配的供应商": "No matching providers",
			"免费 Free": "Free",
			"免费版：约 2-3 张 / 24h": "Free: about 2-3 images / 24h",
			"免费版只统计用量、不按本地额度卡；真正没额度时由调用方自动切换通道": "Free plan only tracks usage; the caller switches channels when ChatGPT actually refuses.",
			"面板管过、后被删掉或停用的通道才会清 env；面板从没管过的 key 保持原值（手写配置不再被误删）。": "Only channels managed here and later deleted/disabled clear their env vars; keys this panel never managed keep their values (hand-written config is no longer wiped).",
			"模型 {p1}": "Models {p1}",
			"模型链": "Model chain",
			"能力看直连子通道": "Capability depends on the direct sub-provider",
			"凭据已保存": "Credentials saved",
			"凭据已保存，点「探测」拉取额度": "Credentials saved; click Probe to fetch quota",
			"凭据已保存（粘贴新 token 可替换）": "Credentials saved (paste a new token to replace)",
			"凭据已清除": "Credentials cleared",
			"启用 {p1}": "{p1} enabled",
			"欠费 {p1}": "{p1} in arrears",
			"欠费/额度耗尽（已自动关停）": "Arrears/quota exhausted (auto-disabled)",
			"欠费关停": "Disabled (arrears)",
			"清除凭据": "Clear credentials",
			"清空": "Clear",
			"清空已保存的 Key（保存后从 .env 删除；不点“清空”时留空保存不会删 key）": "Clear the stored key (removes it from .env after save; leaving the field empty keeps it)",
			"请求失败：{p1}": "Request failed: {p1}",
			"请重启 DSH 宿主后再保存；重启前可以点「预览 .env」查看计划，但「保存配置」已暂时禁用。": "Restart the DSH host before saving; until then you can use Preview .env, but Save is disabled.",
			"取消": "Cancel",
			"任意 OpenAI 兼容识图端点都可以这样加；识图侧不写固定 env，走 VISION_PROVIDERS": "Any OpenAI-compatible vision endpoint can be added this way; vision writes no fixed env vars and uses VISION_PROVIDERS.",
			"任意 OpenAI 兼容中转：填 Base URL + Key 即可；i2i 走 /images/edits": "Any OpenAI-compatible proxy: set Base URL + Key; i2i uses /images/edits",
			"三级 · 兜底": "Tier 3 · Fallback",
			"删除": "Delete",
			"删除 {p1}": "Delete {p1}",
			"删除该通道": "Delete this channel",
			"删除该账号": "Delete this account",
			"删除通道": "Delete channel",
			"上移一位（可跨级）": "Move up one (may change tier)",
			"生图 · 生效链": "Image · effective chain",
			"生图 {p1}": "{p1} image",
			"生图模型链由脚本内置（qwen-image-3.0-pro → qwen-image-3.0 → wan2.7-image-pro），面板里的模型只作记录": "The image model chain is built into the script (qwen-image-3.0-pro → qwen-image-3.0 → wan2.7-image-pro); models shown here are informational only.",
			"生图通道": "Image channels",
			"识图 · 生效链": "Vision · effective chain",
			"识图 {p1}": "{p1} vision",
			"识图侧 VISION_PROVIDERS 接受任意 OpenAI 兼容端点；目录里的只是常用预设。": "Vision accepts any OpenAI-compatible endpoint via VISION_PROVIDERS; the catalog only lists presets.",
			"识图通道": "Vision channels",
			"识图与生图": "Vision & Image",
			"试跑 1 张": "Run 1 test image",
			"试跑 1 张 · {p1}": "Run 1 test image · {p1}",
			"试跑成功：{p1}{p2}{p3}": "Test run succeeded: {p1}{p2}{p3}",
			"试跑失败：{p1}": "Test run failed: {p1}",
			"收起全部": "Collapse all",
			"搜索供应商 / providerId…": "Search providers / providerId…",
			"宿主插件还是旧版：请重启 DSH 宿主后再保存（否则新通道的 .env 同步不会真正生效）": "Host plugin is still the old build: restart the DSH host before saving (new channels would not sync to .env).",
			"宿主插件还是旧版：预览能看，保存需要先重启 DSH 宿主。": "Host plugin is still the old build: preview works, but saving requires a DSH host restart.",
			"宿主插件仍是旧版（浏览器端已更新）：新的 providerId 归一化 / .env 同步 / 保存校验都在宿主侧。": "Host plugin is still the old build (browser side updated): providerId normalization / .env sync / save validation run in the host.",
			"宿主插件未重载：先重启 DSH 宿主": "Host plugin not reloaded: restart the DSH host first",
			"探测失败": "Probe failed",
			"探测失败: ": "Probe failed: ",
			"探测完成": "Probe complete",
			"探测完成：正常 {p1} · 未确认 {p2} · 失败 {p3}{p4}": "Probe complete: OK {p1} · unconfirmed {p2} · failed {p3}{p4}",
			"探测中…": "Probing…",
			"探活（不花钱）：API 通道 GET /models，CLI/账号通道查本机依赖": "Liveness check (free): API channels GET /models; CLI/account channels check local dependencies",
			"套餐默认额度：": "Plan default quotas: ",
			"提示": "Notes",
			"添加生图通道 · 选择供应商": "Add image channel · choose provider",
			"添加识图通道 · 选择供应商": "Add vision channel · choose provider",
			"添加通道": "Add channel",
			"通道不存在": "Channel not found",
			"图生图能力：{p1}{p2}": "Image-to-image: {p1}{p2}",
			"图生图走主体参考": "i2i uses subject reference",
			"托管通道": "Managed channel",
			"拖动把手": "Drag handle",
			"完成": "Done",
			"未保存": "Unsaved",
			"未配置": "Not configured",
			"未设置端点": "No endpoint",
			"未探测": "Not probed",
			"未填凭据": "No credentials",
			"未知错误": "Unknown error",
			"未指定模型": "No model set",
			"无需 API Key，走 qoderclicn 附件识图": "No API key; uses qoderclicn attachment vision",
			"下次重置：{p1}": "Next reset: {p1}",
			"下移一位（可跨级）": "Move down one (may change tier)",
			"先选一个供应商": "Choose a provider first",
			"写入": "Write",
			"需要 bun + engines/direct-api；子通道在卡片里选，写入 DIRECT_PROVIDER": "Requires bun + engines/direct-api; choose the sub-provider in the card, written to DIRECT_PROVIDER",
			"需已安装 qoderclicn 并登录，无需 API Key": "Requires qoderclicn installed and logged in; no API key",
			"一级 · 主通道": "Tier 1 · Primary",
			"依赖未就绪": "Dependency not ready",
			"已保存": "Saved",
			"已保存，并已同步到两份 .env（新会话生效）{p1}": "Saved and synced to both .env files (applies in the skill's next session){p1}",
			"已从 Codex 客户端添加账号": "Account added from Codex client",
			"已登记 1 张": "Logged 1 image",
			"已读取 Codex 客户端登录态": "Read Codex client login",
			"已复制命令：{p1}": "Copied command: {p1}",
			"已配置 {p1}": "{p1} configured",
			"已配置 {p1} 条": "{p1} configured",
			"已配置 API Key（掩码展示，展开卡片可更换）": "API key configured (masked; expand the card to change)",
			"已配置的 Key 以掩码展示；输入新值覆盖，留空保存则保持原值": "Stored key is masked; type a new value to replace it, or leave empty to keep it",
			"已配置的 Key 只以掩码显示；输入新值覆盖，留空保存则保持原值；“清空”才会删除已存 Key。": "Stored keys are only shown masked; type a new value to replace, leave empty to keep, or click Clear to delete.",
			"已删除账号": "Account deleted",
			"已添加 {p1}（{p2}），展开卡片填配置后保存": "Added {p1} ({p2}); expand the card, fill in settings, then save",
			"已添加账号": "Account added",
			"已停用": "Disabled",
			"已用 {p1} / {p2} 张（{p3}h 滚动{p4}）": "{p1} / {p2} used ({p3}h rolling{p4})",
			"已用 {p1} 张（免费版不计额度）": "{p1} used (free plan has no local quota)",
			"已在模型链中": "Already in the model chain",
			"已重置窗口": "Window reset",
			"已自动探测 ": "Auto-probed ",
			"优先级等级（1 主 / 2 备 / 3 兜底）": "Priority tier (1 primary / 2 backup / 3 fallback)",
			"优先使用，失败后依次降级": "Preferred; falls back in order on failure",
			"与宿主保存时共用同一份 planSync()：绿=写入，红=删除，灰=保持原值（不碰手写配置）。": "Uses the same planSync() as the host save: green=write, red=delete, gray=keep (hand-written config untouched).",
			"再试一次": "Try again",
			"粘贴 __Secure-next-auth.session-token": "Paste __Secure-next-auth.session-token",
			"粘贴 API Key（可留空）": "Paste an API key (optional)",
			"粘贴该厂商的 API Key；CLI / 网页账号通道无需填写": "Paste this vendor's API key; not needed for CLI or web-account channels",
			"展开全部": "Expand all",
			"账号备注名（用于区分多个 ChatGPT 账号）": "Account label (distinguishes multiple ChatGPT accounts)",
			"账号库登录态": "Account-library login",
			"账号套餐：免费 / Plus / 5x(Pro) / 20x(Business)": "Account plan: Free / Plus / 5x (Pro) / 20x (Business)",
			"账号已同步到通道库；当前有未保存的通道改动，先保存再刷新（避免覆盖你的编辑）": "Account synced to the channel store; save your unsaved channel edits before refreshing to avoid losing them",
			"这个账号会自动投影成生图通道 chatgpt-web@…（在「生图通道」里显示）：改备注/套餐会同步通道名，登录态只存账号库一份；删账号会连带删通道。": "This account is projected to an image channel chatgpt-web@… (shown under Image channels): label/plan changes update its name, credentials stay in the account library only, and deleting the account also deletes the channel.",
			"真实生成一张 1024×1024 测试图（会消耗额度，会先确认）": "Generate one real 1024×1024 test image (spends quota; asks first)",
			"整张卡片可拖动：同级内排序；拖到其他等级组自动改级": "Drag the whole card: reorder within a tier, or drop into another tier to change it",
			"正常": "OK",
			"正在出图…（等待脚本返回，最长 240 秒）": "Generating… (waiting for the script, up to 240s)",
			"支持图生图": "Supports i2i",
			"支持图生图（参考图）": "Supports i2i (reference images)",
			"直接读取运行中的 Codex 客户端登录态（~/.codex/auth.json），令牌由客户端自动刷新": "Read the running Codex client login (~/.codex/auth.json); tokens refresh automatically",
			"直连引擎（12 家官方 API）": "Direct engine (12 official APIs)",
			"直连引擎的模型由脚本 --model 传入，这里只需选子通道。": "Direct-engine models come from the script's --model; just choose the sub-provider here.",
			"直连子通道（保存后写入 DIRECT_PROVIDER）": "Direct sub-provider (saved to DIRECT_PROVIDER)",
			"重置窗口": "Reset window",
			"主体参考": "Subject reference",
			"主通道失败后自动切换": "Switches automatically when the primary fails",
			"子通道 · {p1}": "Sub-provider · {p1}",
			"自动：{p1}": "Auto: {p1}",
			"自动探测：关": "Auto-probe: off",
			"自动探测：开": "Auto-probe: on",
			"自动探测：用 ChatGPT 后端接口统计窗口内出图，代替手动登记": "Auto-probe: count generated images in the window via the ChatGPT backend instead of manual logging",
			"走技能自己的 generate_image.mjs，固定 1024×1024 / quality normal，provider = {p1}。": "Runs the skill's own generate_image.mjs: 1024×1024 / quality normal, provider = {p1}.",
			"最后兜底，欠费自动关停": "Last resort; auto-disabled on arrears",
			"最近探测{p1}：{p2}": "Last probe{p1}: {p2}",
			"API Key": "API Key",
			"Business / 20x：约为 Plus 的 20 倍": "Business / 20x: about 20x Plus",
			"ChatGPT 探测用代理（Node 不读系统代理，留空则自动读取 Windows 系统代理）": "Proxy for ChatGPT probes (Node ignores the system proxy; empty = read the Windows system proxy)",
			"ChatGPT 网页出图账号": "ChatGPT web image accounts",
			"ChatGPT 网页登录态：DevTools → Application → Cookies → __Secure-next-auth.session-token": "ChatGPT web login: DevTools → Application → Cookies → __Secure-next-auth.session-token",
			"ChatGPT 网页账号": "ChatGPT web account",
			"ChatGPT 账号 {p1}": "ChatGPT account {p1}",
			"CLI / 登录态通道，无需探测": "CLI / login channel; no probe needed",
			"Codex 登录态": "Codex login",
			"Codex 登录态 ✓": "Codex login ✓",
			"Codex 客户端": "Codex client",
			"Codex 客户端登录态": "Codex client login",
			"Codex 客户端账号": "Codex client account",
			"Codex 用量（{p1}{p2}）": "Codex usage ({p1}{p2})",
			"Codex CLI（ChatGPT 订阅）": "Codex CLI (ChatGPT subscription)",
			"DashScope 生图模型链由脚本内置：qwen-image-3.0-pro → qwen-image-3.0 → wan2.7-image-pro；面板里的模型只作记录，不写入 .env。": "The DashScope image model chain is built into the script: qwen-image-3.0-pro → qwen-image-3.0 → wan2.7-image-pro; models shown here are informational and are not written to .env.",
			"DashScope 通义 / 万相": "DashScope Qwen / Wan",
			"DashScope 通义千问 / 万相": "DashScope Qwen / Wan",
			"DeepSeek 识图": "DeepSeek vision",
			"dsh-vision-skill 使用 · 主 → 备 → 兜底依次降级 · 欠费自动关停": "Used by dsh-vision-skill · primary → backup → fallback · auto-disabled on arrears",
			"GLM-Image 不支持参考图，i2i 会被跳过": "GLM-Image does not support reference images; i2i is skipped",
			"gpt-image（网页）": "gpt-image (web)",
			"img2img-studio 使用 · 保存后写入 GEN_PROVIDER_ORDER（脚本 providerId）决定 auto 链顺序": "Used by img2img-studio · saved to GEN_PROVIDER_ORDER (script providerIds) which defines the auto-chain order",
			"MiniMax 海螺": "MiniMax Hailuo",
			"OpenAI 兼容 API": "OpenAI-compatible API",
			"OpenAI 兼容中转填 base，如 https://api.xxx.com/v1": "Enter the OpenAI-compatible base URL, e.g. https://api.xxx.com/v1",
			"Plus": "Plus",
			"Plus：额度显著高于免费版": "Plus: substantially higher quota than Free",
			"Pro / 5x：约为 Plus 的 5 倍": "Pro / 5x: about 5x Plus",
			"Qoder CLI（识图）": "Qoder CLI (vision)",
			"Seedream 豆包": "Seedream",
			"Seedream 豆包（火山方舟）": "Seedream (Volcano Ark)",
			"Z.AI GLM（智谱）": "Z.AI GLM"
		};
		/** zh 是 identity 字典：key 就是中文原文。 */
		const zh = Object.fromEntries(Object.keys(en).map((key) => [key, key]));
		//#endregion
		//#region src/catalog.ts
		/** 直连引擎（engines/direct-api）的子通道，与脚本 DIRECT_PROVIDERS 同源。 */
		const DIRECT_SUB_PROVIDERS = [
			{
				id: "dashscope",
				name: "DashScope 通义 / 万相"
			},
			{
				id: "openai",
				name: "OpenAI GPT Image"
			},
			{
				id: "azure",
				name: "Azure OpenAI"
			},
			{
				id: "google",
				name: "Google Gemini"
			},
			{
				id: "openrouter",
				name: "OpenRouter"
			},
			{
				id: "zai",
				name: "Z.AI GLM"
			},
			{
				id: "minimax",
				name: "MiniMax"
			},
			{
				id: "jimeng",
				name: "即梦 Jimeng"
			},
			{
				id: "seedream",
				name: "Seedream 豆包"
			},
			{
				id: "replicate",
				name: "Replicate"
			},
			{
				id: "agnes",
				name: "Agnes"
			},
			{
				id: "codex-cli",
				name: "Codex CLI"
			}
		];
		/**
		* 供应商目录（单一真源）。
		*
		* 面板「添加通道」直接按这里的条目生成选项；宿主按 env 字段写 .env；
		* hostVersion 跟着目录协议走，旧宿主没有该字段时面板会提示重启。
		*/
		const CATALOG = [
			{
				providerId: "dashscope",
				name: "DashScope 通义千问 / 万相",
				kinds: ["vision", "gen"],
				auth: "apiKey",
				base: "https://dashscope.aliyuncs.com/compatible-mode/v1",
				models: [
					"qwen-image-3.0-pro",
					"qwen-image-3.0",
					"wan2.7-image-pro"
				],
				visionModels: [
					"qwen3.8-max",
					"qwen3.7-plus",
					"qwen3.7-flash",
					"qwen3.6-plus",
					"qwen-vl-max",
					"qwen-vl-plus"
				],
				env: { key: "DASHSCOPE_API_KEY" },
				i2i: "yes",
				note: "生图模型链由脚本内置（qwen-image-3.0-pro → qwen-image-3.0 → wan2.7-image-pro），面板里的模型只作记录"
			},
			{
				providerId: "openai",
				name: "OpenAI 兼容 API",
				kinds: ["vision", "gen"],
				auth: "apiKey",
				base: "",
				models: ["gpt-image-2"],
				visionModels: ["gpt-4o"],
				env: {
					key: "IMG_API_KEY",
					model: "IMG_MODEL",
					base: "IMG_BASE_URL"
				},
				i2i: "yes",
				note: "任意 OpenAI 兼容中转：填 Base URL + Key 即可；i2i 走 /images/edits"
			},
			{
				providerId: "zai",
				name: "Z.AI GLM（智谱）",
				kinds: ["vision", "gen"],
				auth: "apiKey",
				base: "https://open.bigmodel.cn/api/paas/v4",
				models: ["glm-image"],
				visionModels: [
					"glm-4v-plus",
					"glm-4v",
					"glm-4-plus"
				],
				env: {
					key: "ZAI_API_KEY",
					model: "ZAI_IMAGE_MODEL",
					base: "ZAI_BASE_URL"
				},
				i2i: "no",
				note: "GLM-Image 不支持参考图，i2i 会被跳过"
			},
			{
				providerId: "seedream",
				name: "Seedream 豆包（火山方舟）",
				kinds: ["gen"],
				auth: "apiKey",
				base: "https://ark.cn-beijing.volces.com/api/v3",
				models: ["doubao-seedream-5-0-pro-260628", "doubao-seedream-5-0-260128"],
				env: {
					key: "ARK_API_KEY",
					model: "SEEDREAM_IMAGE_MODEL",
					base: "SEEDREAM_BASE_URL"
				},
				i2i: "yes"
			},
			{
				providerId: "minimax",
				name: "MiniMax 海螺",
				kinds: ["gen"],
				auth: "apiKey",
				base: "https://api.minimaxi.com/v1",
				models: ["image-01"],
				env: {
					key: "MINIMAX_API_KEY",
					model: "MINIMAX_IMAGE_MODEL",
					base: "MINIMAX_BASE_URL"
				},
				i2i: "subject",
				note: "参考图走 subject_reference（主体一致性）"
			},
			{
				providerId: "qoder",
				name: "Qoder CLI ImageGen",
				kinds: ["gen"],
				auth: "cli",
				base: "qoderclicn",
				models: ["Qwen3.8-Max"],
				env: { model: "QODER_IMAGE_MODEL" },
				i2i: "no",
				note: "需已安装 qoderclicn 并登录，无需 API Key"
			},
			{
				providerId: "codex-cli",
				name: "Codex CLI（ChatGPT 订阅）",
				kinds: ["gen"],
				auth: "account",
				base: "codex-cli",
				models: ["imagegen"],
				i2i: "yes",
				note: "读 ~/.codex/auth.json 登录态，无需 API Key"
			},
			{
				providerId: "direct",
				name: "直连引擎（12 家官方 API）",
				kinds: ["gen"],
				auth: "cli",
				base: "engines/direct-api",
				models: [],
				i2i: "direct",
				subProviders: DIRECT_SUB_PROVIDERS,
				note: "需要 bun + engines/direct-api；子通道在卡片里选，写入 DIRECT_PROVIDER"
			},
			{
				providerId: "local",
				name: "本地生图服务（chatgpt-web 类）",
				kinds: ["gen"],
				auth: "apiKey",
				base: "",
				models: [],
				env: { base: "IMG_HTTP_URL" },
				i2i: "yes",
				note: "不用 Key，只填 Base URL（写入 IMG_HTTP_URL），指向本机 chatgpt-web 类服务"
			},
			{
				providerId: "deepseek",
				name: "DeepSeek 识图",
				kinds: ["vision"],
				auth: "apiKey",
				base: "https://api.deepseek.com/v1",
				models: [],
				visionModels: [
					"deepseek-flash",
					"deepseek-chat",
					"deepseek-vl2"
				],
				note: "任意 OpenAI 兼容识图端点都可以这样加；识图侧不写固定 env，走 VISION_PROVIDERS"
			},
			{
				providerId: "qoder-cli",
				name: "Qoder CLI（识图）",
				kinds: ["vision"],
				auth: "cli",
				base: "qoderclicn",
				models: [],
				visionModels: ["Qwen3.8-Max"],
				note: "无需 API Key，走 qoderclicn 附件识图"
			}
		];
		const CATALOG_BY_ID = new Map(CATALOG.map((entry) => [entry.providerId, entry]));
		/** 生图 provider id 白名单（脚本 detectProviders() 的 id）。 */
		const GEN_PROVIDER_IDS = CATALOG.filter((entry) => entry.kinds.includes("gen")).map((entry) => entry.providerId);
		CATALOG.filter((entry) => entry.kinds.includes("vision")).map((entry) => entry.providerId);
		function catalogEntry(providerId) {
			return CATALOG_BY_ID.get(providerId);
		}
		/** 生图通道的 providerId 是否会被 generate_image.mjs 识别。 */
		function isGenProviderId(providerId) {
			return GEN_PROVIDER_IDS.includes(providerId) || providerId.startsWith("chatgpt-web@");
		}
		function catalogModels(providerId, kind) {
			const entry = catalogEntry(providerId);
			if (!entry) return [];
			return kind === "vision" ? entry.visionModels ?? entry.models : entry.models;
		}
		function authFor(providerId) {
			const entry = catalogEntry(providerId);
			if (entry) return entry.auth;
			return providerId.startsWith("chatgpt-web@") ? "account" : "apiKey";
		}
		/** 凭据由账号库 / 本机登录态托管，面板不显示 Key 输入框。 */
		function isManagedProvider(providerId) {
			return authFor(providerId) !== "apiKey";
		}
		function managedReason(providerId) {
			if (providerId.startsWith("chatgpt-web@")) return "ChatGPT 网页账号";
			if (providerId === "codex-cli") return "Codex 客户端登录态";
			if (providerId === "direct") return "本机直连引擎（bun）";
			return "Qoder CLI";
		}
		function isAccountProvider(providerId) {
			return providerId === "codex-cli" || providerId.startsWith("chatgpt-web@");
		}
		/** 把历史 id 归一化成脚本 provider id。 */
		function normalizeProviderId(rawId) {
			const raw = String(rawId ?? "").trim();
			if (!raw) return raw;
			if (raw.startsWith("chatgpt-web@")) return raw;
			if (raw === "qoder-gen") return "qoder";
			if (CATALOG_BY_ID.has(raw)) return raw;
			const hash = /^(.+?)#\d+$/.exec(raw);
			if (hash?.[1]) return CATALOG_BY_ID.has(hash[1]) ? hash[1] : hash[1];
			const legacy = /^(.+?)-[a-z0-9]{4,}$/i.exec(raw);
			if (legacy?.[1] && CATALOG_BY_ID.has(legacy[1])) return legacy[1];
			return raw;
		}
		/** 通道行的真实 provider id（新数据取 providerId，旧数据从 id 推导）。 */
		function providerIdOf(provider) {
			return normalizeProviderId(provider.providerId ?? provider.id);
		}
		/** 新通道 id：providerId 未被占用就直接用，重复添加用 `providerId#2`。 */
		function channelIdFor(providerId, taken) {
			if (!taken.has(providerId)) return providerId;
			let index = 2;
			while (taken.has(`${providerId}#${index}`)) index += 1;
			return `${providerId}#${index}`;
		}
		/** 键值是否已经打码（预览/回传场景不当作新 Key）。 */
		function isMaskedValue(value) {
			return String(value ?? "").includes("••••");
		}
		function sortEnabled(list) {
			return list.filter((provider) => provider.enabled).slice().sort((a, b) => Number(a.level) - Number(b.level));
		}
		function setOrDelete(key, value) {
			if (!key) return null;
			const trimmed = String(value ?? "").trim();
			return trimmed ? {
				key,
				action: "set",
				value: trimmed
			} : {
				key,
				action: "delete"
			};
		}
		function defaultVisionModel(providerId) {
			return catalogModels(providerId, "vision")[0] ?? "qwen-vl-plus";
		}
		/**
		* 由通道列表推导两份 skill .env 的写入计划。
		*
		* `previous` 用来区分「用户删掉了这个供应商」与「面板从来没管过它」：
		*  - 从没管过 → 不动 .env（保护手写配置）；
		*  - 面板里管理过、现在没了 / 全部停用 → 删除对应 env 行。
		*
		* 纯函数：宿主直接执行；客户端拿同一份计划做保存前预览。
		*/
		function planSync(providers, previous = []) {
			const warnings = [];
			const enabled = sortEnabled(providers);
			const genChannels = providers.filter((provider) => provider.kind === "gen");
			const visionChannels = providers.filter((provider) => provider.kind === "vision");
			const wasGen = previous.some((provider) => provider.kind === "gen");
			const wasVision = previous.some((provider) => provider.kind === "vision");
			const genEnabled = enabled.filter((provider) => provider.kind === "gen");
			const visionEnabled = enabled.filter((provider) => provider.kind === "vision");
			const chain = [];
			for (const provider of genEnabled) {
				const providerId = providerIdOf(provider);
				if (!chain.includes(providerId)) chain.push(providerId);
			}
			const counts = /* @__PURE__ */ new Map();
			for (const providerId of genEnabled.map(providerIdOf)) counts.set(providerId, (counts.get(providerId) ?? 0) + 1);
			for (const [providerId, count] of counts) if (count > 1) warnings.push(`生图供应商「${catalogEntry(providerId)?.name ?? providerId}」启用了 ${count} 条通道：一份 .env 只能保存一条 Key/端点，按链序取第一条`);
			for (const provider of enabled) {
				if (authFor(providerIdOf(provider)) !== "apiKey") continue;
				const hasKey = Boolean(provider.apiKey.trim()) && !isMaskedValue(provider.apiKey);
				const keepStored = isMaskedValue(provider.apiKey);
				if (!hasKey && !keepStored) warnings.push(`通道「${provider.name}」已启用但还没填 API Key，脚本会判定为未配置并跳过`);
			}
			const genRows = [];
			for (const entry of CATALOG) {
				if (!entry.kinds.includes("gen")) continue;
				const mine = genChannels.filter((provider) => providerIdOf(provider) === entry.providerId);
				const live = genEnabled.filter((provider) => providerIdOf(provider) === entry.providerId);
				if (!(mine.length > 0 || previous.some((provider) => provider.kind === "gen" && providerIdOf(provider) === entry.providerId))) continue;
				const wasLive = previous.some((provider) => provider.kind === "gen" && providerIdOf(provider) === entry.providerId && provider.enabled);
				const hadStoredKey = mine.some((provider) => Boolean(provider.apiKey) && !isMaskedValue(provider.apiKey));
				const ownedByPanel = wasLive || hadStoredKey;
				if (entry.providerId === "direct") {
					if (live.length > 0) {
						const sub = String(live[0].directProvider || "dashscope").toLowerCase();
						genRows.push({
							key: "DIRECT_PROVIDER",
							action: "set",
							value: sub
						});
						if (!DIRECT_SUB_PROVIDERS.some((candidate) => candidate.id === sub)) warnings.push(`直连子通道「${sub}」不在引擎支持列表里，出图会报未知子通道`);
					} else if (ownedByPanel) genRows.push({
						key: "DIRECT_PROVIDER",
						action: "delete"
					});
					continue;
				}
				if (!entry.env) continue;
				if (live.length === 0) {
					if (ownedByPanel) {
						for (const key of [
							entry.env.key,
							entry.env.model,
							entry.env.base
						]) if (key) genRows.push({
							key,
							action: "delete"
						});
					}
					continue;
				}
				const first = live[0];
				const keyRow = setOrDelete(entry.env.key, first.apiKey);
				if (keyRow) genRows.push(keyRow);
				const modelRow = setOrDelete(entry.env.model, first.model || catalogModels(entry.providerId, "gen")[0] || "");
				if (modelRow) genRows.push(modelRow);
				const baseRow = setOrDelete(entry.env.base, first.base || entry.base);
				if (baseRow) genRows.push(baseRow);
			}
			if (chain.length > 0) genRows.push({
				key: "GEN_PROVIDER_ORDER",
				action: "set",
				value: chain.join(",")
			});
			else if (genChannels.length > 0 || wasGen) genRows.push({
				key: "GEN_PROVIDER_ORDER",
				action: "delete"
			});
			const webAccounts = genEnabled.filter((provider) => providerIdOf(provider).startsWith("chatgpt-web@"));
			if (webAccounts.length > 0) genRows.push({
				key: "IMG_CHATGPT_WEB_ACCOUNTS",
				action: "set",
				value: webAccounts.map((provider) => `${providerIdOf(provider).slice(12)}:${provider.name.replace(/[,\r\n]/g, " ")}`).join(",")
			});
			else if (genChannels.some((provider) => providerIdOf(provider).startsWith("chatgpt-web@")) || previous.some((provider) => providerIdOf(provider).startsWith("chatgpt-web@"))) genRows.push({
				key: "IMG_CHATGPT_WEB_ACCOUNTS",
				action: "delete"
			});
			const visionRows = [];
			const wires = visionEnabled.map((provider) => {
				const providerId = providerIdOf(provider);
				if (providerId === "qoder-cli" || provider.base === "qoderclicn") return {
					type: "cli",
					id: providerId,
					cmd: "qoderclicn",
					model: provider.model || defaultVisionModel(providerId)
				};
				const base = provider.base || catalogEntry(providerId)?.base || "";
				return {
					id: providerId,
					key: provider.apiKey,
					model: provider.model || defaultVisionModel(providerId),
					...base ? { base } : {}
				};
			});
			if (visionEnabled.length > 0) visionRows.push({
				key: "VISION_PROVIDERS",
				action: "set",
				value: JSON.stringify(wires)
			});
			else if (visionChannels.length > 0 || wasVision) visionRows.push({
				key: "VISION_PROVIDERS",
				action: "delete"
			});
			const main = visionEnabled.find((provider) => authFor(providerIdOf(provider)) === "apiKey" && Boolean(provider.apiKey));
			if (main) {
				const providerId = providerIdOf(main);
				visionRows.push({
					key: "VISION_API_KEY",
					action: "set",
					value: main.apiKey
				});
				const model = main.model || defaultVisionModel(providerId);
				visionRows.push(model ? {
					key: "VISION_MODEL",
					action: "set",
					value: model
				} : {
					key: "VISION_MODEL",
					action: "delete"
				});
				const base = main.base || catalogEntry(providerId)?.base || "";
				visionRows.push(base ? {
					key: "VISION_BASE_URL",
					action: "set",
					value: base
				} : {
					key: "VISION_BASE_URL",
					action: "delete"
				});
			} else if (visionChannels.length > 0 || wasVision) {
				visionRows.push({
					key: "VISION_API_KEY",
					action: "delete"
				});
				visionRows.push({
					key: "VISION_MODEL",
					action: "delete"
				});
				visionRows.push({
					key: "VISION_BASE_URL",
					action: "delete"
				});
			}
			return {
				vision: {
					rows: visionRows,
					chain: visionEnabled.map(providerIdOf)
				},
				gen: {
					rows: genRows,
					chain
				},
				warnings
			};
		}
		/** 保存前校验：只有「写进 .env 后必然跑不通」的硬错误才拦保存。 */
		function validateProviders(providers) {
			const errors = [];
			const ids = /* @__PURE__ */ new Set();
			for (const provider of providers) {
				const providerId = providerIdOf(provider);
				if (!provider.id) errors.push("存在缺少 id 的通道");
				if (ids.has(provider.id)) errors.push(`通道 id 重复：${provider.id}`);
				ids.add(provider.id);
				if (provider.kind !== "gen" && provider.kind !== "vision") errors.push(`通道「${provider.name}」的 kind 非法：${String(provider.kind)}`);
				if (![
					1,
					2,
					3
				].includes(Number(provider.level))) errors.push(`通道「${provider.name}」的等级非法：${String(provider.level)}`);
				if (provider.kind === "gen" && !isGenProviderId(providerId)) errors.push(`未知生图供应商「${providerId}」：generate_image.mjs 只认 ${GEN_PROVIDER_IDS.join(" / ")} / chatgpt-web@<账号id>`);
				if (providerId === "direct") {
					const sub = String(provider.directProvider || "dashscope").toLowerCase();
					if (!DIRECT_SUB_PROVIDERS.some((candidate) => candidate.id === sub)) errors.push(`直连子通道「${sub}」不存在；可用：${DIRECT_SUB_PROVIDERS.map((candidate) => candidate.id).join(" / ")}`);
				}
			}
			return errors;
		}
		//#endregion
		//#region src/client/config-panel.tsx
		/**
		* dsh-img2img-config client — Settings → 「识图与生图」 panel.
		*
		* 多 API 供应商管理：三级优先级（主/备/兜底）、手动开关、拖拽排序。
		*
		* UI 结构（2026-10 重构）：
		*  - 「厂商卡片」：每个通道一张可折叠卡片，收起时只显示厂商名、模型链摘要、
		*    掩码 Key（未配置则不显示任何 Key 痕迹）与等级，展开后才显示模型 chips、
		*    Key / Base URL 编辑区，长面板不再被输入框撑开；
		*  - 「模型链」按厂商归属展示：卡片内是该厂商对应的模型链（可加/删/排序），
		*    收起摘要里直接看到 `厂商 → 模型 → 模型`；
		*  - 三级分组、ChatGPT 账号逐条也都可折叠；折叠状态写 localStorage，
		*    跨设置页开关、跨刷新保留；
		*  - Key 在卡片头部以掩码形式展示（例如 `sk-b••••0f4f`），没有配置就什么都不显示；
		*  - 顶部工具条常驻（sticky）：通道统计、探测全部余额、保存配置、未保存提示。
		*
		* 本文件是同一个 client bundle 里的第二个 UI 面，由 `./index.tsx` 一并 apply；
		* 它不单独作为 __ModuleLoader__ 入口，所以不导出 name / inject。
		*/
		/** Locale namespace owned by the settings panel. */
		const NS$1 = "dsh-img2img-config";
		/** 通道类型 / 状态 / 行结构都来自双端共用的 ../catalog.ts，panel 只做展示。 */
		const LEVEL_META = {
			1: {
				title: "一级 · 主通道",
				short: "1 级",
				color: "#3a9b5a",
				desc: "优先使用，失败后依次降级"
			},
			2: {
				title: "二级 · 备用",
				short: "2 级",
				color: "#d08a2e",
				desc: "主通道失败后自动切换"
			},
			3: {
				title: "三级 · 兜底",
				short: "3 级",
				color: "#8a6bd0",
				desc: "最后兜底，欠费自动关停"
			}
		};
		const STATUS_META = {
			ok: {
				dot: "#3a9b5a",
				label: "正常"
			},
			arrears: {
				dot: "#d05050",
				label: "欠费/额度耗尽（已自动关停）"
			},
			error: {
				dot: "#d08a2e",
				label: "探测失败"
			},
			unknown: {
				dot: "#888",
				label: "未探测"
			},
			cli: {
				dot: "#4f8fd0",
				label: "CLI / 登录态通道，无需探测"
			}
		};
		const UI_STORE_KEY = "dsh-img2img-config:ui-collapse:v1";
		function splitModels(value) {
			return value.split(",").map((s) => s.trim()).filter(Boolean);
		}
		/** 与宿主同口径的掩码（前端只用于展示，不参与保存）。 */
		function maskKey(value) {
			if (!value) return "";
			if (value.includes("••••")) return value;
			if (value.length <= 8) return "••••";
			return `${value.slice(0, 4)}••••${value.slice(-4)}`;
		}
		/** 供应商在色板里的键（账号通道统一按 chatgpt-web 上色）。 */
		function vendorKey(p) {
			const providerId = providerIdOf(p);
			return providerId.startsWith("chatgpt-web@") ? "chatgpt-web" : providerId;
		}
		/** 托管通道：不用 API Key，也不做 HTTP 余额探测。 */
		function isManagedChannel(p) {
			return isManagedProvider(providerIdOf(p)) || p.base === "qoderclicn" || p.base === "codex-cli" || p.base.startsWith("chatgpt-web:");
		}
		function channelManagedReason(p) {
			return tr(managedReason(providerIdOf(p)));
		}
		/** 直连引擎用子通道选择代替模型链。 */
		function isDirectChannel(p) {
			return providerIdOf(p) === "direct";
		}
		/** 生图 DashScope 的模型链由脚本内置，面板里的模型只作记录。 */
		function isFixedModelChain(p) {
			return p.kind === "gen" && providerIdOf(p) === "dashscope";
		}
		function modelChainEditable(p) {
			const providerId = providerIdOf(p);
			if (isDirectChannel(p)) return false;
			if (isAccountProvider(providerId)) return false;
			if (isFixedModelChain(p)) return false;
			if (providerId === "local") return false;
			return true;
		}
		function modelChainNote(p) {
			if (isDirectChannel(p)) return tr("直连引擎的模型由脚本 --model 传入，这里只需选子通道。");
			if (isFixedModelChain(p)) return tr("DashScope 生图模型链由脚本内置：qwen-image-3.0-pro → qwen-image-3.0 → wan2.7-image-pro；面板里的模型只作记录，不写入 .env。");
			return "";
		}
		const VENDOR_META = {
			deepseek: {
				avatar: "D",
				color: "#4f8fd0"
			},
			dashscope: {
				avatar: "Q",
				color: "#8a6bd0"
			},
			zai: {
				avatar: "Z",
				color: "#3a9b5a"
			},
			openai: {
				avatar: "O",
				color: "#3a9b5a"
			},
			seedream: {
				avatar: "S",
				color: "#d08a2e"
			},
			minimax: {
				avatar: "M",
				color: "#d05050"
			},
			"qoder-cli": {
				avatar: "Q",
				color: "#d08a2e"
			},
			qoder: {
				avatar: "Q",
				color: "#d08a2e"
			},
			"codex-cli": {
				avatar: "C",
				color: "#4f8fd0"
			},
			direct: {
				avatar: "⚡",
				color: "#4f8fd0"
			},
			"chatgpt-web": {
				avatar: "G",
				color: "#3a9b5a"
			}
		};
		function vendorColor(p) {
			return VENDOR_META[vendorKey(p)]?.color ?? "#777";
		}
		function vendorAvatar(p) {
			const known = VENDOR_META[vendorKey(p)]?.avatar;
			if (known) return known;
			const first = p.name.trim().slice(0, 1);
			return first ? first.toUpperCase() : "?";
		}
		function modelSuggestions(p) {
			return [...catalogModels(providerIdOf(p), p.kind)];
		}
		/** Base URL 一行摘要：托管通道显示人话，正常端点只留 host。 */
		function hostOf(base) {
			const value = base.trim();
			if (!value) return tr("未设置端点");
			if (value === "qoderclicn") return "Qoder CLI";
			if (value === "codex-cli") return tr("Codex 客户端");
			if (value.startsWith("chatgpt-web:")) return tr("ChatGPT 网页账号");
			try {
				return new URL(value).host;
			} catch {
				return value;
			}
		}
		function readUiStore() {
			try {
				const raw = localStorage.getItem(UI_STORE_KEY);
				if (!raw) return {};
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
				const out = {};
				for (const [key, value] of Object.entries(parsed)) if (typeof value === "boolean") out[key] = value;
				return out;
			} catch {
				return {};
			}
		}
		function writeUiStore(value) {
			try {
				localStorage.setItem(UI_STORE_KEY, JSON.stringify(value));
			} catch {}
		}
		const styles = {
			section: {
				background: "var(--dsw-alias-settings-card-fill, #1e1e1e)",
				border: "1px solid var(--dsw-alias-border-l3, #333)",
				borderRadius: 10,
				marginBottom: 14,
				overflow: "hidden"
			},
			sectionHead: {
				padding: "11px 14px",
				borderBottom: "1px solid var(--dsw-alias-border-l1, #2c2c2c)",
				display: "flex",
				alignItems: "flex-start",
				gap: 10
			},
			sectionTitle: {
				fontSize: 14,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, #eee)",
				display: "flex",
				alignItems: "center",
				gap: 6
			},
			sectionSub: {
				fontSize: 11.5,
				color: "var(--dsw-alias-label-tertiary, #777)",
				marginTop: 3,
				lineHeight: 1.5
			},
			sectionBody: { padding: "10px 12px 12px" },
			sectionActions: {
				marginLeft: "auto",
				display: "flex",
				gap: 6,
				flexShrink: 0
			},
			group: {
				border: "1px solid var(--dsw-alias-border-l3, #333)",
				borderRadius: 8,
				marginBottom: 8,
				overflow: "hidden",
				background: "var(--dsw-alias-bg-layer-1, #181818)"
			},
			groupHead: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "5px 10px",
				cursor: "pointer",
				userSelect: "none"
			},
			groupTitle: {
				fontSize: 12,
				fontWeight: 600,
				display: "flex",
				alignItems: "center",
				gap: 6
			},
			groupCount: {
				fontSize: 10,
				padding: "0 6px",
				borderRadius: 8,
				background: "var(--dsw-alias-bg-layer-1, #141414)",
				border: "1px solid var(--dsw-alias-border-l3, #333)",
				color: "var(--dsw-alias-label-secondary, #aaa)",
				lineHeight: "16px"
			},
			groupDesc: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary, #777)",
				marginLeft: "auto",
				whiteSpace: "nowrap",
				overflow: "hidden",
				textOverflow: "ellipsis"
			},
			groupEmpty: {
				padding: "8px 12px",
				fontSize: 11.5,
				color: "#666"
			},
			card: {
				border: "1px solid var(--dsw-alias-border-l3, #333)",
				borderRadius: 8,
				background: "var(--dsw-alias-settings-card-fill, #1e1e1e)",
				margin: "6px 8px",
				overflow: "hidden"
			},
			cardHead: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "7px 9px",
				cursor: "pointer"
			},
			cardHeadDragOver: {
				outline: "1px dashed var(--dsw-alias-button-info-fill, #4f6ef7)",
				outlineOffset: -2
			},
			cardBody: {
				padding: "2px 10px 10px",
				borderTop: "1px solid var(--dsw-alias-border-l1, #2a2a2a)"
			},
			handle: {
				color: "#666",
				fontSize: 13,
				cursor: "grab",
				flexShrink: 0,
				userSelect: "none",
				letterSpacing: -1
			},
			avatar: {
				width: 22,
				height: 22,
				borderRadius: 6,
				flexShrink: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: 11,
				fontWeight: 700,
				color: "#fff"
			},
			identity: {
				flex: 1,
				minWidth: 0
			},
			nameRow: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				minWidth: 0
			},
			name: {
				fontSize: 13,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, #eee)",
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			summaryRow: {
				display: "flex",
				alignItems: "center",
				gap: 5,
				marginTop: 1,
				minWidth: 0,
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary, #888)",
				whiteSpace: "nowrap"
			},
			summaryChain: {
				overflow: "hidden",
				textOverflow: "ellipsis",
				minWidth: 0
			},
			sep: { color: "#444" },
			dot: {
				width: 7,
				height: 7,
				borderRadius: 4,
				flexShrink: 0,
				display: "inline-block"
			},
			statusTag: {
				fontSize: 10.5,
				padding: "0 5px",
				borderRadius: 7,
				lineHeight: "15px",
				flexShrink: 0
			},
			keyChip: {
				display: "inline-flex",
				alignItems: "center",
				gap: 3,
				fontSize: 10.5,
				fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
				color: "var(--dsw-alias-label-secondary, #b9b9b9)",
				background: "var(--dsw-alias-bg-layer-1, #141414)",
				border: "1px solid var(--dsw-alias-border-l4, #3a3a3a)",
				borderRadius: 9,
				padding: "1px 7px",
				flexShrink: 0,
				maxWidth: 190,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			levelSelect: {
				padding: "2px 4px",
				borderRadius: 5,
				border: "1px solid var(--dsw-alias-border-l4, #444)",
				background: "var(--dsw-alias-bg-layer-1, #141414)",
				color: "var(--dsw-alias-label-primary, #ddd)",
				fontSize: 11,
				flexShrink: 0
			},
			chevron: {
				fontSize: 10,
				color: "var(--dsw-alias-label-tertiary, #888)",
				width: 14,
				textAlign: "center",
				flexShrink: 0,
				transition: "transform .15s"
			},
			toggle: {
				width: 30,
				height: 17,
				borderRadius: 9,
				border: "none",
				cursor: "pointer",
				position: "relative",
				flexShrink: 0,
				padding: 0,
				background: "#444"
			},
			toggleOn: { background: "#3a9b5a" },
			toggleOff: { background: "#444" },
			knob: {
				position: "absolute",
				top: 2,
				width: 13,
				height: 13,
				borderRadius: 7,
				background: "#fff",
				transition: "left .12s"
			},
			fieldLabel: {
				fontSize: 10.5,
				color: "var(--dsw-alias-label-tertiary, #888)",
				marginBottom: 3,
				display: "flex",
				alignItems: "center",
				gap: 4
			},
			input: {
				padding: "4px 8px",
				borderRadius: 5,
				border: "1px solid var(--dsw-alias-border-l4, #444)",
				background: "var(--dsw-alias-bg-layer-1, #141414)",
				color: "var(--dsw-alias-label-primary, #eee)",
				fontSize: 12,
				width: "100%",
				boxSizing: "border-box"
			},
			field: {
				display: "flex",
				flexDirection: "column",
				flex: 1,
				minWidth: 0
			},
			fieldsRow: {
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
				gap: 10,
				marginTop: 10
			},
			chips: {
				display: "flex",
				flexWrap: "wrap",
				gap: 4,
				alignItems: "center"
			},
			chip: {
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "2px 6px 2px 8px",
				borderRadius: 10,
				border: "1px solid var(--dsw-alias-border-l4, #444)",
				background: "var(--dsw-alias-bg-layer-1, #141414)",
				color: "var(--dsw-alias-label-primary, #ddd)",
				fontSize: 11.5,
				maxWidth: 260
			},
			chipIndex: {
				fontSize: 9,
				color: "var(--dsw-alias-label-tertiary, #777)",
				fontVariantNumeric: "tabular-nums"
			},
			chipText: {
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			chipX: {
				border: "none",
				background: "transparent",
				color: "#d05050",
				cursor: "pointer",
				fontSize: 12,
				padding: 0,
				lineHeight: 1,
				flexShrink: 0
			},
			chipInput: {
				padding: "2px 8px",
				borderRadius: 10,
				border: "1px dashed var(--dsw-alias-border-l4, #555)",
				background: "var(--dsw-alias-bg-layer-1, #141414)",
				color: "var(--dsw-alias-label-primary, #eee)",
				fontSize: 11.5,
				width: 150,
				boxSizing: "border-box",
				outline: "none"
			},
			suggestRow: {
				display: "flex",
				gap: 4,
				marginTop: 6,
				overflowX: "auto",
				paddingBottom: 1
			},
			suggestChip: {
				padding: "1px 7px",
				borderRadius: 9,
				border: "1px dashed var(--dsw-alias-border-l4, #444)",
				background: "transparent",
				color: "var(--dsw-alias-label-tertiary, #999)",
				fontSize: 10.5,
				cursor: "pointer",
				whiteSpace: "nowrap",
				flexShrink: 0
			},
			suggestLabel: {
				fontSize: 10.5,
				color: "var(--dsw-alias-label-tertiary, #777)",
				lineHeight: "18px",
				flexShrink: 0
			},
			hint: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary, #777)",
				lineHeight: 1.6
			},
			hintBox: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary, #888)",
				background: "var(--dsw-alias-bg-layer-1, #181818)",
				border: "1px dashed var(--dsw-alias-border-l3, #333)",
				borderRadius: 6,
				padding: "6px 8px",
				marginTop: 10,
				lineHeight: 1.6
			},
			btn: {
				padding: "5px 12px",
				borderRadius: 6,
				border: "1px solid var(--dsw-alias-border-l4, #444)",
				background: "var(--dsw-alias-bg-layer-1, #242424)",
				color: "var(--dsw-alias-label-primary, #ddd)",
				cursor: "pointer",
				fontSize: 12,
				whiteSpace: "nowrap",
				flexShrink: 0
			},
			btnGhost: {
				padding: "2px 7px",
				borderRadius: 5,
				border: "1px solid transparent",
				background: "transparent",
				color: "var(--dsw-alias-label-tertiary, #888)",
				cursor: "pointer",
				fontSize: 11
			},
			btnPrimary: {
				padding: "6px 18px",
				borderRadius: 6,
				border: "none",
				background: "var(--dsw-alias-button-primary-fill, #4f6ef7)",
				color: "var(--dsw-alias-label-primary-foreground, #fff)",
				cursor: "pointer",
				fontSize: 13,
				fontWeight: 600,
				whiteSpace: "nowrap",
				flexShrink: 0
			},
			btnDanger: {
				padding: "4px 9px",
				borderRadius: 5,
				border: "1px solid #5a2f2f",
				background: "transparent",
				color: "#d05050",
				cursor: "pointer",
				fontSize: 11
			},
			btnArrow: {
				padding: "2px 7px",
				borderRadius: 5,
				border: "1px solid var(--dsw-alias-border-l4, #3a3a3a)",
				background: "var(--dsw-alias-bg-layer-1, #1c1c1c)",
				color: "var(--dsw-alias-label-secondary, #aaa)",
				cursor: "pointer",
				fontSize: 10.5,
				whiteSpace: "nowrap"
			},
			toolbar: {
				position: "sticky",
				top: 0,
				zIndex: 20,
				display: "flex",
				alignItems: "center",
				gap: 8,
				rowGap: 6,
				flexWrap: "wrap",
				padding: "8px 10px",
				marginBottom: 12,
				background: "var(--dsw-alias-settings-card-fill, #1e1e1e)",
				border: "1px solid var(--dsw-alias-border-l3, #333)",
				borderRadius: 10,
				boxShadow: "0 4px 14px rgba(0,0,0,.25)"
			},
			stats: {
				fontSize: 11.5,
				color: "var(--dsw-alias-label-tertiary, #888)",
				display: "flex",
				gap: 6,
				flexWrap: "wrap",
				marginRight: "auto",
				minWidth: 0
			},
			stat: {
				display: "inline-flex",
				alignItems: "center",
				gap: 4
			},
			msg: {
				fontSize: 12,
				marginLeft: 2,
				color: "var(--dsw-alias-label-secondary, #aaa)",
				maxWidth: 340,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				flexShrink: 1,
				minWidth: 0
			},
			dirty: {
				fontSize: 11,
				color: "#d08a2e",
				border: "1px solid #5a4526",
				background: "#d08a2e14",
				borderRadius: 8,
				padding: "0 7px",
				lineHeight: "18px"
			},
			footerHint: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary, #777)",
				marginTop: 12,
				lineHeight: 1.7
			},
			loading: {
				fontSize: 12.5,
				color: "var(--dsw-alias-label-tertiary, #999)",
				padding: 16
			},
			del: {
				border: "none",
				background: "transparent",
				color: "#d05050",
				cursor: "pointer",
				fontSize: 14,
				flexShrink: 0
			},
			select: {
				padding: "4px 6px",
				borderRadius: 5,
				border: "1px solid var(--dsw-alias-border-l4, #444)",
				background: "var(--dsw-alias-bg-layer-1, #141414)",
				color: "var(--dsw-alias-label-primary, #eee)",
				fontSize: 12
			},
			providerBadge: {
				fontSize: 9.5,
				fontFamily: "ui-monospace, Consolas, monospace",
				color: "var(--dsw-alias-label-tertiary, #999)",
				border: "1px solid var(--dsw-alias-border-l4, #3a3a3a)",
				borderRadius: 6,
				padding: "0 5px",
				lineHeight: "15px",
				flexShrink: 0,
				background: "var(--dsw-alias-bg-layer-1, #161616)"
			},
			banner: {
				fontSize: 12,
				lineHeight: 1.6,
				color: "#e0a94a",
				background: "#d08a2e14",
				border: "1px solid #5a4526",
				borderRadius: 8,
				padding: "8px 12px",
				marginBottom: 12
			},
			overlay: {
				position: "fixed",
				inset: 0,
				background: "rgba(0,0,0,.55)",
				zIndex: 1200,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 20
			},
			dialog: {
				width: "min(640px, 96vw)",
				maxHeight: "min(78vh, 780px)",
				display: "flex",
				flexDirection: "column",
				background: "var(--dsw-alias-settings-card-fill, #1e1e1e)",
				border: "1px solid var(--dsw-alias-border-l3, #3a3a3a)",
				borderRadius: 12,
				boxShadow: "0 18px 60px rgba(0,0,0,.55)",
				overflow: "hidden"
			},
			dialogHead: {
				padding: "12px 16px",
				borderBottom: "1px solid var(--dsw-alias-border-l1, #2c2c2c)"
			},
			dialogTitle: {
				fontSize: 14,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, #eee)"
			},
			dialogSub: {
				fontSize: 11.5,
				color: "var(--dsw-alias-label-tertiary, #888)",
				marginTop: 4,
				lineHeight: 1.5
			},
			dialogBody: {
				padding: "10px 14px",
				overflowY: "auto",
				display: "flex",
				flexDirection: "column",
				gap: 8
			},
			dialogFoot: {
				padding: "10px 16px",
				borderTop: "1px solid var(--dsw-alias-border-l1, #2c2c2c)",
				display: "flex",
				alignItems: "center",
				gap: 8,
				justifyContent: "flex-end"
			},
			pickRow: {
				display: "flex",
				alignItems: "flex-start",
				gap: 10,
				padding: "8px 10px",
				borderRadius: 8,
				border: "1px solid var(--dsw-alias-border-l3, #333)",
				background: "var(--dsw-alias-bg-layer-1, #181818)",
				cursor: "pointer"
			},
			pickRowActive: {
				borderColor: "var(--dsw-alias-button-info-fill, #4f6ef7)",
				background: "#4f6ef714"
			},
			pickName: {
				fontSize: 12.5,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, #eee)",
				display: "flex",
				alignItems: "center",
				gap: 6,
				flexWrap: "wrap"
			},
			pickMeta: {
				fontSize: 11,
				color: "var(--dsw-alias-label-tertiary, #888)",
				marginTop: 3,
				lineHeight: 1.5
			},
			tag: {
				fontSize: 9.5,
				padding: "0 5px",
				borderRadius: 6,
				lineHeight: "15px",
				border: "1px solid var(--dsw-alias-border-l4, #444)",
				color: "var(--dsw-alias-label-secondary, #aaa)",
				whiteSpace: "nowrap"
			},
			tagOk: {
				fontSize: 9.5,
				padding: "0 5px",
				borderRadius: 6,
				lineHeight: "15px",
				border: "1px solid #2f5a3a",
				color: "#5cc07a",
				whiteSpace: "nowrap"
			},
			previewGrid: {
				display: "grid",
				gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
				gap: 10
			},
			previewCol: {
				border: "1px solid var(--dsw-alias-border-l3, #333)",
				borderRadius: 8,
				padding: "8px 10px",
				background: "var(--dsw-alias-bg-layer-1, #181818)"
			},
			previewHead: {
				fontSize: 12,
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, #eee)",
				marginBottom: 6
			},
			previewRow: {
				display: "flex",
				alignItems: "baseline",
				gap: 6,
				fontSize: 11,
				color: "var(--dsw-alias-label-secondary, #bbb)",
				padding: "2px 0",
				minWidth: 0
			},
			previewKey: {
				fontFamily: "ui-monospace, Consolas, monospace",
				flexShrink: 0
			},
			previewValue: {
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap",
				minWidth: 0,
				color: "var(--dsw-alias-label-tertiary, #888)"
			},
			actSet: {
				fontSize: 9.5,
				color: "#5cc07a",
				flexShrink: 0
			},
			actDelete: {
				fontSize: 9.5,
				color: "#e06a6a",
				flexShrink: 0
			},
			actKeep: {
				fontSize: 9.5,
				color: "#777",
				flexShrink: 0
			},
			warnBox: {
				fontSize: 11.5,
				lineHeight: 1.6,
				color: "#e0a94a",
				background: "#d08a2e14",
				border: "1px solid #5a4526",
				borderRadius: 8,
				padding: "8px 10px"
			}
		};
		function Toggle({ on, onChange }) {
			return (0, react.createElement)("button", {
				style: {
					...styles.toggle,
					...on ? styles.toggleOn : styles.toggleOff
				},
				title: on ? tr("点击关闭（停用该通道）") : tr("点击开启"),
				onClick: (event) => {
					event.stopPropagation();
					onChange(!on);
				}
			}, (0, react.createElement)("span", { style: {
				...styles.knob,
				left: on ? 15 : 2
			} }));
		}
		function Chevron({ open }) {
			return (0, react.createElement)("span", { style: {
				...styles.chevron,
				transform: open ? "rotate(90deg)" : "none"
			} }, "▶");
		}
		function KeyChip({ p }) {
			if (!p.apiKey) return null;
			if (isManagedChannel(p)) return (0, react.createElement)("span", {
				style: styles.keyChip,
				title: tr("{p1}：凭据由对应账号库托管，不在此处明文展示", { p1: channelManagedReason(p) })
			}, tr("🔐 凭据已存"));
			const text = maskKey(p.apiKey);
			return (0, react.createElement)("span", {
				style: styles.keyChip,
				title: tr("已配置 API Key（掩码展示，展开卡片可更换）")
			}, `🔑 ${text}`);
		}
		function AddCardButton({ label, onClick, block = true }) {
			return (0, react.createElement)("button", {
				style: {
					padding: "5px 10px",
					borderRadius: 6,
					border: "1px dashed var(--dsw-alias-border-l4, #4a4a4a)",
					background: "transparent",
					color: "var(--dsw-alias-label-secondary, #999)",
					cursor: "pointer",
					fontSize: 11,
					width: block ? "100%" : "auto",
					marginTop: 2
				},
				onClick
			}, label);
		}
		/**
		* 模型链（该厂商对应的模型，按降级顺序）。
		* 收起卡片时由头部摘要展示；展开后在此增删。
		*/
		function ModelChain({ value, provider, onChange }) {
			const [draft, setDraft] = (0, react.useState)("");
			const list = splitModels(value);
			const commit = (next) => onChange(next.join(","));
			const suggestions = modelSuggestions(provider);
			const addDraft = () => {
				const model = draft.trim();
				if (model && !list.includes(model)) commit([...list, model]);
				setDraft("");
			};
			return (0, react.createElement)("div", { style: { marginTop: 8 } }, (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6
			} }, (0, react.createElement)("span", { style: {
				fontSize: 11,
				fontWeight: 600,
				color: "var(--dsw-alias-label-secondary, #bbb)"
			} }, tr("模型链")), (0, react.createElement)("span", { style: styles.groupCount }, tr("{p1} 个", { p1: list.length })), (0, react.createElement)("span", { style: {
				...styles.hint,
				marginLeft: 2
			} }, tr("按顺序降级 · 点击 × 删除，回车添加"))), (0, react.createElement)("div", { style: {
				...styles.chips,
				marginTop: 6
			} }, list.map((model, index) => (0, react.createElement)("span", {
				key: model,
				style: styles.chip,
				title: model
			}, (0, react.createElement)("span", { style: styles.chipIndex }, String(index + 1)), (0, react.createElement)("span", { style: styles.chipText }, model), (0, react.createElement)("button", {
				style: styles.chipX,
				title: tr("删除 {p1}", { p1: model }),
				onClick: () => commit(list.filter((x) => x !== model))
			}, "×"))), (0, react.createElement)("input", {
				style: {
					...styles.chipInput,
					width: 168,
					...draft ? { borderColor: "var(--dsw-alias-button-info-fill, #4f6ef7)" } : {}
				},
				value: draft,
				placeholder: tr("+ 输入模型名，回车添加"),
				onChange: (e) => setDraft(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						addDraft();
					}
				},
				onBlur: addDraft
			})), (0, react.createElement)("div", { style: styles.suggestRow }, (0, react.createElement)("span", { style: styles.suggestLabel }, tr("常用")), suggestions.map((model) => {
				const active = list.includes(model);
				return (0, react.createElement)("span", {
					key: model,
					style: {
						...styles.suggestChip,
						...active ? {
							opacity: .4,
							cursor: "default"
						} : {}
					},
					title: active ? tr("已在模型链中") : tr("点击追加 {p1}", { p1: model }),
					onClick: () => {
						if (!active) commit([...list, model]);
					}
				}, active ? model : `+ ${model}`);
			})));
		}
		function KeyField({ p, onChange }) {
			const [draft, setDraft] = (0, react.useState)("");
			const configured = Boolean(p.apiKey);
			const commit = () => {
				const next = draft.trim();
				if (next) onChange({ apiKey: next });
				setDraft("");
			};
			return (0, react.createElement)("div", { style: styles.field }, (0, react.createElement)("span", { style: styles.fieldLabel }, "API Key"), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6
			} }, (0, react.createElement)("input", {
				style: {
					...styles.input,
					fontFamily: "ui-monospace, Consolas, monospace",
					flex: 1
				},
				type: "password",
				value: draft,
				placeholder: configured ? tr("已配置 {p1}", { p1: maskKey(p.apiKey) }) : tr("粘贴 API Key（可留空）"),
				title: configured ? tr("已配置的 Key 以掩码展示；输入新值覆盖，留空保存则保持原值") : tr("粘贴该厂商的 API Key；CLI / 网页账号通道无需填写"),
				onChange: (e) => setDraft(e.target.value),
				onBlur: commit,
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						commit();
					}
				}
			}), configured ? (0, react.createElement)("button", {
				style: styles.btnArrow,
				title: tr("清空已保存的 Key（保存后从 .env 删除；不点“清空”时留空保存不会删 key）"),
				onClick: () => onChange({
					apiKey: "",
					clearKey: true
				})
			}, tr("清空")) : null));
		}
		function BaseField({ p, onChange }) {
			const providerId = providerIdOf(p);
			const readOnly = isManagedChannel(p) || providerId === "direct" || p.base === "qoderclicn";
			return (0, react.createElement)("div", { style: styles.field }, (0, react.createElement)("span", { style: styles.fieldLabel }, "Base URL", readOnly ? (0, react.createElement)("span", { style: { color: "#555" } }, tr("（托管/固定通道，只读）")) : null), readOnly ? (0, react.createElement)("div", {
				style: {
					...styles.input,
					color: "var(--dsw-alias-label-tertiary, #999)",
					fontFamily: "ui-monospace, Consolas, monospace"
				},
				title: p.base
			}, p.base || "—") : (0, react.createElement)("input", {
				style: styles.input,
				value: p.base,
				placeholder: tr("OpenAI 兼容中转填 base，如 https://api.xxx.com/v1"),
				onChange: (e) => onChange({ base: e.target.value })
			}));
		}
		function VendorCard({ p, open, onToggleOpen, onPatch, onDelete, onMove, onTest, onTry, onCopyCommand, onDragStart, onDragOver, onDragEnd, onDrop, isDragOver }) {
			const level = LEVEL_META[p.level];
			const status = STATUS_META[p.status];
			const models = splitModels(p.model);
			const chainText = models.length ? models.slice(0, 2).join(" → ") + (models.length > 2 ? ` +${models.length - 2}` : "") : tr("未指定模型");
			const managed = isManagedChannel(p);
			const providerId = providerIdOf(p);
			const ability = catalogEntry(providerId)?.i2i;
			const abilityText = {
				yes: tr("支持图生图（参考图）"),
				no: tr("仅文生图（i2i 会被跳过）"),
				subject: tr("图生图走主体参考"),
				direct: tr("能力看直连子通道")
			};
			const stateText = !p.enabled ? tr("已停用") : managed ? tr("托管通道") : p.status === "ok" ? tr("正常") : p.status === "arrears" ? tr("欠费关停") : p.status === "error" ? tr("探测失败") : tr("未探测");
			return (0, react.createElement)("div", {
				style: {
					...styles.card,
					...isDragOver ? styles.cardHeadDragOver : {},
					borderLeft: `2px solid ${p.enabled ? level.color : "#3a3a3a"}`
				},
				draggable: true,
				title: tr("整张卡片可拖动：同级内排序；拖到其他等级组自动改级"),
				onDragStart,
				onDragOver,
				onDrop,
				onDragEnd
			}, (0, react.createElement)("div", {
				style: styles.cardHead,
				onClick: onToggleOpen,
				role: "button",
				tabIndex: 0,
				"aria-expanded": open,
				onKeyDown: (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onToggleOpen();
					}
				}
			}, (0, react.createElement)("span", {
				style: styles.handle,
				title: tr("拖动把手")
			}, "⋮⋮"), (0, react.createElement)(Toggle, {
				on: p.enabled,
				onChange: (v) => onPatch({ enabled: v })
			}), (0, react.createElement)("span", {
				style: {
					...styles.dot,
					background: status.dot,
					boxShadow: p.status === "arrears" ? "0 0 0 2px #d0505033" : "none"
				},
				title: tr(status.label)
			}), (0, react.createElement)("span", { style: {
				...styles.avatar,
				background: vendorColor(p) + "d9",
				color: "#fff"
			} }, vendorAvatar(p)), (0, react.createElement)("div", { style: styles.identity }, (0, react.createElement)("div", { style: styles.nameRow }, (0, react.createElement)("span", {
				style: styles.name,
				title: p.name
			}, p.name), (0, react.createElement)("span", {
				style: styles.providerBadge,
				title: tr("脚本 providerId：{p1}（GEN_PROVIDER_ORDER / --provider 用这个）", { p1: providerIdOf(p) })
			}, providerIdOf(p))), (0, react.createElement)("div", { style: styles.summaryRow }, isDirectChannel(p) ? (0, react.createElement)("span", { style: styles.summaryChain }, tr("子通道 · {p1}", { p1: p.directProvider || "dashscope" })) : (0, react.createElement)("span", { style: styles.summaryChain }, (0, react.createElement)("span", { style: { color: "var(--dsw-alias-label-secondary, #aaa)" } }, tr("模型 {p1}", { p1: models.length })), models.length ? ` · ${chainText}` : tr(" · 未指定模型")), (0, react.createElement)("span", { style: styles.sep }, "·"), (0, react.createElement)("span", { style: styles.summaryChain }, hostOf(p.base)), (0, react.createElement)("span", { style: styles.sep }, "·"), (0, react.createElement)("span", { style: styles.summaryChain }, stateText))), (0, react.createElement)(KeyChip, { p }), (0, react.createElement)("select", {
				style: styles.levelSelect,
				value: String(p.level),
				title: tr("优先级等级（1 主 / 2 备 / 3 兜底）"),
				onClick: (e) => e.stopPropagation(),
				onChange: (e) => onPatch({ level: Number(e.target.value) })
			}, [
				1,
				2,
				3
			].map((lv) => (0, react.createElement)("option", {
				key: lv,
				value: String(lv)
			}, tr("{p1} 级", { p1: lv })))), (0, react.createElement)(Chevron, { open })), open ? (0, react.createElement)("div", { style: styles.cardBody }, modelChainEditable(p) ? (0, react.createElement)(ModelChain, {
				value: p.model,
				provider: p,
				onChange: (v) => onPatch({ model: v })
			}) : modelChainNote(p) ? (0, react.createElement)("div", { style: styles.hintBox }, modelChainNote(p)) : null, isDirectChannel(p) ? (0, react.createElement)("div", { style: {
				...styles.field,
				marginTop: 8
			} }, (0, react.createElement)("span", { style: styles.fieldLabel }, tr("直连子通道（保存后写入 DIRECT_PROVIDER）")), (0, react.createElement)("select", {
				style: styles.select,
				value: p.directProvider || "dashscope",
				onChange: (e) => onPatch({ directProvider: e.target.value })
			}, DIRECT_SUB_PROVIDERS.map((sub) => (0, react.createElement)("option", {
				key: sub.id,
				value: sub.id
			}, `${tr(sub.name)}（${sub.id}）`)))) : null, (0, react.createElement)("div", { style: styles.fieldsRow }, managed ? null : (0, react.createElement)(KeyField, {
				p,
				onChange: onPatch
			}), (0, react.createElement)(BaseField, {
				p,
				onChange: onPatch
			})), managed ? (0, react.createElement)("div", { style: styles.hintBox }, tr("该通道使用「{p1}」，不需要 API Key；凭据由对应的账号库 / 客户端登录态提供。", { p1: channelManagedReason(p) })) : p.apiKey ? (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 6
			} }, tr("已配置的 Key 只以掩码显示；输入新值覆盖，留空保存则保持原值；“清空”才会删除已存 Key。")) : null, ability && p.kind === "gen" ? (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 6
			} }, tr("图生图能力：{p1}{p2}", {
				p1: abilityText[ability] ?? ability,
				p2: catalogEntry(providerId)?.note ? ` · ${catalogEntry(providerId).note}` : ""
			})) : null, p.detail ? (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 6,
				color: p.status === "error" ? "#d05050" : p.status === "arrears" ? "#d05050" : "var(--dsw-alias-label-tertiary, #888)"
			} }, tr("最近探测{p1}：{p2}", {
				p1: p.lastChecked ? `（${new Date(p.lastChecked).toLocaleTimeString("zh-CN", { hour12: false })}）` : "",
				p2: p.detail
			})) : null, (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				marginTop: 10,
				flexWrap: "wrap"
			} }, (0, react.createElement)("button", {
				style: styles.btnArrow,
				title: tr("探活（不花钱）：API 通道 GET /models，CLI/账号通道查本机依赖"),
				onClick: onTest
			}, tr("测试")), p.kind === "gen" ? (0, react.createElement)("button", {
				style: styles.btnArrow,
				title: tr("真实生成一张 1024×1024 测试图（会消耗额度，会先确认）"),
				onClick: onTry
			}, tr("试跑 1 张")) : null, p.kind === "gen" ? (0, react.createElement)("button", {
				style: styles.btnArrow,
				title: tr("复制固定该通道的命令，交给 agent / 终端执行"),
				onClick: onCopyCommand
			}, tr("复制命令")) : null, (0, react.createElement)("button", {
				style: styles.btnArrow,
				title: tr("上移一位（可跨级）"),
				onClick: () => onMove(-1)
			}, tr("▲ 上移")), (0, react.createElement)("button", {
				style: styles.btnArrow,
				title: tr("下移一位（可跨级）"),
				onClick: () => onMove(1)
			}, tr("▼ 下移")), (0, react.createElement)("button", {
				style: {
					...styles.btnDanger,
					marginLeft: "auto"
				},
				title: tr("删除该通道"),
				onClick: onDelete
			}, tr("删除通道")))) : null);
		}
		function LevelGroup({ level, items, collapsed, onToggleCollapsed, ...cardHandlers }) {
			const meta = LEVEL_META[level];
			const { patch, remove, move, drag, dragOverId, isOpen, toggleOpen, onTest, onTry, onCopyCommand } = cardHandlers;
			return (0, react.createElement)("div", {
				style: {
					...styles.group,
					...dragOverId === `group-${level}` ? styles.cardHeadDragOver : {}
				},
				onDragOver: (e) => {
					drag.over(e);
					drag.overGroup(level);
				},
				onDrop: (e) => drag.dropToGroup(e, level)
			}, (0, react.createElement)("div", {
				style: {
					...styles.groupHead,
					background: `linear-gradient(90deg, ${meta.color}18, transparent 70%)`
				},
				onClick: onToggleCollapsed,
				role: "button",
				tabIndex: 0,
				"aria-expanded": !collapsed,
				onKeyDown: (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onToggleCollapsed();
					}
				}
			}, (0, react.createElement)(Chevron, { open: !collapsed }), (0, react.createElement)("span", { style: {
				...styles.dot,
				background: meta.color
			} }), (0, react.createElement)("span", { style: {
				...styles.groupTitle,
				color: meta.color
			} }, tr(meta.title)), (0, react.createElement)("span", { style: styles.groupCount }, String(items.length)), (0, react.createElement)("span", { style: styles.groupDesc }, tr(meta.desc))), collapsed ? null : items.length === 0 ? (0, react.createElement)("div", { style: styles.groupEmpty }, tr("（空 · 可把其他等级的行拖到这里自动改级，或点下方添加通道）")) : items.map((p) => (0, react.createElement)(VendorCard, {
				key: p.id,
				p,
				open: isOpen(p.id),
				onToggleOpen: () => toggleOpen(p.id),
				onPatch: (patchPart) => patch(p.id, patchPart),
				onDelete: () => remove(p.id),
				onMove: (dir) => move(p.id, dir),
				onTest: () => onTest(p.id),
				onTry: () => onTry(p.id),
				onCopyCommand: () => onCopyCommand(p.id),
				onDragStart: (e) => drag.start(e, p.id),
				onDragOver: (e) => drag.over(e),
				onDragEnd: drag.end,
				onDrop: (e) => drag.drop(e, p.id),
				isDragOver: dragOverId === p.id
			})));
		}
		const AUTH_LABEL = {
			apiKey: "API Key",
			cli: "本机 CLI 登录",
			account: "账号库登录态"
		};
		const I2I_LABEL = {
			yes: "支持图生图",
			no: "仅文生图",
			subject: "主体参考",
			direct: "看子通道"
		};
		function ProviderPicker({ kind, providers, onClose, onAdd }) {
			const [query, setQuery] = (0, react.useState)("");
			const [selected, setSelected] = (0, react.useState)("");
			const [level, setLevel] = (0, react.useState)(3);
			const [scan, setScan] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				(async () => {
					try {
						setScan(await (await fetch("/dsh-img2img-config/scan")).json());
					} catch {
						setScan(null);
					}
				})();
			}, []);
			const genScan = scan?.gen?.providers ?? [];
			const scanFor = (providerId) => genScan.find((item) => item.id === providerId);
			const scanSummary = !scan?.gen ? "" : scan.gen.ok === false ? tr("脚本扫描失败：{p1}", { p1: scan.gen.error ?? tr("未知错误") }) : tr("脚本扫描：生图 provider {p1}/{p2} 已就绪", {
				p1: genScan.filter((item) => item.configured).length,
				p2: genScan.length
			});
			const entries = CATALOG.filter((entry) => entry.kinds.includes(kind)).filter((entry) => {
				const keyword = query.trim().toLowerCase();
				if (!keyword) return true;
				return `${tr(entry.name)} ${entry.name} ${entry.providerId} ${entry.note ? tr(entry.note) : ""}`.toLowerCase().includes(keyword);
			});
			const configuredCount = (providerId) => providers.filter((p) => providerIdOf(p) === providerId).length;
			const catalogGenIds = new Set(CATALOG.filter((entry) => entry.kinds.includes("gen")).map((entry) => entry.providerId));
			const scriptOnly = kind === "gen" ? genScan.filter((item) => {
				const id = String(item.id ?? "");
				return Boolean(id) && !id.startsWith("chatgpt-web@") && !catalogGenIds.has(id);
			}) : [];
			const chosen = entries.find((entry) => entry.providerId === selected);
			return (0, react.createElement)("div", {
				style: styles.overlay,
				onClick: onClose
			}, (0, react.createElement)("div", {
				style: styles.dialog,
				onClick: (e) => e.stopPropagation()
			}, (0, react.createElement)("div", { style: styles.dialogHead }, (0, react.createElement)("div", { style: styles.dialogTitle }, kind === "gen" ? tr("添加生图通道 · 选择供应商") : tr("添加识图通道 · 选择供应商")), (0, react.createElement)("div", { style: styles.dialogSub }, kind === "gen" ? tr("列表来自 generate_image.mjs 真正支持的 provider；同一供应商可加多条（多 Key / 多中转），.env 按链序取第一条。") : tr("识图侧 VISION_PROVIDERS 接受任意 OpenAI 兼容端点；目录里的只是常用预设。")), kind === "gen" && scanSummary ? (0, react.createElement)("div", { style: styles.pickMeta }, scanSummary) : null, (0, react.createElement)("input", {
				style: {
					...styles.input,
					marginTop: 10
				},
				value: query,
				placeholder: tr("搜索供应商 / providerId…"),
				onChange: (e) => setQuery(e.target.value)
			})), (0, react.createElement)("div", { style: styles.dialogBody }, entries.map((entry) => {
				const count = configuredCount(entry.providerId);
				const info = kind === "gen" ? scanFor(entry.providerId) : void 0;
				return (0, react.createElement)("div", {
					key: entry.providerId,
					style: {
						...styles.pickRow,
						...selected === entry.providerId ? styles.pickRowActive : {}
					},
					role: "button",
					tabIndex: 0,
					onClick: () => setSelected(entry.providerId),
					onKeyDown: (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							setSelected(entry.providerId);
						}
					}
				}, (0, react.createElement)("span", { style: {
					...styles.avatar,
					background: (VENDOR_META[entry.providerId]?.color ?? "#777") + "d9"
				} }, VENDOR_META[entry.providerId]?.avatar ?? entry.name.slice(0, 1)), (0, react.createElement)("div", { style: {
					flex: 1,
					minWidth: 0
				} }, (0, react.createElement)("div", { style: styles.pickName }, tr(entry.name), (0, react.createElement)("span", { style: styles.providerBadge }, entry.providerId), (0, react.createElement)("span", { style: styles.tag }, tr(AUTH_LABEL[entry.auth] ?? entry.auth)), entry.i2i ? (0, react.createElement)("span", { style: styles.tag }, tr(I2I_LABEL[entry.i2i] ?? entry.i2i)) : null, count > 0 ? (0, react.createElement)("span", { style: styles.tagOk }, tr("已配置 {p1} 条", { p1: count })) : null, info ? (0, react.createElement)("span", {
					style: info.configured ? styles.tagOk : styles.tag,
					title: info.detail ?? ""
				}, info.configured ? tr("本机已就绪") : tr("依赖未就绪")) : null), entry.note ? (0, react.createElement)("div", { style: styles.pickMeta }, tr(entry.note)) : null));
			}), entries.length === 0 ? (0, react.createElement)("div", { style: styles.groupEmpty }, tr("没有匹配的供应商")) : null, scriptOnly.length > 0 ? (0, react.createElement)("div", { style: { marginTop: 6 } }, (0, react.createElement)("div", { style: styles.pickMeta }, tr("脚本发现 {p1} 个插件目录尚未收录的 provider（脚本比插件新）：升级插件目录后才能在这里添加。", { p1: scriptOnly.length })), scriptOnly.map((item) => (0, react.createElement)("div", {
				key: String(item.id),
				style: {
					...styles.pickRow,
					cursor: "default",
					opacity: .78
				}
			}, (0, react.createElement)("span", { style: styles.providerBadge }, String(item.id)), (0, react.createElement)("div", { style: {
				flex: 1,
				minWidth: 0
			} }, (0, react.createElement)("div", { style: styles.pickName }, String(item.name ?? item.id), item.configured ? (0, react.createElement)("span", { style: styles.tagOk }, tr("本机已就绪")) : (0, react.createElement)("span", { style: styles.tag }, tr("未配置"))), (0, react.createElement)("div", { style: styles.pickMeta }, item.detail ?? tr("静态目录没有这个 provider 的 env 映射：先手写 .env，或升级插件后再在面板管理")))))) : null), (0, react.createElement)("div", { style: styles.dialogFoot }, (0, react.createElement)("span", { style: {
				...styles.hint,
				marginRight: "auto"
			} }, chosen ? tr("将添加：{p1}（{p2}）", {
				p1: tr(chosen.name),
				p2: chosen.providerId
			}) : tr("先选一个供应商")), (0, react.createElement)("span", { style: styles.hint }, tr("等级")), (0, react.createElement)("select", {
				style: styles.select,
				value: String(level),
				onChange: (e) => setLevel(Number(e.target.value))
			}, [
				1,
				2,
				3
			].map((lv) => (0, react.createElement)("option", {
				key: lv,
				value: String(lv)
			}, tr(LEVEL_META[lv].title)))), (0, react.createElement)("button", {
				style: styles.btn,
				onClick: onClose
			}, tr("取消")), (0, react.createElement)("button", {
				style: {
					...styles.btnPrimary,
					opacity: chosen ? 1 : .5
				},
				disabled: !chosen,
				onClick: () => {
					if (chosen) onAdd(chosen, level);
				}
			}, tr("添加通道")))));
		}
		const ACTION_META = {
			set: {
				label: "写入",
				style: styles.actSet
			},
			delete: {
				label: "删除",
				style: styles.actDelete
			},
			keep: {
				label: "保持",
				style: styles.actKeep
			}
		};
		function previewValueOf(key, value) {
			const text = value ?? "";
			if (!text) return "—";
			if (/KEY|TOKEN|SECRET/i.test(key)) return maskKey(text);
			return text.length > 72 ? `${text.slice(0, 72)}…` : text;
		}
		function PreviewDialog({ providers, previous, hostOk, onClose }) {
			const plan = planSync(providers, previous);
			const renderRows = (rows) => rows.map((row) => {
				const meta = ACTION_META[row.action];
				return (0, react.createElement)("div", {
					key: row.key,
					style: styles.previewRow
				}, (0, react.createElement)("span", { style: meta.style }, tr(meta.label)), (0, react.createElement)("span", { style: styles.previewKey }, row.key), row.action === "keep" ? null : (0, react.createElement)("span", { style: styles.previewValue }, previewValueOf(row.key, row.value)));
			});
			return (0, react.createElement)("div", {
				style: styles.overlay,
				onClick: onClose
			}, (0, react.createElement)("div", {
				style: styles.dialog,
				onClick: (e) => e.stopPropagation()
			}, (0, react.createElement)("div", { style: styles.dialogHead }, (0, react.createElement)("div", { style: styles.dialogTitle }, tr("保存前预览：将写入的 .env")), (0, react.createElement)("div", { style: styles.dialogSub }, tr("与宿主保存时共用同一份 planSync()：绿=写入，红=删除，灰=保持原值（不碰手写配置）。")), hostOk ? null : (0, react.createElement)("div", { style: {
				...styles.warnBox,
				marginTop: 8
			} }, tr("宿主插件还是旧版：预览能看，保存需要先重启 DSH 宿主。"))), (0, react.createElement)("div", { style: styles.dialogBody }, (0, react.createElement)("div", { style: styles.previewGrid }, (0, react.createElement)("div", { style: styles.previewCol }, (0, react.createElement)("div", { style: styles.previewHead }, tr("生图 · 生效链")), (0, react.createElement)("div", { style: {
				...styles.previewValue,
				marginBottom: 6,
				color: "var(--dsw-alias-label-secondary, #bbb)"
			} }, plan.gen.chain.length > 0 ? plan.gen.chain.join(" → ") : tr("（空）")), renderRows(plan.gen.rows)), (0, react.createElement)("div", { style: styles.previewCol }, (0, react.createElement)("div", { style: styles.previewHead }, tr("识图 · 生效链")), (0, react.createElement)("div", { style: {
				...styles.previewValue,
				marginBottom: 6,
				color: "var(--dsw-alias-label-secondary, #bbb)"
			} }, plan.vision.chain.length > 0 ? plan.vision.chain.join(" → ") : tr("（空）")), renderRows(plan.vision.rows))), plan.warnings.length > 0 ? (0, react.createElement)("div", { style: styles.warnBox }, (0, react.createElement)("div", { style: {
				fontWeight: 600,
				marginBottom: 4
			} }, tr("提示")), plan.warnings.map((warning) => (0, react.createElement)("div", { key: warning }, `· ${warning}`))) : null), (0, react.createElement)("div", { style: styles.dialogFoot }, (0, react.createElement)("button", {
				style: styles.btn,
				onClick: onClose
			}, tr("关闭")))));
		}
		function TryDialog({ provider, onClose }) {
			const [running, setRunning] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const providerId = providerIdOf(provider);
			const run = () => {
				setRunning(true);
				setResult(null);
				(async () => {
					try {
						setResult(await (await fetch("/dsh-img2img-config/try", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ id: provider.id })
						})).json());
					} catch (error) {
						setResult({
							ok: false,
							error: tr("请求失败：{p1}", { p1: error.message })
						});
					}
					setRunning(false);
				})();
			};
			return (0, react.createElement)("div", {
				style: styles.overlay,
				onClick: running ? void 0 : onClose
			}, (0, react.createElement)("div", {
				style: styles.dialog,
				onClick: (e) => e.stopPropagation()
			}, (0, react.createElement)("div", { style: styles.dialogHead }, (0, react.createElement)("div", { style: styles.dialogTitle }, tr("试跑 1 张 · {p1}", { p1: provider.name })), (0, react.createElement)("div", { style: styles.dialogSub }, tr("走技能自己的 generate_image.mjs，固定 1024×1024 / quality normal，provider = {p1}。", { p1: providerId }), tr("会真实调用一次出图（可能消耗 API 额度或订阅出图次数）；ChatGPT 网页通道会开无头浏览器，可能要 1-2 分钟。"))), (0, react.createElement)("div", { style: styles.dialogBody }, running ? (0, react.createElement)("div", { style: styles.hint }, tr("正在出图…（等待脚本返回，最长 240 秒）")) : result ? result.ok ? (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: {
				fontSize: 12,
				color: "#5cc07a",
				marginBottom: 6
			} }, tr("试跑成功：{p1}{p2}{p3}", {
				p1: result.provider ?? providerId,
				p2: result.model ? ` · ${result.model}` : "",
				p3: result.ms ? ` · ${(result.ms / 1e3).toFixed(1)}s` : ""
			})), (result.files ?? []).map((file) => (0, react.createElement)("div", {
				key: file,
				style: {
					fontSize: 11,
					fontFamily: "ui-monospace, Consolas, monospace",
					color: "var(--dsw-alias-label-secondary, #bbb)",
					wordBreak: "break-all",
					padding: "2px 0"
				}
			}, file))) : (0, react.createElement)("div", { style: styles.warnBox }, tr("试跑失败：{p1}", { p1: result.error ?? tr("未知错误") })) : (0, react.createElement)("div", { style: styles.hint }, tr("点“开始试跑”才会真正消耗一次额度。"))), (0, react.createElement)("div", { style: styles.dialogFoot }, (0, react.createElement)("button", {
				style: styles.btn,
				disabled: running,
				onClick: onClose
			}, result ? tr("关闭") : tr("取消")), (0, react.createElement)("button", {
				style: styles.btnPrimary,
				disabled: running,
				onClick: run
			}, running ? tr("出图中…") : result ? tr("再试一次") : tr("开始试跑")))));
		}
		function ConfigPanel() {
			const [providers, setProviders] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [probing, setProbing] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)("");
			const [dirty, setDirty] = (0, react.useState)(false);
			const [hostVersion, setHostVersion] = (0, react.useState)(null);
			const [pickerKind, setPickerKind] = (0, react.useState)(null);
			const [previewOpen, setPreviewOpen] = (0, react.useState)(false);
			const [tryTarget, setTryTarget] = (0, react.useState)(null);
			const [ui, setUi] = (0, react.useState)(() => readUiStore());
			const [dragOverId, setDragOverId] = (0, react.useState)(null);
			const dragId = (0, react.useRef)(null);
			/** 上次从宿主加载/保存成功的通道快照：预览用它判断「哪些是用户删掉的」。 */
			const baseline = (0, react.useRef)([]);
			const hostOk = hostVersion === 2;
			(0, react.useEffect)(() => {
				writeUiStore(ui);
			}, [ui]);
			const isOpen = (id) => ui[`card:${id}`] === true;
			const toggleOpen = (id) => setUi((state) => ({
				...state,
				[`card:${id}`]: state[`card:${id}`] !== true
			}));
			const isGroupCollapsed = (kind, level) => ui[`group:${kind}:${level}`] === true;
			const toggleGroup = (kind, level) => setUi((state) => ({
				...state,
				[`group:${kind}:${level}`]: state[`group:${kind}:${level}`] !== true
			}));
			const setAllOpen = (kind, next) => setUi((state) => {
				const copy = { ...state };
				for (const p of providers ?? []) {
					if (p.kind !== kind) continue;
					if (next) {
						copy[`card:${p.id}`] = true;
						delete copy[`group:${kind}:${p.level}`];
					} else delete copy[`card:${p.id}`];
				}
				return copy;
			});
			const normalizeList = (list) => list.map((p) => ({
				...p,
				providerId: providerIdOf(p)
			}));
			const load = () => {
				(async () => {
					try {
						const data = await (await fetch("/dsh-img2img-config/providers")).json();
						const list = normalizeList(data.providers);
						baseline.current = list;
						setProviders(list);
						setHostVersion(typeof data.hostVersion === "number" ? data.hostVersion : 0);
						setDirty(false);
					} catch {
						setMsg(tr("加载配置失败"));
					}
				})();
			};
			(0, react.useEffect)(() => {
				load();
			}, []);
			/** 账号库变更后刷新通道列表；但当前有未保存的通道改动时别把用户编辑冲掉。 */
			const refreshAfterAccountChange = () => {
				if (dirty) {
					setMsg(tr("账号已同步到通道库；当前有未保存的通道改动，先保存再刷新（避免覆盖你的编辑）"));
					return;
				}
				load();
			};
			const patch = (id, part) => {
				setDirty(true);
				const nextPart = part.apiKey !== void 0 && part.clearKey === void 0 ? {
					...part,
					clearKey: false
				} : part;
				setProviders((list) => list ? list.map((p) => p.id === id ? {
					...p,
					...nextPart
				} : p) : list);
			};
			const remove = (id) => {
				setDirty(true);
				setProviders((list) => list ? list.filter((p) => p.id !== id) : list);
			};
			/** 同组内上移/下移（跨级时自动继承相邻通道的等级） */
			const move = (id, dir) => {
				setDirty(true);
				setProviders((list) => {
					if (!list) return list;
					const index = list.findIndex((p) => p.id === id);
					if (index < 0) return list;
					const item = list[index];
					const target = index + dir;
					if (target < 0 || target >= list.length) return list;
					const neighbor = list[target];
					const next = [...list];
					next[index] = neighbor;
					next[target] = {
						...item,
						level: neighbor.level
					};
					return next;
				});
			};
			/** 从目录条目添加一条通道（同一 provider 可多条：多 Key / 多中转）。 */
			const addChannel = (entry, kind, level) => {
				const base = providers ?? [];
				const id = channelIdFor(entry.providerId, new Set(base.map((p) => p.id)));
				const channel = {
					id,
					providerId: entry.providerId,
					name: tr(entry.name),
					kind,
					level,
					enabled: true,
					apiKey: "",
					model: catalogModels(entry.providerId, kind).join(","),
					base: entry.base,
					...entry.providerId === "direct" ? { directProvider: "dashscope" } : {},
					status: "unknown",
					lastChecked: null
				};
				setProviders([...base, channel]);
				setUi((state) => ({
					...state,
					[`card:${id}`]: true
				}));
				setDirty(true);
				setMsg(tr("已添加 {p1}（{p2}），展开卡片填配置后保存", {
					p1: tr(entry.name),
					p2: entry.providerId
				}));
			};
			const save = () => {
				if (!providers) return;
				const errors = validateProviders(providers);
				if (errors.length > 0) {
					setMsg(tr("保存被拦下: ") + errors.join("；"));
					return;
				}
				if (!hostOk) {
					setMsg(tr("宿主插件还是旧版：请重启 DSH 宿主后再保存（否则新通道的 .env 同步不会真正生效）"));
					return;
				}
				setSaving(true);
				setMsg("");
				(async () => {
					try {
						const data = await (await fetch("/dsh-img2img-config/providers", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ providers })
						})).json();
						if (data.ok && data.providers) {
							const list = normalizeList(data.providers);
							baseline.current = list;
							setProviders(list);
							setDirty(false);
							if (typeof data.hostVersion === "number") setHostVersion(data.hostVersion);
						}
						const warningText = data.warnings && data.warnings.length > 0 ? tr("；提示：{p1}", { p1: data.warnings.join("；") }) : "";
						setMsg(data.ok ? tr("已保存，并已同步到两份 .env（新会话生效）{p1}", { p1: warningText }) : tr("保存失败: ") + (data.error || ""));
					} catch {
						setMsg(tr("保存失败"));
					}
					setSaving(false);
				})();
			};
			const probe = (id) => {
				if (!providers) return;
				setProbing(true);
				setMsg("");
				(async () => {
					try {
						const data = await (await fetch("/dsh-img2img-config/probe", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(id ? { id } : {})
						})).json();
						if (data.providers) {
							const list = normalizeList(data.providers);
							baseline.current = list;
							setProviders(list);
						}
						(data.providers ?? []).filter((p) => p.status === "arrears");
						if (id) {
							const target = (data.providers ?? []).find((p) => p.id === id);
							setMsg(target ? tr("测试 {p1}：{p2}{p3}", {
								p1: target.name,
								p2: tr(STATUS_META[target.status].label),
								p3: target.detail ? ` · ${target.detail}` : ""
							}) : tr("测试失败: ") + (data.error || tr("通道不存在")));
						} else {
							const counts = {
								ok: 0,
								unknown: 0,
								error: 0,
								arrears: 0
							};
							for (const p of data.providers ?? []) if (p.status in counts) counts[p.status] += 1;
							setMsg(data.ok ? tr("探测完成：正常 {p1} · 未确认 {p2} · 失败 {p3}{p4}", {
								p1: counts.ok,
								p2: counts.unknown,
								p3: counts.error,
								p4: counts.arrears ? tr(" · 欠费已关停 {p1}", { p1: counts.arrears }) : ""
							}) : tr("探测失败: ") + (data.error || ""));
						}
					} catch {
						setMsg(tr("探测失败"));
					}
					setProbing(false);
				})();
			};
			/** 复制「固定走这个通道」的命令，方便交给 agent / 终端复现。 */
			const copyCommand = (id) => {
				const provider = providers?.find((item) => item.id === id);
				if (!provider) return;
				const providerId = providerIdOf(provider);
				const command = [
					"node \"scripts/generate_image.mjs\"",
					"--provider",
					providerId,
					...providerId === "direct" ? ["--direct-provider", String(provider.directProvider || "dashscope")] : [],
					"--prompt",
					tr("\"<提示词>\""),
					"--image",
					tr("\"<参考图.png>\""),
					"--size",
					"1:1"
				].join(" ");
				const clipboard = navigator.clipboard;
				if (!clipboard) {
					setMsg(command);
					return;
				}
				clipboard.writeText(command).then(() => setMsg(tr("已复制命令：{p1}", { p1: command }))).catch(() => setMsg(command));
			};
			/** 拖拽：卡片拖到卡片 = 插到该位置（跨组自动改级）；拖到组容器 = 改级并追加组尾 */
			const drag = {
				start: (e, id) => {
					dragId.current = id;
					e.dataTransfer.setData("text/plain", id);
					e.dataTransfer.effectAllowed = "move";
				},
				over: (e) => {
					e.preventDefault();
					e.dataTransfer.dropEffect = "move";
				},
				overGroup: (level) => setDragOverId(`group-${level}`),
				drop: (e, targetId) => {
					e.preventDefault();
					setDragOverId(null);
					const from = dragId.current;
					dragId.current = null;
					if (!from || from === targetId) return;
					setDirty(true);
					setProviders((list) => {
						if (!list) return list;
						const moving = list.find((p) => p.id === from);
						const target = list.find((p) => p.id === targetId);
						if (!moving || !target) return list;
						const moved = {
							...moving,
							level: target.level
						};
						const rest = list.filter((p) => p.id !== from);
						const index = rest.findIndex((p) => p.id === targetId);
						const next = [...rest];
						next.splice(index, 0, moved);
						return next;
					});
				},
				dropToGroup: (e, level) => {
					e.preventDefault();
					setDragOverId(null);
					const from = dragId.current;
					dragId.current = null;
					if (!from) return;
					setDirty(true);
					setProviders((list) => {
						if (!list) return list;
						const moving = list.find((p) => p.id === from);
						if (!moving) return list;
						const moved = {
							...moving,
							level
						};
						const rest = list.filter((p) => p.id !== from);
						const groupItems = rest.filter((p) => p.kind === moved.kind && p.level === level);
						const last = groupItems[groupItems.length - 1];
						const index = last !== void 0 ? rest.findIndex((p) => p.id === last.id) + 1 : rest.findIndex((p) => p.kind === moved.kind && p.level > level);
						const next = [...rest];
						next.splice(index < 0 ? next.length : index, 0, moved);
						return next;
					});
				},
				end: () => {
					dragId.current = null;
					setDragOverId(null);
				}
			};
			if (!providers) return (0, react.createElement)("div", { style: styles.loading }, msg || tr("加载中…"));
			const byLevel = (kind, level) => providers.filter((p) => p.kind === kind && p.level === level);
			const kindMeta = [{
				kind: "vision",
				title: tr("识图通道"),
				desc: tr("dsh-vision-skill 使用 · 主 → 备 → 兜底依次降级 · 欠费自动关停"),
				addLabel: tr("＋ 添加识图通道（选择供应商）")
			}, {
				kind: "gen",
				title: tr("生图通道"),
				desc: tr("img2img-studio 使用 · 保存后写入 GEN_PROVIDER_ORDER（脚本 providerId）决定 auto 链顺序"),
				addLabel: tr("＋ 添加生图通道（选择供应商）")
			}];
			const enabledCount = providers.filter((p) => p.enabled).length;
			const arrearsCount = providers.filter((p) => p.status === "arrears").length;
			const visionCount = providers.filter((p) => p.kind === "vision").length;
			const genCount = providers.filter((p) => p.kind === "gen").length;
			return (0, react.createElement)("div", {}, (0, react.createElement)("div", { style: styles.toolbar }, (0, react.createElement)("div", { style: styles.stats }, (0, react.createElement)("span", { style: styles.stat }, (0, react.createElement)("span", { style: {
				...styles.dot,
				background: "#4f8fd0"
			} }), tr("识图 {p1}", { p1: visionCount })), (0, react.createElement)("span", { style: styles.stat }, (0, react.createElement)("span", { style: {
				...styles.dot,
				background: "#8a6bd0"
			} }), tr("生图 {p1}", { p1: genCount })), (0, react.createElement)("span", { style: styles.stat }, (0, react.createElement)("span", { style: {
				...styles.dot,
				background: "#3a9b5a"
			} }), tr("启用 {p1}", { p1: enabledCount })), arrearsCount ? (0, react.createElement)("span", { style: styles.stat }, (0, react.createElement)("span", { style: {
				...styles.dot,
				background: "#d05050"
			} }), tr("欠费 {p1}", { p1: arrearsCount })) : null, dirty ? (0, react.createElement)("span", { style: styles.dirty }, tr("未保存")) : null), msg ? (0, react.createElement)("span", {
				style: styles.msg,
				title: msg
			}, msg) : null, (0, react.createElement)("button", {
				style: styles.btn,
				onClick: () => setPreviewOpen(true)
			}, tr("👁 预览 .env")), (0, react.createElement)("button", {
				style: styles.btn,
				disabled: probing,
				onClick: () => probe()
			}, probing ? tr("探测中…") : tr("🔍 探测全部余额")), (0, react.createElement)("button", {
				style: {
					...styles.btnPrimary,
					...hostOk ? {} : {
						opacity: .55,
						cursor: "not-allowed"
					}
				},
				disabled: saving || !hostOk,
				title: hostOk ? tr("保存并同步两份 .env") : tr("宿主插件未重载：先重启 DSH 宿主"),
				onClick: save
			}, saving ? tr("保存中…") : tr("保存配置"))), hostOk ? null : (0, react.createElement)("div", { style: styles.banner }, tr("宿主插件仍是旧版（浏览器端已更新）：新的 providerId 归一化 / .env 同步 / 保存校验都在宿主侧。"), tr("请重启 DSH 宿主后再保存；重启前可以点「预览 .env」查看计划，但「保存配置」已暂时禁用。")), kindMeta.map((km) => (0, react.createElement)("div", {
				key: km.kind,
				style: styles.section
			}, (0, react.createElement)("div", { style: styles.sectionHead }, (0, react.createElement)("div", { style: { minWidth: 0 } }, (0, react.createElement)("div", { style: styles.sectionTitle }, (0, react.createElement)("span", { style: {
				...styles.dot,
				background: km.kind === "vision" ? "#4f8fd0" : "#8a6bd0"
			} }), km.title), (0, react.createElement)("div", { style: styles.sectionSub }, km.desc)), (0, react.createElement)("div", { style: styles.sectionActions }, (0, react.createElement)("button", {
				style: styles.btnGhost,
				onClick: () => setAllOpen(km.kind, true)
			}, tr("展开全部")), (0, react.createElement)("button", {
				style: styles.btnGhost,
				onClick: () => setAllOpen(km.kind, false)
			}, tr("收起全部")))), (0, react.createElement)("div", { style: styles.sectionBody }, [
				1,
				2,
				3
			].map((lv) => (0, react.createElement)(LevelGroup, {
				key: lv,
				level: lv,
				items: byLevel(km.kind, lv),
				collapsed: isGroupCollapsed(km.kind, lv),
				onToggleCollapsed: () => toggleGroup(km.kind, lv),
				patch,
				remove,
				move,
				drag,
				dragOverId,
				isOpen,
				toggleOpen,
				onTest: (id) => probe(id),
				onTry: (id) => {
					const target = providers.find((p) => p.id === id);
					if (target) setTryTarget(target);
				},
				onCopyCommand: copyCommand
			})), (0, react.createElement)(AddCardButton, {
				label: km.addLabel,
				onClick: () => setPickerKind(km.kind)
			})))), (0, react.createElement)(UsagePanel, {
				isOpen: (id) => ui[`acc:${id}`] === true,
				toggleOpen: (id) => setUi((state) => ({
					...state,
					[`acc:${id}`]: state[`acc:${id}`] !== true
				})),
				expand: (id) => setUi((state) => ({
					...state,
					[`acc:${id}`]: true
				})),
				setAllOpen: (ids, next) => setUi((state) => {
					const copy = { ...state };
					for (const id of ids) if (next) copy[`acc:${id}`] = true;
					else delete copy[`acc:${id}`];
					return copy;
				}),
				onAccountsChanged: refreshAfterAccountChange
			}), (0, react.createElement)("div", { style: styles.footerHint }, tr("「保存配置」会把通道按等级/顺序换算成 .env：GEN_PROVIDER_ORDER 用脚本 providerId（重复供应商自动去重），") + tr("各 provider 的 key / model / base 写对应变量，识图侧写 VISION_PROVIDERS + 主通道的 VISION_API_KEY。") + tr("面板管过、后被删掉或停用的通道才会清 env；面板从没管过的 key 保持原值（手写配置不再被误删）。") + tr("「预览 .env」用与宿主完全相同的 planSync()；新配置在技能新会话生效。")), pickerKind ? (0, react.createElement)(ProviderPicker, {
				kind: pickerKind,
				providers,
				onClose: () => setPickerKind(null),
				onAdd: (entry, level) => {
					addChannel(entry, pickerKind, level);
					setPickerKind(null);
				}
			}) : null, previewOpen ? (0, react.createElement)(PreviewDialog, {
				providers,
				previous: baseline.current,
				hostOk,
				onClose: () => setPreviewOpen(false)
			}) : null, tryTarget ? (0, react.createElement)(TryDialog, {
				provider: tryTarget,
				onClose: () => setTryTarget(null)
			}) : null);
		}
		const PLAN_COLOR = {
			free: "#777",
			plus: "#3a9b5a",
			"5x": "#d08a2e",
			"20x": "#8a6bd0"
		};
		async function usageRequest(action) {
			try {
				return await (await fetch("/dsh-img2img-config/chatgpt-usage", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(action)
				})).json();
			} catch {
				return null;
			}
		}
		function fmtTime(ms) {
			return ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "";
		}
		function AccountRow({ a, tiers, open, onToggleOpen, onPatch, onAction, onProbe, onAuth, onCodexAuth }) {
			const [label, setLabel] = (0, react.useState)(a.label);
			const [limit, setLimit] = (0, react.useState)(a.limitOverridden ? String(a.limit) : "");
			const [token, setToken] = (0, react.useState)("");
			const [probing, setProbing] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				setLabel(a.label);
			}, [a.label]);
			(0, react.useEffect)(() => {
				setLimit(a.limitOverridden ? String(a.limit) : "");
			}, [a.limitOverridden, a.limit]);
			(0, react.useEffect)(() => {
				setProbing(false);
			}, [a.lastProbeAt, a.lastProbeError]);
			const exhausted = a.limitEnforced && a.used >= a.limit;
			const commitLimit = () => {
				const next = limit.trim() === "" ? null : Number(limit);
				if (next !== null && (!Number.isFinite(next) || next <= 0)) {
					setLimit(a.limitOverridden ? String(a.limit) : "");
					return;
				}
				if ((next ?? null) !== (a.limitOverridden ? a.limit : null)) onPatch({ limit: next });
			};
			const probe = () => {
				setProbing(true);
				onProbe();
			};
			const saveToken = () => {
				setProbing(true);
				onAuth(token.trim());
				setToken("");
			};
			const status = a.lastProbeError ? `❌ ${a.lastProbeError}` : a.lastProbeAt ? tr("✅ {p1} 探测 · 档位 {p2} · 扫过 {p3} 个会话", {
				p1: fmtTime(a.lastProbeAt),
				p2: a.detectedPlanType ?? "?",
				p3: a.scanned ?? 0
			}) + (a.generatedTimes.length ? tr(" · 出图: {p1}", { p1: a.generatedTimes.join(" / ") }) : tr(" · 窗口内无出图")) : a.hasToken ? tr("凭据已保存，点「探测」拉取额度") : tr("未填凭据");
			const cu = a.codexUsage;
			const hWin = (w) => w ? tr("{p1}%（{p2}h 窗口，重置 {p3}）", {
				p1: w.usedPercent,
				p2: Math.round(w.windowSeconds / 3600),
				p3: fmtTime(w.resetAt)
			}) : "";
			return (0, react.createElement)("div", { style: {
				...styles.card,
				margin: "6px 0"
			} }, (0, react.createElement)("div", {
				style: styles.cardHead,
				onClick: onToggleOpen
			}, (0, react.createElement)(Chevron, { open }), (0, react.createElement)("span", { style: {
				...styles.avatar,
				background: PLAN_COLOR[a.plan] + "cc"
			} }, a.label.trim().slice(0, 1).toUpperCase() || "G"), (0, react.createElement)("div", { style: styles.identity }, (0, react.createElement)("div", { style: styles.nameRow }, (0, react.createElement)("span", {
				style: styles.name,
				title: a.label
			}, a.label), (0, react.createElement)("span", { style: {
				...styles.statusTag,
				color: PLAN_COLOR[a.plan],
				background: PLAN_COLOR[a.plan] + "18"
			} }, tr(a.planLabel))), (0, react.createElement)("div", { style: styles.summaryRow }, (0, react.createElement)("span", { style: { color: exhausted ? "#d05050" : "var(--dsw-alias-label-tertiary, #888)" } }, a.limitEnforced ? tr("已用 {p1} / {p2} 张（{p3}h 滚动{p4}）", {
				p1: a.used,
				p2: a.limit,
				p3: a.windowHours,
				p4: a.autoProbe ? tr(" · 自动") : ""
			}) : tr("已用 {p1} 张（免费版不计额度）", { p1: a.used })), (0, react.createElement)("span", { style: styles.sep }, "·"), (0, react.createElement)("span", { style: { color: a.hasToken ? "#3a9b5a" : "#777" } }, a.hasToken ? a.codexAuth ? tr("Codex 登录态") : tr("凭据已保存") : tr("未填凭据")), a.lastProbeError ? (0, react.createElement)("span", { style: {
				...styles.statusTag,
				color: "#d05050",
				background: "#d0505018"
			} }, tr("探测失败")) : null)), a.email ? (0, react.createElement)("span", {
				style: {
					fontSize: 10.5,
					color: "var(--dsw-alias-label-tertiary, #888)",
					maxWidth: 160,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap"
				},
				title: a.email
			}, a.email) : null), open ? (0, react.createElement)("div", { style: styles.cardBody }, (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 8,
				flexWrap: "wrap"
			} }, (0, react.createElement)("input", {
				style: {
					...styles.input,
					width: 150,
					flexShrink: 0
				},
				value: label,
				title: tr("账号备注名（用于区分多个 ChatGPT 账号）"),
				onChange: (e) => setLabel(e.target.value),
				onBlur: () => {
					if (label.trim() && label.trim() !== a.label) onPatch({ label: label.trim() });
				}
			}), (0, react.createElement)("select", {
				style: {
					...styles.levelSelect,
					flexShrink: 0
				},
				value: a.plan,
				title: tr("账号套餐：免费 / Plus / 5x(Pro) / 20x(Business)"),
				onChange: (e) => onPatch({ plan: e.target.value })
			}, tiers.map((t) => (0, react.createElement)("option", {
				key: t.plan,
				value: t.plan
			}, tr(t.label)))), (0, react.createElement)("input", {
				style: {
					...styles.input,
					width: 92,
					flexShrink: 0
				},
				value: limit,
				placeholder: tr("额度 {p1}", { p1: tiers.find((t) => t.plan === a.plan)?.defaultLimit ?? "" }),
				title: tr("窗口额度上限（留空 = 跟随套餐默认值）"),
				onChange: (e) => setLimit(e.target.value),
				onBlur: commitLimit
			}), (0, react.createElement)("span", { style: {
				flex: 1,
				minWidth: 8
			} }), (0, react.createElement)("button", {
				style: styles.del,
				title: tr("删除该账号"),
				onClick: () => onAction("remove")
			}, "×")), (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 6
			} }, a.limitEnforced ? exhausted ? tr("⚠️ 已达到窗口额度，等待窗口刷新；用尽时会自动切换下一通道") : a.resetAt ? tr("下次重置：{p1}", { p1: a.resetAt }) : "" : tr("免费版只统计用量、不按本地额度卡；真正没额度时由调用方自动切换通道")), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 8,
				flexWrap: "wrap"
			} }, (0, react.createElement)("button", {
				style: styles.btnArrow,
				onClick: () => onAction("log")
			}, tr("登记 1 张")), (0, react.createElement)("button", {
				style: styles.btnArrow,
				onClick: () => onAction("reset")
			}, tr("重置窗口")), (0, react.createElement)("button", {
				style: {
					...styles.btnArrow,
					...a.autoProbe ? {
						borderColor: "var(--dsw-alias-button-info-fill, #4f6ef7)",
						color: "var(--dsw-alias-label-primary, #eee)"
					} : {}
				},
				title: tr("自动探测：用 ChatGPT 后端接口统计窗口内出图，代替手动登记"),
				onClick: () => onPatch({ autoProbe: !a.autoProbe })
			}, a.autoProbe ? tr("自动探测：开") : tr("自动探测：关"))), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 8,
				flexWrap: "wrap"
			} }, (0, react.createElement)("input", {
				style: {
					...styles.input,
					flex: 1,
					minWidth: 180
				},
				type: "password",
				value: token,
				placeholder: a.hasToken && !a.codexAuth ? tr("凭据已保存（粘贴新 token 可替换）") : tr("粘贴 __Secure-next-auth.session-token"),
				title: tr("ChatGPT 网页登录态：DevTools → Application → Cookies → __Secure-next-auth.session-token"),
				onChange: (e) => setToken(e.target.value)
			}), (0, react.createElement)("button", {
				style: styles.btnArrow,
				disabled: !token.trim(),
				onClick: saveToken
			}, tr("保存凭据")), (0, react.createElement)("button", {
				style: {
					...styles.btnArrow,
					...a.codexAuth ? {
						borderColor: "var(--dsw-alias-button-info-fill, #4f6ef7)",
						color: "var(--dsw-alias-label-primary, #eee)"
					} : {}
				},
				title: tr("直接读取运行中的 Codex 客户端登录态（~/.codex/auth.json），令牌由客户端自动刷新"),
				onClick: onCodexAuth
			}, a.codexAuth ? tr("Codex 登录态 ✓") : tr("读取 Codex 登录态")), a.hasToken ? (0, react.createElement)("button", {
				style: styles.btnArrow,
				onClick: () => onAuth("")
			}, tr("清除凭据")) : null), (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 6
			} }, tr("这个账号会自动投影成生图通道 chatgpt-web@…（在「生图通道」里显示）：改备注/套餐会同步通道名，登录态只存账号库一份；删账号会连带删通道。")), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 8,
				flexWrap: "wrap"
			} }, (0, react.createElement)("button", {
				style: styles.btn,
				disabled: probing || !a.hasToken,
				onClick: probe
			}, probing ? tr("探测中…") : tr("🔍 探测额度")), (0, react.createElement)("span", { style: {
				...styles.hint,
				flex: 1,
				minWidth: 180
			} }, status)), cu && (cu.primary || cu.secondary) ? (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 4
			} }, tr("Codex 用量（{p1}{p2}）", {
				p1: cu.planType ?? a.detectedPlanType ?? "?",
				p2: cu.email ? " · " + cu.email : ""
			}) + (cu.primary ? tr(" · 主窗口 {p1}", { p1: hWin(cu.primary) }) : "") + (cu.secondary ? tr(" · 周窗口 {p1}", { p1: hWin(cu.secondary) }) : "")) : null, (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 4
			} }, `${tr(a.planLabel)} · ${tr(a.rule)}` + (a.limitOverridden ? tr("（额度已手动覆盖）") : "") + (a.planSource === "manual" ? tr("（档位手动锁定）") : ""))) : null);
		}
		function UsagePanel({ isOpen, toggleOpen, expand, setAllOpen, onAccountsChanged }) {
			const [u, setU] = (0, react.useState)(null);
			const [msg, setMsg] = (0, react.useState)("");
			const [proxy, setProxy] = (0, react.useState)("");
			const refreshChannels = () => onAccountsChanged?.();
			(0, react.useEffect)(() => {
				(async () => {
					try {
						const s = await (await fetch("/dsh-img2img-config/chatgpt-usage")).json();
						setU(s);
						setProxy(s.proxy ?? "");
						const stale = s.accounts.filter((a) => a.autoProbe && a.hasToken && (!a.lastProbeAt || Date.now() - a.lastProbeAt > 300 * 1e3));
						for (const a of stale) {
							const next = await usageRequest({
								action: "probe",
								id: a.id
							});
							if (next?.accounts) setU(next);
						}
						if (stale.length) setMsg(tr("已自动探测 ") + stale.length + tr(" 个账号"));
					} catch {
						setU(null);
					}
				})();
			}, []);
			const apply = (next, ok) => {
				if (!next || !Array.isArray(next.accounts)) {
					setMsg(tr("操作失败"));
					return;
				}
				setU(next);
				if (typeof next.proxy === "string") setProxy(next.proxy);
				setMsg(ok);
			};
			const patch = (id, body) => {
				(async () => {
					apply(await usageRequest({
						action: "update",
						id,
						...body
					}), tr("已保存"));
					refreshChannels();
				})();
			};
			const action = (id, act) => {
				(async () => {
					const labels = {
						log: tr("已登记 1 张"),
						reset: tr("已重置窗口"),
						remove: tr("已删除账号")
					};
					apply(await usageRequest({
						action: act,
						id
					}), labels[act] ?? tr("完成"));
					if (act === "remove" || act === "auth") refreshChannels();
				})();
			};
			const probe = (id) => {
				(async () => apply(await usageRequest({
					action: "probe",
					id
				}), tr("探测完成")))();
			};
			const auth = (id, sessionToken) => {
				(async () => {
					apply(await usageRequest({
						action: "auth",
						id,
						sessionToken
					}), sessionToken ? tr("凭据已保存") : tr("凭据已清除"));
					refreshChannels();
				})();
			};
			const codexAuth = (id) => {
				(async () => {
					apply(await usageRequest({
						action: "authCodex",
						id
					}), tr("已读取 Codex 客户端登录态"));
					refreshChannels();
				})();
			};
			const add = () => {
				(async () => {
					const next = await usageRequest({
						action: "add",
						label: tr("ChatGPT 账号 {p1}", { p1: (u?.accounts.length ?? 0) + 1 }),
						plan: "free"
					});
					apply(next, tr("已添加账号"));
					const created = next?.accounts[next.accounts.length - 1];
					if (created) expand(created.id);
					refreshChannels();
				})();
			};
			const addCodex = () => {
				(async () => {
					const added = await usageRequest({
						action: "add",
						label: tr("Codex 客户端账号"),
						plan: "free"
					});
					if (!added?.accounts) {
						apply(added, tr("操作失败"));
						return;
					}
					const created = added.accounts[added.accounts.length - 1];
					apply(await usageRequest({
						action: "authCodex",
						id: created.id
					}), tr("已从 Codex 客户端添加账号"));
					expand(created.id);
					refreshChannels();
				})();
			};
			const saveProxy = () => {
				(async () => apply(await usageRequest({
					action: "settings",
					proxy
				}), tr("代理已保存")))();
			};
			if (!u) return null;
			const tiers = u.tiers ?? [];
			const totalUsed = u.accounts.reduce((sum, a) => sum + a.used, 0);
			return (0, react.createElement)("div", { style: styles.section }, (0, react.createElement)("div", { style: styles.sectionHead }, (0, react.createElement)("div", { style: { minWidth: 0 } }, (0, react.createElement)("div", { style: styles.sectionTitle }, (0, react.createElement)("span", { style: {
				...styles.dot,
				background: "#3a9b5a"
			} }), tr("ChatGPT 网页出图账号"), (0, react.createElement)("span", { style: styles.groupCount }, tr("{p1} 个账号", { p1: u.accounts.length }))), (0, react.createElement)("div", { style: styles.sectionSub }, tr("多账号额度库 · 24h 滚动窗口 · 窗口内已出图 {p1} 张 · 点账号展开凭据与额度设置", { p1: totalUsed }))), (0, react.createElement)("div", { style: styles.sectionActions }, (0, react.createElement)("button", {
				style: styles.btnGhost,
				onClick: () => setAllOpen(u.accounts.map((a) => a.id), true)
			}, tr("展开全部")), (0, react.createElement)("button", {
				style: styles.btnGhost,
				onClick: () => setAllOpen(u.accounts.map((a) => a.id), false)
			}, tr("收起全部")))), (0, react.createElement)("div", { style: styles.sectionBody }, u.accounts.length === 0 ? (0, react.createElement)("div", { style: styles.groupEmpty }, tr("还没有账号，点下方添加")) : u.accounts.map((a) => (0, react.createElement)(AccountRow, {
				key: a.id,
				a,
				tiers,
				open: isOpen(a.id),
				onToggleOpen: () => toggleOpen(a.id),
				onPatch: (body) => patch(a.id, body),
				onAction: (act) => action(a.id, act),
				onProbe: () => probe(a.id),
				onAuth: (token) => auth(a.id, token),
				onCodexAuth: () => codexAuth(a.id)
			})), (0, react.createElement)("div", { style: {
				display: "flex",
				gap: 8,
				marginTop: 4,
				flexWrap: "wrap"
			} }, (0, react.createElement)(AddCardButton, {
				label: tr("＋ 添加 ChatGPT 账号"),
				onClick: add,
				block: false
			}), (0, react.createElement)(AddCardButton, {
				label: tr("＋ 从 Codex 客户端添加账号"),
				onClick: addCodex,
				block: false
			})), msg ? (0, react.createElement)("span", { style: {
				...styles.msg,
				display: "block",
				marginTop: 6
			} }, msg) : null, (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 10,
				flexWrap: "wrap"
			} }, (0, react.createElement)("input", {
				style: {
					...styles.input,
					width: 220
				},
				value: proxy,
				placeholder: u.proxyEffective ? tr("自动：{p1}", { p1: u.proxyEffective }) : tr("留空 = 自动读系统代理"),
				title: tr("ChatGPT 探测用代理（Node 不读系统代理，留空则自动读取 Windows 系统代理）"),
				onChange: (e) => setProxy(e.target.value)
			}), (0, react.createElement)("button", {
				style: styles.btnArrow,
				onClick: saveProxy
			}, tr("保存代理")), (0, react.createElement)("span", { style: {
				...styles.hint,
				marginLeft: 2
			} }, u.proxyEffective ? tr("当前生效：{p1}", { p1: u.proxyEffective }) : tr("当前直连（若探测报 fetch 失败，请填代理）"))), (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 6
			} }, tr("套餐默认额度：") + tiers.map((t) => `${tr(t.label)} ${t.defaultLimit}`).join(" / ") + tr("（24h 滚动窗口，可在每行展开后直接改数字；自动探测按 ChatGPT 后端返回的实际出图时刻统计）"))));
		}
		/**
		* Register the Settings → 「识图与生图」 section.
		* @param ctx - client root context (the same one the editor dock receives).
		*/
		function registerConfigPanel(ctx) {
			ctx.effect(() => {
				ctx.locale.register(NS$1, {
					zh,
					en
				});
				const t = ctx.locale.bind(NS$1);
				setTranslator((key, params) => t(key, params));
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "img2img-config",
					order: 60,
					label: () => t("识图与生图"),
					locale: NS$1,
					inject: () => ({ t })
				}, () => (0, react.createElement)(ConfigPanel)));
			}, "dsh-img2img-config: settings section");
		}
		//#endregion
		//#region src/client/index.tsx
		/** Locale namespace owned by the composer dock entry. */
		const NS = "img2imgEditor";
		/** Services required by the dock entry, its copy, and the settings panel. */
		const inject = ["slots", "locale"];
		/** Runtime guard: only image drafts carry a preview URL and a browser File. */
		function asImageDraft(candidate) {
			const value = candidate;
			if (typeof value.previewUrl !== "string") return void 0;
			if (!(value.file instanceof File)) return void 0;
			return value;
		}
		/**
		* Register the editor dock, its copy, and the brief codec source.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh: zh$1,
				en: en$1
			}), "dsh-img2img-config: dictionaries");
			const t = ctx.locale.bind(NS);
			const conversation = () => ctx.get("conversation");
			ctx.inject(["inputTriggers"], (scope) => {
				const service = scope.get("inputTriggers");
				if (service === void 0) return;
				scope.effect(() => service.registerSource(briefSource()), "dsh-img2img-config: brief codec source");
			});
			const editor = {
				resolveImages(sessionId, ids) {
					const face = conversation();
					if (face === void 0 || ids.length === 0) return [];
					try {
						const images = [];
						for (const item of face.resolveDraftAttachments(ids)) {
							if (item.kind !== "image") continue;
							const image = asImageDraft(item);
							if (image !== void 0) images.push(image);
						}
						return images;
					} catch (error) {
						console.warn("[dsh-img2img-config] resolve draft attachments failed:", error);
						return [];
					}
				},
				stageFiles(sessionId, files) {
					const face = conversation();
					if (face === void 0) return [];
					try {
						return face.createDrafts(sessionId, files).map((draft) => draft.id);
					} catch (error) {
						console.warn("[dsh-img2img-config] staging edited drafts failed:", error);
						return [];
					}
				},
				releaseDrafts(ids) {
					const face = conversation();
					if (face === void 0) return;
					for (const id of ids) try {
						face.releaseDraftAttachment(id);
					} catch (error) {
						console.warn("[dsh-img2img-config] releasing a rejected draft failed:", error);
					}
				},
				insertBrief(sessionId, insert) {
					return insertBriefChip(ctx, sessionId, insert);
				}
			};
			ctx.effect(() => ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "img2img-editor",
				order: 20,
				locale: NS,
				inject: () => ({
					editor,
					t
				})
			}, EditorDock)), "dsh-img2img-config: composer dock entry");
			registerConfigPanel(ctx);
		}
		/**
		* Insert the brief as one composer chip.
		* @param ctx - client root context.
		* @param sessionId - session whose composer receives the chip.
		* @param insert - chip label, payload, and the revision the insertion is guarded by.
		* @returns whether the chip was inserted.
		*/
		function insertBriefChip(ctx, sessionId, insert) {
			const sessions = ctx.get("sessions");
			const resolver = ctx.get("conversation")?.input;
			if (sessions === void 0 || resolver === void 0) return false;
			try {
				const actx = sessions.scope(sessionId);
				if (actx === void 0) return false;
				return resolver.for(actx).insertReference({
					source: SOURCE_NAME,
					ref: insert.payload,
					label: insert.label,
					appearance: "file",
					clipboardText: insert.clipboardText
				}, {
					start: 0,
					end: 0,
					draftRev: insert.draftRev
				});
			} catch (error) {
				console.warn("[dsh-img2img-config] brief chip insertion failed:", error);
				return false;
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map