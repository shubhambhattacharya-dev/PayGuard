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

const FOUC_SCRIPT = `
try {
  var saved = localStorage.getItem('pg-color-scheme');
  var meta = document.querySelector('meta[name="color-scheme"]');
  if (meta && (saved === 'light' || saved === 'dark')) {
    meta.content = saved;
    document.documentElement.dataset.theme = saved;
  } else {
    document.documentElement.dataset.theme = 'dark';
  }
} catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${manrope.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: FOUC_SCRIPT }} />
      </head>
      <body className="antialiased font-sans tabular-nums bg-[#0b1210] text-[#eaf0eb] transition-colors duration-200">
        {children}
      </body>
    </html>
  );
}
