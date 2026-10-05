import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Artifact images are base64 data URIs, which next/image does not optimise.
    rules: { "@next/next/no-img-element": "off" },
  },
  { ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts"] },
];

export default eslintConfig;
