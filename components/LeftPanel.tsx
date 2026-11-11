'use client';
// 左の欄。レイヤーの一覧と、素材 (樽見の写真・落としたファイル)
import { useRef, useState } from 'react';
import { BG_ID, layerLabel, patchLayer, type Doc, type Layer, type MediaKind } from '@/lib/doc';
import Icon from './icons';
import type { Update } from './Stage';

export type Preset = { id: string; group: string; name: string; thumb: string; src: string };
export type Asset = { name: string; kind: MediaKind; src: string };
export type Payload = { kind: MediaKind; src: string; name: string };
export const MEDIA_MIME = 'application/x-sns-media';

const UPLOADS = 'アップロード';

type Props = {
  doc: Doc;
  sel: string | null;
  setSel: (id: string | null) => void;
  update: Update;
  presets: Preset[];
  assets: Asset[];
  busy: boolean;
  onPick: (p: Payload) => void; // 押した素材を、選んでいる枠 (無ければ背景) に入れる
  onFiles: (files: File[]) => void;
};

export default function LeftPanel({ doc, sel, setSel, update, presets, assets, busy, onPick, onFiles }: Props) {
  const [tab, setTab] = useState<'layers' | 'media'>('media');
  const groups = [...new Set(presets.map((p) => p.group))];
  const [group, setGroup] = useState<string | null>(null);
  const current = group ?? groups[0] ?? UPLOADS;
  const file = useRef<HTMLInputElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const start = (e: React.DragEvent, p: Payload) => {
    e.dataTransfer.setData(MEDIA_MIME, JSON.stringify(p));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // 一覧は上にあるものが先。dragId を overId の位置へ
  const reorder = (from: string, to: string) =>
    update((d) => {
      const list = [...d.layers];
      const a = list.findIndex((l) => l.id === from);
      const b = list.findIndex((l) => l.id === to);
      if (a < 0 || b < 0 || a === b) return d;
      const [moved] = list.splice(a, 1);
      list.splice(b, 0, moved);
      return { ...d, layers: list };
    });

  const row = (l: Layer) => {
    const isBg = l.id === BG_ID;
    return (
      <li
        key={l.id}
        className={`layer${sel === l.id ? ' sel' : ''}${l.hidden ? ' off' : ''}${overId === l.id && dragId && dragId !== l.id ? ' over' : ''}`}
        draggable={!isBg}
        onDragStart={(e) => {
          setDragId(l.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!dragId || isBg) return;
          e.preventDefault();
          setOverId(l.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverId(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId && !isBg) reorder(dragId, l.id);
          setDragId(null);
          setOverId(null);
        }}
        onClick={() => setSel(l.id)}
      >
        <Icon name={isBg ? 'bg' : l.type === 'text' ? 'text' : l.type === 'rect' ? 'rect' : l.kind} />
        <span className="name">{layerLabel(l)}</span>
        {!isBg && (
          <button
            type="button"
            className={`mini${l.locked ? ' on' : ''}`}
            title={l.locked ? 'ロックを外す' : '紙面で動かないようにロック'}
            onClick={(e) => {
              e.stopPropagation();
              update((d) => patchLayer(d, l.id, { locked: !l.locked }));
            }}
          >
            <Icon name={l.locked ? 'lock' : 'unlock'} size={14} />
          </button>
        )}
        <button
          type="button"
          className={`mini${l.hidden ? ' on' : ''}`}
          title={l.hidden ? '表示する' : '隠す'}
          onClick={(e) => {
            e.stopPropagation();
            update((d) => patchLayer(d, l.id, { hidden: !l.hidden }));
          }}
        >
          <Icon name={l.hidden ? 'eyeOff' : 'eye'} size={14} />
        </button>
      </li>
    );
  };

  return (
    <aside className="panel left">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'media'} className={tab === 'media' ? 'on' : ''} onClick={() => setTab('media')}>
          素材
        </button>
        <button type="button" role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'on' : ''} onClick={() => setTab('layers')}>
          レイヤー
        </button>
      </div>

      {tab === 'layers' ? (
        <ul className="layers">
          {[...doc.layers].reverse().map(row)}
          {row(doc.bg)}
          {doc.layers.length === 0 && <li className="none">上のバーからテキストや枠を足すと、ここに並びます。</li>}
        </ul>
      ) : (
        <div className="media">
          <div className="chips">
            {[...groups, UPLOADS].map((g) => (
              <button key={g} type="button" className={g === current ? 'on' : ''} onClick={() => setGroup(g)}>
                {g}
              </button>
            ))}
          </div>
          {current === UPLOADS ? (
            <>
              <button type="button" className="add-file" disabled={busy} onClick={() => file.current?.click()}>
                <Icon name="plus" /> {busy ? '読み込んでいます…' : '画像・動画を追加'}
              </button>
              <input
                ref={file}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => {
                  onFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
              <div className="thumbs">
                {assets.map((a) => (
                  <button key={a.src} type="button" className="thumb" title={a.name} draggable onDragStart={(e) => start(e, a)} onClick={() => onPick(a)}>
                    {a.kind === 'video' ? <video src={`${a.src}#t=0.1`} muted playsInline preload="metadata" /> : <img src={a.src} alt="" loading="lazy" draggable={false} />}
                    {a.kind === 'video' && (
                      <span className="badge">
                        <Icon name="video" size={12} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {assets.length === 0 && <p className="none">ここか紙面に、画像や動画のファイルを落としてください。</p>}
            </>
          ) : (
            <div className="thumbs">
              {presets
                .filter((p) => p.group === current)
                .map((p) => {
                  const payload: Payload = { kind: 'image', src: p.src, name: p.name };
                  return (
                    <button key={p.id} type="button" className="thumb" title={p.name} draggable onDragStart={(e) => start(e, payload)} onClick={() => onPick(payload)}>
                      <img src={p.thumb} alt="" loading="lazy" draggable={false} />
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
