import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // ── VENDOR BOUNDARY RULES ────────────────────────────────────────────────
  // WHEEL MART (_lk_tax/) files must never import from Sakura Auto (_standard/)
  {
    files: ["src/app/vendor/_lk_tax/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["*/_standard*", "../_standard*", "../../_standard*", "**/_standard/**"],
          message: "WHEEL MART (_lk_tax) cannot import from Sakura Auto (_standard). Wrong vendor folder!",
        }],
      }],
    },
  },
  // Sakura Auto (_standard/) files must never import from WHEEL MART (_lk_tax/)
  {
    files: ["src/app/vendor/_standard/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["*/_lk_tax*", "../_lk_tax*", "../../_lk_tax*", "**/_lk_tax/**"],
          message: "Sakura Auto (_standard) cannot import from WHEEL MART (_lk_tax). Wrong vendor folder!",
        }],
      }],
    },
  },
]);

export default eslintConfig;
