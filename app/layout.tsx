import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './global.css';
import { RootProvider } from 'fumadocs-ui/provider';
import { ReactNode } from 'react';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'IDAAS 集成平台文档',
  description: 'IDAAS 集成平台的官方文档中心',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={inter.className}>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
