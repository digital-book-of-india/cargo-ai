import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-poppins)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        primary: { DEFAULT: "#2563EB", dark: "#1D4ED8" },
        pale: "#EFF6FF",
        line: "#DBEAFE",
        ink: "#0F172A",
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
      },
    },
  },
  plugins: [],
};

export default config;
