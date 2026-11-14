import babelParser from "@babel/eslint-parser";
import stylistic from "@stylistic/eslint-plugin";
import prettier from "eslint-plugin-prettier/recommended";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "data/**",
      ".tmp/**",
    ],
  },
  {
    files: ["**/*.{ts,js,mjs,cjs}"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          plugins: ["@babel/plugin-syntax-typescript"],
        },
      },
    },
    plugins: { "@stylistic": stylistic },
    rules: {
      // Expand one-line branches and keep independent statements apart.
      curly: ["error", "all"],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
        { blankLine: "any", prev: ["const", "let"], next: ["const", "let"] },
      ],
      "@stylistic/lines-between-class-members": [
        "error",
        "always",
        { exceptAfterSingleLine: false },
      ],
    },
  },
  prettier,
  {
    files: ["**/*.{ts,js,mjs,cjs}"],
    rules: { curly: ["error", "all"] },
  },
];
