// プロジェクト 1 つ。GET: 読む、PUT: data/projects/<id>.json に保存、DELETE: 消す
import { deleteProject, readProject, validId, writeProject } from '@/lib/store';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const doc = readProject((await params).id);
  return doc ? json({ doc }) : json({ error: 'プロジェクトがありません' }, 404);
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!validId(id)) return json({ error: 'id が正しくありません' }, 400);
  let doc;
  try {
    doc = await req.json();
  } catch {
    return json({ error: '送られた内容を読めません' }, 400);
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.layers)) return json({ error: 'プロジェクトの形が正しくありません' }, 400);
  writeProject(id, { ...doc, id });
  return json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  deleteProject((await params).id);
  return json({ ok: true });
}
