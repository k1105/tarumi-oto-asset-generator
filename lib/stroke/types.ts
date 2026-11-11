// データ形式の定義。data/font.json, data/glyphs/*.json, data/reference/*.json と対応する。
// 座標はすべてフォント座標 (unitsPerEm 基準, y-up, ベースライン y=0)。

export type Cap = 'round' | 'butt' | 'square';
export type Join = 'round' | 'miter' | 'bevel';
export type Direction = 'forward' | 'backward' | 'both';
/** パスの由来。manual = 手作業 (Illustrator で描いたもの) / auto = 自動トレース / empty = 未作成 */
export type GlyphStatus = 'manual' | 'auto' | 'empty';

export interface Metrics {
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
  baseline: number;
}

export interface FontFile {
  formatVersion: 1;
  family: string;
  style: string;
  unitsPerEm: number;
  /** フォント全体の既定値。グリフ側の guides で個別に上書きできる */
  metrics: Metrics;
  stroke: { width: number; cap: Cap; join: Join };
  /** アニメーションのタイミングの既定値 */
  animation: {
    /** 描画速度 (units/秒)。duration を指定していないストロークの長さから所要時間を決める */
    unitsPerSecond: number;
    /** 次の order に移るまでの間 (秒) */
    gap: number;
    easing: Easing;
  };
  /**
   * 英数字 (U+0020〜U+007E とその異体字) を和文に対してどう置くか。
   * グリフのデータは変えず、組むとき (プレビュー・OTF・Web 再生) に中心線へ掛ける。線幅は変えない
   */
  latin: LatinPlacement;
}

export interface LatinPlacement {
  /** 拡大率。1 = そのまま */
  scale: number;
  /** 上下位置 (units)。負の値で下がる。拡大した後に足す */
  shift: number;
}

export const NO_LATIN_PLACEMENT: LatinPlacement = { scale: 1, shift: 0 };

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface PathNode {
  x: number;
  y: number;
  /** 入ってくる側のハンドル (絶対座標)。無ければ直線 */
  in?: [number, number];
  /** 出ていく側のハンドル (絶対座標) */
  out?: [number, number];
}

export interface StrokePath {
  id: string;
  closed: boolean;
  nodes: PathNode[];
}

export interface StrokeAnim {
  /** 対象パスの id */
  path: string;
  /** 出現順 (1始まり)。同じ番号のストロークは同時に描き始める */
  order: number;
  /**
   * 描き始める位置。整数部がノード番号、小数部がそのノードから次のノードまでの区間内の位置 (0〜1)。
   * 例: 0 = 先頭ノード, 2 = 3番目のノード, 2.5 = 3番目と4番目のノードの中間
   */
  origin: number;
  /** forward = ノード番号が増える向き, backward = 減る向き, both = 両方向へ同時に */
  direction: Direction;
  /** 所要時間 (秒)。省略時は 長さ / unitsPerSecond */
  duration?: number;
  /** この order の開始からの遅れ (秒) */
  delay?: number;
}

export interface GlyphAnimation {
  strokes: StrokeAnim[];
}

export interface Glyph {
  /** ファイル名を兼ねる ID。u + コードポイント4桁以上の16進 (+ .alt など) */
  id: string;
  /** OTF 内でのグリフ名 */
  name: string;
  char: string;
  /** 異体字は null */
  unicode: number | null;
  /** 異体字の場合、元のグリフの id */
  alternateOf?: string;
  advance: number;
  /** フォント全体の metrics に対するグリフ単位の上書き */
  guides: Partial<Metrics>;
  status: GlyphStatus;
  /** OK マーク。この形で確定としてよいか (由来とは独立に付け外しできる) */
  ok: boolean;
  paths: StrokePath[];
  animation: GlyphAnimation;
}

export interface Reference {
  id: string;
  char: string;
  source: string;
  condense: number;
  advance: number;
  bbox: [number, number, number, number] | null;
  d: string;
}

/** 文字の追加 (tools/add_chars.py) の結果 */
export interface AddResult {
  added: string[];
  /** すでにパスのあるグリフがあったもの */
  skipped: string[];
  failed: { char: string; reason: string }[];
}

export function resolveMetrics(font: FontFile, glyph?: Pick<Glyph, 'guides'> | null): Metrics {
  return { ...font.metrics, ...(glyph?.guides ?? {}) };
}

/** ok が入っていない古いデータ用の初期値。手作業のものは OK 扱い */
export function defaultOk(status: GlyphStatus): boolean {
  return status === 'manual';
}

/** ok が無ければ補う。キーの並びは status の直後にする */
export function withOk<T extends { status: GlyphStatus; ok?: boolean }>(glyph: T): T & { ok: boolean } {
  if (typeof glyph.ok === 'boolean') return glyph as T & { ok: boolean };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(glyph)) {
    out[k] = v;
    if (k === 'status') out.ok = defaultOk(glyph.status);
  }
  return out as T & { ok: boolean };
}

export function glyphIdOf(char: string, alt?: string): string {
  const cp = char.codePointAt(0) ?? 0;
  const base = 'u' + cp.toString(16).toUpperCase().padStart(4, '0');
  return alt ? `${base}.${alt}` : base;
}
