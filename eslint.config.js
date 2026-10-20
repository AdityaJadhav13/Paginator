// ESLint flat config for the Pageinator workspace.
// Kernel packages (the text and print engine) must be deterministic: the same input gives byte-identical output on
// every machine and browser. These rules ban the JavaScript features that would break that. A rule may be disabled
// only with a description that cites an ADR.
import { readFileSync } from "node:fs";
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Every package under packages/ is a kernel package unless tools/ts/workspace.json lists it as a browser package.
const workspace = JSON.parse(readFileSync(new URL("./tools/ts/workspace.json", import.meta.url), "utf8"));
const KERNEL_SRC = ["packages/*/src/**/*.ts"];
const NOT_KERNEL = workspace.browserPackages.map((dir) => `packages/${dir}/**`);
const SORT_MESSAGE =
  "Default sort compares UTF-16 units; call sort/toSorted directly with a comparator (pyshim cmpCodePoints).";
// locale-, engine- or Unicode-version-dependent string and number methods (Python's semantics come from pyshim)
const ENGINE_METHODS = [
  "localeCompare",
  "toLocaleString",
  "toLocaleUpperCase",
  "toLocaleLowerCase",
  "toLocaleDateString",
  "toLocaleTimeString",
  "normalize",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimStart",
  "trimEnd",
  "toFixed",
  "toPrecision",
  "toExponential",
].join("|");

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
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@eslint-community/eslint-comments/require-description": "error",
    },
  },
  {
    files: ["tools/ts/**/*.ts", "tools/testkit/**/*.ts", "**/test/**/*.ts", "*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  {
    files: KERNEL_SRC,
    ignores: NOT_KERNEL,
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
          // any use, not only calls: also catches x.normalize.call(…) and passing the method as a callback
          selector: `MemberExpression[property.name=/^(${ENGINE_METHODS})$/]`,
          message:
            "Locale-, engine- or Unicode-version-dependent; use pyshim (Unicode 14 tables, pyFormatFixed, cmpCodePoints, …).",
        },
        {
          selector: "CallExpression[callee.property.name=/^(sort|toSorted)$/][arguments.length=0]",
          message: SORT_MESSAGE,
        },
        {
          // esquery compares attribute values as strings: a missing name would equal 'undefined', so check the type
          selector:
            "CallExpression[callee.property.name=/^(sort|toSorted)$/][arguments.0.type='Identifier'][arguments.0.name='undefined']",
          message: SORT_MESSAGE,
        },
        {
          selector: "MemberExpression[property.name=/^(sort|toSorted)$/]:not(CallExpression > MemberExpression.callee)",
          message: SORT_MESSAGE,
        },
        {
          selector: "CallExpression[callee.computed=true][callee.property.type=/^(Literal|TemplateLiteral)$/]",
          message: "Call methods by name (x.method()), so the determinism rules can see the call.",
        },
        { selector: "NewExpression[callee.name='Date']", message: "No clock in kernel code." },
        {
          selector: "Literal[regex.flags=/[uv]/][regex.pattern=/\\\\[pP]\\{/]",
          message: "Unicode property escapes follow the engine's Unicode version; use pyshim's generated tables.",
        },
        {
          selector: "Literal[regex.pattern=/\\\\[sS]/]",
          message: "\\s follows the engine's Unicode whitespace; spell the characters out (Python's isspace: pyshim).",
        },
        {
          selector: "NewExpression[callee.name='RegExp'], CallExpression[callee.name='RegExp']",
          message: "No regular expressions built at run time in kernel code; write a literal (no \\p{…} escapes).",
        },
        {
          // the KEY type only: { [k: string]: number } is fine
          selector: "TSIndexSignature > Identifier > TSTypeAnnotation > TSNumberKeyword",
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
            { group: workspace.apps, message: "Kernel packages never depend on apps." },
          ],
        },
      ],
    },
  },
  prettier,
);
