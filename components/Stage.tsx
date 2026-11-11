'use client';
// 紙面。canvas に描いた絵の上に、選ぶ・動かす・大きさを変える・素材を落とすための透明な枠を重ねる
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { BG_ID, allLayers, fullW, patchLayer, radiusOf, retext, type Doc, type Layer, type MediaLayer, type TextLayer } from '@/lib/doc';
import { boxOf, caretAt, cropRect, hitOf, indexAt, measureText, rangeRects, render, type Resolve } from '@/lib/render';
import Icon from './icons';

export type Mode = { kind: 'crop' | 'text'; id: string } | null;
export type Update = (fn: (d: Doc) => Doc, key?: string) => void;
type View = { zoom: number; x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** ボタンを押してから離すまで、動いた量を onMove に渡す */
function drag(e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd?: () => void) {
  const sx = e.clientX;
  const sy = e.clientY;
  const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy, ev);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onEnd?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** 上の端が top、高さ h になるときの、レイヤーの y (上下の中央を基準にしたテキストは中央の位置) */
const yOf = (l: Layer, top: number, h: number) => (l.type === 'text' && l.valign === 'middle' ? top + h / 2 : top);

/** pos から size ぶんの箱の 左・中央・右 のどれかが cands に近ければ、そこへ寄せる */
function snap(pos: number, size: number, cands: number[], th: number) {
  let best: { pos: number; guide: number; d: number } | null = null;
  for (const off of [0, size / 2, size]) {
    for (const c of cands) {
      const d = Math.abs(pos + off - c);
      if (d < th && (!best || d < best.d)) best = { pos: c - off, guide: c, d };
    }
  }
  return best;
}

type Props = {
  doc: Doc;
  sel: string | null;
  mode: Mode;
  setSel: (id: string | null) => void;
  setMode: (m: Mode) => void;
  update: Update;
  resolve: Resolve;
  tick: number; // 素材が読めたときなどに増える (描き直しの合図)
  drawRef: MutableRefObject<() => void>;
  timeRef: MutableRefObject<() => number | null>; // 文字の動きに使う今の時刻 (null = 書き終えた状態)
  templates: { id: string; name: string }[];
  onTemplate: (page: number, id: string | null) => void; // そのアートボードのテンプレートを差し替える
  fitSignal: number;
  onZoom: (zoom: number) => void;
  onDropMedia: (targetId: string, data: DataTransfer) => void;
};

export default function Stage({ doc, sel, mode, setSel, setMode, update, resolve, tick, drawRef, timeRef, templates, onTemplate, fitSignal, onZoom, onDropMedia }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ghost = useRef<HTMLCanvasElement>(null); // 切り抜き中に、枠からはみ出た分も含めた素材の全体を薄く出す
  const [view, setView] = useState<View>({ zoom: 0.4, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [guides, setGuides] = useState<{ x: number | null; y: number | null } | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [caret, setCaret] = useState({ a: 0, b: 0 }); // 入力中のテキストの、カーソル (a = b) か選んでいる範囲
  const anchor = useRef<number | null>(null); // ドラッグで範囲を選ぶときの始点
  const [panning, setPanning] = useState(false);
  const space = useRef(false);
  const latest = useRef({ doc, mode, resolve });
  latest.current = { doc, mode, resolve };

  // ---- 描く ----
  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const { doc: d, mode: m, resolve: r } = latest.current;
    if (c.width !== fullW(d) || c.height !== d.h) {
      c.width = fullW(d);
      c.height = d.h;
    }
    render(c.getContext('2d')!, d, r, { time: timeRef.current() });
    const g = ghost.current;
    const l = m?.kind === 'crop' ? allLayers(d).find((x) => x.id === m.id) : null;
    const s = g && l?.type === 'media' ? r(l) : null;
    if (g && s) {
      const k = Math.min(1, 1600 / Math.max(s.w, s.h));
      const w = Math.round(s.w * k);
      const h = Math.round(s.h * k);
      if (g.width !== w || g.height !== h) {
        g.width = w;
        g.height = h;
      }
      const gc = g.getContext('2d')!;
      gc.clearRect(0, 0, w, h);
      gc.drawImage(s.el, 0, 0, w, h);
    }
  }, [timeRef]);
  drawRef.current = draw;
  useEffect(draw, [draw, doc, mode, tick]);

  // ---- 見える範囲 ----
  const fit = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const { doc: d } = latest.current;
    const zoom = Math.max(0.05, Math.min((el.clientWidth - 120) / fullW(d), (el.clientHeight - 120) / d.h));
    setView({ zoom, x: (el.clientWidth - fullW(d) * zoom) / 2, y: (el.clientHeight - d.h * zoom) / 2 });
  }, []);
  useLayoutEffect(fit, [fit, doc.id, doc.w, doc.h, doc.count, fitSignal]);
  // 画面の大きさが変わったら合わせ直す
  useEffect(() => {
    const ro = new ResizeObserver(fit);
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, [fit]);
  useEffect(() => onZoom(view.zoom), [onZoom, view.zoom]);

  // ホイール: 切り抜き中の枠の上なら絵を拡大、Ctrl / Cmd (ピンチ) なら紙面を拡大、ほかは紙面を動かす
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { mode: m } = latest.current;
      const over = (e.target as HTMLElement).closest<HTMLElement>('[data-layer]')?.dataset.layer;
      if (m?.kind === 'crop' && over === m.id) {
        update((d) => {
          const l = allLayers(d).find((x) => x.id === m.id);
          return l?.type === 'media' ? patchLayer(d, l.id, { zoom: clamp(l.zoom * Math.exp(-e.deltaY * 0.002), 1, 8) }) : d;
        }, `zoom:${m.id}`);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        setView((v) => {
          const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.01), 0.05, 8);
          const k = zoom / v.zoom;
          return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
        });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [update]);

  // スペースを押しているあいだは、ドラッグで紙面を動かす
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e.target)) return;
      e.preventDefault();
      space.current = true;
      root.current?.classList.add('grab');
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      space.current = false;
      root.current?.classList.remove('grab');
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ---- 操作 ----
  const downStage = (e: React.PointerEvent) => {
    if (space.current || e.button === 1) {
      e.preventDefault();
      const o = viewRef.current;
      setPanning(true);
      drag(e, (dx, dy) => setView({ zoom: o.zoom, x: o.x + dx, y: o.y + dy }), () => setPanning(false));
      return;
    }
    if (e.button !== 0) return;
    setMode(null);
    setSel(null);
  };

  const startMove = (e: React.PointerEvent, l: Layer) => {
    const key = `move:${Date.now()}`;
    const o = boxOf(l);
    const others = doc.layers.filter((x) => x.id !== l.id && !x.hidden).map(boxOf);
    // アートボードごとの 左端・中央・右端 にも寄せる
    const pages = Array.from({ length: doc.count }, (_, i) => [i * doc.w, (i + 0.5) * doc.w, (i + 1) * doc.w]).flat();
    const xs = [...pages, ...others.flatMap((b) => [b.x, b.x + b.w / 2, b.x + b.w])];
    const ys = [0, doc.h / 2, doc.h, ...others.flatMap((b) => [b.y, b.y + b.h / 2, b.y + b.h])];
    drag(
      e,
      (dx, dy, ev) => {
        const z = viewRef.current.zoom;
        let x = o.x + dx / z;
        let y = o.y + dy / z;
        // Cmd / Ctrl を押しているあいだは寄せない
        const sx = ev.metaKey || ev.ctrlKey ? null : snap(x, o.w, xs, 6 / z);
        const sy = ev.metaKey || ev.ctrlKey ? null : snap(y, o.h, ys, 6 / z);
        if (sx) x = sx.pos;
        if (sy) y = sy.pos;
        setGuides({ x: sx?.guide ?? null, y: sy?.guide ?? null });
        update((d) => patchLayer(d, l.id, { x: Math.round(x), y: Math.round(yOf(l, y, o.h)) }), key);
      },
      () => setGuides(null),
    );
  };

  const startCrop = (e: React.PointerEvent, l: MediaLayer) => {
    const s = resolve(l);
    if (!s) return;
    const key = `crop:${Date.now()}`;
    const c = cropRect(l, s.w, s.h);
    const ox = s.w * c.scale - l.w; // はみ出ている量 (紙面の px)
    const oy = s.h * c.scale - l.h;
    drag(e, (dx, dy) => {
      const z = viewRef.current.zoom;
      update((d) => patchLayer(d, l.id, { cx: ox > 0.5 ? clamp(l.cx - dx / z / ox, 0, 1) : l.cx, cy: oy > 0.5 ? clamp(l.cy - dy / z / oy, 0, 1) : l.cy }), key);
    });
  };

  // 切り抜き中の素材の角を引いて拡大・縮小する (向かいの角を止める。枠より小さくはならない)
  const startCropScale = (e: React.PointerEvent, l: MediaLayer, hd: 'nw' | 'ne' | 'se' | 'sw') => {
    e.stopPropagation();
    e.preventDefault();
    const s = resolve(l);
    if (!s) return;
    const key = `cropscale:${Date.now()}`;
    const c = cropRect(l, s.w, s.h);
    const base = c.scale / Math.max(1, l.zoom);
    const o = { x: l.x - c.sx * c.scale, y: l.y - c.sy * c.scale, w: s.w * c.scale, h: s.h * c.scale };
    const ax = hd.includes('w') ? o.x + o.w : o.x;
    const ay = hd.includes('n') ? o.y + o.h : o.y;
    drag(e, (dx, dy) => {
      const z = viewRef.current.zoom;
      const ddx = (hd.includes('e') ? dx : -dx) / z;
      const ddy = (hd.includes('s') ? dy : -dy) / z;
      const zoom = clamp(Math.max(1, l.zoom) * Math.max((o.w + ddx) / o.w, (o.h + ddy) / o.h), 1, 8);
      const w = s.w * base * zoom;
      const h = s.h * base * zoom;
      const ix = hd.includes('w') ? ax - w : ax;
      const iy = hd.includes('n') ? ay - h : ay;
      const ox = w - l.w;
      const oy = h - l.h;
      update((d) => patchLayer(d, l.id, { zoom, cx: ox > 0.5 ? clamp((l.x - ix) / ox, 0, 1) : 0.5, cy: oy > 0.5 ? clamp((l.y - iy) / oy, 0, 1) : 0.5 }), key);
    });
  };

  const downLayer = (e: React.PointerEvent, l: Layer) => {
    if (e.button !== 0 || space.current) return; // 紙面を動かす操作は下に任せる
    e.stopPropagation();
    if (mode?.id === l.id) {
      if (mode.kind === 'crop' && l.type === 'media') startCrop(e, l);
      return;
    }
    if (mode) setMode(null);
    if (l.id === BG_ID) {
      setSel(l.type === 'media' && l.src ? BG_ID : null);
      return;
    }
    setSel(l.id);
    startMove(e, l);
  };

  const dblLayer = (l: Layer) => {
    if (l.type === 'text') setMode({ kind: 'text', id: l.id });
    else if (l.type === 'media' && l.src) setMode({ kind: 'crop', id: l.id });
  };

  const startResize = (e: React.PointerEvent, l: Layer, hd: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    const key = `resize:${Date.now()}`;
    const o = boxOf(l);
    drag(e, (dx, dy, ev) => {
      const z = viewRef.current.zoom;
      const ddx = (hd.includes('e') ? dx : hd.includes('w') ? -dx : 0) / z;
      const ddy = (hd.includes('s') ? dy : hd.includes('n') ? -dy : 0) / z;
      let w = o.w + ddx;
      let h = o.h + ddy;
      const r = Math.round;
      if (l.type === 'text') {
        if (hd.length === 1) {
          // 左右の取っ手は幅だけ (折り返しが変わる)
          w = Math.max(40, w);
          update((d) => patchLayer(d, l.id, { w: r(w), x: r(hd === 'w' ? o.x + o.w - w : o.x) }), key);
          return;
        }
        // 角の取っ手は文字の大きさごと拡大・縮小
        const s = Math.max(8 / l.size, w / o.w);
        w = o.w * s;
        h = o.h * s;
        update((d) => patchLayer(d, l.id, { size: r(l.size * s), w: r(w), x: r(hd.includes('w') ? o.x + o.w - w : o.x), y: r(yOf(l, hd.includes('n') ? o.y + o.h - h : o.y, h)) } as Partial<TextLayer>), key);
        return;
      }
      w = Math.max(20, w);
      h = Math.max(20, h);
      if (ev.shiftKey && hd.length === 2) {
        const ratio = o.w / o.h;
        if (w / h > ratio) h = w / ratio;
        else w = h * ratio;
      }
      update((d) => patchLayer(d, l.id, { w: r(w), h: r(h), x: r(hd.includes('w') ? o.x + o.w - w : o.x), y: r(hd.includes('n') ? o.y + o.h - h : o.y) }), key);
    });
  };

  // ---- 素材を落とす ----
  const dropTarget = (e: React.DragEvent) => (e.target as HTMLElement).closest<HTMLElement>('[data-media]')?.dataset.media ?? BG_ID;
  const over = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const id = dropTarget(e);
    if (id !== dropId) setDropId(id);
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropId(null);
    onDropMedia(dropTarget(e), e.dataTransfer);
  };

  const z = view.zoom;
  const px = (b: Box) => ({ left: b.x * z, top: b.y * z, width: b.w * z, height: b.h * z });
  const selLayer = sel ? allLayers(doc).find((l) => l.id === sel) ?? null : null;
  const selBox = selLayer ? boxOf(selLayer) : null;
  // 切り抜き中の素材の全体 (紙面の座標)
  const cropLayer = mode?.kind === 'crop' ? allLayers(doc).find((l) => l.id === mode.id) : null;
  const cropSrc = cropLayer?.type === 'media' ? resolve(cropLayer) : null;
  const crop = (() => {
    if (cropLayer?.type !== 'media' || !cropSrc) return null;
    const c = cropRect(cropLayer, cropSrc.w, cropSrc.h);
    return { l: cropLayer, box: { x: cropLayer.x - c.sx * c.scale, y: cropLayer.y - c.sy * c.scale, w: cropSrc.w * c.scale, h: cropSrc.h * c.scale } };
  })();

  return (
    <div
      ref={root}
      className={`stage${panning ? ' panning' : ''}`}
      onPointerDown={downStage}
      onDragOver={over}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropId(null);
      }}
      onDrop={drop}
    >
      <div className="board" style={{ left: view.x, top: view.y, width: fullW(doc) * z, height: doc.h * z }}>
        <canvas ref={canvas} />
        {allLayers(doc).map((l) => {
          if (l.hidden) return null;
          const b = hitOf(l);
          const tb = boxOf(l); // テキストの文章の範囲 (札があると b より内側)
          const off = l.type === 'text' && l.box ? (measureText(l).bx - l.x) * z : 0; // 札の中で文章が始まる位置
          const isBg = l.id === BG_ID;
          const empty = l.type === 'media' && !l.src;
          const editing = mode?.kind === 'text' && mode.id === l.id && l.type === 'text';
          const cls = ['hit', isBg && 'bg', l.locked && 'locked', empty && !isBg && 'empty', sel === l.id && 'sel', mode?.id === l.id && mode.kind, dropId === l.id && 'drop'].filter(Boolean).join(' ');
          return (
            <div
              key={l.id}
              className={cls}
              style={l.type === 'media' && !isBg ? { ...px(b), borderRadius: radiusOf(l) * z } : px(b)}
              data-layer={l.id}
              data-media={l.type === 'media' ? l.id : undefined}
              onPointerDown={(e) => downLayer(e, l)}
              onDoubleClick={() => dblLayer(l)}
            >
              {empty && !isBg && (
                <span className="ph">
                  <Icon name={l.kind} size={20} />
                  {b.w * z > 120 && b.h * z > 70 && <span>{l.kind === 'video' ? '動画' : '画像'}をドロップ</span>}
                </span>
              )}
              {isBg && dropId === BG_ID && <span className="drop-note">背景に敷く</span>}
              {editing &&
                (() => {
                  // 文章は canvas に描いたものを見せ (個別の字間も出る)、入力欄は透明にして上に重ねる。カーソルと選んだ範囲は自前で描く
                  const len = l.text.length;
                  const ca = Math.min(caret.a, len);
                  const cb = Math.min(caret.b, len);
                  const c = caretAt(l, ca);
                  const at = (e: React.PointerEvent) => {
                    const r = e.currentTarget.closest('.board')!.getBoundingClientRect();
                    return indexAt(l, (e.clientX - r.left) / z, (e.clientY - r.top) / z);
                  };
                  const pick = (el: HTMLTextAreaElement, from: number, to: number) => {
                    el.setSelectionRange(Math.min(from, to), Math.max(from, to), to < from ? 'backward' : 'forward');
                    setCaret({ a: Math.min(from, to), b: Math.max(from, to) });
                  };
                  return (
                    <>
                      {ca === cb ? (
                        <i className="caret" key={`${ca}:${l.kern?.[ca] ?? 0}`} style={{ left: (c.x - b.x) * z, top: (c.y - b.y) * z, height: c.h * z }} />
                      ) : (
                        rangeRects(l, ca, cb).map((r, i) => <i key={i} className="range-hi" style={{ left: (r.x - b.x) * z, top: (r.y - b.y) * z, width: r.w * z, height: r.h * z }} />)
                      )}
                      <textarea
                        autoFocus
                        spellCheck={false}
                        value={l.text}
                        style={{
                          font: `${l.weight} ${l.size * z}px/${l.lineHeight} ${l.font}`, letterSpacing: `${l.tracking}em`, color: 'transparent', caretColor: 'transparent', textAlign: l.align,
                          inset: 'auto', left: (tb.x - b.x) * z, top: (tb.y - b.y) * z, width: tb.w * z, height: tb.h * z,
                          paddingLeft: l.align === 'left' ? off : 0, paddingRight: l.align === 'right' ? off : 0,
                        }}
                        onMouseDown={(e) => e.preventDefault()} // 押した場所は canvas の文字の並びから決める (下の onPointerDown)
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (e.button !== 0) return;
                          const el = e.currentTarget;
                          el.focus();
                          const i = at(e);
                          anchor.current = e.shiftKey ? (el.selectionDirection === 'backward' ? el.selectionEnd : el.selectionStart) : i;
                          pick(el, anchor.current, i);
                          el.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (anchor.current !== null && e.buttons & 1) pick(e.currentTarget, anchor.current, at(e));
                        }}
                        onPointerUp={() => {
                          anchor.current = null;
                        }}
                        onFocus={(e) => {
                          e.currentTarget.select();
                          setCaret({ a: 0, b: e.currentTarget.value.length });
                        }}
                        onSelect={(e) => setCaret({ a: e.currentTarget.selectionStart, b: e.currentTarget.selectionEnd })}
                        onChange={(e) => {
                          const el = e.currentTarget;
                          setCaret({ a: el.selectionStart, b: el.selectionEnd });
                          update((d) => patchLayer(d, l.id, retext(l, el.value)), `text:${l.id}`);
                        }}
                        onBlur={() => setMode(null)}
                        onKeyDown={(e) => {
                          const el = e.currentTarget;
                          if (e.key === 'Escape') el.blur();
                          else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === 'Period' || e.code === 'Comma')) {
                            // Cmd + Shift + > / <: 選んだ文字だけを大きく / 小さく (全体の大きさに対する倍率を 0.05 ずつ)
                            e.preventDefault();
                            const from = el.selectionStart;
                            const to = el.selectionEnd;
                            if (from === to) return;
                            const scale = Array.from({ length: len }, (_, k) => l.scale?.[k] || 1);
                            const n = e.code === 'Period' ? 0.05 : -0.05;
                            for (let k = from; k < to; k++) scale[k] = Math.min(5, Math.max(0.2, Math.round((scale[k] + n) * 100) / 100));
                            update((d) => patchLayer(d, l.id, { scale }), `scale:${l.id}`);
                          }
                          else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.nativeEvent.isComposing) {
                            // Option + ← / →: カーソルのある文字間だけを詰める / 空ける (Shift で 5 倍)
                            e.preventDefault();
                            const i = el.selectionStart;
                            if (i !== el.selectionEnd || i < 1 || i >= len || l.text[i - 1] === '\n' || l.text[i] === '\n') return;
                            const kern = Array.from({ length: len }, (_, k) => l.kern?.[k] ?? 0);
                            const n = (e.shiftKey ? 0.05 : 0.01) * (e.key === 'ArrowLeft' ? -1 : 1);
                            kern[i] = Math.min(1, Math.max(-0.5, Math.round((kern[i] + n) * 1000) / 1000));
                            update((d) => patchLayer(d, l.id, { kern }), `kern:${l.id}`);
                          }
                        }}
                      />
                    </>
                  );
                })()}
            </div>
          );
        })}
        {Array.from({ length: doc.count }, (_, i) => (
          <i key={i} className={`page${i ? ' cut' : ''}`} style={{ left: i * doc.w * z, width: doc.w * z }}>
            {/* アートボードごとのテンプレート。上に付ける */}
            <label className="page-head" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              {doc.count > 1 && <b>{i + 1}</b>}
              <select value={doc.templates[i] ?? ''} title="このアートボードのテンプレート。差し替えても、背景や書いた文章は残ります" onChange={(e) => onTemplate(i, e.target.value || null)}>
                <option value="">テンプレートなし</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </i>
        ))}
        {crop && (
          <>
            <canvas ref={ghost} className="ghost-img" style={px(crop.box)} />
            <div
              className="crop-box"
              data-layer={crop.l.id}
              style={px(crop.box)}
              onPointerDown={(e) => {
                if (e.button !== 0 || space.current) return;
                e.stopPropagation();
                startCrop(e, crop.l);
              }}
            >
              {(['nw', 'ne', 'se', 'sw'] as const).map((h) => (
                <b key={h} className={`handle ${h}`} onPointerDown={(e) => startCropScale(e, crop.l, h)} />
              ))}
            </div>
          </>
        )}
        {guides?.x != null && <i className="guide v" style={{ left: guides.x * z }} />}
        {guides?.y != null && <i className="guide h" style={{ top: guides.y * z }} />}
        {selLayer && selBox && !selLayer.hidden && (
          <div className={`frame${mode?.id === selLayer.id ? ` ${mode.kind}` : ''}`} style={px(selBox)}>
            {selLayer.id !== BG_ID && !selLayer.locked && !mode &&
              HANDLES.filter((h) => selLayer.type !== 'text' || (h !== 'n' && h !== 's')).map((h) => <b key={h} className={`handle ${h}`} onPointerDown={(e) => startResize(e, selLayer, h)} />)}
            <span className="size">{mode?.kind === 'crop' ? 'ドラッグで位置、角かホイールで拡大' : `${Math.round(selBox.w)} × ${Math.round(selBox.h)}`}</span>
          </div>
        )}
      </div>
    </div>
  );
}
