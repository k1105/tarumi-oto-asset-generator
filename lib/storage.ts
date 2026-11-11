'use client';
// プロジェクトと落とした素材の保存先。
//   files   : サーバーのファイル (data/projects, data/assets)。手元で動かすとき
//   browser : 開いているブラウザの中 (IndexedDB)。Vercel に公開したもの (サーバーにはファイルを書けない)。端末・ブラウザごとに別々
// どちらかは next.config.ts の NEXT_PUBLIC_STORE で決まる。手元でも URL に ?store=browser を付けるとブラウザの中に保存する
import type { MediaKind } from './doc';

export type ProjectInfo = { id: string; name: string; aspect: string; updatedAt: number };
export type Asset = { name: string; kind: MediaKind; src: string };

export const browserMode = () => process.env.NEXT_PUBLIC_STORE === 'browser' || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('store') === 'browser');

const getJson = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json());

// ---- IndexedDB ----
const IDB = 'idb:'; // ブラウザの中の素材の src は「idb:<キー>」
type ProjectRow = { id: string; doc: { name?: string; aspect?: string }; updatedAt: number };
type AssetRow = { key: string; name: string; kind: MediaKind; blob: Blob; addedAt: number };

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('sns-frame', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('projects', { keyPath: 'id' });
      req.result.createObjectStore('assets', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

/** 1 つの操作をして、書き込みが終わるまで待つ */
async function tx<T>(store: 'projects' | 'assets', mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = run(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// 素材の中身を指す URL (blob:)。ページを開いているあいだ持っておく
const urls = new Map<string, string>();
const blobs = new Map<string, Blob>();
function keep(row: AssetRow): Asset {
  if (!urls.has(row.key)) {
    urls.set(row.key, URL.createObjectURL(row.blob));
    blobs.set(row.key, row.blob);
  }
  return { name: row.name, kind: row.kind, src: IDB + row.key };
}

/** レイヤーの src を、img / video に渡せる URL にする。ブラウザの中の素材は blob: の URL (まだ読めていなければ空) */
export const mediaUrl = (src: string) => (src.startsWith(IDB) ? urls.get(src.slice(IDB.length)) ?? '' : src);
/** ブラウザの中の素材の中身。サーバーにある素材は null */
export const mediaBlob = (src: string) => (src.startsWith(IDB) ? blobs.get(src.slice(IDB.length)) ?? null : null);

// ---- プロジェクト ----
export async function listProjects(): Promise<ProjectInfo[]> {
  if (!browserMode()) return (await getJson('/api/projects')).projects ?? [];
  const rows = await tx<ProjectRow[]>('projects', 'readonly', (s) => s.getAll());
  return rows.map((r) => ({ id: r.id, name: String(r.doc.name ?? r.id), aspect: String(r.doc.aspect ?? ''), updatedAt: r.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readProject(id: string): Promise<unknown> {
  if (!browserMode()) return (await getJson(`/api/projects/${id}`).catch(() => null))?.doc ?? null;
  return (await tx<ProjectRow | undefined>('projects', 'readonly', (s) => s.get(id)))?.doc ?? null;
}

export async function writeProject(doc: { id: string }): Promise<void> {
  if (!browserMode()) {
    const r = await fetch(`/api/projects/${doc.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
    if (!r.ok) throw new Error('保存できませんでした');
    return;
  }
  await tx('projects', 'readwrite', (s) => s.put({ id: doc.id, doc, updatedAt: Date.now() }));
}

export async function deleteProject(id: string): Promise<void> {
  if (!browserMode()) {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    return;
  }
  await tx('projects', 'readwrite', (s) => s.delete(id));
}

// ---- 落とした素材 ----
export async function listAssets(): Promise<Asset[]> {
  if (!browserMode()) return (await getJson('/api/assets')).assets ?? [];
  const rows = await tx<AssetRow[]>('assets', 'readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.addedAt - a.addedAt).map(keep);
}

const kindOfFile = (f: File): MediaKind | null =>
  f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(f.name) ? 'image' : f.type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/i.test(f.name) ? 'video' : null;

/** 素材を足す。入れられないものは error に理由 */
export async function addAsset(f: File): Promise<{ asset?: Asset; error?: string }> {
  if (!browserMode()) {
    const r = await fetch('/api/assets', { method: 'POST', headers: { 'x-file-name': encodeURIComponent(f.name) }, body: f });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.asset ? { asset: j.asset } : { error: j.error ?? `「${f.name}」を読み込めませんでした` };
  }
  const kind = kindOfFile(f);
  if (!kind) return { error: '画像 (jpg / png / webp / gif / svg) か動画 (mp4 / mov / webm) を入れてください' };
  const row: AssetRow = { key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name: f.name, kind, blob: f, addedAt: Date.now() };
  try {
    await tx('assets', 'readwrite', (s) => s.put(row));
  } catch (e) {
    return { error: `「${f.name}」をブラウザに保存できませんでした (空き容量が足りないかもしれません): ${(e as Error)?.message ?? ''}` };
  }
  return { asset: keep(row) };
}
