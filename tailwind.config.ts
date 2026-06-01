import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{ts,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        // DeepGuard brand palette
        'dg-bg': '#0a0e1a',
        'dg-surface': '#111827',
        'dg-border': '#1e2d45',
        'dg-accent': '#3b82f6',
        'dg-accent-glow': '#60a5fa',
        // Status colors
        'status-real': '#10b981',
        'status-suspicious': '#f59e0b',
        'status-synthetic': '#ef4444',
        // Score bar track
        'track': '#1e293b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glow-real': '0 0 20px rgba(16, 185, 129, 0.3)',
        'glow-suspicious': '0 0 20px rgba(245, 158, 11, 0.3)',
        'glow-synthetic': '0 0 20px rgba(239, 68, 68, 0.3)',
        'glow-accent': '0 0 20px rgba(59, 130, 246, 0.3)',
        'card': '0 4px 24px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.4)',
      },
      backgroundImage: {
        'glass': 'linear-gradient(135deg, rgba(17,24,39,0.9) 0%, rgba(10,14,26,0.95) 100%)',
        'badge-real': 'linear-gradient(135deg, #059669, #10b981)',
        'badge-suspicious': 'linear-gradient(135deg, #d97706, #f59e0b)',
        'badge-synthetic': 'linear-gradient(135deg, #dc2626, #ef4444)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan': 'scan 2s linear infinite',
        'fadeIn': 'fadeIn 0.3s ease-out',
        'slideIn': 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'scoreReveal': 'scoreReveal 1s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(400%)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        scoreReveal: {
          '0%': { 'stroke-dashoffset': '283' },
          '100%': { 'stroke-dashoffset': 'var(--target-offset)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
