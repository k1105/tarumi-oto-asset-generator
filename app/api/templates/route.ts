// テンプレートの一覧 (templates/*.json)
import { listTemplates } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ templates: listTemplates() }, { headers: { 'Cache-Control': 'no-store' } });
}
