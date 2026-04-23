/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // База — почти «космический» тёмный UI в духе клиента EVE
        'eve-bg': '#050608',
        'eve-surface': '#0c0e14',
        'eve-elevated': '#12161f',
        'eve-border': '#2a3142',
        /** Основной акцент — «фирменное» золото Neocom */
        'eve-accent': '#b8963d',
        'eve-accent-hover': '#d4b55a',
        'eve-gold': '#a88930',
        'eve-gold-bright': '#e8d4a0',
        'eve-accent-muted': 'rgba(184, 150, 61, 0.12)',
        'eve-text': '#c8ccd6',
        'eve-bright': '#eceef2',
        'eve-muted': '#6d7588',
        'eve-danger': '#c25a5a',
        'eve-row-alt': 'rgba(18, 22, 31, 0.65)',
        'eve-highlight': 'rgba(184, 150, 61, 0.08)',
        'eve-cyan': '#5a8fa8',
      },
      fontFamily: {
        sans: [
          'Rajdhani',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        tabular: [
          'Rajdhani',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        eve: [
          'Rajdhani',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        'eve-inset': 'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.35)',
        'eve-panel':
          '0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(184, 150, 61, 0.08)',
      },
    },
  },
  plugins: [],
}
