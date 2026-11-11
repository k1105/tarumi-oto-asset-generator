// ベジェ曲線まわりの計算。エディターと再生ランタイムの両方から使う (DOM には依存しない)。
import type { PathNode, StrokePath } from './types';

export type Pt = [number, number];
/** 3次ベジェ1区間。直線も [p0, p0, p3, p3] として持つ */
export interface Seg {
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
  line: boolean;
}

const SAMPLES = 24;

export function r1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function segCount(path: StrokePath): number {
  const n = path.nodes.length;
  if (n < 2) return 0;
  return path.closed ? n : n - 1;
}

export function segmentsOf(path: StrokePath): Seg[] {
  const out: Seg[] = [];
  const n = path.nodes.length;
  const count = segCount(path);
  for (let i = 0; i < count; i++) {
    const a = path.nodes[i];
    const b = path.nodes[(i + 1) % n];
    const line = !a.out && !b.in;
    out.push({
      p0: [a.x, a.y],
      p1: a.out ? [a.out[0], a.out[1]] : [a.x, a.y],
      p2: b.in ? [b.in[0], b.in[1]] : [b.x, b.y],
      p3: [b.x, b.y],
      line,
    });
  }
  return out;
}

export function pointAt(s: Seg, t: number): Pt {
  // 直線はハンドルがアンカーに重なった3次ベジェとして持っているので、そのまま計算すると等速にならない
  if (s.line) return [s.p0[0] + (s.p3[0] - s.p0[0]) * t, s.p0[1] + (s.p3[1] - s.p0[1]) * t];
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * s.p0[0] + b * s.p1[0] + c * s.p2[0] + d * s.p3[0],
    a * s.p0[1] + b * s.p1[1] + c * s.p2[1] + d * s.p3[1],
  ];
}

export function tangentAt(s: Seg, t: number): Pt {
  const u = 1 - t;
  if (s.line) {
    const l = Math.hypot(s.p3[0] - s.p0[0], s.p3[1] - s.p0[1]) || 1;
    return [(s.p3[0] - s.p0[0]) / l, (s.p3[1] - s.p0[1]) / l];
  }
  let x = 3 * u * u * (s.p1[0] - s.p0[0]) + 6 * u * t * (s.p2[0] - s.p1[0]) + 3 * t * t * (s.p3[0] - s.p2[0]);
  let y = 3 * u * u * (s.p1[1] - s.p0[1]) + 6 * u * t * (s.p2[1] - s.p1[1]) + 3 * t * t * (s.p3[1] - s.p2[1]);
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) {
    // ハンドルがアンカーに重なっている場合は弦の向きで代用
    x = s.p3[0] - s.p0[0];
    y = s.p3[1] - s.p0[1];
  }
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

export function segLength(s: Seg, t0 = 0, t1 = 1): number {
  if (s.line) return Math.hypot(s.p3[0] - s.p0[0], s.p3[1] - s.p0[1]) * (t1 - t0);
  let len = 0;
  let prev = pointAt(s, t0);
  for (let i = 1; i <= SAMPLES; i++) {
    const p = pointAt(s, t0 + ((t1 - t0) * i) / SAMPLES);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
}

export function splitSeg(s: Seg, t: number): [Seg, Seg] {
  if (s.line) {
    const m = pointAt(s, t);
    return [
      { p0: s.p0, p1: s.p0, p2: m, p3: m, line: true },
      { p0: m, p1: m, p2: s.p3, p3: s.p3, line: true },
    ];
  }
  const l = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a = l(s.p0, s.p1);
  const b = l(s.p1, s.p2);
  const c = l(s.p2, s.p3);
  const d = l(a, b);
  const e = l(b, c);
  const f = l(d, e);
  return [
    { p0: s.p0, p1: a, p2: d, p3: f, line: false },
    { p0: f, p1: e, p2: c, p3: s.p3, line: false },
  ];
}

export function reverseSegs(segs: Seg[]): Seg[] {
  return segs
    .slice()
    .reverse()
    .map((s) => ({ p0: s.p3, p1: s.p2, p2: s.p1, p3: s.p0, line: s.line }));
}

export function lengthOf(segs: Seg[]): number {
  return segs.reduce((a, s) => a + segLength(s), 0);
}

function f(v: number): string {
  return String(r1(v));
}

/** 区間列を SVG の d 文字列にする。flipY が true なら y を反転 (SVG の y-down 用) */
export function segsToD(segs: Seg[], closed = false, flipY = false): string {
  if (!segs.length) return '';
  const k = flipY ? -1 : 1;
  let d = `M${f(segs[0].p0[0])} ${f(k * segs[0].p0[1])}`;
  for (const s of segs) {
    if (s.line) d += `L${f(s.p3[0])} ${f(k * s.p3[1])}`;
    else
      d += `C${f(s.p1[0])} ${f(k * s.p1[1])} ${f(s.p2[0])} ${f(k * s.p2[1])} ${f(s.p3[0])} ${f(k * s.p3[1])}`;
  }
  if (closed) d += 'Z';
  return d;
}

export function pathToD(path: StrokePath, flipY = false): string {
  const segs = segmentsOf(path);
  if (!segs.length) {
    // ノード1つだけのパスは点として描く
    if (path.nodes.length === 1) {
      const n = path.nodes[0];
      const y = flipY ? -n.y : n.y;
      return `M${f(n.x)} ${f(y)}L${f(n.x)} ${f(y)}`;
    }
    return '';
  }
  return segsToD(segs, path.closed, flipY);
}

/** origin (整数部=ノード番号, 小数部=区間内の位置) を、パスの範囲に収める */
export function clampOrigin(path: StrokePath, origin: number): number {
  const n = path.nodes.length;
  if (n < 2 || !Number.isFinite(origin)) return 0;
  if (path.closed) {
    const m = ((origin % n) + n) % n;
    return m;
  }
  return Math.min(Math.max(origin, 0), n - 1);
}

export function originPoint(path: StrokePath, origin: number): Pt {
  const segs = segmentsOf(path);
  if (!segs.length) {
    const n = path.nodes[0];
    return n ? [n.x, n.y] : [0, 0];
  }
  const o = clampOrigin(path, origin);
  let i = Math.floor(o);
  let t = o - i;
  if (i >= segs.length) {
    i = segs.length - 1;
    t = 1;
  }
  return pointAt(segs[i], t);
}

/**
 * パスを origin の位置で分け、origin から出ていく2本の枝にする。
 *   fwd: origin からノード番号が増える向きに進む区間列
 *   bwd: origin からノード番号が減る向きに進む区間列
 * 閉じたパスでは fwd / bwd とも一周ぶんになる。
 */
export function branchesFrom(path: StrokePath, origin: number): { fwd: Seg[]; bwd: Seg[] } {
  const segs = segmentsOf(path);
  if (!segs.length) return { fwd: [], bwd: [] };
  const o = clampOrigin(path, origin);
  let i = Math.floor(o);
  let t = o - i;
  if (i >= segs.length) {
    i = segs.length - 1;
    t = 1;
  }
  let before = segs.slice(0, i);
  let after = segs.slice(i + 1);
  if (t <= 1e-6) {
    after = [segs[i], ...after];
  } else if (t >= 1 - 1e-6) {
    before = [...before, segs[i]];
  } else {
    const [a, b] = splitSeg(segs[i], t);
    before = [...before, a];
    after = [b, ...after];
  }
  if (path.closed) {
    const loop = [...after, ...before];
    return { fwd: loop, bwd: reverseSegs(loop) };
  }
  return { fwd: after, bwd: reverseSegs(before) };
}

export function bboxOfPaths(paths: StrokePath[]): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of paths) {
    const segs = segmentsOf(p);
    const pts: Pt[] = p.nodes.map((n) => [n.x, n.y]);
    for (const s of segs) {
      if (s.line) continue;
      for (let i = 1; i < 12; i++) pts.push(pointAt(s, i / 12));
    }
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

export function translatePath(path: StrokePath, dx: number, dy: number): StrokePath {
  const mv = (n: PathNode): PathNode => {
    const o: PathNode = { x: r1(n.x + dx), y: r1(n.y + dy) };
    if (n.in) o.in = [r1(n.in[0] + dx), r1(n.in[1] + dy)];
    if (n.out) o.out = [r1(n.out[0] + dx), r1(n.out[1] + dy)];
    return o;
  };
  return { ...path, nodes: path.nodes.map(mv) };
}

/** 区間列の先頭から dist だけ進んだ位置と、その向き */
export function pointAtLength(segs: Seg[], dist: number): { point: Pt; tangent: Pt } | null {
  if (!segs.length) return null;
  let rest = Math.max(dist, 0);
  for (const s of segs) {
    const l = segLength(s);
    if (rest <= l || s === segs[segs.length - 1]) {
      const t = l > 0 ? Math.min(rest / l, 1) : 0;
      return { point: pointAt(s, t), tangent: tangentAt(s, t) };
    }
    rest -= l;
  }
  return null;
}

/** 点 pt に最も近いパス上の位置を origin の表現 (ノード番号 + 区間内の位置) で返す */
export function nearestOrigin(path: StrokePath, pt: Pt, snap = 30): number {
  const n = path.nodes.length;
  for (let i = 0; i < n; i++) {
    if (Math.hypot(path.nodes[i].x - pt[0], path.nodes[i].y - pt[1]) <= snap) return i;
  }
  const segs = segmentsOf(path);
  let best = 0;
  let bestDist = Infinity;
  segs.forEach((s, i) => {
    for (let k = 0; k <= 60; k++) {
      const t = k / 60;
      const p = pointAt(s, t);
      const d = Math.hypot(p[0] - pt[0], p[1] - pt[1]);
      if (d < bestDist) {
        bestDist = d;
        best = i + t;
      }
    }
  });
  return clampOrigin(path, Math.round(best * 100) / 100);
}
