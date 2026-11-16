import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        obsidian: {
          950: '#0b1210',
          900: '#0e1713',
          850: '#111b17',
          800: '#15211b',
          700: '#1c3428',
        },
        limeaccent: {
          400: '#d6f68d',
          500: '#c8f169',
        },
        forest: {
          950: '#0b1210',
          900: '#0d261c',
          850: '#111b17',
          800: '#15211b',
          700: '#1c3428',
          600: '#28bb83',
          500: '#c8f169',
          100: '#1c3428',
          50: '#15211b',
        },
        surface: {
          canvas: '#0b1210',
          card: '#111b17',
          border: 'rgba(222, 242, 227, 0.12)',
          subtle: '#15211b',
          muted: '#9aa9a0',
        },
        badge: {
          greenBg: 'rgba(40, 187, 131, 0.14)',
          greenText: '#84e5b3',
          amberBg: 'rgba(255, 184, 107, 0.14)',
          amberText: '#ffc477',
          redBg: 'rgba(255, 123, 130, 0.14)',
          redText: '#ff959a',
          grayBg: 'rgba(222, 242, 227, 0.08)',
          grayText: '#9aa9a0',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Manrope', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'DM Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
