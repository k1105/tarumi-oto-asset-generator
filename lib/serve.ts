// ファイルを Response にする。Range (映像のシーク) と ETag (304) に応える
import fs from 'node:fs';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** root の下の segments を指すファイルの絶対パス。外に出るもの、隠しファイルは null */
export function resolveUnder(root: string, segments: string[]): string | null {
  if (!segments.length) return null;
  if (segments.some((s) => !s || s === '.' || s === '..' || s.startsWith('.') || s.includes('/') || s.includes('\\'))) return null;
  const file = path.resolve(root, ...segments);
  if (!file.startsWith(root + path.sep)) return null;
  return file;
}

export function notFound(message = 'not found') {
  return new Response(message, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export function serveFile(req: Request, file: string): Response {
  if (!fs.existsSync(file)) return notFound();
  const st = fs.statSync(file);
  if (!st.isFile()) return notFound();

  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  // 先頭の 2- は配信の仕組みを直したときの版 (ブラウザが前の版の途中で切れた応答を覚えていても、ここが変わると取り直す)
  const etag = `"2-${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    // 直したものがすぐ出るよう、毎回確かめる (ETag が同じなら 304)
    'Cache-Control': 'private, no-cache',
  };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });

  const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = st.size - 1;
  let status = 200;
  if (range && st.size > 0) {
    if (range[1] === '' && range[2] !== '') start = Math.max(0, st.size - Number(range[2]));
    else {
      start = Number(range[1] || 0);
      if (range[2] !== '') end = Math.min(Number(range[2]), end);
    }
    if (start > end || start >= st.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  if (req.method === 'HEAD') return new Response(null, { status, headers });

  // 映像のシークで途中で切られても落ちないよう (Readable.toWeb だと「Controller is already closed」になる)、pull で少しずつ読む
  const stream = fs.createReadStream(file, { start, end });
  const it = stream[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value as Uint8Array);
      } catch (e) {
        try {
          controller.error(e);
        } catch {}
      }
    },
    cancel() {
      stream.destroy();
    },
  });
  return new Response(body, { status, headers });
}
