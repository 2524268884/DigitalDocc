import { accessSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DOCS_DIR = 'content/docs';
const DEFAULT_IMAGES_DIR = 'public/images';
const DEFAULT_SOURCE_DIR = 'image/inbox';
const DEFAULT_ARCHIVE_ROOT = '../tmp/dingtalk-doc-images/images';
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 720;
const PLACEHOLDER_PREFIX = '{/* DOC_IMAGE';
const PLACEHOLDER_RE =
  /\{\/\*\s*DOC_IMAGE\s+src="([^"]+)"\s+alt="([^"]+)"\s+width="(\d+)"\s+height="(\d+)"\s*\*\/\}|<!--\s*DOC_IMAGE\s+src="([^"]+)"\s+alt="([^"]+)"\s+width="(\d+)"\s+height="(\d+)"\s*-->/g;
const OVERVIEW_HEADING_RE = /^##\s+(概述|功能概述|什么是.+|简介|概览)\s*$/;
const STEP_HEADING_RE = /^###\s+(.+?)\s*$/;
const STEP_PREFIX_RE = /^步骤\s*([0-9]+|[一二三四五六七八九十]+)\s*[:：\-]?\s*/;

function printHelp() {
  console.log(`用法:
  node scripts/manage-doc-images.mjs report [options]
  node scripts/manage-doc-images.mjs insert [options]
  node scripts/manage-doc-images.mjs render [options]
  node scripts/manage-doc-images.mjs ingest [options]
  node scripts/manage-doc-images.mjs archive [options]

常用参数:
  --write                实际写入文件，默认仅 dry-run
  --docs-dir <path>      文档目录，默认 content/docs
  --images-dir <path>    图片目录，默认 public/images
  --source-dir <path>    截图暂存目录，默认 image/inbox
  --archive-root <path>  已整理图片归档目录，默认 ../tmp/dingtalk-doc-images/images
  --doc <path>           指定单篇文档，仅 ingest 使用
  --move                 ingest 时将截图从暂存目录移动到目标目录
  --match <text>         仅处理路径包含指定文本的文档
  --exclude <text>       排除路径包含指定文本的文档，可重复传入
  --limit <number>       仅处理前 N 篇文档
  --width <number>       ImageZoom 宽度，默认 1200
  --height <number>      ImageZoom 高度，默认 720

示例:
  npm run images:report
  node scripts/manage-doc-images.mjs insert --match "钉钉开放平台创建应用"
  node scripts/manage-doc-images.mjs insert --match "快速开始" --write
  node scripts/manage-doc-images.mjs render --write
  node scripts/manage-doc-images.mjs ingest --doc "content/docs/快速开始/钉钉开放平台创建应用.mdx" --write --move
  node scripts/manage-doc-images.mjs archive --match "快速开始" --write`);
}

function parseArgs(argv) {
  const options = {
    write: false,
    docsDir: DEFAULT_DOCS_DIR,
    imagesDir: DEFAULT_IMAGES_DIR,
    sourceDir: DEFAULT_SOURCE_DIR,
    archiveRoot: DEFAULT_ARCHIVE_ROOT,
    doc: '',
    move: false,
    match: '',
    exclude: [],
    limit: Infinity,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };

  const [command, ...rest] = argv;
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    return { command: 'help', options };
  }

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];

    if (arg === '--write') {
      options.write = true;
      continue;
    }

    if (arg === '--docs-dir') {
      options.docsDir = rest[++i];
      continue;
    }

    if (arg === '--images-dir') {
      options.imagesDir = rest[++i];
      continue;
    }

    if (arg === '--source-dir') {
      options.sourceDir = rest[++i];
      continue;
    }

    if (arg === '--archive-root') {
      options.archiveRoot = rest[++i];
      continue;
    }

    if (arg === '--doc') {
      options.doc = rest[++i] ?? '';
      continue;
    }

    if (arg === '--move') {
      options.move = true;
      continue;
    }

    if (arg === '--match') {
      options.match = rest[++i] ?? '';
      continue;
    }

    if (arg === '--exclude') {
      options.exclude.push(rest[++i] ?? '');
      continue;
    }

    if (arg === '--limit') {
      options.limit = Number(rest[++i] ?? Number.POSITIVE_INFINITY);
      continue;
    }

    if (arg === '--width') {
      options.width = Number(rest[++i] ?? DEFAULT_WIDTH);
      continue;
    }

    if (arg === '--height') {
      options.height = Number(rest[++i] ?? DEFAULT_HEIGHT);
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  return { command, options };
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function toImageUrl(docFile, docsDir, name) {
  const relativeDoc = path.relative(docsDir, docFile).replace(/\.(md|mdx)$/i, '');
  return `/images/${toPosix(relativeDoc)}/${name}`;
}

function toAssetPath(imageUrl, imagesDir) {
  return path.join(imagesDir, imageUrl.replace(/^\/images\//, ''));
}

function replaceExt(filePath, ext) {
  return `${filePath.replace(/\.[^.]+$/u, '')}${ext}`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeArchivePath(pathLike) {
  return pathLike
    .replace(/\\/gu, '/')
    .replace(/（钉钉／飞书）/gu, '（钉钉_飞书）');
}

function parseTitle(content, docFile) {
  const match = content.match(/^---[\s\S]*?^title:\s*["']?(.+?)["']?\s*$[\s\S]*?^---/m);
  return match?.[1]?.trim() || path.basename(docFile, path.extname(docFile));
}

function splitLines(content) {
  return content.split(/\r?\n/);
}

function buildAltText(kind, title, headingText, stepIndex) {
  if (kind === 'overview') {
    return `${title}概览截图`;
  }

  const action = headingText.replace(STEP_PREFIX_RE, '').trim();
  return action ? `${action}截图` : `${title}步骤 ${stepIndex} 截图`;
}

function buildPlaceholder({ src, alt, width, height }) {
  return `${PLACEHOLDER_PREFIX} src="${src}" alt="${alt}" width="${width}" height="${height}" */}`;
}

function buildImageZoom({ src, alt, width, height }) {
  return [
    '<ImageZoom',
    `  src="${src}"`,
    `  alt="${alt}"`,
    `  width={${width}}`,
    `  height={${height}}`,
    '/>',
  ].join('\n');
}

function isDocFile(entry) {
  return entry.isFile() && /\.(md|mdx)$/i.test(entry.name);
}

async function collectDocFiles(rootDir) {
  const results = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (isDocFile(entry)) {
        results.push(fullPath);
      }
    }
  }

  return results.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function matchesFilters(filePath, { match, exclude }) {
  const normalized = toPosix(filePath);

  if (match && !normalized.includes(match)) {
    return false;
  }

  return !exclude.some((item) => item && normalized.includes(item));
}

function findAttachmentStatus(lines, startIndex) {
  let inFence = false;

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (/^(?:\{\/\*|<!--)\s*DOC_IMAGE\b/.test(trimmed)) {
      return 'placeholder';
    }

    if (/<ImageZoom\b|!\[|<img\b/.test(trimmed)) {
      return 'image';
    }

    if (
      /^##\s+/.test(trimmed) ||
      /^###\s+/.test(trimmed) ||
      /^<Step>/.test(trimmed) ||
      /^<\/Step>/.test(trimmed) ||
      /^---$/.test(trimmed)
    ) {
      return 'none';
    }
  }

  return 'none';
}

function collectCandidates(lines, title, docFile, options) {
  const candidates = [];
  let inFence = false;
  let inSteps = false;
  let overviewAdded = false;
  let stepIndex = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (trimmed === '<Steps>') {
      inSteps = true;
      continue;
    }

    if (trimmed === '</Steps>') {
      inSteps = false;
      continue;
    }

    if (!overviewAdded && OVERVIEW_HEADING_RE.test(trimmed)) {
      const src = toImageUrl(docFile, options.docsDir, 'overview.png');
      candidates.push({
        kind: 'overview',
        lineIndex: i,
        headingText: trimmed.replace(/^##\s+/, ''),
        stepIndex: null,
        src,
        assetPath: toAssetPath(src, options.imagesDir),
        alt: buildAltText('overview', title, trimmed, 0),
        attachmentStatus: findAttachmentStatus(lines, i),
      });
      overviewAdded = true;
      continue;
    }

    const stepHeadingMatch = trimmed.match(STEP_HEADING_RE);
    if (!stepHeadingMatch) {
      continue;
    }

    const headingText = stepHeadingMatch[1].trim();
    const looksLikeStep = inSteps || STEP_PREFIX_RE.test(headingText);
    if (!looksLikeStep) {
      continue;
    }

    stepIndex += 1;
    const fileName = `step-${String(stepIndex).padStart(2, '0')}.png`;
    const src = toImageUrl(docFile, options.docsDir, fileName);

    candidates.push({
      kind: 'step',
      lineIndex: i,
      headingText,
      stepIndex,
      src,
      assetPath: toAssetPath(src, options.imagesDir),
      alt: buildAltText('step', title, headingText, stepIndex),
      attachmentStatus: findAttachmentStatus(lines, i),
    });
  }

  return candidates;
}

async function analyzeDoc(docFile, options) {
  const content = await fs.readFile(docFile, 'utf8');
  return analyzeContent(docFile, content, options);
}

async function analyzeContent(docFile, content, options) {
  const lines = splitLines(content);
  const title = parseTitle(content, docFile);
  const candidates = collectCandidates(lines, title, docFile, options);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate.assetPath);
      candidate.assetExists = true;
    } catch {
      candidate.assetExists = false;
    }
  }

  const hasRenderedImage = /<ImageZoom\b|!\[|<img\b/.test(content);
  const hasPlaceholder = /^(?:\{\/\*|<!--)\s*DOC_IMAGE\b/m.test(content);

  return {
    docFile,
    title,
    content,
    lines,
    candidates,
    hasRenderedImage,
    hasPlaceholder,
  };
}

function buildInsertedContent(analysis, options) {
  const lines = [...analysis.lines];
  const targets = analysis.candidates
    .filter((candidate) => candidate.attachmentStatus === 'none')
    .sort((a, b) => b.lineIndex - a.lineIndex);

  if (targets.length === 0) {
    return { nextContent: analysis.content, insertedBlocks: 0 };
  }

  for (const candidate of targets) {
    insertBlockAfterLine(
      lines,
      candidate.lineIndex,
      buildPlaceholder({
        src: candidate.src,
        alt: candidate.alt,
        width: options.width,
        height: options.height,
      }),
    );
  }

  return {
    nextContent: `${lines.join('\n').replace(/\n+$/u, '\n')}`,
    insertedBlocks: targets.length,
  };
}

function extractPlaceholders(content, options) {
  const placeholders = [];
  PLACEHOLDER_RE.lastIndex = 0;

  for (const match of content.matchAll(PLACEHOLDER_RE)) {
    const src = match[1] || match[5];
    const alt = match[2] || match[6];
    const width = Number(match[3] || match[7]);
    const height = Number(match[4] || match[8]);

    placeholders.push({
      full: match[0],
      src,
      alt,
      width,
      height,
      assetPath: toAssetPath(src, options.imagesDir),
    });
  }

  return placeholders;
}

function buildPlaceholderPattern({ src, alt, width, height }) {
  return new RegExp(
    `(?:\\{\\/\\*|<!--)\\s*DOC_IMAGE\\s+src="${escapeRegExp(src)}"\\s+alt="${escapeRegExp(alt)}"\\s+width="${width}"\\s+height="${height}"\\s*(?:\\*\\/\\}|-->)`,
    'u',
  );
}

function isImageFile(entry) {
  return entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name);
}

async function collectSourceImages(rootDir) {
  try {
    await fs.access(rootDir);
  } catch {
    throw new Error(`截图暂存目录不存在: ${rootDir}`);
  }

  const results = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!isImageFile(entry)) {
        continue;
      }

      const stat = await fs.stat(fullPath);
      results.push({
        filePath: fullPath,
        name: entry.name,
        mtimeMs: stat.mtimeMs,
        ext: path.extname(entry.name).toLowerCase(),
      });
    }
  }

  return results.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

async function collectArchiveImages(rootDir) {
  try {
    await fs.access(rootDir);
  } catch {
    throw new Error(`归档图片目录不存在: ${rootDir}`);
  }

  const archive = new Map();
  const dirs = [rootDir];

  while (dirs.length > 0) {
    const current = dirs.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        dirs.push(fullPath);
        continue;
      }

      if (!isImageFile(entry)) {
        continue;
      }

      files.push({
        filePath: fullPath,
        name: entry.name,
        ext: path.extname(entry.name).toLowerCase(),
      });
    }

    if (files.length === 0) {
      continue;
    }

    const rel = toPosix(path.relative(rootDir, current));
    archive.set(rel, files.sort((a, b) => a.name.localeCompare(b.name, 'en')));
  }

  return archive;
}

function findArchiveMatch(docRel, archiveMap) {
  if (archiveMap.has(docRel)) {
    return docRel;
  }

  const normalized = normalizeArchivePath(docRel);
  if (archiveMap.has(normalized)) {
    return normalized;
  }

  return null;
}

function insertBlockAfterLine(lines, lineIndex, block) {
  const nextLine = lines[lineIndex + 1];

  if (nextLine === '') {
    lines.splice(lineIndex + 2, 0, block, '');
    return;
  }

  lines.splice(lineIndex + 1, 0, '', block, '');
}

async function writeIfChanged(docFile, nextContent, currentContent, write) {
  if (nextContent === currentContent) {
    return false;
  }

  if (write) {
    await fs.writeFile(docFile, nextContent, 'utf8');
  }

  return true;
}

async function runInsert(analyses, options) {
  let changedFiles = 0;
  let insertedBlocks = 0;

  for (const analysis of analyses) {
    const { nextContent, insertedBlocks: insertedCount } = buildInsertedContent(analysis, options);
    if (insertedCount === 0) {
      continue;
    }
    const changed = await writeIfChanged(
      analysis.docFile,
      nextContent,
      analysis.content,
      options.write,
    );

    if (!changed) {
      continue;
    }

    changedFiles += 1;
    insertedBlocks += insertedCount;
  }

  console.log(
    `${options.write ? '已写入' : 'dry-run'}: ${changedFiles} 篇文档，新增 ${insertedBlocks} 个图片占位`,
  );
}

async function runIngest(options) {
  if (!options.doc) {
    throw new Error('ingest 命令必须指定 --doc');
  }

  const docFile = path.isAbsolute(options.doc)
    ? options.doc
    : path.resolve(options.doc);
  const sourceDir = path.isAbsolute(options.sourceDir)
    ? options.sourceDir
    : path.resolve(options.sourceDir);

  let analysis = await analyzeDoc(docFile, options);
  const existingPlaceholders = extractPlaceholders(analysis.content, options);
  const prepared = existingPlaceholders.length === 0
    ? buildInsertedContent(analysis, options)
    : { nextContent: analysis.content, insertedBlocks: 0 };

  if (prepared.insertedBlocks > 0) {
    if (options.write) {
      await fs.writeFile(docFile, prepared.nextContent, 'utf8');
    }
    analysis = await analyzeContent(docFile, prepared.nextContent, options);
  }

  const placeholders = extractPlaceholders(analysis.content, options)
    .filter((item) => {
      try {
        accessSync(item.assetPath);
        return false;
      } catch {
        return true;
      }
    });

  if (placeholders.length === 0) {
    console.log('没有待导入的图片槽位');
    return;
  }

  const sourceImages = await collectSourceImages(sourceDir);
  if (sourceImages.length === 0) {
    throw new Error(`暂存目录中没有可导入的截图: ${sourceDir}`);
  }

  const count = Math.min(placeholders.length, sourceImages.length);
  let nextContent = analysis.content;

  for (let i = 0; i < count; i += 1) {
    const slot = placeholders[i];
    const sourceImage = sourceImages[i];
    const targetAssetPath = replaceExt(slot.assetPath, sourceImage.ext || '.png');
    const targetUrl = replaceExt(slot.src, sourceImage.ext || '.png');

    if (options.write) {
      await fs.mkdir(path.dirname(targetAssetPath), { recursive: true });
      if (options.move) {
        await fs.rename(sourceImage.filePath, targetAssetPath);
      } else {
        await fs.copyFile(sourceImage.filePath, targetAssetPath);
      }
    }

    nextContent = nextContent.replace(
      buildPlaceholderPattern(slot),
      buildImageZoom({
        src: targetUrl,
        alt: slot.alt,
        width: slot.width,
        height: slot.height,
      }),
    );
  }

  const changed = await writeIfChanged(
    docFile,
    nextContent,
    analysis.content,
    options.write,
  );

  console.log(
    `${options.write ? '已导入' : 'dry-run'}: ${count} 张截图 -> ${toPosix(path.relative(process.cwd(), docFile))}`,
  );
  console.log(`图片来源目录: ${toPosix(path.relative(process.cwd(), sourceDir))}`);
  console.log(`占位自动补齐: ${prepared.insertedBlocks}`);
  console.log(`文档内容已更新: ${changed ? 'yes' : 'no'}`);

  if (sourceImages.length > placeholders.length) {
    console.log(`有 ${sourceImages.length - placeholders.length} 张截图未使用，保留在暂存目录`);
  }

  if (placeholders.length > sourceImages.length) {
    console.log(`还有 ${placeholders.length - sourceImages.length} 个槽位未补图`);
  }
}

async function runArchive(analyses, options) {
  const archiveRoot = path.isAbsolute(options.archiveRoot)
    ? options.archiveRoot
    : path.resolve(options.archiveRoot);
  const archiveMap = await collectArchiveImages(archiveRoot);

  const summary = {
    docsMatched: 0,
    docsChanged: 0,
    docsWithImports: 0,
    docsWithoutArchive: 0,
    docsWithoutSlots: 0,
    docsWithExtraArchiveImages: 0,
    docsWithRemainingPlaceholders: 0,
    placeholdersInserted: 0,
    imagesImported: 0,
  };

  for (const analysis of analyses) {
    const docRel = toPosix(path.relative(options.docsDir, analysis.docFile)).replace(/\.(md|mdx)$/iu, '');
    const archiveRel = findArchiveMatch(docRel, archiveMap);
    if (!archiveRel) {
      summary.docsWithoutArchive += 1;
      continue;
    }

    summary.docsMatched += 1;
    const sourceImages = archiveMap.get(archiveRel) ?? [];

    let workingContent = analysis.content;
    let insertedCount = 0;
    const existingPlaceholders = extractPlaceholders(workingContent, options);

    if (existingPlaceholders.length === 0) {
      const prepared = buildInsertedContent(analysis, options);
      workingContent = prepared.nextContent;
      insertedCount = prepared.insertedBlocks;
      summary.placeholdersInserted += insertedCount;
    }

    const placeholders = extractPlaceholders(workingContent, options)
      .filter((item) => {
        try {
          accessSync(item.assetPath);
          return false;
        } catch {
          return true;
        }
      });

    if (placeholders.length === 0) {
      summary.docsWithoutSlots += 1;
      continue;
    }

    const count = Math.min(placeholders.length, sourceImages.length);
    if (count === 0) {
      summary.docsWithoutSlots += 1;
      continue;
    }

    let nextContent = workingContent;

    for (let i = 0; i < count; i += 1) {
      const slot = placeholders[i];
      const sourceImage = sourceImages[i];
      const targetAssetPath = replaceExt(slot.assetPath, sourceImage.ext || '.png');
      const targetUrl = replaceExt(slot.src, sourceImage.ext || '.png');

      if (options.write) {
        await fs.mkdir(path.dirname(targetAssetPath), { recursive: true });
        await fs.copyFile(sourceImage.filePath, targetAssetPath);
      }

      nextContent = nextContent.replace(
        buildPlaceholderPattern(slot),
        buildImageZoom({
          src: targetUrl,
          alt: slot.alt,
          width: slot.width,
          height: slot.height,
        }),
      );
    }

    const changed = await writeIfChanged(
      analysis.docFile,
      nextContent,
      analysis.content,
      options.write,
    );

    if (changed) {
      summary.docsChanged += 1;
    }

    summary.docsWithImports += 1;
    summary.imagesImported += count;

    if (sourceImages.length > placeholders.length) {
      summary.docsWithExtraArchiveImages += 1;
    }

    if (placeholders.length > sourceImages.length) {
      summary.docsWithRemainingPlaceholders += 1;
    }
  }

  console.log(`${options.write ? '已写入' : 'dry-run'} archive 导入结果:`);
  console.log(`匹配到图片归档的文档: ${summary.docsMatched}`);
  console.log(`实际改动文档: ${summary.docsChanged}`);
  console.log(`成功导入图片的文档: ${summary.docsWithImports}`);
  console.log(`导入图片总数: ${summary.imagesImported}`);
  console.log(`自动补充占位数: ${summary.placeholdersInserted}`);
  console.log(`未匹配到归档的文档: ${summary.docsWithoutArchive}`);
  console.log(`没有可用槽位的文档: ${summary.docsWithoutSlots}`);
  console.log(`归档图片多于槽位的文档: ${summary.docsWithExtraArchiveImages}`);
  console.log(`图片不足，仍有剩余占位的文档: ${summary.docsWithRemainingPlaceholders}`);
}

async function runRender(analyses, options) {
  let changedFiles = 0;
  let renderedBlocks = 0;

  for (const analysis of analyses) {
    let nextContent = analysis.content;

    nextContent = nextContent.replace(
      PLACEHOLDER_RE,
      (
        full,
        jsxSrc,
        jsxAlt,
        jsxWidth,
        jsxHeight,
        htmlSrc,
        htmlAlt,
        htmlWidth,
        htmlHeight,
      ) => {
        const src = jsxSrc || htmlSrc;
        const alt = jsxAlt || htmlAlt;
        const width = jsxWidth || htmlWidth;
        const height = jsxHeight || htmlHeight;
        const assetPath = toAssetPath(src, options.imagesDir);
        try {
          accessSync(assetPath);
          renderedBlocks += 1;
          return buildImageZoom({
            src,
            alt,
            width: Number(width),
            height: Number(height),
          });
        } catch {
          return full;
        }
      },
    );

    const changed = await writeIfChanged(
      analysis.docFile,
      nextContent,
      analysis.content,
      options.write,
    );

    if (changed) {
      changedFiles += 1;
    }
  }

  console.log(
    `${options.write ? '已写入' : 'dry-run'}: ${changedFiles} 篇文档，渲染 ${renderedBlocks} 个 ImageZoom 组件`,
  );
}

function printReport(analyses) {
  const totals = {
    docs: analyses.length,
    docsWithRenderedImages: 0,
    docsWithPlaceholders: 0,
    actionableDocs: 0,
    overviewSlots: 0,
    stepSlots: 0,
    existingAssets: 0,
  };

  const rows = [];

  for (const analysis of analyses) {
    if (analysis.hasRenderedImage) {
      totals.docsWithRenderedImages += 1;
    }

    if (analysis.hasPlaceholder) {
      totals.docsWithPlaceholders += 1;
    }

    let openSlots = 0;

    for (const candidate of analysis.candidates) {
      if (candidate.kind === 'overview') {
        totals.overviewSlots += 1;
      }

      if (candidate.kind === 'step') {
        totals.stepSlots += 1;
      }

      if (candidate.assetExists) {
        totals.existingAssets += 1;
      }

      if (candidate.attachmentStatus === 'none') {
        openSlots += 1;
      }
    }

    if (openSlots > 0) {
      totals.actionableDocs += 1;
      rows.push({
        path: toPosix(path.relative(process.cwd(), analysis.docFile)),
        title: analysis.title,
        openSlots,
        stepSlots: analysis.candidates.filter((item) => item.kind === 'step').length,
        overview: analysis.candidates.some((item) => item.kind === 'overview') ? 'yes' : 'no',
      });
    }
  }

  console.log(`扫描完成，共 ${totals.docs} 篇文档`);
  console.log(`已有图片组件的文档: ${totals.docsWithRenderedImages}`);
  console.log(`已有占位注释的文档: ${totals.docsWithPlaceholders}`);
  console.log(`可补图文档: ${totals.actionableDocs}`);
  console.log(`概述图槽位: ${totals.overviewSlots}`);
  console.log(`步骤图槽位: ${totals.stepSlots}`);
  console.log(`已落地图片资源: ${totals.existingAssets}`);

  if (rows.length > 0) {
    console.log('\n前 20 篇可补图文档:');
    console.table(rows.slice(0, 20));
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'help') {
    printHelp();
    return;
  }

  if (!['report', 'insert', 'render', 'ingest', 'archive'].includes(command)) {
    throw new Error(`不支持的命令: ${command}`);
  }

  const docsDir = path.resolve(options.docsDir);
  const imagesDir = path.resolve(options.imagesDir);
  options.docsDir = docsDir;
  options.imagesDir = imagesDir;

  if (command === 'ingest') {
    await runIngest(options);
    return;
  }

  const allDocs = await collectDocFiles(docsDir);
  const filteredDocs = allDocs
    .filter((docFile) => matchesFilters(docFile, options))
    .filter((docFile) => path.basename(docFile) !== 'index.mdx')
    .slice(0, Number.isFinite(options.limit) ? options.limit : undefined);

  const analyses = [];
  for (const docFile of filteredDocs) {
    analyses.push(await analyzeDoc(docFile, options));
  }

  if (command === 'report') {
    printReport(analyses);
    return;
  }

  if (command === 'insert') {
    await runInsert(analyses, options);
    return;
  }

  if (command === 'archive') {
    await runArchive(analyses, options);
    return;
  }

  await runRender(analyses, options);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
