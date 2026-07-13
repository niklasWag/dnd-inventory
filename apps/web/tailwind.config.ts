import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Tailwind v3 config wired to the R9 design-system token set
// (docs/r9-redesign/DESIGN_SYSTEM.md). All values map to CSS variables in
// src/index.css so the copy-vendored primitives in src/components/ui/ and the
// R9 screens resolve one source for light/dark + runtime accent overrides.
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          2: 'hsl(var(--surface-2))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        rarity: {
          common: 'hsl(var(--rarity-common))',
          uncommon: 'hsl(var(--rarity-uncommon))',
          rare: 'hsl(var(--rarity-rare))',
          'very-rare': 'hsl(var(--rarity-very-rare))',
          legendary: 'hsl(var(--rarity-legendary))',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        display: ['var(--font-display)'],
      },
      borderRadius: {
        xl: 'var(--radius)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      boxShadow: {
        e1: '0 1px 2px 0 hsl(var(--shadow-color) / 0.06)',
        e2: '0 2px 8px -2px hsl(var(--shadow-color) / 0.10)',
        e3: '0 8px 24px -6px hsl(var(--shadow-color) / 0.16)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
