import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '樽見OTO鉄道 SNS フレーム',
  description: 'SNS に投稿する画像と動画を組むエディター',
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='3' y='1' width='10' height='14' fill='%2318ff14'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
