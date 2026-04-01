import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'IDAAS 集成平台',
      url: '/',
    },
    githubUrl: 'https://github.com/your-org/idaas',
    themeSwitch: {},
    searchToggle: {},
  };
}
