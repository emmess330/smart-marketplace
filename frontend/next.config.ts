import type { NextConfig } from "next";

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