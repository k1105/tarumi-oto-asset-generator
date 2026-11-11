// 写真の縮小コピー。/api/presets/proxy/<thumb|view>/<区分>/<名前>.jpg。無ければその場で magick で作る
import { SIZES, ensureProxy, type Size } from '@/lib/presets';
import { notFound, serveFile } from '@/lib/serve';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [size, group, file] = path;
  if (path.length !== 3 || !(size in SIZES) || !/\.jpg$/.test(file)) return notFound();
  try {
    const out = await ensureProxy(group, file.slice(0, -4), size as Size);
    return out ? serveFile(req, out) : notFound();
  } catch (e) {
    return new Response((e as Error).message, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

export const HEAD = GET;
