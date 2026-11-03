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
        forest: {
          950: '#06140e',
          900: '#0d261c', // Sidebar background
          850: '#143829',
          800: '#1a4734',
          700: '#235e45',
          600: '#2e7a5a',
          500: '#15803d', // Primary action green
          100: '#eef5f0',
          50: '#f6fbf8',
        },
        surface: {
          canvas: '#f8f9f8', // Warm off-white page background
          card: '#ffffff',
          border: '#e6e9e7',
          subtle: '#f1f4f2',
          muted: '#68726e',
        },
        badge: {
          greenBg: '#eaf6ee',
          greenText: '#1b7837',
          amberBg: '#fef5e7',
          amberText: '#b45309',
          redBg: '#fdf0f0',
          redText: '#c53030',
          grayBg: '#f2f4f3',
          grayText: '#4a5550',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
