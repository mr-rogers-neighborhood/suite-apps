import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
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
  async redirects() {
    return [
      {
        source: "/docs/walkthroughs",
        destination: "/docs/tours",
        permanent: true,
      },
      {
        source: "/docs/walkthroughs/:path*",
        destination: "/docs/tours/:path*",
        permanent: true,
      },
      {
        source: "/walkthroughs",
        destination: "/explore?view=tours",
        permanent: false,
      },
    ];
  },
};

export default withMDX(config);
