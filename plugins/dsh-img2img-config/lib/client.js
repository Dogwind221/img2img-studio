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
			(0, react.useEffect)(() => {
				const target = previewRef.current;
				if (base === null || target === null) return;
				const ctx = context2d(target);
				ctx.clearRect(0, 0, target.width, target.height);
				ctx.drawImage(base, 0, 0, target.width, target.height);
				if (strokes.length > 0) ctx.drawImage(renderMask(strokes, target.width, target.height, "overlay"), 0, 0);
				paintMarkers(ctx, markers, target.width, target.height, activeId ?? void 0);
			}, [
				base,
				markers,
				strokes,
				activeId
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
											markers.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: hintStyle$1,
												children: t("editor.markerEmpty")
											}),
											[...markers].sort((a, b) => a.id - b.id).map((marker) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													flexDirection: "column",
													gap: 4
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
				})) inputActions.setDraft(mergeDraft(draft, buildBrief(result.manifest, {
					legend,
					carrier: "draft"
				})));
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
		const zh = {
			"dock.title": "图片编辑",
			"dock.edit": "标记·编辑",
			"dock.hint": "点缩略图打开编辑器：加编号标记 / 移除背景 / 涂抹擦除 / 调整大小",
			"dock.done": "已放回输入框：编辑图 + 清单附件 + 一个说明胶囊，发送即可出图",
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
			"editor.sizeHint": "改尺寸会同时缩放标记与涂抹区域；生图常用 1:1 / 3:4 / 16:9。",
			"brief.title": "图片编辑",
			"brief.markers": "处标记",
			"brief.strokes": "笔涂抹",
			"brief.bg": "移除背景",
			"brief.plain": "仅底图",
			"brief.manifest": "img2img-manifest.json：机器可读清单（标记坐标 / 尺寸 / 涂抹 / 文件清单），结构化字段以它为准"
		};
		/** English dictionary. */
		const en = {
			"dock.title": "Image editor",
			"dock.edit": "Mark & edit",
			"dock.hint": "Open the editor: numbered markers / background removal / brush erase / resize",
			"dock.done": "Sent back to the composer: edited image + manifest attachment + one brief chip. Press send to generate.",
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
			"editor.sizeHint": "Resizing scales markers and brushed areas too; 1:1 / 3:4 / 16:9 are the usual generation frames.",
			"brief.title": "Image edit",
			"brief.markers": "markers",
			"brief.strokes": "strokes",
			"brief.bg": "background removal",
			"brief.plain": "base image only",
			"brief.manifest": "img2img-manifest.json: machine-readable manifest (marker coordinates / size / strokes / file list); structured fields follow it"
		};
		//#endregion
		//#region src/client/config-panel.tsx
		/**
		* dsh-img2img-config client — Settings → 「识图与生图」 panel:
		* 多 API 供应商管理：三级优先级（主/备/兜底）、手动开关、拖拽排序
		* （拖把手/跨组自动改级/↑↓按钮）、模型链完整展示 + 常用模型快捷选择、
		* 余额探测（欠费自动关停）、ChatGPT 网页账号库与额度窗口。
		*
		* 本文件是同一个 client bundle 里的第二个 UI 面，由 `./index.tsx` 一并 apply；
		* 它不单独作为 __ModuleLoader__ 入口，所以不导出 name / inject。
		*/
		/** Locale namespace owned by the settings panel. */
		const NS$1 = "dsh-img2img-config";
		const LEVEL_META = {
			1: {
				title: "一级 · 主通道",
				color: "#3a9b5a",
				desc: "优先使用，模型链依次降级"
			},
			2: {
				title: "二级 · 备用",
				color: "#d08a2e",
				desc: "主通道失败后自动切换"
			},
			3: {
				title: "三级 · 兜底",
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
				label: "CLI 无需探测"
			}
		};
		/** 常用模型快捷选择（点击追加到模型链末尾） */
		const COMMON_MODELS = {
			vision: [
				"qwen3.8-max",
				"qwen3.7-plus",
				"qwen3.7-flash",
				"qwen3.6-plus",
				"qwen-vl-max",
				"qwen-vl-plus",
				"glm-4v-plus",
				"Qwen3.8-Max",
				"gpt-4o"
			],
			gen: [
				"qwen-image-3.0-pro",
				"qwen-image-3.0",
				"wan2.7-image-pro",
				"gpt-image-2",
				"glm-image",
				"doubao-seedream-5-0-260128",
				"image-01",
				"Qwen3.8-Max"
			]
		};
		const TEMPLATES = [
			{
				id: "dashscope",
				name: "DashScope 通义千问（识图/生图）",
				kind: "vision",
				level: 1,
				enabled: true,
				apiKey: "",
				model: "qwen3.8-max,qwen3.7-plus,qwen3.7-flash,qwen3.6-plus,qwen-vl-max,qwen-vl-plus",
				base: "https://dashscope.aliyuncs.com/compatible-mode/v1"
			},
			{
				id: "qoder-cli",
				name: "Qoder CLI（识图/生图，无需 key）",
				kind: "vision",
				level: 2,
				enabled: true,
				apiKey: "",
				model: "Qwen3.8-Max",
				base: "qoderclicn"
			},
			{
				id: "openai",
				name: "OpenAI 兼容中转",
				kind: "vision",
				level: 3,
				enabled: false,
				apiKey: "",
				model: "gpt-4o",
				base: ""
			},
			{
				id: "zai",
				name: "Z.AI GLM（识图）",
				kind: "vision",
				level: 3,
				enabled: false,
				apiKey: "",
				model: "glm-4v-plus",
				base: "https://open.bigmodel.cn/api/paas/v4"
			},
			{
				id: "seedream",
				name: "Seedream 豆包（生图）",
				kind: "gen",
				level: 2,
				enabled: false,
				apiKey: "",
				model: "doubao-seedream-5-0-260128",
				base: "https://ark.cn-beijing.volces.com/api/v3"
			},
			{
				id: "minimax",
				name: "MiniMax 海螺（生图）",
				kind: "gen",
				level: 3,
				enabled: false,
				apiKey: "",
				model: "image-01",
				base: "https://api.minimaxi.com/v1"
			},
			{
				id: "qoder-gen",
				name: "Qoder CLI ImageGen（生图）",
				kind: "gen",
				level: 2,
				enabled: true,
				apiKey: "",
				model: "Qwen3.8-Max",
				base: "qoderclicn"
			}
		];
		const styles = {
			card: {
				background: "var(--surface-1, #1e1e1e)",
				border: "1px solid var(--border, #333)",
				borderRadius: 8,
				padding: 16,
				marginBottom: 16
			},
			title: {
				fontSize: 14,
				fontWeight: 600,
				marginBottom: 4,
				color: "var(--text-1, #eee)"
			},
			sub: {
				fontSize: 11,
				color: "var(--text-3, #777)",
				marginBottom: 12
			},
			group: {
				border: "1px solid var(--border, #333)",
				borderRadius: 8,
				marginBottom: 10,
				overflow: "hidden"
			},
			groupHead: {
				padding: "6px 12px",
				fontSize: 12,
				fontWeight: 600,
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center"
			},
			row: {
				padding: "8px 12px",
				borderTop: "1px solid var(--border, #2a2a2a)",
				background: "var(--surface-2, #181818)"
			},
			rowTop: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				flexWrap: "nowrap"
			},
			rowFields: {
				display: "flex",
				gap: 10,
				marginTop: 8,
				alignItems: "flex-start",
				flexWrap: "wrap"
			},
			rowDragOver: {
				outline: "1px dashed var(--accent, #4f6ef7)",
				outlineOffset: -1
			},
			handle: {
				color: "#666",
				fontSize: 14,
				cursor: "grab",
				flexShrink: 0,
				userSelect: "none",
				padding: "0 2px"
			},
			toggle: {
				width: 34,
				height: 18,
				borderRadius: 9,
				border: "none",
				cursor: "pointer",
				position: "relative",
				flexShrink: 0
			},
			toggleOn: { background: "#3a9b5a" },
			toggleOff: { background: "#444" },
			knob: {
				position: "absolute",
				top: 2,
				width: 14,
				height: 14,
				borderRadius: 7,
				background: "#fff"
			},
			dot: {
				width: 9,
				height: 9,
				borderRadius: 5,
				flexShrink: 0
			},
			name: {
				fontSize: 12,
				fontWeight: 600,
				color: "var(--text-1, #eee)",
				minWidth: 130,
				maxWidth: 130,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			field: {
				display: "flex",
				flexDirection: "column",
				flex: 1,
				minWidth: 70
			},
			fieldLabel: {
				fontSize: 10,
				color: "var(--text-3, #888)",
				marginBottom: 2
			},
			input: {
				padding: "4px 8px",
				borderRadius: 5,
				border: "1px solid var(--border, #444)",
				background: "var(--surface-3, #141414)",
				color: "var(--text-1, #eee)",
				fontSize: 12,
				width: "100%",
				boxSizing: "border-box"
			},
			textarea: {
				padding: "4px 8px",
				borderRadius: 5,
				border: "1px solid var(--border, #444)",
				background: "var(--surface-3, #141414)",
				color: "var(--text-1, #eee)",
				fontSize: 12,
				width: "100%",
				boxSizing: "border-box",
				resize: "vertical",
				minHeight: 44,
				lineHeight: 1.5,
				fontFamily: "inherit"
			},
			chips: {
				display: "flex",
				flexWrap: "wrap",
				gap: 4,
				marginTop: 4
			},
			chip: {
				padding: "1px 7px",
				borderRadius: 9,
				border: "1px solid var(--border, #444)",
				background: "var(--surface-3, #141414)",
				color: "var(--text-2, #aaa)",
				fontSize: 10,
				cursor: "pointer"
			},
			chipInput: {
				padding: "2px 8px",
				borderRadius: 10,
				border: "1px dashed var(--border, #555)",
				background: "var(--surface-3, #141414)",
				color: "var(--text-1, #eee)",
				fontSize: 11,
				width: 150,
				boxSizing: "border-box",
				outline: "none"
			},
			select: {
				padding: "4px 6px",
				borderRadius: 5,
				border: "1px solid var(--border, #444)",
				background: "var(--surface-3, #141414)",
				color: "var(--text-1, #eee)",
				fontSize: 12
			},
			arrow: {
				border: "none",
				background: "transparent",
				color: "var(--text-2, #999)",
				cursor: "pointer",
				fontSize: 12,
				padding: "0 3px",
				flexShrink: 0
			},
			del: {
				border: "none",
				background: "transparent",
				color: "#d05050",
				cursor: "pointer",
				fontSize: 14,
				flexShrink: 0
			},
			addBtn: {
				padding: "5px 12px",
				borderRadius: 6,
				border: "1px dashed var(--border, #555)",
				background: "transparent",
				color: "var(--text-2, #aaa)",
				cursor: "pointer",
				fontSize: 12,
				marginRight: 8
			},
			save: {
				padding: "7px 18px",
				borderRadius: 6,
				border: "none",
				background: "var(--accent, #4f6ef7)",
				color: "#fff",
				cursor: "pointer",
				fontSize: 13
			},
			probe: {
				padding: "7px 14px",
				borderRadius: 6,
				border: "none",
				background: "var(--surface-2, #333)",
				color: "var(--text-1, #eee)",
				cursor: "pointer",
				fontSize: 13,
				marginRight: 8
			},
			msg: {
				fontSize: 12,
				marginLeft: 10,
				color: "var(--text-2, #aaa)"
			},
			hint: {
				fontSize: 11,
				color: "var(--text-3, #777)",
				marginTop: 8
			}
		};
		function Toggle({ on, onChange }) {
			return (0, react.createElement)("button", {
				style: {
					...styles.toggle,
					...on ? styles.toggleOn : styles.toggleOff
				},
				title: on ? "点击关闭（停用该通道）" : "点击开启",
				onClick: () => onChange(!on)
			}, (0, react.createElement)("span", { style: {
				...styles.knob,
				left: on ? 18 : 2
			} }));
		}
		/** 模型链模块化编辑：已录入模型显示为 chips（× 删除），输入框回车添加，常用模型快捷追加 */
		function ModelChips({ value, kind, onChange }) {
			const [draft, setDraft] = (0, react.useState)("");
			const list = value.split(",").map((s) => s.trim()).filter(Boolean);
			const commit = (next) => onChange(next.join(","));
			const addDraft = () => {
				const m = draft.trim();
				if (m && !list.includes(m)) commit([...list, m]);
				setDraft("");
			};
			const chipStyle = {
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "2px 6px 2px 9px",
				borderRadius: 10,
				border: "1px solid var(--border, #444)",
				background: "var(--surface-3, #141414)",
				color: "var(--text-1, #ddd)",
				fontSize: 11
			};
			return (0, react.createElement)("div", { style: styles.field }, (0, react.createElement)("span", { style: styles.fieldLabel }, `模型链（${list.length} 个，点击 × 删除，输入后回车添加）`), (0, react.createElement)("div", { style: {
				...styles.chips,
				alignItems: "center"
			} }, list.map((m) => (0, react.createElement)("span", {
				key: m,
				style: chipStyle
			}, m, (0, react.createElement)("button", {
				style: {
					border: "none",
					background: "transparent",
					color: "#d05050",
					cursor: "pointer",
					fontSize: 12,
					padding: 0,
					lineHeight: 1
				},
				title: `删除 ${m}`,
				onClick: () => commit(list.filter((x) => x !== m))
			}, "×"))), (0, react.createElement)("input", {
				style: {
					...styles.chipInput,
					...draft ? { borderColor: "var(--accent, #4f6ef7)" } : {}
				},
				value: draft,
				placeholder: "+ 输入模型名，回车添加",
				onChange: (e) => setDraft(e.target.value),
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						addDraft();
					}
				},
				onBlur: addDraft
			})), (0, react.createElement)("div", { style: styles.chips }, COMMON_MODELS[kind].map((m) => (0, react.createElement)("span", {
				key: m,
				style: {
					...styles.chip,
					...list.includes(m) ? {
						opacity: .4,
						cursor: "default"
					} : {}
				},
				title: list.includes(m) ? "已在链中" : "点击追加到模型链",
				onClick: () => {
					if (!list.includes(m)) commit([...list, m]);
				}
			}, `+ ${m}`))));
		}
		function Row({ p, onPatch, onDelete, onMove, onDragStart, onDragOver, onDragEnd, onDrop, isDragOver }) {
			const st = STATUS_META[p.status];
			return (0, react.createElement)("div", {
				style: {
					...styles.row,
					...isDragOver ? styles.rowDragOver : {}
				},
				draggable: true,
				title: "整行可拖动：同级内排序；拖到其他等级组自动改级",
				onDragStart,
				onDragOver,
				onDrop,
				onDragEnd
			}, (0, react.createElement)("div", { style: styles.rowTop }, (0, react.createElement)("span", {
				style: styles.handle,
				title: "拖动把手"
			}, "⋮⋮"), (0, react.createElement)(Toggle, {
				on: p.enabled,
				onChange: (v) => onPatch({ enabled: v })
			}), (0, react.createElement)("span", {
				style: styles.dot,
				background: st.dot,
				title: st.label
			}), (0, react.createElement)("span", {
				style: styles.name,
				title: p.name
			}, p.name), (0, react.createElement)("select", {
				style: styles.select,
				value: String(p.level),
				title: "优先级等级（1主/2备/3兜底）",
				onChange: (e) => onPatch({ level: Number(e.target.value) })
			}, [
				1,
				2,
				3
			].map((lv) => (0, react.createElement)("option", {
				key: lv,
				value: String(lv)
			}, `${lv} 级`))), (0, react.createElement)("button", {
				style: styles.arrow,
				title: "上移一位（可跨级）",
				onClick: () => onMove(-1)
			}, "▲"), (0, react.createElement)("button", {
				style: styles.arrow,
				title: "下移一位（可跨级）",
				onClick: () => onMove(1)
			}, "▼"), (0, react.createElement)("button", {
				style: styles.del,
				title: "删除该通道",
				onClick: onDelete
			}, "✕")), (0, react.createElement)("div", { style: styles.rowFields }, (0, react.createElement)("div", { style: {
				...styles.field,
				flex: 1,
				minWidth: 140
			} }, (0, react.createElement)("span", { style: styles.fieldLabel }, "Key"), (0, react.createElement)("input", {
				style: styles.input,
				type: "password",
				value: p.apiKey,
				placeholder: p.apiKey ? "" : "未配置",
				onChange: (e) => onPatch({ apiKey: e.target.value })
			})), (0, react.createElement)("div", { style: {
				...styles.field,
				flex: 2,
				minWidth: 220
			} }, (0, react.createElement)(ModelChips, {
				value: p.model,
				kind: p.kind,
				onChange: (v) => onPatch({ model: v })
			})), (0, react.createElement)("div", { style: {
				...styles.field,
				flex: 1,
				minWidth: 140
			} }, (0, react.createElement)("span", { style: styles.fieldLabel }, "Base URL"), (0, react.createElement)("input", {
				style: styles.input,
				value: p.base,
				placeholder: "qoderclicn = Qoder CLI",
				onChange: (e) => onPatch({ base: e.target.value })
			}))));
		}
		function Group({ level, items, patch, remove, move, drag, dragOverId }) {
			const meta = LEVEL_META[level];
			return (0, react.createElement)("div", {
				style: {
					...styles.group,
					...dragOverId === `group-${level}` ? styles.rowDragOver : {}
				},
				onDragOver: (e) => {
					drag.over(e);
					drag.overGroup(level);
				},
				onDrop: (e) => drag.dropToGroup(e, level)
			}, (0, react.createElement)("div", { style: {
				...styles.groupHead,
				background: meta.color + "22",
				color: meta.color
			} }, (0, react.createElement)("span", {}, meta.title), (0, react.createElement)("span", { style: {
				fontWeight: 400,
				fontSize: 11
			} }, meta.desc)), items.length === 0 ? (0, react.createElement)("div", { style: {
				padding: "10px 12px",
				fontSize: 12,
				color: "#666"
			} }, "（空，可把其他等级的行拖到这里自动改级，或点下方添加）") : items.map((p) => (0, react.createElement)(Row, {
				key: p.id,
				p,
				onPatch: (patchPart) => patch(p.id, patchPart),
				onDelete: () => remove(p.id),
				onMove: (dir) => move(p.id, dir),
				onDragStart: (e) => drag.start(e, p.id),
				onDragOver: (e) => drag.over(e),
				onDragEnd: drag.end,
				onDrop: (e) => drag.drop(e, p.id),
				isDragOver: dragOverId === p.id
			})));
		}
		function ConfigPanel() {
			const [providers, setProviders] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [probing, setProbing] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)("");
			const [dragOverId, setDragOverId] = (0, react.useState)(null);
			const dragId = (0, react.useRef)(null);
			const load = () => {
				(async () => {
					try {
						setProviders((await (await fetch("/dsh-img2img-config/providers")).json()).providers);
					} catch {
						setMsg("加载配置失败");
					}
				})();
			};
			(0, react.useEffect)(() => {
				load();
			}, []);
			const patch = (id, part) => setProviders((list) => list ? list.map((p) => p.id === id ? {
				...p,
				...part
			} : p) : list);
			const remove = (id) => setProviders((list) => list ? list.filter((p) => p.id !== id) : list);
			/** 同组内上移/下移 */
			const move = (id, dir) => setProviders((list) => {
				if (!list) return list;
				const idx = list.findIndex((p) => p.id === id);
				if (idx < 0) return list;
				const item = list[idx];
				const target = idx + dir;
				if (target < 0 || target >= list.length) return list;
				const next = [...list];
				const neighbor = next[target];
				next[idx] = neighbor;
				next[target] = {
					...item,
					level: neighbor.level
				};
				return next;
			});
			const add = (kind) => {
				setProviders((list) => {
					const base = list ?? [];
					const tpl = TEMPLATES.find((t) => t.kind === kind && !base.some((p) => p.id === t.id));
					if (!tpl) {
						setMsg("该类模板已全部添加，可直接修改现有行或复制一行");
						return base;
					}
					return [...base, {
						...tpl,
						id: tpl.id + "-" + Date.now().toString(36),
						status: "unknown",
						lastChecked: null
					}];
				});
			};
			const save = () => {
				if (!providers) return;
				setSaving(true);
				setMsg("");
				(async () => {
					try {
						const d = await (await fetch("/dsh-img2img-config/providers", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ providers })
						})).json();
						if (d.ok && d.providers) setProviders(d.providers);
						setMsg(d.ok ? "已保存，并已同步到 skill 的 .env（新会话生效）" : "保存失败: " + (d.error || ""));
					} catch {
						setMsg("保存失败");
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
						const d = await (await fetch("/dsh-img2img-config/probe", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(id ? { id } : {})
						})).json();
						if (d.providers) setProviders(d.providers);
						const arrears = (d.providers ?? []).filter((p) => p.status === "arrears");
						setMsg(d.ok ? arrears.length ? `探测完成：${arrears.length} 个通道欠费/额度耗尽，已自动关停（可手动重新开启）` : "探测完成，全部正常" : "探测失败: " + (d.error || ""));
					} catch {
						setMsg("探测失败");
					}
					setProbing(false);
				})();
			};
			/** 拖拽：整行可拖；drop 到行 = 插到该行位置（跨组自动改级）；drop 到组容器 = 改级并追加组尾 */
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
					setProviders((list) => {
						if (!list) return list;
						const a = list.find((p) => p.id === from);
						const b = list.find((p) => p.id === targetId);
						if (!a || !b) return list;
						const moved = {
							...a,
							level: b.level
						};
						const rest = list.filter((p) => p.id !== from);
						const ti = rest.findIndex((p) => p.id === targetId);
						const next = [...rest];
						next.splice(ti, 0, moved);
						return next;
					});
				},
				dropToGroup: (e, level) => {
					e.preventDefault();
					setDragOverId(null);
					const from = dragId.current;
					dragId.current = null;
					if (!from) return;
					setProviders((list) => {
						if (!list) return list;
						const a = list.find((p) => p.id === from);
						if (!a) return list;
						const moved = {
							...a,
							level
						};
						const rest = list.filter((p) => p.id !== from);
						const groupItems = rest.filter((p) => p.kind === moved.kind && p.level === level);
						const ti = groupItems.length ? rest.findIndex((p) => p.id === groupItems[groupItems.length - 1].id) + 1 : rest.findIndex((p) => p.kind === moved.kind && p.level > level);
						const next = [...rest];
						const insertAt = ti < 0 ? next.length : ti;
						next.splice(insertAt, 0, moved);
						return next;
					});
				},
				end: () => {
					dragId.current = null;
					setDragOverId(null);
				}
			};
			if (!providers) return (0, react.createElement)("div", { style: styles.msg }, "加载中…");
			const byLevel = (kind, level) => providers.filter((p) => p.kind === kind && p.level === level);
			return (0, react.createElement)("div", {}, [{
				kind: "vision",
				title: "识图通道（dsh-vision-skill）",
				desc: "主→备→兜底依次尝试；拖把手或 ▲▼ 调整顺序，拖到其他等级组自动改级；欠费自动关停",
				addLabel: "+ 添加识图通道"
			}, {
				kind: "gen",
				title: "生图通道（img2img-studio）",
				desc: "同样支持开关/等级/排序；Qoder CLI 无需 key；保存后写入 GEN_PROVIDER_ORDER 决定 auto 链顺序",
				addLabel: "+ 添加生图通道"
			}].map((km) => (0, react.createElement)("div", {
				key: km.kind,
				style: styles.card
			}, (0, react.createElement)("div", { style: styles.title }, km.title), (0, react.createElement)("div", { style: styles.sub }, km.desc), [
				1,
				2,
				3
			].map((lv) => (0, react.createElement)(Group, {
				key: lv,
				level: lv,
				items: byLevel(km.kind, lv),
				patch,
				remove,
				move,
				drag,
				dragOverId
			})), (0, react.createElement)("button", {
				style: styles.addBtn,
				onClick: () => add(km.kind)
			}, km.addLabel))), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				marginBottom: 12
			} }, (0, react.createElement)("button", {
				style: styles.probe,
				disabled: probing,
				onClick: () => probe()
			}, probing ? "探测中…" : "🔍 探测全部余额（欠费自动关停）"), (0, react.createElement)("button", {
				style: styles.save,
				disabled: saving,
				onClick: save
			}, saving ? "保存中…" : "保存配置"), msg ? (0, react.createElement)("span", { style: styles.msg }, msg) : null), (0, react.createElement)(UsagePanel, null), (0, react.createElement)("div", { style: styles.hint }, "提示：保存后自动同步 .env（VISION_PROVIDERS / 各 API key / GEN_PROVIDER_ORDER），新会话生效；「一级」的首个通道为默认主通道（VISION_API_KEY）；探测用 GET /models 识别欠费错误码（Arrearage / quota exhausted / insufficient balance）。"));
		}
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
		function AccountRow({ a, tiers, onPatch, onAction, onProbe, onAuth, onCodexAuth }) {
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
			const status = a.lastProbeError ? `❌ ${a.lastProbeError}` : a.lastProbeAt ? `✅ ${fmtTime(a.lastProbeAt)} 探测 · 档位 ${a.detectedPlanType ?? "?"} · 扫过 ${a.scanned ?? 0} 个会话` + (a.generatedTimes.length ? ` · 出图: ${a.generatedTimes.join(" / ")}` : " · 窗口内无出图") : a.hasToken ? "凭据已保存，点「探测」拉取额度" : "未填凭据";
			const cu = a.codexUsage;
			const hWin = (w) => w ? `${w.usedPercent}%（${Math.round(w.windowSeconds / 3600)}h 窗口，重置 ${fmtTime(w.resetAt)}）` : "";
			return (0, react.createElement)("div", { style: {
				...styles.row,
				borderTop: "1px solid var(--border, #2a2a2a)"
			} }, (0, react.createElement)("div", { style: {
				...styles.rowTop,
				flexWrap: "wrap"
			} }, (0, react.createElement)("input", {
				style: {
					...styles.input,
					width: 150,
					flexShrink: 0
				},
				value: label,
				title: "账号备注名（用于区分多个 ChatGPT 账号）",
				onChange: (e) => setLabel(e.target.value),
				onBlur: () => {
					if (label.trim() && label.trim() !== a.label) onPatch({ label: label.trim() });
				}
			}), (0, react.createElement)("select", {
				style: {
					...styles.select,
					flexShrink: 0
				},
				value: a.plan,
				title: "账号套餐：免费 / Plus / 5x(Pro) / 20x(Business)",
				onChange: (e) => onPatch({ plan: e.target.value })
			}, tiers.map((t) => (0, react.createElement)("option", {
				key: t.plan,
				value: t.plan
			}, t.label))), (0, react.createElement)("input", {
				style: {
					...styles.input,
					width: 84,
					flexShrink: 0
				},
				value: limit,
				placeholder: `额度 ${tiers.find((t) => t.plan === a.plan)?.defaultLimit ?? ""}`,
				title: "窗口额度上限（留空 = 跟随套餐默认值）",
				onChange: (e) => setLimit(e.target.value),
				onBlur: commitLimit
			}), (0, react.createElement)("button", {
				style: styles.del,
				title: "删除该账号",
				onClick: () => onAction("remove")
			}, "×")), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 8,
				flexWrap: "wrap"
			} }, (0, react.createElement)("div", { style: {
				fontSize: 12,
				color: exhausted ? "var(--danger, #d05050)" : "var(--text-2, #aaa)",
				whiteSpace: "nowrap"
			} }, a.limitEnforced ? `已用 ${a.used} / ${a.limit} 张（${a.windowHours}h 滚动${a.autoProbe ? "，自动" : ""}）` + (exhausted ? " — ⚠️ 已用完，等待窗口刷新" : a.resetAt ? ` — 下次重置: ${a.resetAt}` : "") : `已用 ${a.used} 张（${a.windowHours}h 滚动，免费版不计额度；用尽自动切换下一通道）`), (0, react.createElement)("button", {
				style: {
					...styles.probe,
					marginRight: 0
				},
				onClick: () => onAction("log")
			}, "登记 1 张"), (0, react.createElement)("button", {
				style: {
					...styles.addBtn,
					marginRight: 0
				},
				onClick: () => onAction("reset")
			}, "重置"), (0, react.createElement)("button", {
				style: {
					...styles.addBtn,
					marginRight: 0,
					...a.autoProbe ? {
						borderColor: "var(--accent, #4f6ef7)",
						color: "var(--text-1, #eee)"
					} : {}
				},
				title: "自动探测：用 ChatGPT 后端接口统计窗口内出图，代替手动登记",
				onClick: () => onPatch({ autoProbe: !a.autoProbe })
			}, a.autoProbe ? "自动探测：开" : "自动探测：关")), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 8,
				flexWrap: "wrap"
			} }, (0, react.createElement)("input", {
				style: {
					...styles.input,
					width: 260
				},
				type: "password",
				value: token,
				placeholder: a.hasToken && !a.codexAuth ? "凭据已保存（粘贴新 token 可替换）" : "粘贴 __Secure-next-auth.session-token",
				title: "ChatGPT 网页登录态：DevTools → Application → Cookies → __Secure-next-auth.session-token",
				onChange: (e) => setToken(e.target.value)
			}), (0, react.createElement)("button", {
				style: {
					...styles.probe,
					marginRight: 0
				},
				disabled: !token.trim(),
				onClick: saveToken
			}, "保存凭据"), (0, react.createElement)("button", {
				style: {
					...styles.addBtn,
					marginRight: 0,
					...a.codexAuth ? {
						borderColor: "var(--accent, #4f6ef7)",
						color: "var(--text-1, #eee)"
					} : {}
				},
				title: "直接读取运行中的 Codex 客户端登录态（~/.codex/auth.json），令牌由客户端自动刷新",
				onClick: onCodexAuth
			}, a.codexAuth ? "Codex 客户端登录态 ✓" : "读取 Codex 客户端登录态"), (0, react.createElement)("button", {
				style: {
					...styles.save,
					padding: "6px 12px"
				},
				disabled: probing || !a.hasToken,
				onClick: probe
			}, probing ? "探测中…" : "🔍 探测额度"), a.hasToken ? (0, react.createElement)("button", {
				style: {
					...styles.addBtn,
					marginRight: 0
				},
				onClick: () => onAuth("")
			}, "清除凭据") : null), (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 6
			} }, status), cu && (cu.primary || cu.secondary) ? (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 2
			} }, `Codex 用量（${cu.planType ?? a.detectedPlanType ?? "?"}${cu.email ? " · " + cu.email : ""}）` + (cu.primary ? ` · 主窗口 ${hWin(cu.primary)}` : "") + (cu.secondary ? ` · 周窗口 ${hWin(cu.secondary)}` : "")) : null, (0, react.createElement)("div", { style: {
				...styles.hint,
				marginTop: 2
			} }, `${a.planLabel} · ${a.rule}` + (a.limitOverridden ? "（额度已手动覆盖）" : "") + (a.planSource === "manual" ? "（档位手动锁定）" : "")));
		}
		function UsagePanel() {
			const [u, setU] = (0, react.useState)(null);
			const [msg, setMsg] = (0, react.useState)("");
			const [proxy, setProxy] = (0, react.useState)("");
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
						if (stale.length) setMsg("已自动探测 " + stale.length + " 个账号");
					} catch {
						setU(null);
					}
				})();
			}, []);
			const apply = (next, ok) => {
				if (!next || !Array.isArray(next.accounts)) {
					setMsg("操作失败");
					return;
				}
				setU(next);
				if (typeof next.proxy === "string") setProxy(next.proxy);
				setMsg(ok);
			};
			const patch = (id, body) => {
				(async () => apply(await usageRequest({
					action: "update",
					id,
					...body
				}), "已保存"))();
			};
			const action = (id, act) => {
				(async () => {
					apply(await usageRequest({
						action: act,
						id
					}), {
						log: "已登记 1 张",
						reset: "已重置窗口",
						remove: "已删除账号"
					}[act] ?? "完成");
				})();
			};
			const probe = (id) => {
				(async () => apply(await usageRequest({
					action: "probe",
					id
				}), "探测完成"))();
			};
			const auth = (id, sessionToken) => {
				(async () => apply(await usageRequest({
					action: "auth",
					id,
					sessionToken
				}), sessionToken ? "凭据已保存" : "凭据已清除"))();
			};
			const codexAuth = (id) => {
				(async () => apply(await usageRequest({
					action: "authCodex",
					id
				}), "已读取 Codex 客户端登录态"))();
			};
			const add = () => {
				(async () => apply(await usageRequest({
					action: "add",
					label: `ChatGPT 账号 ${(u?.accounts.length ?? 0) + 1}`,
					plan: "free"
				}), "已添加账号"))();
			};
			const addCodex = () => {
				(async () => {
					const added = await usageRequest({
						action: "add",
						label: "Codex 客户端账号",
						plan: "free"
					});
					if (!added?.accounts) {
						apply(added, "操作失败");
						return;
					}
					const created = added.accounts[added.accounts.length - 1];
					apply(await usageRequest({
						action: "authCodex",
						id: created.id
					}), "已从 Codex 客户端添加账号");
				})();
			};
			const saveProxy = () => {
				(async () => apply(await usageRequest({
					action: "settings",
					proxy
				}), "代理已保存"))();
			};
			if (!u) return null;
			const tiers = u.tiers ?? [];
			return (0, react.createElement)("div", { style: styles.card }, (0, react.createElement)("div", { style: styles.title }, "ChatGPT 网页出图账号（多账号额度）"), (0, react.createElement)("div", { style: styles.sub }, "每个账号标注套餐档位（免费 / Plus / 5x / 20x）；填凭据后可自动探测档位与窗口内出图，也可手动「登记 1 张」。"), (0, react.createElement)("div", { style: styles.group }, u.accounts.map((a) => (0, react.createElement)(AccountRow, {
				key: a.id,
				a,
				tiers,
				onPatch: (body) => patch(a.id, body),
				onAction: (act) => action(a.id, act),
				onProbe: () => probe(a.id),
				onAuth: (token) => auth(a.id, token),
				onCodexAuth: () => codexAuth(a.id)
			}))), (0, react.createElement)("button", {
				style: styles.addBtn,
				onClick: add
			}, "＋ 添加 ChatGPT 账号"), (0, react.createElement)("button", {
				style: styles.addBtn,
				onClick: addCodex
			}, "＋ 从 Codex 客户端添加账号"), msg ? (0, react.createElement)("span", { style: styles.msg }, msg) : null, (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginTop: 12,
				flexWrap: "wrap"
			} }, (0, react.createElement)("input", {
				style: {
					...styles.input,
					width: 220
				},
				value: proxy,
				placeholder: u.proxyEffective ? `自动：${u.proxyEffective}` : "留空 = 自动读系统代理",
				title: "ChatGPT 探测用代理（Node 不读系统代理，留空则自动读取 Windows 系统代理）",
				onChange: (e) => setProxy(e.target.value)
			}), (0, react.createElement)("button", {
				style: {
					...styles.addBtn,
					marginRight: 0
				},
				onClick: saveProxy
			}, "保存代理"), (0, react.createElement)("span", { style: styles.hint }, u.proxyEffective ? `当前生效：${u.proxyEffective}` : "当前直连（若探测报 fetch 失败，请填代理）")), (0, react.createElement)("div", { style: styles.hint }, "套餐默认额度：" + tiers.map((t) => `${t.label} ${t.defaultLimit}`).join(" / ") + "（24h 滚动窗口，可在每行直接改数字；自动探测按 ChatGPT 后端返回的实际出图时刻统计）"));
		}
		/**
		* Register the Settings → 「识图与生图」 section.
		* @param ctx - client root context (the same one the editor dock receives).
		*/
		function registerConfigPanel(ctx) {
			ctx.effect(() => {
				ctx.locale.register(NS$1, {
					zh: { nav: "识图与生图" },
					en: { nav: "Vision & Image" }
				});
				const t = ctx.locale.bind(NS$1);
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "img2img-config",
					order: 60,
					label: () => t("nav"),
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
				zh,
				en
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