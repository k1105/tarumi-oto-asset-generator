'use client';
// SNS の投稿画像・動画を組むエディター。上にバー、左に素材とレイヤー、中央に紙面、右に設定
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ASPECTS, BG_ID, MAX_COUNT, applyTemplate, aspectOf, findLayer, hasMotion, hasVideo, newDoc, newMedia, newRect, newText, normalize, patchLayer, setAspect, setCount, uid, type AspectId, type Doc, type Layer, type MediaKind } from '@/lib/doc';
import { download, exportImage, exportVideo, fileBase } from '@/lib/export';
import { durationOf } from '@/lib/render';
import { loadStroke } from '@/lib/stroke/draw';
import { addAsset, deleteProject, listAssets, listProjects, readProject, writeProject, type ProjectInfo } from '@/lib/storage';
import { useMedia } from '@/lib/useMedia';
import Icon from './icons';
import Inspector from './Inspector';
import LeftPanel, { MEDIA_MIME, type Asset, type Payload, type Preset } from './LeftPanel';
import Preview from './Preview';
import Stage, { type Mode } from './Stage';
import './editor.css';

type Template = { id: string; name: string; aspect: string; doc: unknown };
type Clock = { t: number; playing: boolean; subs: Set<() => void> };

const LAST = 'sns-frame:last';
const getJson = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json());
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function Transport({ clock, duration, onToggle, onSeek }: { clock: Clock; duration: number; onToggle: () => void; onSeek: (t: number) => void }) {
  const sub = useCallback((fn: () => void) => (clock.subs.add(fn), () => void clock.subs.delete(fn)), [clock]);
  const t = useSyncExternalStore(sub, () => clock.t, () => 0);
  const playing = useSyncExternalStore(sub, () => clock.playing, () => false);
  return (
    <div className="transport">
      <button type="button" className="play" onClick={onToggle} title={playing ? '止める' : '再生'}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <input type="range" min={0} max={duration} step={0.01} value={Math.min(t, duration)} onChange={(e) => onSeek(Number(e.target.value))} aria-label="再生位置" />
      <span className="time">
        {fmt(Math.min(t, duration))} / {fmt(duration)}
      </span>
    </div>
  );
}

export default function Editor() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const docRef = useRef<Doc | null>(null);
  const hist = useRef<{ past: Doc[]; future: Doc[]; key: string | null }>({ past: [], future: [], key: null });
  const [sel, setSel] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [tick, setTick] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fitSignal, setFitSignal] = useState(0);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [menu, setMenu] = useState<'file' | 'export' | null>(null);
  const [dialog, setDialog] = useState<'new' | null>(null);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [exporting, setExporting] = useState<{ ratio: number; note: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const clean = useRef<Doc | null>(null); // ディスクから読んだままのドキュメント
  const drawRef = useRef<() => void>(() => {});
  // 文字の動きに使う時刻。止まっていて頭にいるあいだは、書き終えた状態を見せる (編集しやすいように)
  const timeRef = useRef<() => number | null>(() => null);
  const clock = useRef<Clock>({ t: 0, playing: false, subs: new Set() }).current;
  const notify = useCallback(() => clock.subs.forEach((fn) => fn()), [clock]);
  timeRef.current = () => (clock.playing || clock.t > 0 ? clock.t : null);

  const bump = useCallback(() => setTick((n) => n + 1), []);
  const media = useMedia(doc ?? EMPTY, bump);

  const say = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast((t) => (t === text ? '' : t)), 3200);
  }, []);

  // ---- ドキュメントの更新と、取り消し・やり直し ----
  // key が直前と同じ更新 (ドラッグの途中、同じ欄の打ち直し) は、取り消しの 1 手にまとめる
  const update = useCallback((fn: (d: Doc) => Doc, key?: string) => {
    const prev = docRef.current;
    if (!prev) return;
    const next = fn(prev);
    if (next === prev) return;
    const h = hist.current;
    if (!key || key !== h.key) {
      h.past.push(prev);
      if (h.past.length > 200) h.past.shift();
    }
    h.key = key ?? null;
    h.future = [];
    docRef.current = next;
    setDoc(next);
  }, []);

  const travel = useCallback((dir: 'undo' | 'redo') => {
    const h = hist.current;
    const cur = docRef.current;
    const to = dir === 'undo' ? h.past.pop() : h.future.pop();
    if (!to || !cur) return;
    (dir === 'undo' ? h.future : h.past).push(cur);
    h.key = null;
    docRef.current = to;
    setDoc(to);
    setMode(null);
  }, []);

  const open = useCallback((d: Doc, remember = true) => {
    hist.current = { past: [], future: [], key: null };
    docRef.current = d;
    clean.current = null;
    setDoc(d);
    setSel(null);
    setMode(null);
    clock.t = 0;
    clock.playing = false;
    notify();
    try {
      if (remember) localStorage.setItem(LAST, d.id);
    } catch {}
  }, [clock, notify]);

  // ---- 読み込み ----
  const loadLists = useCallback(async () => {
    const [p, a] = await Promise.all([listProjects(), listAssets()]);
    setProjects(p);
    setAssets(a);
    return p;
  }, []);

  const openById = useCallback(async (id: string, remember = true) => {
    const d = normalize(await readProject(id).catch(() => null));
    if (d) {
      open(d, remember);
      clean.current = d;
    }
    return !!d;
  }, [open]);

  useEffect(() => {
    (async () => {
      getJson('/presets/index.json').then((r) => setPresets(r.presets ?? [])).catch(() => {});
      getJson('/api/templates').then((r) => setTemplates(r.templates ?? [])).catch(() => {});
      const list = await loadLists().catch(() => [] as ProjectInfo[]);
      // ?p=<id> で開くプロジェクトを指定できる
      const asked = new URLSearchParams(location.search).get('p');
      if (asked && (await openById(asked, false))) return;
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST);
      } catch {}
      const first = list.find((p) => p.id === last) ?? list[0];
      if (!first || !(await openById(first.id))) open(newDoc());
    })();
    // 樽見のフォントが読めたら、テキストを描き直す
    document.fonts.load('40px "Tarumi OTO Stroke"').then(bump).catch(() => {});
    document.fonts.ready.then(bump);
    loadStroke().then(bump).catch(() => {});
  }, [loadLists, openById, open, bump]);

  // ---- 自動保存 ----
  useEffect(() => {
    // 開いたままの (まだ何も変えていない) ものは書かない。別のタブで編集中の内容を古いもので上書きしないため
    if (!doc || doc === clean.current) return;
    setSaved('saving');
    const timer = window.setTimeout(async () => {
      try {
        await writeProject(doc);
        setSaved('saved');
      } catch {
        setSaved('error');
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [doc]);

  // ---- 再生 ----
  const duration = doc ? durationOf(doc, media.videoLength) : 5;
  const video = !!doc && (hasVideo(doc) || hasMotion(doc)); // 時間で変わるものがある
  // tick: 動画の長さが分かったら描き直す
  void tick;

  const seek = useCallback((t: number) => {
    clock.t = t;
    if (docRef.current) media.sync(docRef.current, t, clock.playing);
    drawRef.current();
    notify();
  }, [clock, media, notify]);

  const setPlaying = useCallback((on: boolean) => {
    clock.playing = on;
    notify();
    if (!on && docRef.current) media.sync(docRef.current, clock.t, false);
    drawRef.current();
  }, [clock, media, notify]);

  const playing = useSyncExternalStore(
    useCallback((fn: () => void) => (clock.subs.add(fn), () => void clock.subs.delete(fn)), [clock]),
    () => clock.playing,
    () => false,
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const d = docRef.current;
      if (d) {
        const total = durationOf(d, media.videoLength);
        clock.t += (now - last) / 1000;
        if (clock.t >= total) clock.t = 0;
        media.sync(d, clock.t, true);
        drawRef.current();
        notify();
      }
      last = now;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, clock, media, notify]);

  // 止まっているあいだは、動画を今の時刻のコマに合わせておく (頭出しを変えたとき、読み込めたとき)
  useEffect(() => {
    if (doc && !clock.playing) media.sync(doc, clock.t, false);
  }, [doc, tick, clock, media]);
  useEffect(() => {
    if (!video && clock.playing) setPlaying(false);
  }, [video, clock, setPlaying]);

  // ---- 素材を入れる ----
  const place = useCallback((targetId: string, p: Payload) => {
    const d = docRef.current;
    const target = d && findLayer(d, targetId);
    if (!target || target.type !== 'media') return;
    if (targetId !== BG_ID && target.kind !== p.kind) {
      say(`この枠は${target.kind === 'video' ? '動画' : '画像'}用です。${p.kind === 'video' ? '動画' : '画像'}は入りません`);
      return;
    }
    update((x) => patchLayer(x, targetId, { kind: p.kind, src: p.src, name: p.name, zoom: 1, cx: 0.5, cy: 0.5, start: 0 }));
    setSel(targetId);
  }, [say, update]);

  const upload = useCallback(async (files: File[]): Promise<Payload[]> => {
    const out: Payload[] = [];
    setBusy(true);
    try {
      for (const f of files) {
        const r = await addAsset(f).catch(() => ({ asset: undefined, error: `「${f.name}」を読み込めませんでした` }));
        if (r.asset) out.push(r.asset);
        else say(r.error ?? `「${f.name}」を読み込めませんでした`);
      }
      const a = await listAssets().catch(() => null);
      if (a) setAssets(a);
    } finally {
      setBusy(false);
    }
    return out;
  }, [say]);

  const onDropMedia = useCallback(async (targetId: string, data: DataTransfer) => {
    const raw = data.getData(MEDIA_MIME);
    if (raw) {
      place(targetId, JSON.parse(raw));
      return;
    }
    const files = [...data.files];
    if (!files.length) return;
    const [first] = await upload(files.slice(0, 1));
    if (first) place(targetId, first);
  }, [place, upload]);

  const onPick = useCallback((p: Payload) => {
    const d = docRef.current;
    const cur = d && findLayer(d, sel);
    place(cur?.type === 'media' ? cur.id : BG_ID, p);
  }, [place, sel]);

  // ---- レイヤーの操作 ----
  const add = useCallback((what: 'text' | 'rect' | MediaKind) => {
    const d = docRef.current;
    if (!d) return;
    const l: Layer = what === 'text' ? newText(d) : what === 'rect' ? newRect(d) : newMedia(d, what);
    update((x) => ({ ...x, layers: [...x.layers, l] }));
    setSel(l.id);
    setMode(what === 'text' ? { kind: 'text', id: l.id } : null);
  }, [update]);

  const remove = useCallback((id: string) => {
    if (id === BG_ID) update((d) => patchLayer(d, BG_ID, { src: null, name: '', zoom: 1, cx: 0.5, cy: 0.5 }));
    else update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSel(null);
    setMode(null);
  }, [update]);

  const exitMode = useCallback((m: Mode) => {
    // 空のまま編集を終えたテキストは消す
    const d = docRef.current;
    const cur = mode && d ? findLayer(d, mode.id) : null;
    if (!m && mode?.kind === 'text' && cur?.type === 'text' && !cur.text.trim()) remove(cur.id);
    else setMode(m);
  }, [mode, remove]);

  const closePreview = useCallback(() => {
    setPreview((urls) => {
      urls?.forEach((u) => URL.revokeObjectURL(u));
      return null;
    });
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const d = docRef.current;
      if (!d) return;
      const cmd = e.metaKey || e.ctrlKey;
      const cur = findLayer(d, sel);
      if (cmd && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        travel(e.shiftKey ? 'redo' : 'undo');
      } else if (cmd && e.key.toLowerCase() === 'd' && cur && cur.id !== BG_ID) {
        e.preventDefault();
        const copy = { ...cur, id: uid(), tpl: undefined, page: undefined, x: cur.x + 24, y: cur.y + 24 };
        update((x) => ({ ...x, layers: [...x.layers, copy] }));
        setSel(copy.id);
      } else if (cmd) return;
      else if (e.key === 'Escape') {
        if (preview || dialog) {
          closePreview();
          setDialog(null);
        } else if (mode) setMode(null);
        else setSel(null);
        setMenu(null);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && cur) {
        e.preventDefault();
        remove(cur.id);
      } else if (e.key === 'Enter' && cur) {
        e.preventDefault();
        if (cur.type === 'text') setMode({ kind: 'text', id: cur.id });
        else if (cur.type === 'media' && cur.src) setMode(mode ? null : { kind: 'crop', id: cur.id });
      } else if (e.key.startsWith('Arrow') && cur && cur.id !== BG_ID && !cur.locked) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0;
        const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
        update((x) => patchLayer(x, cur.id, { x: cur.x + dx, y: cur.y + dy }), `nudge:${cur.id}`);
      } else if ((e.key === ']' || e.key === '[') && cur && cur.id !== BG_ID) {
        update((x) => {
          const list = [...x.layers];
          const i = list.findIndex((l) => l.id === cur.id);
          const j = e.key === ']' ? i + 1 : i - 1;
          if (j < 0 || j >= list.length) return x;
          [list[i], list[j]] = [list[j], list[i]];
          return { ...x, layers: list };
        });
      } else if (e.key === 't') add('text');
      else if (e.key === 'i') add('image');
      else if (e.key === 'v') add('video');
      else if (e.key === 'r') add('rect');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [sel, mode, travel, update, remove, add, preview, dialog, closePreview]);

  // ---- ファイル ----
  const create = useCallback((aspect: AspectId, template?: Template) => {
    // テンプレートからなら、そのテンプレートの縦横比で始める
    open(template ? applyTemplate(newDoc(aspectOf(template.aspect).id), 0, template, null) : newDoc(aspect));
    setDialog(null);
  }, [open]);

  /** page 枚目のアートボードのテンプレートを差し替える (id が null なら外す)。背景や書いた文章は残る */
  const swapTemplate = useCallback((page: number, id: string | null) => {
    update((d) => {
      if ((d.templates[page] ?? null) === id) return d;
      const cur = templates.find((x) => x.id === d.templates[page]);
      return applyTemplate(d, page, templates.find((x) => x.id === id) ?? null, cur ? normalize(cur.doc) : null);
    });
    setSel(null);
    setMode(null);
  }, [update, templates]);

  const duplicate = useCallback(() => {
    const d = docRef.current;
    if (d) open({ ...d, id: newDoc().id, name: `${d.name} のコピー` });
  }, [open]);

  const destroy = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    await deleteProject(d.id).catch(() => {});
    const list = (await loadLists().catch(() => [])).filter((p) => p.id !== d.id);
    if (!list[0] || !(await openById(list[0].id))) open(newDoc());
  }, [loadLists, openById, open]);

  // ---- 書き出し・プレビュー ----
  const saveImage = useCallback(async (type: 'png' | 'jpeg') => {
    const d = docRef.current;
    if (!d) return;
    try {
      // アートボードごとに 1 枚ずつ
      for (let page = 0; page < d.count; page++) {
        download(await exportImage(d, media.resolve, type, timeRef.current(), page), `${fileBase(d, page)}.${type === 'jpeg' ? 'jpg' : 'png'}`);
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch (e) {
      say((e as Error).message);
    }
  }, [media, say]);

  const saveVideo = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    setPlaying(false);
    const ctl = new AbortController();
    abort.current = ctl;
    setExporting({ ratio: 0, note: '' });
    try {
      for (let page = 0; page < d.count; page++) {
        const head = d.count > 1 ? `${page + 1} / ${d.count} 枚目: ` : '';
        const blob = await exportVideo(d, media.resolve, (ratio, note) => setExporting({ ratio: (page + ratio) / d.count, note: head + note }), ctl.signal, page);
        download(blob, `${fileBase(d, page)}.mp4`);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') say(`動画を書き出せませんでした: ${(e as Error).message}`);
    } finally {
      setExporting(null);
      abort.current = null;
    }
  }, [media, say, setPlaying]);

  const showPreview = useCallback(async () => {
    const d = docRef.current;
    if (!d) return;
    try {
      const urls: string[] = [];
      for (let page = 0; page < d.count; page++) urls.push(URL.createObjectURL(await exportImage(d, media.resolve, 'jpeg', timeRef.current(), page)));
      setPreview(urls);
    } catch (e) {
      say((e as Error).message);
    }
  }, [media, say]);

  const layer = useMemo(() => (doc ? findLayer(doc, sel) : null), [doc, sel]);

  if (!doc) return <div className="loading">読み込んでいます…</div>;

  return (
    <div className="editor" onPointerDown={(e) => menu && !(e.target as HTMLElement).closest('.menu-wrap') && setMenu(null)}>
      <header className="bar">
        <span className="mark" aria-hidden="true" />
        <div className="menu-wrap">
          <button type="button" className="ghost" onClick={() => { setMenu(menu === 'file' ? null : 'file'); loadLists().catch(() => {}); }}>
            ファイル <Icon name="down" size={12} />
          </button>
          {menu === 'file' && (
            <div className="menu">
              <button type="button" onClick={() => { setDialog('new'); setMenu(null); }}>新規…</button>
              <button type="button" onClick={() => { duplicate(); setMenu(null); }}>複製</button>
              <button type="button" className="danger" onClick={() => { if (window.confirm(`「${doc.name}」を削除しますか？ 元に戻せません`)) destroy(); setMenu(null); }}>このプロジェクトを削除</button>
              {projects.length > 0 && <hr />}
              <div className="menu-list">
                {projects.map((p) => (
                  <button key={p.id} type="button" className={p.id === doc.id ? 'on' : ''} onClick={() => { if (p.id !== doc.id) openById(p.id); setMenu(null); }}>
                    <span>{p.name}</span>
                    <small>{p.aspect}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <input className="title" value={doc.name} aria-label="プロジェクトの名前" spellCheck={false} onChange={(e) => update((d) => ({ ...d, name: e.target.value }), 'name')} />
        <span className={`saved ${saved}`}>{saved === 'saved' ? '保存済み' : saved === 'saving' ? '保存中…' : '保存できません'}</span>

        <div className="seg aspect" role="group" aria-label="縦横比">
          {ASPECTS.map((a) => (
            <button key={a.id} type="button" className={a.id === doc.aspect ? 'on' : ''} title={`${a.note} (${a.w} × ${a.h})`} onClick={() => a.id !== doc.aspect && update((d) => setAspect(d, a.id))}>
              {a.id}
            </button>
          ))}
        </div>

        <div className="count" role="group" aria-label="横に並べる枚数" title="アートボードを横に並べる枚数。背景や枠をまたがせると、1 枚の絵を分けて投稿できます">
          <button type="button" disabled={doc.count <= 1} onClick={() => update((d) => setCount(d, d.count - 1))} aria-label="1 枚減らす">−</button>
          <span>{doc.count} 枚</span>
          <button type="button" disabled={doc.count >= MAX_COUNT} onClick={() => update((d) => setCount(d, d.count + 1))} aria-label="1 枚増やす">+</button>
        </div>

        <div className="tools">
          <button type="button" className="ghost icon-btn" title="テキストを足す (T)" aria-label="テキストを足す" onClick={() => add('text')}>
            <Icon name="text" />
          </button>
          <button type="button" className="ghost icon-btn" title="画像を入れる枠を足す (I)" aria-label="画像の枠を足す" onClick={() => add('image')}>
            <Icon name="image" />
          </button>
          <button type="button" className="ghost icon-btn" title="動画を入れる枠を足す (V)" aria-label="動画の枠を足す" onClick={() => add('video')}>
            <Icon name="video" />
          </button>
          <button type="button" className="ghost icon-btn" title="色面 (帯など) を足す (R)" aria-label="色面を足す" onClick={() => add('rect')}>
            <Icon name="rect" />
          </button>
          <span className="sep" />
          <button type="button" className="ghost icon-btn" title="取り消す (Cmd + Z)" onClick={() => travel('undo')}>
            <Icon name="undo" />
          </button>
          <button type="button" className="ghost icon-btn" title="やり直す (Shift + Cmd + Z)" onClick={() => travel('redo')}>
            <Icon name="redo" />
          </button>
        </div>

        <div className="bar-right">
          <button type="button" className="ghost zoom" title="紙面を画面に合わせる" onClick={() => setFitSignal((n) => n + 1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="ghost" onClick={showPreview}>
            プレビュー
          </button>
          <div className="menu-wrap">
            <button type="button" className="primary" onClick={() => setMenu(menu === 'export' ? null : 'export')}>
              書き出す <Icon name="down" size={12} />
            </button>
            {menu === 'export' && (
              <div className="menu end">
                <button type="button" onClick={() => { saveImage('png'); setMenu(null); }}>PNG<small>{doc.w} × {doc.h}</small></button>
                <button type="button" onClick={() => { saveImage('jpeg'); setMenu(null); }}>JPEG<small>{doc.w} × {doc.h}</small></button>
                <button type="button" onClick={() => { saveVideo(); setMenu(null); }}>MP4 (動画)<small>{duration.toFixed(1)} 秒</small></button>
              </div>
            )}
          </div>
        </div>
      </header>

      <LeftPanel doc={doc} sel={sel} setSel={(id) => { setMode(null); setSel(id); }} update={update} presets={presets} assets={assets} busy={busy} onPick={onPick} onFiles={upload} />

      <main className="center">
        <Stage doc={doc} sel={sel} mode={mode} setSel={setSel} setMode={exitMode} update={update} resolve={media.resolve} tick={tick} drawRef={drawRef} timeRef={timeRef} templates={templates} onTemplate={swapTemplate} fitSignal={fitSignal} onZoom={setZoom} onDropMedia={onDropMedia} />
        {video && <Transport clock={clock} duration={duration} onToggle={() => setPlaying(!clock.playing)} onSeek={seek} />}
      </main>

      <Inspector doc={doc} layer={layer} update={update} mode={mode} setMode={setMode} autoDuration={duration} onRemove={remove} />

      {dialog === 'new' && (
        <div className="modal" onPointerDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <div className="dialog">
            <h2>新しく作る</h2>
            <p className="meta">何も置かれていない紙面から始めます。</p>
            <div className="aspects">
              {ASPECTS.map((a) => (
                <button key={a.id} type="button" onClick={() => create(a.id)}>
                  <i style={{ aspectRatio: `${a.w} / ${a.h}` }} />
                  <b>{a.id}</b>
                  <small>{a.note}</small>
                </button>
              ))}
            </div>
            <h2>テンプレートから</h2>
            {templates.length ? (
              <div className="menu-list">
                {templates.map((t) => (
                  <button key={t.id} type="button" onClick={() => create('3:4', t)}>
                    <span>{t.name}</span>
                    <small>{t.aspect}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="meta">まだありません。templates/ に置いたレイアウトがここに並びます。</p>
            )}
          </div>
        </div>
      )}

      {preview && <Preview doc={doc} urls={preview} onClose={closePreview} />}

      {exporting && (
        <div className="modal">
          <div className="dialog small">
            <h2>動画を書き出しています</h2>
            <progress value={exporting.ratio} max={1} />
            <p className="meta">{exporting.note}</p>
            <button type="button" className="ghost" onClick={() => abort.current?.abort()}>
              止める
            </button>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

const EMPTY: Doc = newDoc();
