// 樽見の写真 (../docs/photo/selected/<区分>/*.JPG。NEF / DNG は読まない) を素材として出す。
// 縮小コピーは data/cache/presets/{thumb,view}/<区分>/<名前>.jpg に magick で作る (EXIF の向きは焼き込む)
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { CACHE, PHOTOS } from './paths';

const run = promisify(execFile);

export const SIZES = { thumb: 360, view: 2400 } as const;
export type Size = keyof typeof SIZES;
export type Preset = { id: string; group: string; name: string; thumb: string; src: string };

const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();

export function listPresets(): Preset[] {
  if (!isDir(PHOTOS)) return [];
  const out: Preset[] = [];
  for (const group of fs.readdirSync(PHOTOS).sort()) {
    if (group.startsWith('.') || !isDir(path.join(PHOTOS, group))) continue;
    for (const f of fs.readdirSync(path.join(PHOTOS, group)).sort()) {
      if (f.startsWith('.') || !/\.jpe?g$/i.test(f)) continue;
      const name = f.replace(/\.jpe?g$/i, '');
      const url = (size: Size) => `/api/presets/proxy/${size}/${encodeURIComponent(group)}/${encodeURIComponent(name)}.jpg`;
      out.push({ id: `${group}/${name}`, group, name, thumb: url('thumb'), src: url('view') });
    }
  }
  return out;
}

function source(group: string, name: string): string | null {
  const dir = path.join(PHOTOS, group);
  if (path.dirname(dir) !== PHOTOS || !isDir(dir)) return null;
  const f = fs.readdirSync(dir).find((x) => /\.jpe?g$/i.test(x) && x.replace(/\.jpe?g$/i, '') === name);
  return f ? path.join(dir, f) : null;
}

// 同時に走らせる magick は 3 つまで (一覧を開くと全部の縮小コピーを一度に頼まれる)
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const making = new Map<string, Promise<string | null>>();

/** 縮小コピーのパス。無ければ (か元より古ければ) 作る。写真が無ければ null */
export function ensureProxy(group: string, name: string, size: Size): Promise<string | null> {
  const key = `${size}/${group}/${name}`;
  const going = making.get(key);
  if (going) return going;
  const job = (async () => {
    const src = source(group, name);
    if (!src) return null;
    const dst = path.join(CACHE, 'presets', size, group, `${name}.jpg`);
    if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) return dst;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const tmp = `${dst}.${process.pid}.tmp.jpg`;
    const px = SIZES[size];
    try {
      await slot(() => run('magick', [src, '-auto-orient', '-resize', `${px}x${px}>`, '-strip', '-quality', size === 'thumb' ? '78' : '88', tmp], { maxBuffer: 1 << 20 }));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('ImageMagick (magick) がありません。brew install imagemagick で入れてください');
      throw e;
    }
    fs.renameSync(tmp, dst);
    return dst;
  })().finally(() => making.delete(key));
  making.set(key, job);
  return job;
}
