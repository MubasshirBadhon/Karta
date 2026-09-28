import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        karta: {
          primary: "#6366f1",
          secondary: "#8b5cf6",
          accent: "#06b6d4",
          dark: "#0f172a",
          light: "#f8fafc",
        },
      },
    },
  },
  plugins: [],
};

export default config;
