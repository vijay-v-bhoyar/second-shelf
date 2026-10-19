import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default defineConfig([
  globalIgnores([".next/**", "node_modules/**", "output/**", "graphify-out/**", "next-env.d.ts"]),
  js.configs.recommended,
  ...ts.configs.recommended,
  { files: ["**/*.tsx"], plugins: {"react-hooks": hooks}, rules: {"react-hooks/rules-of-hooks":"error"} },
  { files: ["**/*.mjs"], languageOptions: {globals: {process:"readonly",console:"readonly",URL:"readonly",fetch:"readonly",setTimeout:"readonly",Buffer:"readonly"}} },
  { files: ["scripts/e2e.mjs","scripts/persona-e2e.mjs","scripts/gap-e2e.mjs"], languageOptions: {globals: {document:"readonly",window:"readonly"}} }
]);
