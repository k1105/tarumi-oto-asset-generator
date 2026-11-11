// プロジェクトの一覧
import { listProjects } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ projects: listProjects() }, { headers: { 'Cache-Control': 'no-store' } });
}
