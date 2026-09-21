import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored ffmpeg.wasm core, copied in by postinstall. It is emscripten
    // output, not our source, and linting it produces 100+ meaningless
    // warnings that bury real ones.
    "public/ffmpeg/**",
  ]),
]);

export default eslintConfig;
