import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 左下の N (開発中の印) は出さない
  devIndicators: false,
  // 保存先 (lib/storage.ts)。Vercel ではサーバーにファイルを書けないので、ブラウザの中に保存する
  env: { NEXT_PUBLIC_STORE: process.env.VERCEL ? 'browser' : 'files' },
  // テンプレートは実行時に templates/ から読むので、デプロイに含める
  outputFileTracingIncludes: { '/api/templates': ['./templates/*.json'] },
};

export default nextConfig;
