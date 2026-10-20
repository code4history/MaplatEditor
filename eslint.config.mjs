// ESLint の設定（nov26-m8-t4・NayutaProducts#33）。形は m8 設計の C-m8-1。Vue は eslint-plugin-vue の flat/essential
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import vue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier"; // 書式の規則は prettier に任せる。no-unexpected-multiline 等の書式の規則を off にする

export default [
  // 全体の除外は ignores だけを持つ要素に書く（C-m8-1 (b)）。src/libs は第三者の同梱物（ol-geocoder・ol-contextmenu。各 LICENSE あり）
  { ignores: ["dist/**", "dist-electron/**", "release/**", "node_modules/**", "coverage/**", "src/libs/**"] },
  { linterOptions: { reportUnusedDisableDirectives: true } },
  // recommended は独立した要素に置き、files を付けない（.vue・.js にも当てる。C-m8-1 (a)）
  js.configs.recommended,
  ...vue.configs["flat/essential"],
  { files: ["**/*.{ts,tsx,mts,cts}"], languageOptions: { parser: tsParser } },
  // .vue は flat/essential が vue-eslint-parser を設定する。その中の <script lang="ts"> を @typescript-eslint/parser に読ませる
  { files: ["**/*.vue"], languageOptions: { parserOptions: { parser: tsParser, extraFileExtensions: [".vue"], sourceType: "module" } } },
  {
    files: ["**/*.{ts,tsx,mts,cts,vue}"],
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-undef": "off", // TS・Vue の未定義の識別子は vue-tsc（pnpm run build の前段）が検査する。no-undef は DOM・Electron・型の大域を知らず誤検出する（typescript-eslint の推奨）
      "no-unused-vars": "off", // @typescript-eslint/no-unused-vars（warn・_ 始まりを除外）で代替する
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
  prettier,
];
