/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ink: { 950: "#07090d", 900: "#0c1017", 850: "#11161f", 800: "#171d28", 700: "#232b39", 600: "#2f394a" },
        lotus: { 300: "#f9a8d4", 400: "#f472b6", 500: "#ec4899", 600: "#db2777" },
      },
    },
  },
  plugins: [],
};
