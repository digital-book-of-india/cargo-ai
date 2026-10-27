import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // Stricter rules that arrived with React 19 / eslint-plugin-react-hooks 6. The code they flag
    // (fetch on mount, Date.now() for a default range) works; they stay visible as warnings until
    // those places are reworked on purpose.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
  globalIgnores([".next/**", ".next-*/**", "next-env.d.ts"]),
]);
