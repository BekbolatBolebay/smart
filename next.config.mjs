/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('node:sqlite', 'better-sqlite3', 'tesseract.js');
    }
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ['tesseract.js'],
    outputFileTracingIncludes: {
      '/api/smartprice/**': [
        './node_modules/tesseract.js-core/**/*.wasm',
        './node_modules/tesseract.js/src/worker-script/**/*',
      ],
    },
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
