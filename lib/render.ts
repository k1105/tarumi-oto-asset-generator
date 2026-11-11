// ドキュメントを canvas に描く。編集画面も書き出しも同じ描き方を通す (見えたとおりに書き出される)
import { allLayers, fullW, isStroke, radiusOf, type Doc, type Layer, type MediaLayer, type TextLayer, type Tone } from './doc';
import { drawStrokeText, strokeInfo } from './stroke/draw';

/** 枠に入れる絵。w, h は絵のもとの大きさ */
export type Source = { el: CanvasImageSource; w: number; h: number };
export type Resolve = (layer: MediaLayer) => Source | null;

/** 枠 (w x h) に絵 (sw x sh) を入れたとき、絵のどこを切り出すか */
export function cropRect(l: Pick<MediaLayer, 'w' | 'h' | 'zoom' | 'cx' | 'cy'>, sw: number, sh: number) {
  const scale = Math.max(l.w / sw, l.h / sh) * Math.max(1, l.zoom); // 絵 1px が紙面の何 px か
  const vw = l.w / scale;
  const vh = l.h / scale;
  return { sx: (sw - vw) * l.cx, sy: (sh - vh) * l.cy, sw: vw, sh: vh, scale };
}

// 行頭に置かない文字と、行末に置かない文字 (禁則)
const NO_START = new Set('、。，．,.・：；:;？！?!）」』】〕〉》)]}ー〜…‥っゃゅょぁぃぅぇぉッャュョァィゥェォ々');
const NO_END = new Set('（「『【〔〈《([{');
const isWordChar = (c: string) => /[!-~À-ɏ]/.test(c);

/** 折り返しの単位に分ける。欧文は単語ごと、和文は 1 文字ごと (禁則の文字は隣にくっつける) */
function tokens(text: string) {
  const out: string[] = [];
  let glue = false; // 次の文字を前のかたまりにつなげる
  for (const c of Array.from(text)) {
    const last = out.length - 1;
    const prev = last >= 0 ? out[last] : '';
    const joinWord = isWordChar(c) && prev !== '' && isWordChar(prev[prev.length - 1]) && !NO_END.has(prev[prev.length - 1]);
    if (last >= 0 && c !== ' ' && (glue || NO_START.has(c) || joinWord)) out[last] += c;
    else out.push(c);
    glue = NO_END.has(c);
  }
  return out;
}

export const fontOf = (l: TextLayer) => `${l.weight} ${l.size}px ${l.font}`;

/** sc: 文字ごとの大きさの倍率 */
function setFont(ctx: CanvasRenderingContext2D, l: TextLayer, sc = 1) {
  ctx.font = `${l.weight} ${l.size * sc}px ${l.font}`;
  ctx.letterSpacing = `${l.size * sc * l.tracking}px`;
}

const scaleAt = (l: TextLayer, i: number) => l.scale?.[i] || 1;

/**
 * start 文字目から始まる行 line の、先頭から j 文字ぶんの幅 (px)。それぞれの文字のあとの字間と、あいだの個別の字間を含む。
 * 大きさの違う文字は、同じ大きさの続きごとに測る。呼んだあとは ctx の書体が変わっている
 */
function span(ctx: CanvasRenderingContext2D, l: TextLayer, line: string, start: number, j: number) {
  let w = 0;
  let from = 0;
  for (let k = 1; k <= j; k++) {
    if (k < j && scaleAt(l, start + k) === scaleAt(l, start + from)) continue;
    setFont(ctx, l, scaleAt(l, start + from));
    w += ctx.measureText(line.slice(from, k)).width;
    from = k;
  }
  return w + kernSum(l, start, j);
}

/** start 文字目から始まる行 line の中の、個別の字間の合計 (px)。行の先頭の手前のぶんは数えない */
function kernSum(l: TextLayer, start: number, len: number) {
  if (!l.kern) return 0;
  let sum = 0;
  for (let j = 1; j < len; j++) sum += l.kern[start + j] ?? 0;
  return sum * l.size;
}

/** 幅 l.w で折り返した行と高さ。starts = それぞれの行が l.text の何文字目から始まるか */
export function layoutText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  setFont(ctx, l);
  const lines: string[] = [];
  const starts: number[] = [];
  let base = 0; // 段落の始まり
  for (const para of l.text.split('\n')) {
    let line = '';
    let start = base;
    let pos = base; // 次のかたまりの位置
    for (const t of tokens(para)) {
      const next = (line + t).trimEnd();
      if (line && span(ctx, l, next, start, next.length) > l.w) {
        lines.push(line.trimEnd());
        starts.push(start);
        line = t === ' ' ? '' : t;
        start = t === ' ' ? pos + 1 : pos;
      } else line += t;
      pos += t.length;
    }
    lines.push(line);
    starts.push(start);
    base += para.length + 1;
  }
  const lh = l.size * l.lineHeight;
  return { lines, starts, lh, height: Math.max(1, lines.length) * lh };
}

/** 行の幅 (px)。行末の字間は含めず、個別の字間は含める */
const lineWidth = (ctx: CanvasRenderingContext2D, l: TextLayer, line: string, start: number) => (line ? span(ctx, l, line, start, line.length) - l.size * scaleAt(l, start + line.length - 1) * l.tracking : 0);

/**
 * テキストの置き場所。top = 文章の上の端、bx / bw = 行を揃える範囲 (札があるときは、文章の幅ぶんを幅 w の中央に取る)、
 * card = 札の長方形 (文章 + 余白 + 縁。無ければ null)
 */
export function textBlock(ctx: CanvasRenderingContext2D, l: TextLayer) {
  const { lines, starts, lh, height } = layoutText(ctx, l);
  const top = l.valign === 'middle' ? l.y - height / 2 : l.y;
  if (!l.box) return { lines, starts, lh, height, top, bx: l.x, bw: l.w, card: null };
  const bw = Math.min(l.w, Math.max(1, ...lines.map((s, i) => lineWidth(ctx, l, s, starts[i]))));
  const bx = l.x + (l.w - bw) / 2;
  const ox = l.box.padX + l.box.strokeWidth;
  const oy = l.box.padY + l.box.strokeWidth;
  return { lines, starts, lh, height, top, bx, bw, card: { x: bx - ox, y: top - oy, w: bw + ox * 2, h: height + oy * 2 } };
}

/** 行の左の端の x (揃えに合わせる) */
function lineLeft(ctx: CanvasRenderingContext2D, l: TextLayer, line: string, start: number, bx: number, bw: number) {
  const w = lineWidth(ctx, l, line, start);
  return l.align === 'left' ? bx : l.align === 'center' ? bx + (bw - w) / 2 : bx + bw - w;
}

/** 行の j 文字目の手前までの幅 (px)。字間と個別の字間を含む */
const advance = (ctx: CanvasRenderingContext2D, l: TextLayer, line: string, start: number, j: number) =>
  j <= 0 ? 0 : j >= line.length ? lineWidth(ctx, l, line, start) : span(ctx, l, line, start, j) + (l.kern?.[start + j] ?? 0) * l.size;

/** l.text の index 文字目の手前に出すカーソルの位置 (紙面の px) と、その行 */
export function caretAt(l: TextLayer, index: number) {
  measurer ??= document.createElement('canvas').getContext('2d')!;
  const ctx = measurer;
  const { lines, starts, lh, top, bx, bw } = textBlock(ctx, l);
  let row = 0;
  for (let i = 0; i < lines.length; i++) if (starts[i] <= index) row = i;
  const j = Math.min(lines[row].length, Math.max(0, index - starts[row]));
  return { x: lineLeft(ctx, l, lines[row], starts[row], bx, bw) + advance(ctx, l, lines[row], starts[row], j), y: top + row * lh, h: lh, row };
}

/** 紙面の点 (x, y) にいちばん近い文字の位置 */
export function indexAt(l: TextLayer, x: number, y: number) {
  measurer ??= document.createElement('canvas').getContext('2d')!;
  const ctx = measurer;
  const { lines, starts, lh, top, bx, bw } = textBlock(ctx, l);
  const row = Math.min(lines.length - 1, Math.max(0, Math.floor((y - top) / lh)));
  const left = lineLeft(ctx, l, lines[row], starts[row], bx, bw);
  let best = 0;
  let dist = Infinity;
  for (let j = 0; j <= lines[row].length; j++) {
    const d = Math.abs(left + advance(ctx, l, lines[row], starts[row], j) - x);
    if (d < dist) {
      dist = d;
      best = j;
    }
  }
  return starts[row] + best;
}

/** 選んでいる範囲 (a 〜 b 文字目) を塗る長方形 (紙面の px)。行ごと */
export function rangeRects(l: TextLayer, a: number, b: number) {
  measurer ??= document.createElement('canvas').getContext('2d')!;
  const ctx = measurer;
  const { lines, starts, lh, top, bx, bw } = textBlock(ctx, l);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  lines.forEach((line, i) => {
    const from = Math.max(a, starts[i]) - starts[i];
    const to = Math.min(b, starts[i] + line.length) - starts[i];
    if (to <= from) return;
    const left = lineLeft(ctx, l, line, starts[i], bx, bw);
    const x0 = advance(ctx, l, line, starts[i], from);
    out.push({ x: left + x0, y: top + i * lh, w: advance(ctx, l, line, starts[i], to) - x0, h: lh });
  });
  return out;
}

let measurer: CanvasRenderingContext2D | null = null;
/** テキストの置き場所を測る (紙面の px)。ブラウザの中だけ */
export function measureText(l: TextLayer) {
  measurer ??= document.createElement('canvas').getContext('2d')!;
  return textBlock(measurer, l);
}

/** レイヤーの占める長方形 (テキストは、幅 w と測った高さ) */
export function boxOf(l: Layer) {
  if (l.type !== 'text') return { x: l.x, y: l.y, w: l.w, h: l.h };
  const m = measureText(l);
  return { x: l.x, y: m.top, w: l.w, h: m.height };
}

/** 押して選べる範囲。札のあるテキストは、札も含める */
export function hitOf(l: Layer) {
  const b = boxOf(l);
  const card = l.type === 'text' ? measureText(l).card : null;
  if (!card) return b;
  const x = Math.min(b.x, card.x);
  const y = Math.min(b.y, card.y);
  return { x, y, w: Math.max(b.x + b.w, card.x + card.w) - x, h: Math.max(b.y + b.h, card.y + card.h) - y };
}

/** textOff: 文章は描かず、札だけ描く (編集中は上に入力欄を重ねるので) */
function drawText(ctx: CanvasRenderingContext2D, l: TextLayer, time: number | null, textOff: boolean) {
  const { lines, starts, lh, top, bx, bw, card } = textBlock(ctx, l);
  if (card && l.box) {
    ctx.fillStyle = l.box.fill;
    ctx.fillRect(card.x, card.y, card.w, card.h);
    const sw = Math.min(l.box.strokeWidth, card.w / 2, card.h / 2);
    if (sw > 0) {
      ctx.strokeStyle = l.box.stroke;
      ctx.lineWidth = sw;
      ctx.strokeRect(card.x + sw / 2, card.y + sw / 2, card.w - sw, card.h - sw);
    }
  }
  if (textOff) return;
  setFont(ctx, l);
  const m = ctx.measureText('あ');
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  const baseline = (i: number) => top + i * lh + (lh - (asc + desc)) / 2 + asc;
  // 動きつきの樽見 OTO ストロークは、線で描く (線のデータがまだ読めていなければ、ふつうの文字で)
  const kern = l.kern?.some(Boolean) ? l.kern : null;
  const extra = kern ? (row: number, j: number) => (j > 0 ? (kern[starts[row] + j] ?? 0) * l.size : 0) : undefined;
  const scale = l.scale?.some((v) => v && v !== 1) ? l.scale : null;
  const scaleOf = scale ? (row: number, j: number) => scale[starts[row] + j] || 1 : undefined;
  if (l.motion?.on && isStroke(l) && drawStrokeText(ctx, { ...l, x: bx, w: bw }, lines, baseline, l.motion, time, extra, scaleOf)) return;
  ctx.fillStyle = l.color;
  ctx.textBaseline = 'alphabetic';
  if (!kern && !scale) {
    ctx.textAlign = l.align;
    const sp = l.size * l.tracking; // 行末にも字間が付くので、その分を戻す
    const x = l.align === 'left' ? bx : l.align === 'center' ? bx + bw / 2 + sp / 2 : bx + bw + sp;
    lines.forEach((line, i) => ctx.fillText(line, x, baseline(i)));
    return;
  }
  // 個別の字間や大きさの違う文字があるときは、その変わり目で区切って左から順に置く
  ctx.textAlign = 'left';
  lines.forEach((line, i) => {
    let x = lineLeft(ctx, l, line, starts[i], bx, bw);
    let from = 0;
    for (let j = 1; j <= line.length; j++) {
      const k = j < line.length ? kern?.[starts[i] + j] ?? 0 : 0;
      if (j < line.length && !k && scaleAt(l, starts[i] + j) === scaleAt(l, starts[i] + from)) continue;
      const part = line.slice(from, j);
      setFont(ctx, l, scaleAt(l, starts[i] + from));
      ctx.fillText(part, x, baseline(i));
      x += ctx.measureText(part).width + k * l.size;
      from = j;
    }
  });
}

const rgb = (hex: string) => {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i);
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// 2 値化した絵。画像は同じ条件のあいだ使い回す (動画は毎回作る)
const toned = new WeakMap<object, { key: string; canvas: OffscreenCanvas }>();
let scratch: OffscreenCanvas | null = null;

/** 枠に入る部分を枠の大きさで切り出し、2 値化して返す。輝度 (0.2126 R + 0.7152 G + 0.0722 B) が threshold 以上なら light、未満なら dark (advertising と同じ式) */
function tone(l: MediaLayer, s: Source, c: ReturnType<typeof cropRect>, t: Tone): OffscreenCanvas {
  const w = Math.max(1, Math.round(l.w));
  const h = Math.max(1, Math.round(l.h));
  const still = !(typeof HTMLVideoElement !== 'undefined' && s.el instanceof HTMLVideoElement);
  const key = [w, h, c.sx, c.sy, c.sw, c.sh, t.threshold, t.dark, t.light].join(',');
  const hit = still ? toned.get(s.el as object) : undefined;
  if (hit && hit.key === key) return hit.canvas;
  const canvas = still ? new OffscreenCanvas(w, h) : (scratch ??= new OffscreenCanvas(w, h));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, w, h);
  g.drawImage(s.el, c.sx, c.sy, c.sw, c.sh, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const p = img.data;
  const d = rgb(t.dark);
  const li = rgb(t.light);
  const th = Math.min(1, Math.max(0, t.threshold)) * 255;
  for (let i = 0; i < p.length; i += 4) {
    const to = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2] >= th ? li : d;
    p[i] = to[0];
    p[i + 1] = to[1];
    p[i + 2] = to[2];
  }
  g.putImageData(img, 0, 0);
  if (still) toned.set(s.el as object, { key, canvas });
  return canvas;
}

function drawMedia(ctx: CanvasRenderingContext2D, l: MediaLayer, s: Source) {
  const c = cropRect(l, s.w, s.h);
  const r = radiusOf(l);
  const paint = () => {
    if (l.tone?.on) ctx.drawImage(tone(l, s, c, l.tone), l.x, l.y, l.w, l.h);
    else ctx.drawImage(s.el, c.sx, c.sy, c.sw, c.sh, l.x, l.y, l.w, l.h);
  };
  if (!r) return paint();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(l.x, l.y, l.w, l.h, r);
  ctx.clip();
  paint();
  ctx.restore();
}

export type RenderOptions = {
  skipText?: string | null; // 編集中のテキスト (上に入力欄を重ねるので描かない)
  time?: number | null; // 全体の時刻 (秒)。文字の動きに使う。null なら書き終えた状態
  page?: number | null; // 何枚目のアートボードだけを描くか (0 から。canvas は 1 枚の大きさ)。null なら横に並べた全体
};

export function render(ctx: CanvasRenderingContext2D, doc: Doc, resolve: Resolve, { skipText = null, time = null, page = null }: RenderOptions = {}) {
  ctx.save();
  if (page !== null) ctx.translate(-page * doc.w, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = doc.bgColor;
  ctx.fillRect(0, 0, fullW(doc), doc.h);
  for (const l of allLayers(doc)) {
    if (l.hidden) continue;
    ctx.globalAlpha = l.opacity;
    if (l.type === 'media') {
      const s = l.src ? resolve(l) : null;
      if (s && s.w > 0 && s.h > 0) drawMedia(ctx, l, s);
    } else if (l.type === 'rect') {
      if (l.fill) {
        ctx.fillStyle = l.fill;
        ctx.fillRect(l.x, l.y, l.w, l.h);
      }
      const sw = Math.min(l.strokeWidth, l.w / 2, l.h / 2);
      if (sw > 0) {
        ctx.strokeStyle = l.stroke;
        ctx.lineWidth = sw;
        ctx.strokeRect(l.x + sw / 2, l.y + sw / 2, l.w - sw, l.h - sw);
      }
    } else drawText(ctx, l, time, l.id === skipText);
  }
  ctx.restore();
}

/** 動画の長さ (秒)。決めていなければ、入っている動画のいちばん長いもの (頭出しの後ろ) */
export function durationOf(doc: Doc, videoLength: (l: MediaLayer) => number) {
  if (doc.duration) return doc.duration;
  let d = 0;
  for (const l of allLayers(doc)) {
    if (l.hidden) continue;
    if (l.type === 'media' && l.kind === 'video' && l.src) d = Math.max(d, videoLength(l) - l.start);
    // 文字の動きは、書き終えてから 1 秒残す
    if (l.type === 'text' && l.motion?.on && isStroke(l)) d = Math.max(d, l.motion.start + (l.motion.duration || strokeInfo(l.text, l.motion.order).natural) + 1);
  }
  return d > 0.1 ? d : 5;
}

/** 全体の時刻 t のとき、動画のどこを出すか (短い動画は繰り返す) */
export function videoTime(l: MediaLayer, t: number, length: number) {
  const span = Math.max(0.05, length - l.start);
  return l.start + (t % span);
}
