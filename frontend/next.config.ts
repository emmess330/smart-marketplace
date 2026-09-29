import type { NextConfig } from "next";

// next-pwa ships no type declarations, so it can't be imported as an ES module here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // Add your phone's IP address here, as a string, inside the array.
  allowedDevOrigins: ['10.143.191.37'],
};

module.exports = withPWA(nextConfig);