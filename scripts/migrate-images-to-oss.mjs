import fs from 'node:fs/promises';
import path from 'node:path';
import OSS from 'ali-oss';

const DEFAULT_DOCS_DIR = 'content/docs';
const DEFAULT_IMAGES_DIR = 'public/images';
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_SAMPLE_SIZE = 8;
const DEFAULT_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ENV_FILES = ['.env.local', '.env'];

function printHelp() {
  console.log(`用法:
  node scripts/migrate-images-to-oss.mjs
  node scripts/migrate-images-to-oss.mjs --write

说明:
  默认 dry-run，只扫描文档引用并输出计划上传和替换结果。
  传入 --write 后会上传被引用的图片到 OSS，并把 content/docs 中的 /images/... 替换为 OSS 绝对 URL。

参数:
  --write                实际上传并写回文档
  --docs-dir <path>      文档目录，默认 content/docs
  --images-dir <path>    图片目录，默认 public/images
  --match <text>         仅处理路径包含指定文本的文档
  --limit <number>       仅处理前 N 篇文档
  --concurrency <n>      并发上传数，默认 6
  --help                 查看帮助

环境变量:
  ALIYUN_OSS_ENDPOINT
  ALIYUN_OSS_BUCKET
  ALIYUN_OSS_ACCESS_KEY_ID
  ALIYUN_OSS_ACCESS_KEY_SECRET
`);
}

function parseArgs(argv) {
  const options = {
    write: false,
    docsDir: DEFAULT_DOCS_DIR,
    imagesDir: DEFAULT_IMAGES_DIR,
    match: '',
    limit: Infinity,
    concurrency: DEFAULT_CONCURRENCY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--write') {
      options.write = true;
      continue;
    }

    if (arg === '--docs-dir') {
      options.docsDir = argv[++index];
      continue;
    }

    if (arg === '--images-dir') {
      options.imagesDir = argv[++index];
      continue;
    }

    if (arg === '--match') {
      options.match = argv[++index] ?? '';
      continue;
    }

    if (arg === '--limit') {
      options.limit = Number(argv[++index] ?? Number.POSITIVE_INFINITY);
      continue;
    }

    if (arg === '--concurrency') {
      options.concurrency = Number(argv[++index] ?? DEFAULT_CONCURRENCY);
      continue;
    }

    if (arg === '--help' || arg === '-h' || arg === 'help') {
      options.help = true;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  if (!Number.isFinite(options.limit) || options.limit <= 0) {
    options.limit = Infinity;
  }

  if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
    throw new Error(`--concurrency 必须是正整数，当前值为 ${options.concurrency}`);
  }

  return options;
}

async function loadEnvFiles(projectRoot) {
  for (const name of ENV_FILES) {
    const filePath = path.join(projectRoot, name);
    let content;

    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    for (const line of content.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separator = trimmed.indexOf('=');
      if (separator === -1) {
        continue;
      }

      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();

      if (!key || process.env[key] !== undefined) {
        continue;
      }

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function normalizeEndpointHost(rawValue) {
  if (!rawValue) {
    return '';
  }

  return rawValue
    .replace(/^https?:\/\//u, '')
    .replace(/\/+$/u, '');
}

function deriveRegion(endpointHost) {
  const region = endpointHost.replace(/\.aliyuncs\.com$/u, '');
  if (!region.startsWith('oss-')) {
    throw new Error(`无法从 endpoint 推导 OSS region: ${endpointHost}`);
  }
  return region;
}

function encodeObjectKey(objectKey) {
  return objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildPublicUrl(bucket, endpointHost, objectKey) {
  return `https://${bucket}.${endpointHost}/${encodeObjectKey(objectKey)}`;
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function refToRelativePath(localRef) {
  return localRef
    .replace(/^\/images\//u, '')
    .split('/')
    .map((segment) => safeDecode(segment))
    .join(path.sep);
}

function detectMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const byExtension = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
  };

  return byExtension[extension] ?? 'application/octet-stream';
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

      if (entry.isFile() && /\.(md|mdx)$/iu.test(entry.name)) {
        results.push(fullPath);
      }
    }
  }

  return results.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

function extractImageRefs(content) {
  const refs = new Set();

  for (const match of content.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gu)) {
    const candidate = match[1].trim();
    if (candidate.startsWith('/images/')) {
      refs.add(candidate);
    }
  }

  for (const match of content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/gu)) {
    let candidate = match[1].trim();

    if (candidate.startsWith('<') && candidate.endsWith('>')) {
      candidate = candidate.slice(1, -1).trim();
    }

    if (candidate.startsWith('/images/')) {
      refs.add(candidate);
    }
  }

  return [...refs];
}

async function buildMigrationPlan(projectRoot, options) {
  const docsDir = path.resolve(projectRoot, options.docsDir);
  const imagesDir = path.resolve(projectRoot, options.imagesDir);
  const docFiles = await collectDocFiles(docsDir);
  const filteredDocFiles = docFiles
    .filter((filePath) => !options.match || toPosix(filePath).includes(options.match))
    .slice(0, options.limit);

  const docChanges = [];
  const imageUsage = new Map();
  const missingFiles = [];

  for (const docFile of filteredDocFiles) {
    const content = await fs.readFile(docFile, 'utf8');
    const refs = extractImageRefs(content);

    if (refs.length === 0) {
      continue;
    }

    docChanges.push({ docFile, content, refs });

    for (const localRef of refs) {
      const relativeImagePath = refToRelativePath(localRef);
      const absoluteImagePath = path.join(imagesDir, relativeImagePath);
      const objectKey = toPosix(path.join('images', relativeImagePath));

      let fileStat = null;
      try {
        fileStat = await fs.stat(absoluteImagePath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          missingFiles.push({ localRef, absoluteImagePath, docFile });
          continue;
        }
        throw error;
      }

      if (!fileStat.isFile()) {
        missingFiles.push({ localRef, absoluteImagePath, docFile });
        continue;
      }

      let usage = imageUsage.get(localRef);
      if (!usage) {
        usage = {
          localRef,
          relativeImagePath,
          absoluteImagePath,
          objectKey,
          size: fileStat.size,
          docs: new Set(),
        };
        imageUsage.set(localRef, usage);
      }
      usage.docs.add(docFile);
    }
  }

  return {
    docsDir,
    imagesDir,
    docChanges,
    imageUsage: [...imageUsage.values()].sort((left, right) =>
      left.localRef.localeCompare(right.localRef, 'zh-Hans-CN'),
    ),
    missingFiles,
  };
}

function createClient() {
  const endpointHost = normalizeEndpointHost(process.env.ALIYUN_OSS_ENDPOINT);
  const bucket = process.env.ALIYUN_OSS_BUCKET?.trim();
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET?.trim();

  if (!endpointHost || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error(
      '缺少 OSS 配置，请设置 ALIYUN_OSS_ENDPOINT、ALIYUN_OSS_BUCKET、ALIYUN_OSS_ACCESS_KEY_ID、ALIYUN_OSS_ACCESS_KEY_SECRET',
    );
  }

  const region = deriveRegion(endpointHost);
  const client = new OSS({
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    secure: true,
  });

  return { client, bucket, endpointHost };
}

function isNotFoundError(error) {
  return error?.status === 404 || error?.code === 'NoSuchKey' || error?.code === 'NotFound';
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(runners);
  return results;
}

async function uploadImages(client, imageUsage, concurrency) {
  const stats = {
    uploaded: 0,
    skipped: 0,
  };

  await mapLimit(imageUsage, concurrency, async (image, index) => {
    let remoteSize = null;

    try {
      const headResult = await client.head(image.objectKey);
      const contentLength = Number(headResult.res.headers['content-length']);
      remoteSize = Number.isFinite(contentLength) ? contentLength : null;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    if (remoteSize !== image.size) {
      await client.put(image.objectKey, image.absoluteImagePath, {
        mime: detectMimeType(image.absoluteImagePath),
        headers: {
          'Cache-Control': DEFAULT_CACHE_CONTROL,
        },
      });
      stats.uploaded += 1;
    } else {
      stats.skipped += 1;
    }

    await client.putACL(image.objectKey, 'public-read');

    if ((index + 1) % 25 === 0 || index === imageUsage.length - 1) {
      console.log(
        `[upload] ${index + 1}/${imageUsage.length} complete (uploaded=${stats.uploaded}, skipped=${stats.skipped})`,
      );
    }
  });

  return stats;
}

function replaceAll(content, replacements) {
  let output = content;

  for (const [source, target] of replacements) {
    output = output.split(source).join(target);
  }

  return output;
}

async function rewriteDocs(docChanges, replacements) {
  let changedDocs = 0;

  for (const docChange of docChanges) {
    const nextContent = replaceAll(docChange.content, replacements);
    if (nextContent === docChange.content) {
      continue;
    }

    await fs.writeFile(docChange.docFile, nextContent, 'utf8');
    changedDocs += 1;
  }

  return changedDocs;
}

async function countRemainingLocalRefs(docFiles) {
  let count = 0;
  for (const docFile of docFiles) {
    const content = await fs.readFile(docFile, 'utf8');
    count += extractImageRefs(content).length;
  }
  return count;
}

function printPlanSummary(plan, replacements) {
  console.log(`文档数量: ${plan.docChanges.length}`);
  console.log(`引用图片数量: ${plan.imageUsage.length}`);
  console.log(`计划替换数量: ${replacements.length}`);

  if (plan.missingFiles.length > 0) {
    console.log(`缺失图片: ${plan.missingFiles.length}`);
    for (const item of plan.missingFiles.slice(0, DEFAULT_SAMPLE_SIZE)) {
      console.log(`  - ${item.localRef} -> ${item.absoluteImagePath}`);
    }
  }

  if (replacements.length > 0) {
    console.log('示例替换:');
    for (const [source, target] of replacements.slice(0, DEFAULT_SAMPLE_SIZE)) {
      console.log(`  - ${source}`);
      console.log(`    -> ${target}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const projectRoot = process.cwd();
  await loadEnvFiles(projectRoot);

  const plan = await buildMigrationPlan(projectRoot, options);

  if (plan.docChanges.length === 0) {
    console.log('没有找到需要处理的文档。');
    return;
  }

  if (plan.missingFiles.length > 0) {
    throw new Error(`存在缺失图片，终止执行。缺失数量: ${plan.missingFiles.length}`);
  }

  const { client, bucket, endpointHost } = createClient();
  const replacements = plan.imageUsage.map((image) => [
    image.localRef,
    buildPublicUrl(bucket, endpointHost, image.objectKey),
  ]);

  printPlanSummary(plan, replacements);

  if (!options.write) {
    console.log('dry-run 完成，未上传文件，也未修改文档。');
    return;
  }

  console.log('开始上传图片到 OSS...');
  const uploadStats = await uploadImages(client, plan.imageUsage, options.concurrency);
  console.log(
    `上传完成: uploaded=${uploadStats.uploaded}, skipped=${uploadStats.skipped}, total=${plan.imageUsage.length}`,
  );

  console.log('开始替换文档中的图片引用...');
  const changedDocs = await rewriteDocs(docChangesForWrite(plan.docChanges), replacements);
  const remainingLocalRefs = await countRemainingLocalRefs(
    plan.docChanges.map((docChange) => docChange.docFile),
  );

  console.log(`文档替换完成: changedDocs=${changedDocs}`);
  console.log(`剩余本地 /images 引用: ${remainingLocalRefs}`);

  if (remainingLocalRefs > 0) {
    throw new Error('仍存在未替换的本地图片引用，请检查文档格式。');
  }
}

function docChangesForWrite(docChanges) {
  return docChanges.map((docChange) => ({
    ...docChange,
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
