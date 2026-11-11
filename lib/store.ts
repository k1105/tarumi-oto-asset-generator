// プロジェクト (data/projects/<id>.json)、テンプレート (templates/*.json)、落とした素材 (data/assets/) の読み書き
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, PROJECTS, TEMPLATES } from './paths';

export const validId = (id: string) => /^[a-z0-9-]{1,48}$/.test(id);

export type ProjectInfo = { id: string; name: string; aspect: string; updatedAt: number };

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function listDocs(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .map((f) => ({ file: path.join(dir, f), id: f.slice(0, -5), doc: readJson(path.join(dir, f)) }))
    .filter((x) => x.doc);
}

export function listProjects(): ProjectInfo[] {
  return listDocs(PROJECTS)
    .map(({ file, id, doc }) => ({ id, name: String(doc!.name ?? id), aspect: String(doc!.aspect ?? ''), updatedAt: fs.statSync(file).mtimeMs }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readProject(id: string) {
  return validId(id) ? readJson(path.join(PROJECTS, `${id}.json`)) : null;
}

export function writeProject(id: string, doc: unknown) {
  fs.mkdirSync(PROJECTS, { recursive: true });
  const file = path.join(PROJECTS, `${id}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, file);
}

export function deleteProject(id: string) {
  const file = path.join(PROJECTS, `${id}.json`);
  if (validId(id) && fs.existsSync(file)) fs.unlinkSync(file);
}

/** テンプレート。プロジェクトと同じ形の JSON を templates/ に置くと「新規」に並ぶ */
export function listTemplates() {
  return listDocs(TEMPLATES).map(({ id, doc }) => ({ id, name: String(doc!.name ?? id), aspect: String(doc!.aspect ?? ''), doc }));
}

const IMAGE = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'];
const VIDEO = ['.mp4', '.mov', '.m4v', '.webm'];
export function kindOf(name: string): 'image' | 'video' | null {
  const ext = path.extname(name).toLowerCase();
  return IMAGE.includes(ext) ? 'image' : VIDEO.includes(ext) ? 'video' : null;
}

export type Asset = { name: string; kind: 'image' | 'video'; src: string; mtime: number };

const assetOf = (f: string): Asset | null => {
  const kind = kindOf(f);
  if (!kind || f.startsWith('.')) return null;
  // ファイル名は「<時刻>-<もとの名前>」
  return { name: f.replace(/^[a-z0-9]+-/, ''), kind, src: `/assets/${encodeURIComponent(f)}`, mtime: fs.statSync(path.join(ASSETS, f)).mtimeMs };
};

export function listAssets(): Asset[] {
  if (!fs.existsSync(ASSETS)) return [];
  return fs
    .readdirSync(ASSETS)
    .map(assetOf)
    .filter((a): a is Asset => a !== null)
    .sort((a, b) => b.mtime - a.mtime);
}

/** 落とされたファイルを置く先。名前の危ない文字は _ にする */
export function newAssetPath(name: string): { file: string; base: string } | null {
  const safe = path.basename(name).replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '');
  if (!safe || !kindOf(safe)) return null;
  fs.mkdirSync(ASSETS, { recursive: true });
  const base = `${Date.now().toString(36)}-${safe}`;
  return { file: path.join(ASSETS, base), base };
}

export const assetInfo = (base: string) => assetOf(base);
