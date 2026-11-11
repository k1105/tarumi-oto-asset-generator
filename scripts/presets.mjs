// 樽見の写真 (../docs/photo/selected/<区分>/*.JPG。NEF / DNG は読まない) の縮小版を public/presets/ に作る。
//   public/presets/thumb/<名前>.jpg  一覧用 (長辺 360px)
//   public/presets/view/<名前>.jpg   紙面用 (長辺 2400px)
//   public/presets/index.json        一覧 (アプリが読む)
// 使い方: node scripts/presets.mjs [--limit N]   (ImageMagick の magick が要る。写真を足したら走らせ直す。出来ているものは作り直さない)
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.join(import.meta.dirname, '..');
const PHOTOS = path.join(ROOT, '..', 'docs', 'photo', 'selected');
const OUT = path.join(ROOT, 'public', 'presets');
const SIZES = { thumb: [360, 78], view: [2400, 88] };
const arg = process.argv.indexOf('--limit');
const limit = arg > 0 ? Number(process.argv[arg + 1]) : Infinity;

const presets = [];
const seen = new Set();
let made = 0;
let kept = 0;
let failed = 0;
for (const group of fs.readdirSync(PHOTOS).sort()) {
  const dir = path.join(PHOTOS, group);
  if (group.startsWith('.') || !fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.startsWith('.') || !/\.jpe?g$/i.test(f)) continue;
    if (presets.length >= limit) break;
    const name = f.replace(/\.jpe?g$/i, '');
    if (!/^[\w.-]+$/.test(name) || seen.has(name)) {
      console.error(`飛ばしました (名前が英数字でないか、重なっています): ${group}/${f}`);
      failed++;
      continue;
    }
    seen.add(name);
    const src = path.join(dir, f);
    let ok = true;
    for (const [size, [px, q]] of Object.entries(SIZES)) {
      const dst = path.join(OUT, size, `${name}.jpg`);
      if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) {
        kept++;
        continue;
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      try {
        await run('magick', [src, '-auto-orient', '-resize', `${px}x${px}>`, '-strip', '-quality', String(q), dst]);
        made++;
      } catch (e) {
        console.error(`作れませんでした: ${group}/${f}: ${e.message}`);
        ok = false;
        failed++;
      }
    }
    if (ok) presets.push({ id: `${group.normalize('NFC')}/${name}`, group: group.normalize('NFC'), name, thumb: `/presets/thumb/${name}.jpg`, src: `/presets/view/${name}.jpg` });
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ presets }, null, 1));
console.log(`写真 ${presets.length} 枚。作った ${made} 個、そのまま ${kept} 個、失敗 ${failed} 個`);
