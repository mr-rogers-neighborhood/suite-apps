import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  webpack(webpackConfig, options) {
    webpackConfig.module.rules.unshift({
      test: /\.tour$/,
      use: [{ loader: path.resolve(process.cwd(), "loaders/tour.mjs") }],
    });
    return webpackConfig;
  },
  async rewrites() {
    return [
      {
        source: "/docs/:path*.md",
        destination: "/llms.mdx/docs/:path*.md",
      },
      {
        source: "/docs/:path*.txt",
        destination: "/llms.mdx/docs/:path*.txt",
      },
    ];
  },
};

export default withMDX(config);
