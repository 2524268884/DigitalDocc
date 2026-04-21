import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DOCS_DIR = 'content/docs';
const DEFAULT_IMAGES_DIR = 'public/images';
const DEFAULT_SOURCE_FILE = '.source/server.ts';
const ISSUE_LIMIT = 20;

function printHelp() {
  console.log(`用法:
  node scripts/audit-docs.mjs [options]

参数:
  --docs-dir <path>      文档目录，默认 content/docs
  --images-dir <path>    图片目录，默认 public/images
  --source-file <path>   Fumadocs 生成清单，默认 .source/server.ts
  --include-internal     包含以下划线开头的内部文档（默认跳过）
  --json                 输出 JSON
  -h, --help             显示帮助

检查项:
  1. 本地图片引用是否落盘
  2. 标题是否完全重复
  3. 正文是否完全重复
  4. 文档是否已注册到 .source/server.ts
`);
}

function parseArgs(argv) {
  const options = {
    docsDir: DEFAULT_DOCS_DIR,
    imagesDir: DEFAULT_IMAGES_DIR,
    sourceFile: DEFAULT_SOURCE_FILE,
    includeInternal: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      return { help: true, options };
    }

    if (arg === '--docs-dir') {
      options.docsDir = argv[++i];
      continue;
    }

    if (arg === '--images-dir') {
      options.imagesDir = argv[++i];
      continue;
    }

    if (arg === '--source-file') {
      options.sourceFile = argv[++i];
      continue;
    }

    if (arg === '--include-internal') {
      options.includeInternal = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  return { help: false, options };
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function isDocFile(entry) {
  return entry.isFile() && /\.(md|mdx)$/i.test(entry.name);
}

function isInternalDoc(filePath) {
  return path.basename(filePath).startsWith('_');
}

function isMetaFile(filePath) {
  return path.basename(filePath).toLowerCase() === 'meta.json';
}

async function collectDocFiles(rootDir, includeInternal) {
  const results = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!isDocFile(entry)) {
        continue;
      }

      if (!includeInternal && isInternalDoc(fullPath)) {
        continue;
      }

      results.push(fullPath);
    }
  }

  return results.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { raw: '', body: content };
  }

  return { raw: match[1], body: content.slice(match[0].length) };
}

function parseTitle(content, filePath) {
  const { raw } = extractFrontmatter(content);
  const titleMatch = raw.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return collapseWhitespace(titleMatch?.[1] ?? path.basename(filePath, path.extname(filePath)));
}

function canonicalizeTitle(title) {
  return collapseWhitespace(
    title
      .replace(/(?:[_-]\d+|（\d+）|\(\d+\))$/u, '')
      .trim(),
  );
}

function normalizeImageReference(raw) {
  let value = raw.trim();

  if (value.startsWith('<') && value.endsWith('>')) {
    value = value.slice(1, -1).trim();
  }

  value = value
    .replace(/\s+"[^"]*"\s*$/u, '')
    .replace(/\s+'[^']*'\s*$/u, '')
    .replace(/\s+\([^)]+\)\s*$/u, '');

  const queryIndex = value.search(/[?#]/u);
  if (queryIndex >= 0) {
    value = value.slice(0, queryIndex);
  }

  return value.trim();
}

function safeDecodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractImageRefs(content) {
  const refs = [];
  const patterns = [
    /<ImageZoom\b[\s\S]*?\bsrc="([^"]+)"[\s\S]*?\/>/g,
    /<img\b[^>]*\bsrc="([^"]+)"/g,
    /!\[[^\]]*]\(([^)]+)\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const src = normalizeImageReference(match[1]);
      if (!src) {
        continue;
      }

      refs.push(src);
    }
  }

  return [...new Set(refs)];
}

function normalizeContentForHash(content) {
  const { body } = extractFrontmatter(content);

  return collapseWhitespace(
    body
      .replace(/\n##\s+相关文档[\s\S]*$/u, ' ')
      .replace(/<ImageZoom\b[\s\S]*?\/>/g, ' ')
      .replace(/!\[[^\]]*]\(([^)]+)\)/g, ' ')
      .replace(/<img\b[^>]*>/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' '),
  );
}

function sha1(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function toRoute(relativePath) {
  return `/docs/${relativePath.replace(/\.(md|mdx)$/i, '')}`;
}

async function analyzeDocs(docFiles, docsDir, imagesDir) {
  const docs = [];
  const missingImageRefs = [];
  const invalidImageRefs = [];
  let localImageRefCount = 0;
  let externalImageRefCount = 0;

  for (const filePath of docFiles) {
    const content = await fs.readFile(filePath, 'utf8');
    const relativePath = toPosix(path.relative(docsDir, filePath));
    const title = parseTitle(content, filePath);
    const imageRefs = extractImageRefs(content);

    for (const src of imageRefs) {
      if (/^(https?:)?\/\//u.test(src) || src.startsWith('data:')) {
        externalImageRefCount += 1;
        continue;
      }

      if (!src.startsWith('/images/')) {
        invalidImageRefs.push({
          doc: relativePath,
          title,
          src,
        });
        continue;
      }

      localImageRefCount += 1;
      const assetPath = path.join(imagesDir, safeDecodePath(src.replace(/^\/images\//u, '')));

      try {
        await fs.access(assetPath);
      } catch {
        missingImageRefs.push({
          doc: relativePath,
          title,
          src,
          assetPath: toPosix(assetPath),
        });
      }
    }

    docs.push({
      filePath,
      relativePath,
      title,
      canonicalTitle: canonicalizeTitle(title),
      route: toRoute(relativePath),
      contentHash: sha1(normalizeContentForHash(content)),
    });
  }

  return {
    docs,
    missingImageRefs,
    invalidImageRefs,
    localImageRefCount,
    externalImageRefCount,
  };
}

function groupDuplicates(values, keySelector) {
  const map = new Map();

  for (const value of values) {
    const key = keySelector(value);
    const group = map.get(key) ?? [];
    group.push(value);
    map.set(key, group);
  }

  return [...map.entries()]
    .filter(([, group]) => group.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-Hans-CN'));
}

async function collectRegisteredDocs(sourceFile, includeInternal) {
  try {
    const source = await fs.readFile(sourceFile, 'utf8');
    const matches = [...source.matchAll(/\.\.\/content\/docs\/(.+?)\?collection=docs/g)];
    const paths = matches
      .map((match) => match[1])
      .filter((relativePath) => !isMetaFile(relativePath))
      .filter((relativePath) => includeInternal || !isInternalDoc(relativePath));

    return {
      exists: true,
      docs: [...new Set(paths)].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')),
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return { exists: false, docs: [] };
    }

    throw error;
  }
}

function compareRegisteredDocs(docs, registeredDocs) {
  const actual = new Set(docs.map((item) => item.relativePath));
  const registered = new Set(registeredDocs);

  const missing = docs
    .filter((item) => !registered.has(item.relativePath))
    .map((item) => ({
      doc: item.relativePath,
      route: item.route,
      title: item.title,
    }));

  const stale = registeredDocs
    .filter((relativePath) => !actual.has(relativePath))
    .map((relativePath) => ({
      doc: relativePath,
      route: toRoute(relativePath),
    }));

  return { missing, stale };
}

function limitItems(items) {
  return items.slice(0, ISSUE_LIMIT);
}

function printIssueBlock(title, items, formatter) {
  console.log(`\n${title} (${items.length})`);

  for (const item of limitItems(items)) {
    console.log(`- ${formatter(item)}`);
  }

  if (items.length > ISSUE_LIMIT) {
    console.log(`- 其余 ${items.length - ISSUE_LIMIT} 条省略`);
  }
}

function buildReport(options, analysis, registeredStatus, registrationDiff) {
  const duplicateTitles = groupDuplicates(analysis.docs, (item) => item.canonicalTitle);
  const duplicateContent = groupDuplicates(analysis.docs, (item) => item.contentHash);

  const report = {
    summary: {
      docs: analysis.docs.length,
      localImageRefs: analysis.localImageRefCount,
      externalImageRefs: analysis.externalImageRefCount,
      missingLocalImageRefs: analysis.missingImageRefs.length,
      invalidImageRefs: analysis.invalidImageRefs.length,
      duplicateTitleGroups: duplicateTitles.length,
      duplicateContentGroups: duplicateContent.length,
      sourceFileFound: registeredStatus.exists,
      registeredDocs: registeredStatus.docs.length,
      missingRegisteredDocs: registrationDiff.missing.length,
      staleRegisteredDocs: registrationDiff.stale.length,
    },
    brokenImages: {
      missing: analysis.missingImageRefs,
      invalid: analysis.invalidImageRefs,
    },
    duplicateTitles: duplicateTitles.map(([title, group]) => ({
      title,
      rawTitles: [...new Set(group.map((item) => item.title))],
      docs: group.map((item) => item.relativePath),
    })),
    duplicateContent: duplicateContent.map(([, group]) => ({
      hash: group[0].contentHash,
      docs: group.map((item) => item.relativePath),
    })),
    inaccessibleDocs: {
      sourceFileFound: registeredStatus.exists,
      missingFromSource: registrationDiff.missing,
      staleInSource: registrationDiff.stale,
    },
    options,
  };

  const hasIssues = Boolean(
    analysis.missingImageRefs.length
      || analysis.invalidImageRefs.length
      || duplicateTitles.length
      || duplicateContent.length
      || !registeredStatus.exists
      || registrationDiff.missing.length
      || registrationDiff.stale.length,
  );

  return { report, hasIssues };
}

function printHumanReadable(report) {
  const { summary } = report;

  console.log('文档审计结果');
  console.log(`- 文章数: ${summary.docs}`);
  console.log(`- 本地图片引用: ${summary.localImageRefs}`);
  console.log(`- 外部图片引用: ${summary.externalImageRefs}`);
  console.log(`- 缺失本地图片: ${summary.missingLocalImageRefs}`);
  console.log(`- 非标准图片引用: ${summary.invalidImageRefs}`);
  console.log(`- 标题重复组: ${summary.duplicateTitleGroups}`);
  console.log(`- 正文完全重复组: ${summary.duplicateContentGroups}`);
  console.log(`- .source 清单存在: ${summary.sourceFileFound ? 'yes' : 'no'}`);
  console.log(`- .source 已注册文章: ${summary.registeredDocs}`);
  console.log(`- 未注册文章: ${summary.missingRegisteredDocs}`);
  console.log(`- 失效注册项: ${summary.staleRegisteredDocs}`);

  if (report.brokenImages.missing.length > 0) {
    printIssueBlock('缺失本地图片', report.brokenImages.missing, (item) =>
      `${item.doc} -> ${item.src} (缺少文件 ${item.assetPath})`);
  }

  if (report.brokenImages.invalid.length > 0) {
    printIssueBlock('非标准图片引用', report.brokenImages.invalid, (item) =>
      `${item.doc} -> ${item.src}`);
  }

  if (report.duplicateTitles.length > 0) {
    printIssueBlock('标题重复', report.duplicateTitles, (item) =>
      `${item.title} [${item.rawTitles.join(' | ')}]: ${item.docs.join(', ')}`);
  }

  if (report.duplicateContent.length > 0) {
    printIssueBlock('正文完全重复', report.duplicateContent, (item) =>
      `${item.docs.join(', ')}`);
  }

  if (!report.inaccessibleDocs.sourceFileFound) {
    console.log(`\n不可访问性检查`);
    console.log(`- 未找到 ${DEFAULT_SOURCE_FILE}，无法校验 Fumadocs 注册清单`);
  }

  if (report.inaccessibleDocs.missingFromSource.length > 0) {
    printIssueBlock('未注册文章', report.inaccessibleDocs.missingFromSource, (item) =>
      `${item.doc} -> ${item.route}`);
  }

  if (report.inaccessibleDocs.staleInSource.length > 0) {
    printIssueBlock('失效注册项', report.inaccessibleDocs.staleInSource, (item) =>
      `${item.doc} -> ${item.route}`);
  }

  if (
    summary.missingLocalImageRefs === 0
    && summary.invalidImageRefs === 0
    && summary.duplicateTitleGroups === 0
    && summary.duplicateContentGroups === 0
    && summary.sourceFileFound
    && summary.missingRegisteredDocs === 0
    && summary.staleRegisteredDocs === 0
  ) {
    console.log('\n静态审计通过，未发现当前阻塞上线的问题。');
  }
}

async function main() {
  const { help, options } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp();
    return;
  }

  const docsDir = path.resolve(options.docsDir);
  const imagesDir = path.resolve(options.imagesDir);
  const sourceFile = path.resolve(options.sourceFile);
  const docFiles = await collectDocFiles(docsDir, options.includeInternal);
  const analysis = await analyzeDocs(docFiles, docsDir, imagesDir);
  const registeredStatus = await collectRegisteredDocs(sourceFile, options.includeInternal);
  const registrationDiff = registeredStatus.exists
    ? compareRegisteredDocs(analysis.docs, registeredStatus.docs)
    : { missing: [], stale: [] };
  const { report, hasIssues } = buildReport(options, analysis, registeredStatus, registrationDiff);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReadable(report);
  }

  if (hasIssues) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
