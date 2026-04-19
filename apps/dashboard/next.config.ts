import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "tages",
  project: "tages-dashboard",
  widenClientFileUpload: true,
  disableLogger: true,
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
});
