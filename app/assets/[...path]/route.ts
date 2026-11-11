// data/assets/ のファイルをそのまま出す (動画のシークのため Range に応える)
import { ASSETS } from '@/lib/paths';
import { notFound, resolveUnder, serveFile } from '@/lib/serve';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const file = path.length === 1 ? resolveUnder(ASSETS, path) : null;
  return file ? serveFile(req, file) : notFound();
}

export const HEAD = GET;
