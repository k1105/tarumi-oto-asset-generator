// ドキュメント (1 つの投稿) の形と、その操作。テンプレートも同じ形 (中身の入っていない枠 = プレースホルダー)
import { STROKE_FAMILY, type Motion } from './stroke/draw';

export const ASPECTS = [
  { id: '1:1', w: 1080, h: 1080, note: '正方形' },
  { id: '3:4', w: 1080, h: 1440, note: 'Instagram の通常投稿' },
  { id: '4:5', w: 1080, h: 1350, note: 'Instagram の旧縦長' },
  { id: '4:3', w: 1440, h: 1080, note: '横長 (4:3)' },
  { id: '16:9', w: 1920, h: 1080, note: '横長' },
  { id: '9:16', w: 1080, h: 1920, note: 'リール・ストーリーズ' },
] as const;
export type AspectId = (typeof ASPECTS)[number]['id'];
export const aspectOf = (id: string) => ASPECTS.find((a) => a.id === id) ?? ASPECTS[1];

// 欧文は Helvetica だけ (和文の書体の前に置くので、英数字は Helvetica で組まれる)。樽見 OTO ストロークは自前の英数字を持つ
export const FONTS = [
  { label: 'Helvetica + ヒラギノ角ゴ', family: 'Helvetica, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif' },
  { label: 'Helvetica + ヒラギノ明朝', family: 'Helvetica, "Hiragino Mincho ProN", serif' },
  { label: '樽見 OTO ストローク', family: '"Tarumi OTO Stroke", Helvetica, "Hiragino Sans", sans-serif' },
] as const;
/** 保存されていた書体を、今の一覧のどれかにする (前の版の書体は近いものへ) */
export const fontFor = (family: string) => (FONTS.find((f) => f.family === family) ?? FONTS[family.includes('Tarumi') ? 2 : family.includes('Mincho') ? 1 : 0]).family;
export const isStroke = (l: { font: string }) => l.font.includes(STROKE_FAMILY);
export const WEIGHTS = [
  { label: '細い', value: 300 },
  { label: '標準', value: 400 },
  { label: '中太', value: 600 },
  { label: '太い', value: 800 },
] as const;

// すぐ選べる色。緑は Web (web/app/globals.css の --green) と同じ
export const PALETTE = [
  { label: 'BLK', value: '#000000' },
  { label: 'WHITE', value: '#ffffff' },
  { label: 'GREEN', value: '#00ff36' },
] as const;

export type MediaKind = 'image' | 'video';
export type Align = 'left' | 'center' | 'right';

type Base = {
  id: string; x: number; y: number; w: number; h: number; opacity: number; hidden?: boolean; locked?: boolean;
  tpl?: string; // テンプレートから来たレイヤーの印 (テンプレートの中での id)。テンプレートを差し替えると入れ替わる
  page?: number; // tpl のあるレイヤーが、何枚目のアートボードのテンプレートのものか (0 から)
};

/** 画像か動画を入れる枠。src が無いあいだはプレースホルダー */
export type MediaLayer = Base & {
  type: 'media';
  kind: MediaKind;
  src: string | null;
  name: string; // 入っている素材の名前
  zoom: number; // 1 = 枠をちょうど覆う
  cx: number; // はみ出た分のどこを見せるか (0 = 左 / 上、0.5 = 中央、1 = 右 / 下)
  cy: number;
  start: number; // 動画の頭出し (秒)
  volume: number; // 動画の音量 (0 〜 1)
  muted: boolean;
  shape?: Shape; // 切り抜く形。無ければ四角
  tone?: Tone; // 2 値化。無ければ掛けない
};

/** 2 値化 (advertising の組み合わせ・web の開催の背景の写真と同じ式): 輝度が threshold より明るければ light、暗ければ dark の色 */
export type Tone = { on: boolean; threshold: number; dark: string; light: string };
/** 既定の 2 値化。advertising (lib/combo-plan.ts の DEFAULT_TONE) と同じ値 */
export const DEFAULT_TONE: Tone = { on: false, threshold: 0.77, dark: '#c7faff', light: '#ffffff' };

/** 切り抜く形。Web の写真の枠 (KV の窓) と同じ 2 種類: round = 角の丸みが大きい窓、square = 角の丸みが小さい窓 */
export type Shape = 'rect' | 'round' | 'square';
/** 角の丸み (px)。Web と同じく、幅に対する比で決める */
export const radiusOf = (l: Pick<MediaLayer, 'w' | 'h' | 'shape'>) =>
  l.shape === 'round' || l.shape === 'square' ? Math.min(l.w * (l.shape === 'round' ? 0.155 : 0.057), l.w / 2, l.h / 2) : 0;

/** テキスト。高さは中身で決まる (h は使わない) */
export type TextLayer = Base & {
  type: 'text';
  text: string;
  scale?: number[]; // 文字ごとの大きさ。scale[i] = text の i 文字目 (UTF-16 の位置) の、size に対する倍率。無ければ 1
  kern?: number[]; // 文字間の個別の調整。kern[i] = text の i 文字目 (UTF-16 の位置) の手前に足す幅 (文字の大きさに対する割合)。無ければ 0
  font: string;
  size: number;
  weight: number;
  color: string;
  align: Align;
  lineHeight: number; // 文字の大きさに対する倍率
  tracking: number; // 字間 (em)
  motion?: Motion; // 線が書かれていく動き (樽見 OTO ストロークのときだけ効く)
  valign?: 'top' | 'middle'; // y の意味。top (既定) = 上の端で、文章が増えると下へ伸びる。middle = 上下の中央で、上下へ伸びる
  box?: TextBox | null; // 文章の後ろに敷く札。文章の大きさに余白を足した大きさになり、左右は幅 w の中央に来る
};

/** 色面 (帯など) */
export type RectLayer = Base & { type: 'rect'; fill: string; stroke: string; strokeWidth: number }; // fill が '' なら塗らない (縁だけ)。縁は内側に付く。strokeWidth 0 = 縁なし

/** テキストの後ろの札。余白は縁の内側から文章まで。縁は strokeWidth 0 で無し */
export type TextBox = { fill: string; stroke: string; strokeWidth: number; padX: number; padY: number };
export const DEFAULT_BOX: TextBox = { fill: '#ffffff', stroke: '#00ff36', strokeWidth: 16, padX: 72, padY: 64 };

export type Layer = MediaLayer | TextLayer | RectLayer;

export type Doc = {
  version: 1;
  id: string;
  name: string;
  aspect: AspectId;
  w: number;
  h: number;
  bgColor: string;
  bg: MediaLayer; // 背景。画面いっぱいの枠で、画像も動画も入る
  layers: Layer[]; // 下から上の順
  duration: number | null; // 動画の長さ (秒)。null = 入っている動画に合わせる
  templates: (string | null)[]; // アートボードごとに当てているテンプレートの id (無ければ null)。長さは count
  count: number; // 横に並べるアートボードの枚数。w は 1 枚の幅で、紙面の幅は w x count
};

export const MAX_COUNT = 10;
/** 紙面ぜんたいの幅 (アートボードを横に並べた幅) */
export const fullW = (doc: Pick<Doc, 'w' | 'count'>) => doc.w * doc.count;

export const BG_ID = 'bg';
export const uid = () => Math.random().toString(36).slice(2, 10);

const media = (p: Partial<MediaLayer>): MediaLayer => ({
  type: 'media', id: uid(), kind: 'image', src: null, name: '', x: 0, y: 0, w: 100, h: 100, opacity: 1, zoom: 1, cx: 0.5, cy: 0.5, start: 0, volume: 1, muted: false, ...p,
  // 前の版は、樽見の写真をその場で縮小して出していた (/api/presets/proxy/<大きさ>/<区分>/<名前>.jpg)。今は public/presets/<大きさ>/<名前>.jpg
  ...(typeof p.src === 'string' ? { src: p.src.replace(/^\/api\/presets\/proxy\/(thumb|view)\/[^/]+\//, '/presets/$1/') } : {}),
});

export function newDoc(aspect: AspectId = '3:4', name = '名称未設定'): Doc {
  const a = aspectOf(aspect);
  return { version: 1, id: `p-${Date.now().toString(36)}-${uid().slice(0, 4)}`, name, aspect: a.id, w: a.w, h: a.h, bgColor: '#ffffff', bg: media({ id: BG_ID, w: a.w, h: a.h }), layers: [], duration: null, count: 1, templates: [null] };
}

/** 読んだ JSON を今の形に整える (足りない値は既定で埋める) */
export function normalize(raw: unknown): Doc | null {
  const d = raw as Partial<Doc> | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.layers)) return null;
  const base = newDoc(aspectOf(String(d.aspect)).id, typeof d.name === 'string' ? d.name : undefined);
  const doc: Doc = { ...base, id: typeof d.id === 'string' ? d.id : base.id, bgColor: d.bgColor ?? base.bgColor, duration: typeof d.duration === 'number' ? d.duration : null, count: Math.min(MAX_COUNT, Math.max(1, Math.round(Number(d.count) || 1))) };
  // 前の版は、全体で 1 つのテンプレート (template) だった。それは 1 枚目のものとして読む
  const old = (d as { template?: unknown }).template;
  const list: unknown[] = Array.isArray(d.templates) ? d.templates : [old];
  doc.templates = Array.from({ length: doc.count }, (_, i) => (typeof list[i] === 'string' ? (list[i] as string) : null));
  doc.bg = media({ ...(d.bg ?? {}), id: BG_ID, x: 0, y: 0, w: fullW(doc), h: doc.h });
  doc.layers = d.layers
    .filter((l) => l && (l.type === 'media' || l.type === 'text' || l.type === 'rect'))
    .map((l) => (l.type === 'media' ? media(l) : l.type === 'rect' ? { ...newRect(doc), ...l } : { ...newText(doc), ...l, font: fontFor(String(l.font ?? '')) }));
  return doc;
}

export function newMedia(doc: Doc, kind: MediaKind): MediaLayer {
  const w = Math.round(doc.w * 0.5);
  const h = kind === 'video' ? Math.round((w * 9) / 16) : w;
  return media({ kind, w, h, x: Math.round((doc.w - w) / 2), y: Math.round((doc.h - h) / 2) });
}

export function newRect(doc: Doc): RectLayer {
  const h = Math.round(doc.h * 0.18);
  return { type: 'rect', id: uid(), fill: PALETTE[2].value, stroke: PALETTE[2].value, strokeWidth: 0, x: 0, y: doc.h - h, w: doc.w, h, opacity: 1 };
}

export function newText(doc: Doc): TextLayer {
  const w = Math.round(doc.w * 0.7);
  return {
    type: 'text', id: uid(), text: 'テキスト', font: FONTS[0].family, size: 72, weight: 600, color: '#000000', align: 'left', lineHeight: 1.4, tracking: 0,
    x: Math.round((doc.w - w) / 2), y: Math.round(doc.h / 2 - 50), w, h: 0, opacity: 1,
  };
}

export const allLayers = (doc: Doc): Layer[] => [doc.bg, ...doc.layers];
export const findLayer = (doc: Doc, id: string | null) => (id ? allLayers(doc).find((l) => l.id === id) ?? null : null);

export function patchLayer(doc: Doc, id: string, patch: Partial<MediaLayer> | Partial<TextLayer> | Partial<RectLayer>): Doc {
  if (id === BG_ID) return { ...doc, bg: { ...doc.bg, ...(patch as Partial<MediaLayer>), id: BG_ID, x: 0, y: 0, w: fullW(doc), h: doc.h } };
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) };
}

/**
 * 縦横比を変える。枠・色面・テキストは形を保ったまま、紙面の短い辺の比で大きさを変える。
 * 左右も上下も、中央にあるものは中央のまま、ほかは近いほうの端からの距離を保つ (下の帯は下、右下のロゴは右下に付いたまま)。
 * 紙面の幅 (高さ) いっぱいのものは、いっぱいのままにする
 */
export function setAspect(doc: Doc, aspect: AspectId): Doc {
  const a = aspectOf(aspect);
  // 短い辺どうしの比 (行って戻っても同じ大きさになる。今の縦横比はどれも短い辺が 1080 なので、大きさは変わらない)
  const s = Math.min(a.w, a.h) / Math.min(doc.w, doc.h);
  const W = fullW(doc);
  const W2 = a.w * doc.count;
  const r = Math.round;
  // 1 つの向きの位置と大きさ。端から端までのものはそのまま、中央にあるものは中央、ほかは近いほうの端からの距離を保つ
  const along = (pos: number, size: number, full: number, full2: number): [number, number] => {
    if (pos <= 0 && pos + size >= full) return [0, full2];
    const size2 = size * s;
    const lo = pos;
    const hi = full - (pos + size);
    if (Math.abs(lo - hi) <= full * 0.02) return [(full2 - size2) / 2, size2];
    return [hi < lo ? full2 - hi * s - size2 : lo * s, size2];
  };
  const place = (l: Layer, h0: number) => {
    const [y, h] = along(l.y, h0, doc.h, a.h);
    // 左右は、横に並べた全体にまたがるものは全体で、ほかはそのレイヤーのあるアートボードの中で考える
    if (l.x <= 0 && l.x + l.w >= W) return { x: 0, y: r(y), w: W2, h: r(h) };
    const page = l.tpl ? l.page ?? 0 : Math.min(doc.count - 1, Math.max(0, Math.floor((l.x + l.w / 2) / doc.w)));
    const [x, w] = along(l.x - page * doc.w, l.w, doc.w, a.w);
    return { x: r(x + page * a.w), y: r(y), w: r(w), h: r(h) };
  };
  return {
    ...doc, aspect: a.id, w: a.w, h: a.h,
    bg: { ...doc.bg, w: W2, h: a.h },
    layers: doc.layers.map((l) => {
      if (l.type === 'rect') return { ...l, ...place(l, l.h), strokeWidth: r(l.strokeWidth * s) };
      if (l.type !== 'text') return { ...l, ...place(l, l.h) };
      // テキストの高さは行数からの見当 (折り返しは数えない)
      const h0 = l.text.split('\n').length * l.size * l.lineHeight;
      const mid = l.valign === 'middle';
      const p = place(mid ? { ...l, y: l.y - h0 / 2 } : l, h0);
      const box = l.box ? { ...l.box, strokeWidth: r(l.box.strokeWidth * s), padX: r(l.box.padX * s), padY: r(l.box.padY * s) } : l.box;
      return { ...l, x: p.x, y: mid ? r(p.y + (h0 * s) / 2) : p.y, w: p.w, size: Math.max(8, r(l.size * s)), box };
    }),
  };
}

/**
 * page 枚目のアートボードにテンプレートを当てる・差し替える (next が null なら外す)。prev はそこに今当てているテンプレート。
 * 背景・縦横比・枚数、自分で足したレイヤー、ほかのアートボードのテンプレートはそのまま。そのアートボードのテンプレートのレイヤーだけを入れ替え、
 * 書き換えたテキストと枠に入れた素材は、新しいテンプレートの同じ種類の場所へ順に移す。
 * 移す先が無いものは消さずに、隠したレイヤーとして取っておき、次に場所のあるテンプレートへ差し替えたときに戻す
 */
export function applyTemplate(doc: Doc, page: number, next: { id: string; doc: unknown } | null, prev: Doc | null): Doc {
  const rest: Layer[] = []; // 自分で足したものと、ほかのアートボードのテンプレートのもの
  const texts: TextLayer[] = []; // テンプレートの場所に書いた文章
  const medias: MediaLayer[] = []; // テンプレートの枠に入れた素材
  for (const l of doc.layers) {
    if (!l.tpl || (l.page ?? 0) !== page) {
      rest.push(l);
      continue;
    }
    const was = prev?.layers.find((x) => x.id === l.tpl);
    if (l.type === 'text' && (was?.type !== 'text' || was.text !== l.text)) texts.push(l);
    if (l.type === 'media' && l.src && (was?.type !== 'media' || was.src !== l.src)) medias.push(l);
  }

  let fresh: Layer[] = [];
  const t = next ? normalize(next.doc) : null;
  if (t) {
    // テンプレートを今の縦横比に合わせ、そのアートボードの位置へずらす
    fresh = setAspect({ ...t, count: 1 }, doc.aspect).layers.map((l): Layer => {
      const base = { ...l, id: uid(), tpl: l.id, page, x: l.x + page * doc.w };
      if (base.type === 'text') {
        const from = texts.shift();
        return from ? { ...base, text: from.text, kern: from.kern, scale: from.scale } : base;
      }
      if (base.type === 'media' && !base.src) {
        const i = medias.findIndex((m) => m.kind === base.kind);
        if (i < 0) return base;
        const [m] = medias.splice(i, 1);
        return { ...base, src: m.src, name: m.name, zoom: m.zoom, cx: m.cx, cy: m.cy, start: m.start, volume: m.volume, muted: m.muted };
      }
      return base;
    });
  }
  // 移す先が無かったものは、隠して取っておく (次に差し替えたテンプレートに場所があれば、そこへ入る)
  const keep = (l: Layer): Layer => ({ ...l, tpl: 'orphan', page, hidden: true });
  const templates = doc.templates.map((id, i) => (i === page ? (t ? next!.id : null) : id));
  return { ...doc, templates, layers: [...fresh, ...rest, ...texts.map(keep), ...medias.map(keep)] };
}

/** 横に並べる枚数を変える (背景は全体に広がる。自分で足した枠とテキストは動かさない) */
export function setCount(doc: Doc, count: number): Doc {
  const n = Math.min(MAX_COUNT, Math.max(1, Math.round(count)));
  if (n === doc.count) return doc;
  // 減らしたアートボードのテンプレートのレイヤーは、いっしょに消す
  const layers = doc.layers.filter((l) => !(l.tpl && (l.page ?? 0) >= n));
  const templates = Array.from({ length: n }, (_, i) => doc.templates[i] ?? null);
  return { ...doc, count: n, templates, layers, bg: { ...doc.bg, w: doc.w * n } };
}

export const hasMotion = (doc: Doc) => doc.layers.some((l) => l.type === 'text' && !l.hidden && !!l.motion?.on && isStroke(l));
export const hasVideo = (doc: Doc) => allLayers(doc).some((l) => l.type === 'media' && l.kind === 'video' && l.src && !l.hidden);

export function layerLabel(l: Layer) {
  if (l.id === BG_ID) return '背景';
  if (l.type === 'text') return l.text.split('\n')[0].slice(0, 24) || 'テキスト';
  if (l.type === 'rect') return '色面';
  return l.src ? l.name || (l.kind === 'video' ? '動画' : '画像') : l.kind === 'video' ? '動画の枠' : '画像の枠';
}

export const ACCOUNT = { name: '樽見OTO鉄道', handle: 'tarumi_oto' };

/** 文章を書き換える。個別の字間 (kern) と文字ごとの大きさ (scale) は、変わらなかった前後の部分に付いていたものを残す。打ち足した文字は、直前の文字の大きさになる */
export function retext(l: TextLayer, text: string): Partial<TextLayer> {
  const old = l.text;
  const hasKern = l.kern?.some(Boolean);
  const hasScale = l.scale?.some((v) => v && v !== 1);
  if ((!hasKern && !hasScale) || old === text) return { text };
  let p = 0;
  while (p < old.length && p < text.length && old[p] === text[p]) p++;
  let s = 0;
  while (s < old.length - p && s < text.length - p && old[old.length - 1 - s] === text[text.length - 1 - s]) s++;
  const out: Partial<TextLayer> = { text };
  if (hasKern) {
    const kern = new Array<number>(text.length).fill(0);
    for (let i = 1; i < p; i++) kern[i] = l.kern![i] ?? 0;
    for (let i = 1; i < s; i++) kern[text.length - s + i] = l.kern![old.length - s + i] ?? 0;
    out.kern = kern;
  }
  if (hasScale) {
    const scale = new Array<number>(text.length).fill(p > 0 ? l.scale![p - 1] || 1 : 1);
    for (let i = 0; i < p; i++) scale[i] = l.scale![i] || 1;
    for (let i = 0; i < s; i++) scale[text.length - s + i] = l.scale![old.length - s + i] || 1;
    out.scale = scale;
  }
  return out;
}
