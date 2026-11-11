// 樽見 OTO ストロークの文字を、線が書かれていく動きつきで canvas に描く。
// animation.ts / geometry.ts / types.ts は ../font/src/core からの写し (フォントのアプリ・Web と同じ計算)。
// 線のデータは public/fonts/TarumiOTOStroke-Regular.stroke.json (../web/public/fonts からの写し)
import { buildTimeline, progressAt, type Timeline } from './animation';
import type { FontFile, Metrics, StrokeAnim, StrokePath } from './types';

type BundleGlyph = { id: string; char: string; alternateOf?: string; advance: number; baseline: number; paths: StrokePath[]; strokes: StrokeAnim[] };
type Bundle = {
  unitsPerEm: number;
  metrics: Metrics;
  stroke: FontFile['stroke'];
  animation: FontFile['animation'];
  kerning?: Record<string, Record<string, number>>;
  glyphs: BundleGlyph[];
};
type Prepared = { glyph: BundleGlyph; timeline: Timeline; paths: Path2D[] };

export type MotionOrder = 'sequential' | 'stagger' | 'together';
export type Motion = { on: boolean; start: number; duration: number; order: MotionOrder };
export const DEFAULT_MOTION: Motion = { on: true, start: 0, duration: 0, order: 'stagger' };
export const STROKE_FAMILY = 'Tarumi OTO Stroke';
const STAGGER = 0.1;

let bundle: Bundle | null = null;
let byChar = new Map<string, BundleGlyph>();
const prepared = new Map<string, Prepared>();
let pending: Promise<void> | null = null;

/** 線のデータを読む (1 回だけ)。読めたら描けるようになる */
export function loadStroke(): Promise<void> {
  pending ??= fetch('/fonts/TarumiOTOStroke-Regular.stroke.json')
    .then((r) => {
      if (!r.ok) throw new Error(`stroke.json: ${r.status}`);
      return r.json();
    })
    .then((b: Bundle) => {
      byChar = new Map(b.glyphs.filter((g) => !g.alternateOf).map((g) => [g.char, g]));
      bundle = b;
    });
  return pending;
}
export const strokeReady = () => bundle !== null;

function prepare(ch: string): Prepared | null {
  const glyph = byChar.get(ch);
  if (!glyph || !bundle) return null;
  let p = prepared.get(glyph.id);
  if (!p) {
    const timeline = buildTimeline({ paths: glyph.paths, animation: { strokes: glyph.strokes } }, bundle.animation);
    p = { glyph, timeline, paths: timeline.items.map((i) => new Path2D(i.d)) };
    prepared.set(glyph.id, p);
  }
  return p;
}

type Placed = { ch: string; x: number; line: number; offset: number; p: Prepared | null; sc: number };
type Plan = { placed: Placed[]; widths: number[]; total: number; missing: string[] };

/**
 * 文字を並べ、書き始める時刻を決める。x は行の左端からの px。
 * measure: フォントに無い文字の幅 (px) を返す
 */
function plan(lines: string[], size: number, tracking: number, order: MotionOrder, measure: (ch: string) => number, extra?: (row: number, j: number) => number, scaleOf?: (row: number, j: number) => number): Plan {
  const b = bundle!;
  const k = size / b.unitsPerEm;
  const sp = size * tracking;
  const placed: Placed[] = [];
  const widths: number[] = [];
  const missing: string[] = [];
  let cursor = 0;
  let index = 0;
  let total = 0;
  lines.forEach((line, row) => {
    let x = 0;
    let prev: BundleGlyph | null = null;
    let j = 0; // 行の中の位置 (UTF-16)
    let tail = 0; // 最後の文字のあとに付けた字間
    for (const ch of Array.from(line)) {
      const p = prepare(ch);
      if (extra) x += extra(row, j); // 個別の字間
      const sc = p && scaleOf ? scaleOf(row, j) : 1; // 文字ごとの大きさ (フォントに無い文字は変えない)
      j += ch.length;
      if (p && prev) x += (b.kerning?.[prev.char]?.[p.glyph.char] ?? 0) * k * sc;
      const offset = order === 'sequential' ? cursor : order === 'stagger' ? index * STAGGER : 0;
      placed.push({ ch, x, line: row, offset, p, sc });
      if (p) {
        if (p.timeline.items.length) {
          cursor = offset + p.timeline.duration + b.animation.gap;
          total = Math.max(total, offset + p.timeline.duration);
          index++;
        }
        x += (p.glyph.advance * k + sp) * sc;
        tail = sp * sc;
      } else {
        if (ch.trim() && !missing.includes(ch)) missing.push(ch);
        x += measure(ch) + sp;
        tail = sp;
      }
      prev = p?.glyph ?? null;
    }
    widths.push(Math.max(0, x - tail));
  });
  return { placed, widths, total, missing };
}

/** 全部を書き終えるまでの、フォントの既定の速さでの秒数と、フォントに無い文字 */
export function strokeInfo(text: string, order: MotionOrder) {
  if (!bundle) return { natural: 0, missing: [] as string[] };
  const p = plan(text.split('\n'), 100, 0, order, () => 50);
  return { natural: p.total, missing: p.missing };
}

type Target = { x: number; y: number; w: number; size: number; tracking: number; color: string; align: 'left' | 'center' | 'right'; text: string };

/**
 * 折り返した行 lines を、線で描く。baseline(i) は i 行目のベースラインの y。
 * time: 全体の時刻 (秒)。null なら書き終えた状態
 */
export function drawStrokeText(ctx: CanvasRenderingContext2D, l: Target, lines: string[], baseline: (i: number) => number, motion: Motion, time: number | null, extra?: (row: number, j: number) => number, scaleOf?: (row: number, j: number) => number) {
  const b = bundle;
  if (!b) return false;
  const k = l.size / b.unitsPerEm;
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const pl = plan(lines, l.size, l.tracking, motion.order, (ch) => ctx.measureText(ch).width, extra, scaleOf);
  // 秒数を決めてあれば、その長さに収まるよう速さを変える
  const rate = motion.duration > 0 && pl.total > 0 ? pl.total / motion.duration : 1;
  const t = time === null ? Infinity : (time - motion.start) * rate;
  ctx.strokeStyle = l.color;
  ctx.fillStyle = l.color;
  ctx.lineWidth = b.stroke.width;
  ctx.lineCap = b.stroke.cap as CanvasLineCap;
  ctx.lineJoin = b.stroke.join as CanvasLineJoin;
  for (const g of pl.placed) {
    const lw = pl.widths[g.line];
    const x0 = l.align === 'left' ? l.x : l.align === 'center' ? l.x + (l.w - lw) / 2 : l.x + l.w - lw;
    const y = baseline(g.line);
    if (!g.p) {
      // フォントに無い文字は動かせないので、順番が来たらそのまま出す
      if (t >= g.offset && time !== null ? true : time === null) ctx.fillText(g.ch, x0 + g.x, y);
      continue;
    }
    ctx.save();
    ctx.translate(x0 + g.x, y);
    ctx.scale(k * g.sc, -k * g.sc); // フォントの座標は上が正
    g.p.timeline.items.forEach((item, i) => {
      const p = progressAt(item, t - g.offset);
      if (p <= 0) return;
      ctx.setLineDash(p >= 1 || item.length === 0 ? [] : [item.length * p, item.length + b.stroke.width * 2]);
      ctx.stroke(g.p!.paths[i]);
    });
    ctx.restore();
  }
  ctx.setLineDash([]);
  return true;
}
