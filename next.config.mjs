import { createMDX } from 'fumadocs-mdx/next';
import path from 'path';

const projectRoot = '/Users/lidongming/Documents/IDAAS Fumadocs/idaas-docs';

const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
  outputFileTracingRoot: projectRoot,
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
