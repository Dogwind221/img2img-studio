/**
 * Raster operations for the image editor hand-off, implemented in-process on
 * {@link Raster} (see png.mjs for why no child process is spawned).
 *
 * Mask convention throughout: white (luminance ≥ threshold) = the region the
 * user brushed. Providers disagree on the encoding, so the conversion lives at
 * the call site in edit_image.mjs, never here.
 */
import fs from "node:fs";
import path from "node:path";
import { Raster, decodePng, encodePng, probeSize } from "./png.mjs";

/** Read a PNG file into a raster. */
export function readRaster(file) {
  const buffer = fs.readFileSync(file);
  const size = probeSize(buffer);
  if (size.format !== "png") throw new Error(`${file} 不是 PNG（${size.format}）：请先转成 PNG（面板导出的图都是 PNG）`);
  return decodePng(buffer);
}

/** Write a raster as a PNG file, creating parent directories. */
export function writePng(file, raster) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, encodePng(raster));
  return target;
}

/** 感知亮度（Rec.601）。 */
export function luminance(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }

/** Bilinear resample of one raster to an exact pixel size. */
export function resample(source, width, height) {
  if (source.width === width && source.height === height) return source.clone();
  const out = new Raster(width, height, new Uint8Array(width * height * 4));
  const sx = source.width / width;
  const sy = source.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(source.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(source.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const wx = fx - x0;
      const dst = (y * width + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        const p00 = source.data[source.index(x0, y0) + channel];
        const p10 = source.data[source.index(x1, y0) + channel];
        const p01 = source.data[source.index(x0, y1) + channel];
        const p11 = source.data[source.index(x1, y1) + channel];
        const top = p00 + (p10 - p00) * wx;
        const bottom = p01 + (p11 - p01) * wx;
        out.data[dst + channel] = Math.round(top + (bottom - top) * wy);
      }
    }
  }
  return out;
}

/**
 * Fit a raster into `width`×`height`.
 * @param mode - `cover` fills and centre-crops, `contain` fits inside with
 * transparent padding, `stretch` ignores the aspect ratio.
 */
export function resizeRaster(source, width, height, mode = "cover") {
  if (mode === "stretch") return resample(source, width, height);
  const scale = mode === "cover"
    ? Math.max(width / source.width, height / source.height)
    : Math.min(width / source.width, height / source.height);
  const dw = Math.max(1, Math.round(source.width * scale));
  const dh = Math.max(1, Math.round(source.height * scale));
  const scaled = resample(source, dw, dh);
  const out = Raster.create(width, height);
  const dx = Math.round((width - dw) / 2);
  const dy = Math.round((height - dh) / 2);
  for (let y = 0; y < dh; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < dw; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= width) continue;
      const src = scaled.index(x, y);
      const dst = out.index(tx, ty);
      out.data[dst] = scaled.data[src];
      out.data[dst + 1] = scaled.data[src + 1];
      out.data[dst + 2] = scaled.data[src + 2];
      out.data[dst + 3] = scaled.data[src + 3];
    }
  }
  return out;
}

/** Force every pixel to pure black or white — the provider mask input. */
export function binarizeRaster(source, threshold = 128) {
  const out = new Raster(source.width, source.height, Uint8Array.from(source.data));
  for (let i = 0; i < out.data.length; i += 4) {
    const value = luminance(out.data[i], out.data[i + 1], out.data[i + 2]) >= threshold ? 255 : 0;
    out.data[i] = value; out.data[i + 1] = value; out.data[i + 2] = value; out.data[i + 3] = 255;
  }
  return out;
}

/** White-brush mask → OpenAI mask form (alpha 0 marks the region to redraw). */
export function maskToAlphaRaster(source) {
  const out = new Raster(source.width, source.height, Uint8Array.from(source.data));
  for (let i = 0; i < out.data.length; i += 4) {
    const lum = luminance(out.data[i], out.data[i + 1], out.data[i + 2]);
    out.data[i] = 0; out.data[i + 1] = 0; out.data[i + 2] = 0;
    out.data[i + 3] = Math.round(255 - lum);
  }
  return out;
}

/** 5×7 digit glyphs: pin numbering without a font dependency. */
const DIGITS = {
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
};

function fillCircle(raster, cx, cy, radius, color) {
  const r2 = radius * radius;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    if (y < 0 || y >= raster.height) continue;
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (x < 0 || x >= raster.width) continue;
      const dx = x - cx; const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = raster.index(x, y);
      // 抗锯齿边缘：按覆盖率混合
      const coverage = Math.min(1, Math.max(0, radius + 0.5 - Math.sqrt(dx * dx + dy * dy)));
      raster.data[i] = Math.round(raster.data[i] * (1 - coverage) + color[0] * coverage);
      raster.data[i + 1] = Math.round(raster.data[i + 1] * (1 - coverage) + color[1] * coverage);
      raster.data[i + 2] = Math.round(raster.data[i + 2] * (1 - coverage) + color[2] * coverage);
      raster.data[i + 3] = Math.round(raster.data[i + 3] * (1 - coverage) + (color[3] ?? 255) * coverage);
    }
  }
}

function drawNumber(raster, text, cx, cy, scale, color) {
  const glyphWidth = 5; const glyphHeight = 7;
  const totalWidth = (glyphWidth + 1) * text.length - 1;
  const originX = cx - (totalWidth * scale) / 2;
  const originY = cy - (glyphHeight * scale) / 2;
  for (let index = 0; index < text.length; index++) {
    const glyph = DIGITS[text[index]];
    if (!glyph) continue;
    for (let row = 0; row < glyphHeight; row++) {
      for (let col = 0; col < glyphWidth; col++) {
        if ((glyph[row] & (1 << (glyphWidth - 1 - col))) === 0) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = Math.round(originX + (index * (glyphWidth + 1) + col) * scale + sx);
            const y = Math.round(originY + row * scale + sy);
            if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue;
            const i = raster.index(x, y);
            raster.data[i] = color[0]; raster.data[i + 1] = color[1]; raster.data[i + 2] = color[2];
            raster.data[i + 3] = color[3] ?? 255;
          }
        }
      }
    }
  }
}

/** Stamp numbered pins onto a copy of the raster (the position guidance image). */
export function drawMarkerPins(source, markers) {
  const out = source.clone();
  const radius = Math.max(11, Math.min(out.width, out.height) * 0.026);
  const ring = Math.max(2, radius * 0.14);
  // 数字占徽章高度的 ~60%：笔画宽度 = scale，过大就糊成一团
  const scale = Math.max(2, Math.floor(radius / 6));
  for (const marker of markers) {
    const cx = marker.x * out.width;
    const cy = marker.y * out.height;
    fillCircle(out, cx, cy, radius, [255, 255, 255, 255]);
    fillCircle(out, cx, cy, Math.max(2, radius - ring), [255, 59, 48, 246]);
    drawNumber(out, String(marker.id), cx, cy, scale, [255, 255, 255, 255]);
  }
  return out;
}

/** One white rectangle on black — a rectangular mask for local edits. */
export function maskRectRaster(width, height, rect) {
  const out = Raster.create(width, height, [0, 0, 0, 255]);
  const x0 = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const x1 = Math.max(x0 + 1, Math.min(width, Math.round(rect.x + rect.width)));
  const y1 = Math.max(y0 + 1, Math.min(height, Math.round(rect.y + rect.height)));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = out.index(x, y);
      out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; out.data[i + 3] = 255;
    }
  }
  return out;
}

/** One filled ellipse inscribed in the rect, as a white-on-black mask (softer edge than a rectangle). */
export function maskEllipseRaster(width, height, rect) {
  const out = Raster.create(width, height, [0, 0, 0, 255]);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rx = Math.max(1, rect.width / 2);
  const ry = Math.max(1, rect.height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      if (nx * nx + ny * ny > 1) continue;
      const i = out.index(x, y);
      out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255; out.data[i + 3] = 255;
    }
  }
  return out;
}

/** One filled circle per marker, as a white-on-black mask. */
export function maskFromMarkers(width, height, markers, radiusRatio = 0.03) {
  const out = Raster.create(width, height, [0, 0, 0, 255]);
  const radius = Math.max(8, Math.min(width, height) * radiusRatio);
  for (const marker of markers) fillCircle(out, marker.x * width, marker.y * height, radius, [255, 255, 255, 255]);
  return out;
}

/** Paint the masked region red on a copy of the image (prompt-only fallback). */
export function overlayMaskRaster(source, mask, alpha = 0.45) {
  const out = source.clone();
  const width = Math.min(out.width, mask.width);
  const height = Math.min(out.height, mask.height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = mask.index(x, y);
      const luminanceValue = luminance(mask.data[m], mask.data[m + 1], mask.data[m + 2]) / 255;
      if (luminanceValue < 0.5) continue;
      const strength = luminanceValue * alpha;
      const i = out.index(x, y);
      out.data[i] = Math.round(out.data[i] * (1 - strength) + 255 * strength);
      out.data[i + 1] = Math.round(out.data[i + 1] * (1 - strength) + 45 * strength);
      out.data[i + 2] = Math.round(out.data[i + 2] * (1 - strength) + 30 * strength);
    }
  }
  return out;
}

/** 取一块矩形区域（越界部分按图像边界裁剪）。 */
export function cropRect(source, x, y, width, height) {
  const x0 = Math.max(0, Math.min(source.width - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(source.height - 1, Math.round(y)));
  const w = Math.max(1, Math.min(source.width - x0, Math.round(width)));
  const h = Math.max(1, Math.min(source.height - y0, Math.round(height)));
  const out = new Raster(w, h, new Uint8Array(w * h * 4));
  for (let row = 0; row < h; row++) {
    const src = source.index(x0, y0 + row);
    out.data.set(source.data.subarray(src, src + w * 4), row * w * 4);
  }
  return { raster: out, x: x0, y: y0, width: w, height: h };
}

/**
 * 把一张小图（补丁）贴回原图的 (x,y)，可选按同尺寸掩码只取掩码内的像素
 * ——「局部重绘后守边」的关键一步：补丁外的一切保持原样。
 */
export function compositePatch(original, patch, x, y, mask = null, feather = 2) {
  const out = original.clone();
  const targetW = mask?.width ?? patch.width;
  const targetH = mask?.height ?? patch.height;
  const scaled = patch.width === targetW && patch.height === targetH
    ? patch
    : resizeRaster(patch, targetW, targetH, "cover");
  const weight = new Float32Array(targetW * targetH);
  if (mask === null) weight.fill(1);
  else {
    for (let index = 0; index < targetW * targetH; index++) {
      const i = index * 4;
      weight[index] = luminance(mask.data[i], mask.data[i + 1], mask.data[i + 2]) >= 128 ? 1 : 0;
    }
    if (feather > 0) {
      for (let pass = 0; pass < feather; pass++) {
        const snapshot = Float32Array.from(weight);
        for (let row = 0; row < targetH; row++) {
          for (let col = 0; col < targetW; col++) {
            let sum = 0; let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = col + dx; const ny = row + dy;
                if (nx < 0 || ny < 0 || nx >= targetW || ny >= targetH) continue;
                sum += snapshot[ny * targetW + nx]; count++;
              }
            }
            weight[row * targetW + col] = sum / count;
          }
        }
      }
    }
  }
  for (let row = 0; row < targetH; row++) {
    const ty = y + row;
    if (ty < 0 || ty >= out.height) continue;
    for (let col = 0; col < targetW; col++) {
      const tx = x + col;
      if (tx < 0 || tx >= out.width) continue;
      const alpha = weight[row * targetW + col];
      if (alpha <= 0) continue;
      const src = scaled.index(col, row);
      const dst = out.index(tx, ty);
      for (let channel = 0; channel < 4; channel++) {
        out.data[dst + channel] = alpha >= 1
          ? scaled.data[src + channel]
          : Math.round(out.data[dst + channel] * (1 - alpha) + scaled.data[src + channel] * alpha);
      }
    }
  }
  return out;
}

/**
 * Keep the generated pixels only inside the mask and the original pixels
 * outside it — the safety net for the prompt-only fallback, where a model may
 * repaint parts of the frame the user never brushed.
 * @param feather - box-blur radius (pixels) applied to the mask edge.
 */
export function compositeWithMask(original, generated, mask, feather = 2) {
  const scaled = generated.width === original.width && generated.height === original.height
    ? generated
    : resizeRaster(generated, original.width, original.height, "cover");
  const out = original.clone();
  const { width, height } = original;
  const weight = new Float32Array(width * height);
  const maskWidth = Math.min(width, mask.width);
  const maskHeight = Math.min(height, mask.height);
  for (let y = 0; y < maskHeight; y++) {
    for (let x = 0; x < maskWidth; x++) {
      const i = mask.index(x, y);
      weight[y * width + x] = luminance(mask.data[i], mask.data[i + 1], mask.data[i + 2]) >= 128 ? 1 : 0;
    }
  }
  if (feather > 0) {
    const blurred = Float32Array.from(weight);
    for (let pass = 0; pass < feather; pass++) {
      const snapshot = Float32Array.from(blurred);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0; let count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx; const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              sum += snapshot[ny * width + nx]; count++;
            }
          }
          blurred[y * width + x] = sum / count;
        }
      }
    }
    for (let index = 0; index < weight.length; index++) weight[index] = blurred[index];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = weight[y * width + x];
      if (alpha <= 0) continue;
      const src = scaled.index(x, y);
      const dst = out.index(x, y);
      for (let channel = 0; channel < 4; channel++) {
        out.data[dst + channel] = alpha >= 1
          ? scaled.data[src + channel]
          : Math.round(out.data[dst + channel] * (1 - alpha) + scaled.data[src + channel] * alpha);
      }
    }
  }
  return out;
}

/**
 * Local flat-background cutout: flood the border inward while pixels stay within
 * `tolerance` of the border reference colour, then zero their alpha with a
 * one-pixel seam. Complex backgrounds need a cloud matting channel.
 */
export function cutoutRaster(source, tolerance = 36) {
  const { width, height } = source;
  const out = source.clone();
  if (width * height > 12_000_000) return out;
  const reference = borderReference(source);
  const removed = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const tolerance2 = tolerance * tolerance;
  const push = (index) => {
    if (removed[index] === 1) return;
    removed[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index - x) / width;
    const neighbours = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || removed[neighbour] === 1) continue;
      const offset = neighbour * 4;
      const dr = out.data[offset] - reference[0];
      const dg = out.data[offset + 1] - reference[1];
      const db = out.data[offset + 2] - reference[2];
      if (dr * dr + dg * dg + db * db <= tolerance2) push(neighbour);
    }
  }
  for (let index = 0; index < width * height; index++) {
    if (removed[index] === 1) out.data[index * 4 + 3] = 0;
  }
  for (let index = 0; index < width * height; index++) {
    if (removed[index] === 1) continue;
    const x = index % width;
    const y = (index - x) / width;
    const touching = (x > 0 && removed[index - 1] === 1)
      || (x < width - 1 && removed[index + 1] === 1)
      || (y > 0 && removed[index - width] === 1)
      || (y < height - 1 && removed[index + width] === 1);
    if (touching) out.data[index * 4 + 3] = 150;
  }
  return out;
}

function borderReference(source) {
  const reds = []; const greens = []; const blues = [];
  const { width, height } = source;
  const stride = Math.max(1, Math.round(Math.min(width, height) / 128));
  const sample = (x, y) => {
    const i = source.index(x, y);
    reds.push(source.data[i]); greens.push(source.data[i + 1]); blues.push(source.data[i + 2]);
  };
  for (let x = 0; x < width; x += stride) { sample(x, 0); sample(x, height - 1); }
  for (let y = 0; y < height; y += stride) { sample(0, y); sample(width - 1, y); }
  const median = (values) => { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)] ?? 0; };
  return [median(reds), median(greens), median(blues)];
}
