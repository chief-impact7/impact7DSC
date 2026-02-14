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
        background: '#09090b', // Zinc 950
        foreground: '#fafafa', // Zinc 50
        card: '#18181b', // Zinc 900
        'card-foreground': '#fafafa', // Zinc 50
        popover: '#18181b', // Zinc 900
        'popover-foreground': '#fafafa', // Zinc 50
        primary: '#fafafa', // Zinc 50
        'primary-foreground': '#18181b', // Zinc 900
        secondary: '#27272a', // Zinc 800
        'secondary-foreground': '#fafafa', // Zinc 50
        muted: '#27272a', // Zinc 800
        'muted-foreground': '#a1a1aa', // Zinc 400
        accent: '#27272a', // Zinc 800
        'accent-foreground': '#fafafa', // Zinc 50
        destructive: '#7f1d1d', // Red 900
        'destructive-foreground': '#fafafa', // Zinc 50
        border: '#27272a', // Zinc 800
        input: '#27272a', // Zinc 800
        ring: '#d4d4d8', // Zinc 300
      },
    },
  },
  plugins: [],
}
