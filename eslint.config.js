// ESLint flat config for the Pageinator workspace.
// Kernel packages (the text and print engine) must be deterministic: the same input gives byte-identical output on
// every machine and browser. These rules ban the JavaScript features that would break that. A rule may be disabled
// only with a description that cites an ADR.
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import prettier from "eslint-config-prettier";
import globals from "globals";

const KERNEL_SRC = [
  "packages/{pyshim,harfbuzz,fonts,shape,hyphenate,compose,headline,document,pdf,kernel,layout-gen,preflight,color}/src/**/*.ts",
];

const MATH_BANNED = [
  "random",
  "pow",
  "exp",
  "expm1",
  "log",
  "log1p",
  "log2",
  "log10",
  "cbrt",
  "hypot",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "round",
  "fround",
];

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.tsbuild/**",
      "apps/web/**",
      "experiments/**",
      "fixtures/**",
      "tools/oracle/**",
      "tools/goldens/**",
      "graphify-out/**",
      "docs/**",
      "specs/**",
      "snap5/**",
      "Logos/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  comments.recommended,
  {
    rules: {
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unused-disable": "error",
    },
  },
  {
    files: ["tools/ts/**/*.ts", "tools/testkit/**/*.ts", "**/test/**/*.ts", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: KERNEL_SRC,
    rules: {
      "no-restricted-globals": [
        "error",
        ...[
          "Date",
          "Intl",
          "performance",
          "crypto",
          "fetch",
          "XMLHttpRequest",
          "window",
          "document",
          "self",
          "navigator",
          "process",
          "Buffer",
          "setTimeout",
          "setInterval",
          "globalThis",
        ].map((name) => ({ name, message: "Kernel code must not depend on the clock, the host or I/O." })),
      ],
      "no-restricted-properties": [
        "error",
        ...MATH_BANNED.map((property) => ({
          object: "Math",
          property,
          message:
            "Not bit-identical across engines (or not Python's rounding). Use @pageinator/pyshim, or + - * / sqrt floor ceil trunc abs min max.",
        })),
        { object: "Date", property: "now", message: "No clock in kernel code." },
        { object: "JSON", property: "stringify", message: "Use pyshim's pyJsonDumps or document/canonical.ts." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='**']",
          message: "`**` is not bit-identical across engines; use pyshim.",
        },
        { selector: "AssignmentExpression[operator='**=']", message: "`**=` is not bit-identical; use pyshim." },
        { selector: "ForInStatement", message: "for…in order is not a contract; iterate a Map or an array." },
        {
          selector:
            "CallExpression[callee.property.name=/^(localeCompare|toLocaleString|toLocaleUpperCase|toLocaleLowerCase|toLocaleDateString|normalize|toFixed|toPrecision|toExponential)$/]",
          message: "Locale- and engine-dependent; use pyshim (pyFormatFixed, cmpCodePoints, …).",
        },
        {
          selector: "CallExpression[callee.property.name='sort'][arguments.length=0]",
          message: "Default sort compares UTF-16 units; pass a comparator (pyshim cmpCodePoints).",
        },
        { selector: "NewExpression[callee.name='Date']", message: "No clock in kernel code." },
        {
          selector: "Literal[regex.flags=/[uv]/][regex.pattern=/\\\\[pP]\\{/]",
          message: "Unicode property escapes follow the engine's Unicode version; use pyshim's generated tables.",
        },
        {
          selector: "TSIndexSignature TSNumberKeyword",
          message: "Number-keyed objects reorder keys; use a Map.",
        },
        {
          selector:
            "TSTypeReference[typeName.name='Record'] > TSTypeParameterInstantiation > TSNumberKeyword:first-child",
          message: "Record<number, …> reorders keys; use a Map.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["node:*"], message: "Kernel packages do no I/O." },
            {
              group: ["fs", "path", "zlib", "os", "child_process", "http", "https", "net", "worker_threads", "url"],
              message: "Kernel packages do no I/O.",
            },
            {
              group: ["@pageinator/web", "@pageinator/api", "@pageinator/worker", "@pageinator/kernel-cli"],
              message: "Kernel packages never depend on apps.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
