// アニメーション指定 (animation.strokes) から、再生用のタイムラインを組み立てる。
// エディターのプレビューと再生ランタイムで同じ計算を使う。
import { branchesFrom, clampOrigin, lengthOf, segLength, segsToD, splitSeg, type Seg } from './geometry';
import type { Easing, FontFile, Glyph, StrokeAnim, StrokePath } from './types';

export interface TimelineItem {
  pathId: string;
  /** SVG の d (フォント座標, y-up)。描き始めの点から始まる */
  d: string;
  segs: Seg[];
  length: number;
  start: number;
  duration: number;
  easing: Easing;
}

export interface Timeline {
  duration: number;
  items: TimelineItem[];
}

export type AnimDefaults = FontFile['animation'];

/** パスの初期指定。先頭ノードから順方向 */
export function defaultStroke(path: StrokePath, order: number): StrokeAnim {
  return { path: path.id, order, origin: 0, direction: 'forward' };
}

/**
 * パスとアニメーション指定の対応を揃える。
 * - 存在しないパスを指す指定は捨てる
 * - 指定の無いパスは末尾の順番として追加する
 * - origin をパスの範囲に収める
 */
export function normalizeStrokes(paths: StrokePath[], strokes: StrokeAnim[]): StrokeAnim[] {
  const byId = new Map(paths.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: StrokeAnim[] = [];
  for (const s of strokes) {
    const p = byId.get(s.path);
    if (!p || seen.has(s.path)) continue;
    seen.add(s.path);
    out.push({ ...s, origin: clampOrigin(p, s.origin), order: Math.max(1, Math.round(s.order || 1)) });
  }
  let next = out.reduce((m, s) => Math.max(m, s.order), 0) + 1;
  for (const p of paths) {
    if (!seen.has(p.id)) out.push(defaultStroke(p, next++));
  }
  return out;
}

/** order の番号を 1,2,3... に詰め直す (同じ番号どうしの関係は保つ) */
export function compactOrders(strokes: StrokeAnim[]): StrokeAnim[] {
  const orders = [...new Set(strokes.map((s) => s.order))].sort((a, b) => a - b);
  const map = new Map(orders.map((o, i) => [o, i + 1]));
  return strokes.map((s) => ({ ...s, order: map.get(s.order) ?? s.order }));
}

/**
 * ストロークの順番を動かす。同時グループに属している場合はグループから抜ける。
 * gap は順番の並びのすき間の番号 (0 = 1番の前, 1 = 1番と2番の間, ...)
 */
export function moveStroke(strokes: StrokeAnim[], id: string, gap: number): StrokeAnim[] {
  const compact = compactOrders(strokes);
  const groups: string[][] = [];
  for (const s of compact) (groups[s.order - 1] ??= []).push(s.path);
  const gi = groups.findIndex((g) => g.includes(id));
  if (gi < 0) return compact;
  groups[gi] = groups[gi].filter((x) => x !== id);
  groups.splice(Math.max(0, Math.min(gap, groups.length)), 0, [id]);
  const order = new Map<string, number>();
  groups.filter((g) => g.length > 0).forEach((g, i) => g.forEach((x) => order.set(x, i + 1)));
  return compact.map((s) => ({ ...s, order: order.get(s.path) ?? s.order }));
}

function splitAtLength(segs: Seg[], target: number): [Seg[], Seg[]] {
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    const l = segLength(segs[i]);
    if (acc + l >= target) {
      const t = l > 0 ? (target - acc) / l : 0;
      if (t <= 1e-6) return [segs.slice(0, i), segs.slice(i)];
      if (t >= 1 - 1e-6) return [segs.slice(0, i + 1), segs.slice(i + 1)];
      const [a, b] = splitSeg(segs[i], t);
      return [[...segs.slice(0, i), a], [b, ...segs.slice(i + 1)]];
    }
    acc += l;
  }
  return [segs, []];
}

/** 1本のストローク指定を、描き始めの点から伸びる枝 (1本または2本) にする */
export function branchesOf(path: StrokePath, anim: StrokeAnim): Seg[][] {
  const { fwd, bwd } = branchesFrom(path, anim.origin);
  if (anim.direction === 'forward') return fwd.length ? [fwd] : bwd.length ? [bwd] : [];
  if (anim.direction === 'backward') return bwd.length ? [bwd] : fwd.length ? [fwd] : [];
  if (path.closed) {
    // 閉じたパスを両方向に描くときは、反対側で出会うように半周ずつにする
    const [a, b] = splitAtLength(fwd, lengthOf(fwd) / 2);
    const back = b
      .slice()
      .reverse()
      .map((s) => ({ p0: s.p3, p1: s.p2, p2: s.p1, p3: s.p0, line: s.line }));
    return [a, back].filter((x) => x.length);
  }
  return [fwd, bwd].filter((x) => x.length);
}

export function buildTimeline(glyph: Pick<Glyph, 'paths' | 'animation'>, defaults: AnimDefaults): Timeline {
  const byId = new Map(glyph.paths.map((p) => [p.id, p]));
  const strokes = normalizeStrokes(glyph.paths, glyph.animation?.strokes ?? []);
  const orders = [...new Set(strokes.map((s) => s.order))].sort((a, b) => a - b);
  const speed = Math.max(defaults.unitsPerSecond, 1);
  const items: TimelineItem[] = [];
  let cursor = 0;
  orders.forEach((order, idx) => {
    const stepStart = idx === 0 ? 0 : cursor + defaults.gap;
    let stepEnd = stepStart;
    for (const s of strokes.filter((x) => x.order === order)) {
      const path = byId.get(s.path)!;
      const branches = branchesOf(path, s);
      const lengths = branches.map(lengthOf);
      const longest = Math.max(0, ...lengths);
      // 点 (長さ0) でも一瞬で出るのではなく、わずかに時間を取る
      const total = s.duration ?? Math.max(longest / speed, 0.05);
      const start = stepStart + (s.delay ?? 0);
      branches.forEach((segs, i) => {
        const ratio = longest > 0 ? lengths[i] / longest : 1;
        items.push({
          pathId: s.path,
          d: segsToD(segs),
          segs,
          length: lengths[i],
          start,
          duration: Math.max(total * ratio, 0.001),
          easing: defaults.easing,
        });
      });
      if (!branches.length && path.nodes.length === 1) {
        const n = path.nodes[0];
        items.push({
          pathId: s.path,
          d: `M${n.x} ${n.y}L${n.x} ${n.y}`,
          segs: [],
          length: 0,
          start,
          duration: total,
          easing: defaults.easing,
        });
      }
      stepEnd = Math.max(stepEnd, start + total);
    }
    cursor = stepEnd;
  });
  return { duration: cursor, items };
}

export function ease(kind: Easing, t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  switch (kind) {
    case 'ease-in':
      return x * x;
    case 'ease-out':
      return 1 - (1 - x) * (1 - x);
    case 'ease-in-out':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    default:
      return x;
  }
}

/** 時刻 t における各枝の進み具合 (0〜1) */
export function progressAt(item: TimelineItem, t: number): number {
  if (t <= item.start) return 0;
  return ease(item.easing, (t - item.start) / item.duration);
}
