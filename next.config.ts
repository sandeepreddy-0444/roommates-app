import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { randomUUID } from "node:crypto";

const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID();

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries: [{ url: "/offline", revision }],
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSerwist(nextConfig);
