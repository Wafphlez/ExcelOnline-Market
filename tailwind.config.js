import containerQueries from '@tailwindcss/container-queries'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'eve-bg': 'rgb(var(--eve-bg-rgb) / <alpha-value>)',
        'eve-surface': 'rgb(var(--eve-surface-rgb) / <alpha-value>)',
        'eve-elevated': 'rgb(var(--eve-elevated-rgb) / <alpha-value>)',
        'eve-border': 'rgb(var(--eve-border-rgb) / <alpha-value>)',
        'eve-accent': 'rgb(var(--eve-accent-rgb) / <alpha-value>)',
        'eve-accent-hover': 'rgb(var(--eve-accent-hover-rgb) / <alpha-value>)',
        'eve-gold': 'rgb(var(--eve-gold-rgb) / <alpha-value>)',
        'eve-gold-bright': 'rgb(var(--eve-gold-bright-rgb) / <alpha-value>)',
        'eve-accent-muted': 'rgb(var(--eve-accent-rgb) / 0.14)',
        'eve-text': 'rgb(var(--eve-text-rgb) / <alpha-value>)',
        'eve-bright': 'rgb(var(--eve-bright-rgb) / <alpha-value>)',
        'eve-muted': 'rgb(var(--eve-muted-rgb) / <alpha-value>)',
        'eve-danger': 'rgb(var(--eve-danger-rgb) / <alpha-value>)',
        'eve-row-alt': 'rgb(var(--eve-elevated-rgb) / 0.68)',
        'eve-highlight': 'rgb(var(--eve-accent-rgb) / 0.1)',
        'eve-cyan': 'rgb(var(--eve-cyan-rgb) / <alpha-value>)',
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
        'glass-subtle':
          'inset 0 1px 0 rgba(255,255,255,0.06), 0 6px 18px rgba(0,0,0,0.28)',
        'glass-panel':
          'inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 28px rgba(0,0,0,0.35)',
        'glass-elevated':
          'inset 0 1px 0 rgba(255,255,255,0.1), 0 16px 36px rgba(0,0,0,0.42)',
      },
    },
  },
  plugins: [containerQueries],
}
