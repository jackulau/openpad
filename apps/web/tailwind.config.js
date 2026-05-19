/** @type {import('tailwindcss').Config} */
const withOpacity =
  (cssVar) =>
  ({ opacityValue } = {}) =>
    opacityValue == null
      ? `rgb(var(${cssVar}))`
      : `rgb(var(${cssVar}) / ${opacityValue})`;

const tokens = {
  page: withOpacity('--oc-bg-page'),
  surface: withOpacity('--oc-bg-surface'),
  elevated: withOpacity('--oc-bg-elevated'),
  muted: withOpacity('--oc-bg-muted'),
  hover: withOpacity('--oc-bg-hover'),
  primary: withOpacity('--oc-text-primary'),
  secondary: withOpacity('--oc-text-secondary'),
  subtle: withOpacity('--oc-text-muted'),
  inverted: withOpacity('--oc-text-inverted'),
  line: withOpacity('--oc-border-default'),
  'line-strong': withOpacity('--oc-border-strong'),
  accent: withOpacity('--oc-accent'),
  'accent-hover': withOpacity('--oc-accent-hover'),
  'accent-fg': withOpacity('--oc-accent-fg'),
  success: withOpacity('--oc-success'),
  warn: withOpacity('--oc-warn'),
  danger: withOpacity('--oc-danger'),
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecfeff',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
        ...tokens,
      },
      borderColor: {
        DEFAULT: withOpacity('--oc-border-default'),
        strong: withOpacity('--oc-border-strong'),
      },
      ringColor: {
        DEFAULT: withOpacity('--oc-focus-ring'),
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgb(0 0 0 / 0.05), 0 1px 3px 0 rgb(0 0 0 / 0.06)',
        pop: '0 8px 24px -4px rgb(0 0 0 / 0.25), 0 4px 10px -2px rgb(0 0 0 / 0.18)',
      },
    },
  },
  plugins: [],
};
