import type { NextConfig } from "next";

const ocrRuntimeFiles = [
  "./assets/ocr/eng.traineddata",
  "./node_modules/tesseract.js/src/**/*",
  "./node_modules/tesseract.js-core/**/*",
  "./node_modules/wasm-feature-detect/**/*",
  "./node_modules/regenerator-runtime/**/*",
  "./node_modules/is-url/**/*",
  "./node_modules/bmp-js/**/*",
  "./node_modules/node-fetch/**/*",
  "./node_modules/sharp/**/*",
  "./node_modules/@img/sharp-*/**/*",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    // The default website logo is embedded in transactional emails at runtime.
    "/*": ["./public/website_logo_transparent.png"],
    "/api/reservations/payment": ocrRuntimeFiles,
    "/api/reservations/checkout": ocrRuntimeFiles,
  },
};

export default nextConfig;
