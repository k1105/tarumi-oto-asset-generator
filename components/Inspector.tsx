'use client';
// 右の欄。選んでいるもの (テキスト・枠・背景) か、何も選んでいなければ紙面の設定
import { useEffect, useState } from 'react';
import { BG_ID, DEFAULT_BOX, DEFAULT_TONE, FONTS, PALETTE, WEIGHTS, isStroke, patchLayer, retext, type Align, type Doc, type Layer, type MediaKind, type MediaLayer, type RectLayer, type Shape, type TextLayer } from '@/lib/doc';
import { DEFAULT_MOTION, strokeInfo, type MotionOrder } from '@/lib/stroke/draw';
import { boxOf } from '@/lib/render';
import Icon from './icons';
import type { Mode, Update } from './Stage';

function Num({ label, value, onChange, step = 1, min, max, title }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; title?: string }) {
  const shown = String(Math.round(value * 1000) / 1000);
  const [text, setText] = useState(shown);
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) setText(shown);
  }, [shown, focus]);
  return (
    <label className="num" title={title}>
      <span>{label}</span>
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v)));
        }}
      />
    </label>
  );
}

function Range({ label, value, onChange, min, max, step, show }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; show: string }) {
  return (
    <label className="range">
      <span>{label}</span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{show}</output>
    </label>
  );
}

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="colors">
      {PALETTE.map((c) => (
        <button key={c.value} type="button" className={`swatch${value.toLowerCase() === c.value ? ' on' : ''}`} style={{ background: c.value }} title={`${c.label} (${c.value})`} aria-label={c.label} onClick={() => onChange(c.value)} />
      ))}
    <div className="color">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label="色" />
      <input
        type="text"
        value={text}
        spellCheck={false}
        aria-label="色のコード"
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value);
        }}
      />
    </div>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

type Props = { doc: Doc; layer: Layer | null; update: Update; mode: Mode; setMode: (m: Mode) => void; autoDuration: number; onRemove: (id: string) => void };

export default function Inspector({ doc, layer, update, mode, setMode, autoDuration, onRemove }: Props) {
  if (!layer) {
    return (
      <aside className="panel right">
        <section>
          <h2>紙面</h2>
          <p className="meta">
            {doc.aspect}、{doc.w} × {doc.h} px
          </p>
          <div className="row">
            <span className="lbl">地の色</span>
            <Color value={doc.bgColor} onChange={(v) => update((d) => ({ ...d, bgColor: v }), 'bgColor')} />
          </div>
        </section>
        <section>
          <h2>動画の長さ</h2>
          <Seg
            value={doc.duration ? 'fixed' : 'auto'}
            options={[
              { value: 'auto', label: '動画に合わせる' },
              { value: 'fixed', label: '秒数で決める' },
            ]}
            onChange={(v) => update((d) => ({ ...d, duration: v === 'auto' ? null : Math.round(autoDuration * 10) / 10 }))}
          />
          {doc.duration ? (
            <div className="grid2">
              <Num label="秒" value={doc.duration} min={0.5} max={600} step={0.5} onChange={(v) => update((d) => ({ ...d, duration: v }), 'duration')} />
            </div>
          ) : (
            <p className="meta">今は {autoDuration.toFixed(1)} 秒。短い動画は繰り返します</p>
          )}
        </section>
        <section className="hint">
          <p>写真や動画を紙面に落とすと背景に、枠に落とすとその枠に入ります。</p>
          <p>枠やテキストはダブルクリックで中身を編集。スペース + ドラッグで紙面を動かし、ピンチか Cmd + ホイールで拡大します。</p>
        </section>
      </aside>
    );
  }

  const set = (patch: Partial<MediaLayer> | Partial<TextLayer> | Partial<RectLayer>, key?: string) => update((d) => patchLayer(d, layer.id, patch), key ? `${key}:${layer.id}` : undefined);
  const isBg = layer.id === BG_ID;

  return (
    <aside className="panel right">
      {!isBg && (
        <section>
          <h2>位置と大きさ</h2>
          <div className="grid2">
            <Num label="X" value={layer.x} onChange={(v) => set({ x: v }, 'x')} />
            <Num label="Y" value={layer.y} onChange={(v) => set({ y: v }, 'y')} />
            <Num label="W" value={layer.w} min={20} onChange={(v) => set({ w: v }, 'w')} />
            {layer.type !== 'text' && <Num label="H" value={layer.h} min={20} onChange={(v) => set({ h: v }, 'h')} />}
          </div>
          <div className="row gap">
            <button type="button" className="ghost" onClick={() => set({ x: Math.round((doc.w - layer.w) / 2) })}>
              左右の中央へ
            </button>
            {layer.type !== 'text' && (
              <button type="button" className="ghost" onClick={() => set({ x: 0, y: 0, w: doc.w, h: doc.h })}>
                紙面いっぱい
              </button>
            )}
          </div>
        </section>
      )}

      {layer.type === 'text' && (
        <section>
          <h2>テキスト</h2>
          <textarea className="text-input" value={layer.text} rows={3} spellCheck={false} onChange={(e) => set(retext(layer, e.target.value), 'text')} />
          <select value={layer.font} onChange={(e) => set({ font: e.target.value })} aria-label="フォント">
            {FONTS.map((f) => (
              <option key={f.label} value={f.family}>
                {f.label}
              </option>
            ))}
          </select>
          <div className="grid2">
            <Num label="大きさ" value={layer.size} min={8} max={800} onChange={(v) => set({ size: v }, 'size')} />
            <label className="num">
              <span>太さ</span>
              <select value={layer.weight} onChange={(e) => set({ weight: Number(e.target.value) })}>
                {WEIGHTS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <Num label="行間" value={layer.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => set({ lineHeight: v }, 'lh')} />
            <Num label="字間" value={layer.tracking} min={-0.2} max={1} step={0.01} title="文字の大きさに対する割合" onChange={(v) => set({ tracking: v }, 'tr')} />
          </div>
          <div className="row">
            <Seg<Align>
              value={layer.align}
              options={[
                { value: 'left', label: <Icon name="left" />, title: '左揃え' },
                { value: 'center', label: <Icon name="center" />, title: '中央揃え' },
                { value: 'right', label: <Icon name="right" />, title: '右揃え' },
              ]}
              onChange={(v) => set({ align: v })}
            />
          </div>
          <div className="row">
            <span className="lbl">色</span>
            <Color value={layer.color} onChange={(v) => set({ color: v }, 'color')} />
          </div>
        </section>
      )}

      {layer.type === 'text' && (
        <section>
          <h2>札</h2>
          <Seg
            value={layer.box ? 'on' : 'off'}
            options={[
              { value: 'off', label: 'なし' },
              { value: 'on', label: '文章の後ろに敷く' },
            ]}
            onChange={(v) => set({ box: v === 'on' ? DEFAULT_BOX : null })}
          />
          {layer.box && (() => {
            const box = layer.box;
            return (
              <>
                <div className="row">
                  <span className="lbl">地の色</span>
                  <Color value={box.fill} onChange={(v) => set({ box: { ...box, fill: v } }, 'bfill')} />
                </div>
                <div className="row">
                  <span className="lbl">縁の色</span>
                  <Color value={box.stroke} onChange={(v) => set({ box: { ...box, stroke: v } }, 'bstroke')} />
                </div>
                <div className="grid2">
                  <Num label="縁" value={box.strokeWidth} min={0} max={200} title="縁の太さ。0 なら縁なし" onChange={(v) => set({ box: { ...box, strokeWidth: v } }, 'bsw')} />
                  <span />
                  <Num label="余白 左右" value={box.padX} min={0} max={600} title="縁の内側から文章までの、左右の余白" onChange={(v) => set({ box: { ...box, padX: v } }, 'bpx')} />
                  <Num label="余白 上下" value={box.padY} min={0} max={600} title="縁の内側から文章までの、上下の余白" onChange={(v) => set({ box: { ...box, padY: v } }, 'bpy')} />
                </div>
                <p className="meta">札は文章の量に合わせて大きさが変わり、左右はテキストの幅 (W) の中央に来ます。</p>
              </>
            );
          })()}
          <Seg
            value={layer.valign === 'middle' ? 'middle' : 'top'}
            options={[
              { value: 'top', label: '下へ伸びる' },
              { value: 'middle', label: '上下に伸びる' },
            ]}
            onChange={(v) => {
              if ((layer.valign ?? 'top') === v) return;
              // 見た目の位置は変えずに、基準だけ変える
              const b = boxOf(layer);
              set({ valign: v, y: Math.round(v === 'middle' ? b.y + b.h / 2 : b.y) });
            }}
          />
        </section>
      )}

      {layer.type === 'rect' && (
        <section>
          <h2>色面</h2>
          <Seg
            value={layer.fill ? 'on' : 'off'}
            options={[
              { value: 'on', label: '塗る' },
              { value: 'off', label: '塗らない (縁だけ)' },
            ]}
            onChange={(v) => set({ fill: v === 'on' ? PALETTE[1].value : '', strokeWidth: v === 'off' && !layer.strokeWidth ? 24 : layer.strokeWidth })}
          />
          {layer.fill && (
            <div className="row">
              <span className="lbl">色</span>
              <Color value={layer.fill} onChange={(v) => set({ fill: v }, 'fill')} />
            </div>
          )}
          <div className="row">
            <span className="lbl">縁の色</span>
            <Color value={layer.stroke} onChange={(v) => set({ stroke: v, strokeWidth: layer.strokeWidth || 16 }, 'stroke')} />
          </div>
          <div className="grid2">
            <Num label="縁の太さ" value={layer.strokeWidth} min={0} max={400} title="0 なら縁なし。縁は内側に付きます" onChange={(v) => set({ strokeWidth: v }, 'sw')} />
          </div>
        </section>
      )}

      {layer.type === 'text' && isStroke(layer) && (() => {
        const m = layer.motion?.on ? layer.motion : null;
        const info = strokeInfo(layer.text, m?.order ?? 'sequential');
        return (
          <section>
            <h2>モーション</h2>
            <Seg
              value={m ? 'on' : 'off'}
              options={[
                { value: 'off', label: 'なし' },
                { value: 'on', label: '線を書いていく' },
              ]}
              onChange={(v) => set({ motion: { ...DEFAULT_MOTION, ...layer.motion, on: v === 'on' } })}
            />
            {m && (
              <>
                <div className="grid2">
                  <Num label="開始" value={m.start} min={0} step={0.1} title="何秒目から書き始めるか" onChange={(v) => set({ motion: { ...m, start: v } }, 'mstart')} />
                  <Num label="秒数" value={m.duration} min={0} step={0.1} title="書き終えるまでの秒数。0 ならフォントの既定の速さ" onChange={(v) => set({ motion: { ...m, duration: v } }, 'mdur')} />
                </div>
                <Seg<MotionOrder>
                  value={m.order}
                  options={[
                    { value: 'sequential', label: '1 文字ずつ' },
                    { value: 'stagger', label: 'ずらして' },
                    { value: 'together', label: '同時に' },
                  ]}
                  onChange={(v) => set({ motion: { ...m, order: v } })}
                />
                <p className="meta">
                  {m.duration > 0 ? `${m.duration} 秒で書き終えます` : `既定の速さで ${info.natural.toFixed(1)} 秒`}。下の再生で確かめ、MP4 で書き出すと動きが付きます。
                </p>
                {info.missing.length > 0 && <p className="meta warn">フォントに無い文字 ({info.missing.join(' ')}) は線で書けないので、順番が来たらそのまま出ます。</p>}
              </>
            )}
          </section>
        );
      })()}

      {layer.type === 'media' && (
        <section>
          <h2>{isBg ? '背景' : '枠'}</h2>
          {!isBg && (
            <Seg<MediaKind>
              value={layer.kind}
              options={[
                { value: 'image', label: '画像を入れる' },
                { value: 'video', label: '動画を入れる' },
              ]}
              onChange={(v) => v !== layer.kind && set({ kind: v, src: null, name: '' })}
            />
          )}
          {!isBg && (
            <div className="row">
              <span className="lbl">形</span>
              <Seg<Shape>
                value={layer.shape ?? 'rect'}
                options={[
                  { value: 'rect', label: '四角' },
                  { value: 'round', label: '窓 (丸)', title: 'Web の窓と同じ、角の丸みが大きい形' },
                  { value: 'square', label: '窓 (角)', title: 'Web の窓と同じ、角の丸みが小さい形' },
                ]}
                onChange={(v) => set({ shape: v })}
              />
            </div>
          )}
          {layer.src ? (
            <>
              <p className="meta file" title={layer.name}>
                <Icon name={layer.kind} /> {layer.name}
              </p>
              <div className="row gap">
                <button type="button" className={`ghost${mode?.id === layer.id ? ' on' : ''}`} onClick={() => setMode(mode?.id === layer.id ? null : { kind: 'crop', id: layer.id })}>
                  {mode?.id === layer.id ? '調整を終える' : '位置と拡大を調整'}
                </button>
                <button type="button" className="ghost" onClick={() => set({ src: null, name: '', zoom: 1, cx: 0.5, cy: 0.5 })}>
                  素材を外す
                </button>
              </div>
              {(() => {
                const t = layer.tone ?? DEFAULT_TONE;
                return (
                  <>
                    <div className="row">
                      <span className="lbl">2 値化</span>
                      <Seg
                        value={t.on ? 'on' : 'off'}
                        options={[
                          { value: 'off', label: 'なし' },
                          { value: 'on', label: 'かける' },
                        ]}
                        onChange={(v) => set({ tone: { ...t, on: v === 'on' } })}
                      />
                    </div>
                    {t.on && (
                      <>
                        <Range label="閾値" value={t.threshold} min={0} max={1} step={0.01} show={t.threshold.toFixed(2)} onChange={(v) => set({ tone: { ...t, threshold: v } }, 'tone-th')} />
                        <div className="row">
                          <span className="lbl">暗い側</span>
                          <Color value={t.dark} onChange={(v) => set({ tone: { ...t, dark: v } }, 'tone-dark')} />
                        </div>
                        <div className="row">
                          <span className="lbl">明るい側</span>
                          <Color value={t.light} onChange={(v) => set({ tone: { ...t, light: v } }, 'tone-light')} />
                        </div>
                      </>
                    )}
                  </>
                );
              })()}
            </>
          ) : (
            <p className="meta">{isBg ? '写真か動画を紙面に落とすと、背景に敷かれます。' : `左の「素材」から${layer.kind === 'video' ? '動画' : '画像'}を落とすか、ファイルを直接落としてください。`}</p>
          )}
        </section>
      )}

      {layer.type === 'media' && layer.kind === 'video' && layer.src && (
        <section>
          <h2>動画</h2>
          <div className="grid2">
            <Num label="頭出し" value={layer.start} min={0} step={0.1} title="動画の何秒目から使うか" onChange={(v) => set({ start: v }, 'start')} />
          </div>
          <div className="row">
            <button type="button" className={`ghost icon-btn${layer.muted ? ' on' : ''}`} title={layer.muted ? '音を出す' : '音を消す'} onClick={() => set({ muted: !layer.muted })}>
              <Icon name={layer.muted ? 'mute' : 'sound'} />
            </button>
            <Range label="音量" value={layer.muted ? 0 : layer.volume} min={0} max={1} step={0.01} show={`${Math.round((layer.muted ? 0 : layer.volume) * 100)}`} onChange={(v) => set({ volume: v, muted: false }, 'vol')} />
          </div>
        </section>
      )}

      <section>
        <h2>重ね方</h2>
        <Range label="不透明度" value={layer.opacity} min={0} max={1} step={0.01} show={`${Math.round(layer.opacity * 100)}%`} onChange={(v) => set({ opacity: v }, 'op')} />
        {!isBg && (
          <button type="button" className="ghost danger" onClick={() => onRemove(layer.id)}>
            <Icon name="trash" /> 削除
          </button>
        )}
      </section>
    </aside>
  );
}
