import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PayGuard — Autonomous B2B Procurement & Settlement Copilot',
  description: 'A deterministic fiduciary gateway between autonomous AI agents and PayPal.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
