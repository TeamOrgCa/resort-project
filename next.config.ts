import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/reservations/payment": ["./assets/ocr/eng.traineddata"],
    "/api/reservations/checkout": ["./assets/ocr/eng.traineddata"],
  },
};

export default nextConfig;
