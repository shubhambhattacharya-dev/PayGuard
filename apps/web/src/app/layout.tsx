import type { Metadata } from 'next';
import { Manrope, DM_Mono } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PayGuard — Give every payment a second look',
  description: 'A deterministic policy layer between AI payment proposals and execution.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`}>
      <body className="antialiased font-sans tabular-nums bg-[#0b1210] text-[#eaf0eb]">{children}</body>
    </html>
  );
}
