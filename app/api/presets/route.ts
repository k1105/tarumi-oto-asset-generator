// 樽見の写真の一覧
import { listPresets } from '@/lib/presets';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ presets: listPresets() }, { headers: { 'Cache-Control': 'no-store' } });
}
