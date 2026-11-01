import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#10b981", 400: "#34d399", 600: "#059669" },
        ink: {
          950: "#0e1014",
          900: "#14161c",
          800: "#1f232c",
          700: "#2a2f3a",
          500: "#5a6172",
          400: "#8a91a1",
          300: "#b4bac6",
          200: "#d3d7df",
          100: "#eceef2",
        },
      },
    },
  },
  plugins: [],
};
export default config;
