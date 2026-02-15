/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#FBFBFA', // Attio-style soft background
        foreground: '#111110', // Deep black text
        card: '#FFFFFF',
        'card-foreground': '#111110',
        popover: '#FFFFFF',
        'popover-foreground': '#111110',
        primary: '#000000', // Black as primary accent
        'primary-foreground': '#FFFFFF',
        secondary: '#F5F5F4',
        'secondary-foreground': '#666665',
        muted: '#F5F5F4',
        'muted-foreground': '#666665',
        accent: '#F5F5F4',
        'accent-foreground': '#111110',
        destructive: '#F97066',
        'destructive-foreground': '#FFFFFF',
        border: '#EBEBEA', // Subtle border color
        input: '#FFFFFF',
        ring: '#000000',
      },
    },
  },
  plugins: [],
}
