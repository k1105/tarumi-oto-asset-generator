// 落とした素材。GET: 一覧、POST: 本文をそのまま data/assets/ に書く (名前は x-file-name に URL エンコードで)
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import { assetInfo, listAssets, newAssetPath } from '@/lib/store';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET() {
  return json({ assets: listAssets() });
}

export async function POST(req: Request) {
  let name = '';
  try {
    name = decodeURIComponent(req.headers.get('x-file-name') ?? '');
  } catch {}
  const dst = newAssetPath(name);
  if (!dst) return json({ error: '画像 (jpg / png / webp / gif / svg) か動画 (mp4 / mov / webm) を入れてください' }, 400);
  if (!req.body) return json({ error: 'ファイルの中身がありません' }, 400);
  try {
    await pipeline(Readable.fromWeb(req.body as unknown as NodeWebStream), fs.createWriteStream(dst.file));
  } catch (e) {
    fs.rmSync(dst.file, { force: true });
    return json({ error: `保存できませんでした: ${(e as Error).message}` }, 500);
  }
  return json({ asset: assetInfo(dst.base) });
}
