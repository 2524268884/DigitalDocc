import fs from 'node:fs/promises';
import { createMDX } from 'fumadocs-mdx/next';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(__filename);

const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  outputFileTracingRoot: projectRoot,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'digitalsee-image.oss-cn-beijing.aliyuncs.com',
      },
    ],
  },
  async redirects() {
    try {
      const raw = await fs.readFile(path.join(projectRoot, 'api', 'idaas-api-route-map.json'), 'utf8');
      const routeMap = JSON.parse(raw);

      return Object.entries(routeMap).map(([source, destination]) => ({
        source: encodeURI(`/docs/${source}`),
        destination: encodeURI(destination),
        permanent: true,
      }));
    } catch {
      return [];
    }
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(projectRoot, 'lib'),
      collections: path.resolve(projectRoot, '.source'),
    };
    return config;
  },
};

export default createMDX()(nextConfig);
