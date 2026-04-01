import { generateFiles } from 'fumadocs-openapi';

await generateFiles({
  input: './openapi.yaml',
  output: './content/docs/开发指引/api',
  groupBy: 'tag',
  per: 'operation',
});

console.log('✅ API 文档生成完成');
