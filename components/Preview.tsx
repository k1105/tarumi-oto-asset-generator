'use client';
// 投稿したときの見え方 (Instagram のフィード・グリッド・リール、X)。今の紙面を 1 枚の絵にして当てはめる
import { useState } from 'react';
import { ACCOUNT, type Doc } from '@/lib/doc';
import Icon from './icons';

type Tab = 'feed' | 'grid' | 'reel' | 'x';
const TABS: { id: Tab; label: string }[] = [
  { id: 'feed', label: 'Instagram フィード' },
  { id: 'grid', label: 'Instagram グリッド' },
  { id: 'reel', label: 'リール・ストーリーズ' },
  { id: 'x', label: 'X' },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const Bars = ({ n }: { n: number }) => (
  <div className="bars">
    {Array.from({ length: n }, (_, i) => (
      <i key={i} />
    ))}
  </div>
);

/** urls: アートボードごとの絵 (左から) */
export default function Preview({ doc, urls, onClose }: { doc: Doc; urls: string[]; onClose: () => void }) {
  const url = urls[0];
  const many = urls.length > 1;
  const ratio = doc.w / doc.h;
  const [tab, setTab] = useState<Tab>(doc.aspect === '9:16' ? 'reel' : doc.aspect === '16:9' ? 'x' : 'feed');
  // フィードは 1.91:1 〜 3:4、X のタイムラインは 16:9 〜 3:4 の範囲に切られる
  const feed = clamp(ratio, 3 / 4, 1.91);
  const xr = clamp(ratio, 3 / 4, 16 / 9);
  const note =
    tab === 'feed' && feed !== ratio ? 'フィードでは 3:4 より縦長の部分が上下で切れます。'
    : tab === 'grid' && doc.aspect !== '3:4' ? 'グリッドは 3:4 に切り抜かれます (中央が残ります)。'
    : tab === 'reel' && doc.aspect !== '9:16' ? '9:16 でない投稿は、上下に余白が付きます。'
    : tab === 'x' && xr !== ratio ? 'タイムラインでは上下が切れます (押すと全体が出ます)。'
    : '';

  return (
    <div className="modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="preview">
        <header>
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={t.id === tab ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" className="mini" onClick={onClose} title="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="preview-body">
          {tab === 'feed' && (
            <div className="phone">
              <div className="ig-head">
                <span className="avatar" />
                <b>{ACCOUNT.handle}</b>
              </div>
              <div className="carousel">
                {urls.map((u, i) => (
                  <img key={i} className="shot" src={u} alt="" style={{ aspectRatio: String(feed) }} />
                ))}
              </div>
              <div className="ig-actions">
                <i className="heart" />
                <i className="bubble" />
                <i className="send" />
                <i className="keep" />
              </div>
              <div className="ig-caption">
                <b>{ACCOUNT.handle}</b>
                <Bars n={2} />
              </div>
            </div>
          )}
          {tab === 'grid' && (
            <div className="phone">
              <div className="ig-profile">
                <span className="avatar big" />
                <div>
                  <b>{ACCOUNT.name}</b>
                  <Bars n={2} />
                </div>
              </div>
              <div className="ig-grid">
                {urls.map((u, i) => (
                  <img key={i} src={u} alt="" />
                ))}
                {Array.from({ length: Math.ceil(urls.length / 3) * 3 - urls.length + 6 }, (_, i) => (
                  <i key={i} />
                ))}
              </div>
            </div>
          )}
          {tab === 'reel' && (
            <div className="phone reel">
              <img src={url} alt="" />
              <div className="reel-side">
                <i className="heart" />
                <i className="bubble" />
                <i className="send" />
              </div>
              <div className="reel-foot">
                <div className="ig-head">
                  <span className="avatar" />
                  <b>{ACCOUNT.handle}</b>
                </div>
                <Bars n={1} />
              </div>
            </div>
          )}
          {tab === 'x' && (
            <div className="tweet">
              <span className="avatar" />
              <div>
                <p>
                  <b>{ACCOUNT.name}</b> <span>@{ACCOUNT.handle}</span>
                </p>
                <Bars n={2} />
                <img className="shot" src={url} alt="" style={{ aspectRatio: String(xr) }} />
              </div>
            </div>
          )}
        </div>
        <p className="preview-note">
          {note || '切られずにそのまま出ます。'}
          {many && (tab === 'feed' ? ' 複数枚の投稿は、横にスワイプして続きが見られます (ここでも横にスクロールできます)。' : tab === 'grid' ? ' 1 枚ずつ別の投稿にしたときの並びです (新しい投稿が左に来るので、右の 1 枚から順に投稿します)。' : ' 1 枚目だけを出しています。')}
        </p>
      </div>
    </div>
  );
}
