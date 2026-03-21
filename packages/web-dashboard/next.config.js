/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@clever/shared"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

module.exports = nextConfig;
