import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(PROJECT_ROOT, '..');
const SOURCE_DIR = path.join(WORKSPACE_ROOT, '数犀集成平台文档站');
const TARGET_DOCS_DIR = path.join(PROJECT_ROOT, 'content', 'docs');
const TARGET_IMAGES_DIR = path.join(PROJECT_ROOT, 'public', 'images');
const LEGACY_IMAGE_DIR = path.join(PROJECT_ROOT, 'image');
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 720;
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|gif|webp|svg)$/i;
const CONTENT_TYPE_EXTENSION = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
]);
const LINK_TOKEN_STOPWORDS = new Set([
  '文档',
  '说明',
  '指南',
  '详情',
  '步骤',
  '参考',
  '查看',
  '添加',
  '创建',
  '配置',
  '使用',
  '功能',
  '平台',
]);

const STEP_SECTION_KEYWORDS = [
  '配置步骤',
  '操作步骤',
  '快速开始步骤',
  '集成平台侧配置',
  '系统侧配置',
  '测试与验证',
  '验证与测试',
  '测试验证',
  '使用步骤',
  '配置流程',
  '操作流程',
  '实施步骤',
];

const FAQ_TITLES = new Set(['常见问题', 'FAQ', '常见问题与处理']);
const KNOWN_LANGUAGES = [
  'powershell',
  'javascript',
  'typescript',
  'batch',
  'bash',
  'shell',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'http',
  'https',
  'sql',
  'cmd',
  'js',
  'ts',
  'sh',
  'py',
  'text',
];
const LANGUAGE_ALIAS = new Map([
  ['js', 'javascript'],
  ['ts', 'typescript'],
  ['sh', 'bash'],
  ['py', 'python'],
  ['yml', 'yaml'],
  ['https', 'http'],
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function escapeYaml(text) {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeAttr(text) {
  return text.replace(/"/g, '&quot;');
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripBookQuotes(text) {
  return text.replace(/[《》「」“”"'`]/g, '').trim();
}

function normalizeLookupKey(text) {
  return stripBookQuotes(text)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）:：,.，/\\\-]/g, '');
}

function cleanHeadingText(text) {
  let value = text.replace(/\\\./g, '.').trim();
  value = value.replace(/^\*+|\*+$/g, '').trim();
  value = value.replace(/^\d+(?:\.\d+)+\s+/u, '');
  value = value.replace(/^\d+\s*[、.．]\s*/u, '');
  value = value.replace(/^[一二三四五六七八九十百]+\s*[、.．]\s*/u, '');
  value = value.replace(/^第?[一二三四五六七八九十百0-9]+步\s*[：:.\-、]?\s*/u, '');
  return value.trim();
}

function stripMarkdown(text) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[*_`>#|~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHtml(content) {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/^\uFEFF/, '')
    .replace(/^\\>/gm, '>')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?span[^>]*>/gi, '')
    .replace(/<\/?font[^>]*>/gi, '')
    .replace(/<\/?div[^>]*>/gi, '')
    .replace(/<\/?p[^>]*>/gi, '\n');
}

function replaceProductTerms(content) {
  return content
    .replace(/\bIDAAS 平台\b/g, '专属集成平台')
    .replace(/\biDaaS\b/g, '专属集成平台')
    .replace(/\bIDAAS\b/g, '专属集成平台')
    .replace(/云身份连接器/g, '专属集成平台')
    .replace(/数犀集成平台/g, '专属集成平台')
    .replace(/\bAI FLOW\b/g, 'AI 连接流')
    .replace(/\bAgenticFlow\b/g, 'AI 连接流');
}

function extractTitle(content, fallbackName) {
  const lines = content.split('\n');
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^##\s+/.test(trimmed)) break;
    const match = trimmed.match(/^#\s+(.+)$/);
    if (match) return cleanHeadingText(match[1]);
  }

  return fallbackName;
}

function extractDescription(content) {
  const lines = content.split('\n');
  for (const line of lines) {
    const value = stripMarkdown(line);
    if (!value) continue;
    if (value.startsWith('更新时间') || value.startsWith('版本')) continue;
    if (value === '概述' || value === '功能概述') continue;
    if (value.length < 12) continue;
    return value.slice(0, 120);
  }
  return '专属集成平台使用说明。';
}

async function walkDocs(rootDir) {
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

      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  }

  return results.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

async function collectImageDirMap(rootDir) {
  const map = new Map();
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (!entry.isDirectory()) continue;

      if (entry.name.endsWith('_images')) {
        const key = normalizeLookupKey(entry.name.replace(/_images$/u, ''));
        if (!key) continue;
        const list = map.get(key) ?? [];
        list.push(fullPath);
        map.set(key, list);
        continue;
      }

      queue.push(fullPath);
    }
  }

  return map;
}

async function collectNamedDirMap(rootDir) {
  const map = new Map();
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || !(await pathExists(current))) continue;

    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(current, entry.name);
      const key = normalizeLookupKey(entry.name);
      if (key) {
        const list = map.get(key) ?? [];
        list.push(fullPath);
        map.set(key, list);
      }
      queue.push(fullPath);
    }
  }

  return map;
}

function mergeDirMaps(...maps) {
  const merged = new Map();

  for (const map of maps) {
    for (const [key, dirs] of map.entries()) {
      const existing = merged.get(key) ?? [];
      for (const dir of dirs) {
        if (!existing.includes(dir)) existing.push(dir);
      }
      merged.set(key, existing);
    }
  }

  return merged;
}

function fileNameWithoutExt(relativePath) {
  return relativePath.replace(/\.md$/i, '');
}

function cleanFolderName(folderName) {
  return folderName.replace(/^\d+-/u, '');
}

function buildAliases(title, fileStem) {
  const values = new Set([
    title,
    fileStem,
    stripBookQuotes(title),
    stripBookQuotes(fileStem),
  ]);

  return [...values]
    .map((value) => normalizeLookupKey(value))
    .filter(Boolean);
}

async function collectMetadata() {
  const files = await walkDocs(SOURCE_DIR);
  const metas = [];

  for (const filePath of files) {
    const relativePath = toPosix(path.relative(SOURCE_DIR, filePath));
    const raw = await fs.readFile(filePath, 'utf8');
    const normalized = replaceProductTerms(cleanHtml(raw));
    const fileStem = path.basename(filePath, '.md');
    const title = extractTitle(normalized, fileStem);
    const route = `/docs/${fileNameWithoutExt(relativePath)}`;

    metas.push({
      sourcePath: filePath,
      relativePath,
      targetPath: path.join(TARGET_DOCS_DIR, relativePath.replace(/\.md$/i, '.mdx')),
      relativeNoExt: fileNameWithoutExt(relativePath),
      route,
      title,
      fileStem,
      dir: toPosix(path.dirname(relativePath)),
      depth: relativePath.split('/').length,
      aliases: buildAliases(title, fileStem),
      raw,
    });
  }

  const titleMap = new Map();
  for (const meta of metas) {
    for (const alias of meta.aliases) {
      const existing = titleMap.get(alias) ?? [];
      existing.push(meta);
      titleMap.set(alias, existing);
    }
  }

  return { metas, titleMap };
}

function buildSearchTokens(text) {
  const raw = stripBookQuotes(text)
    .split(/[\/\s\-()（）:：,.，_]+/u)
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(
    raw.filter((item) => item.length >= 2 && !LINK_TOKEN_STOPWORDS.has(item))
  )];
}

function findFuzzyInternalMatch(text, metas) {
  const haystack = stripBookQuotes(text).replace(/\s+/g, '');
  if (!haystack) return null;

  const scored = [];

  for (const meta of metas) {
    const tokens = buildSearchTokens(`${meta.title} ${meta.fileStem}`);
    if (tokens.length === 0) continue;

    const matches = tokens.filter((token) => haystack.includes(token));
    if (matches.length === 0) continue;

    const score = matches.length * 100 + matches.reduce((sum, token) => sum + token.length, 0);
    if (matches.length < 2 && score < 110) continue;

    scored.push({ meta, score });
  }

  scored.sort((a, b) => b.score - a.score || a.meta.depth - b.meta.depth);
  if (scored.length === 0) return null;
  if (scored[1] && scored[1].score === scored[0].score) return null;
  return scored[0].meta;
}

function resolveInternalLink(text, href, meta, titleMap, metas) {
  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref === '""') return '';

  if (trimmedHref.startsWith('http') || trimmedHref.startsWith('mailto:')) {
    const key = normalizeLookupKey(text);
    const matches = titleMap.get(key);
    if (trimmedHref.includes('alidocs') && matches?.length === 1) {
      return matches[0].route;
    }
    if (trimmedHref.includes('alidocs')) {
      const fuzzyMatch = findFuzzyInternalMatch(text, metas);
      if (fuzzyMatch) return fuzzyMatch.route;
    }
    return trimmedHref;
  }

  if (
    trimmedHref.endsWith('.md') ||
    trimmedHref.startsWith('./') ||
    trimmedHref.startsWith('../')
  ) {
    const absolute = path.resolve(path.dirname(meta.sourcePath), trimmedHref);
    const relative = toPosix(path.relative(SOURCE_DIR, absolute)).replace(/\.md$/i, '');
    if (!relative.startsWith('..') && existsSync(absolute)) {
      return `/docs/${relative}`;
    }
    const key = normalizeLookupKey(text);
    const matches = titleMap.get(key);
    if (matches?.length === 1) {
      return matches[0].route;
    }
  }

  return trimmedHref;
}

function replaceMarkdownLinks(content, replacer) {
  let index = 0;
  let output = '';

  while (index < content.length) {
    const start = content.indexOf('[', index);
    if (start === -1) {
      output += content.slice(index);
      break;
    }

    if (start > 0 && content[start - 1] === '!') {
      output += content.slice(index, start + 1);
      index = start + 1;
      continue;
    }

    const closeLabel = content.indexOf(']', start);
    if (closeLabel === -1 || content[closeLabel + 1] !== '(') {
      output += content.slice(index, start + 1);
      index = start + 1;
      continue;
    }

    let cursor = closeLabel + 2;
    let depth = 1;
    while (cursor < content.length && depth > 0) {
      if (content[cursor] === '(') depth += 1;
      else if (content[cursor] === ')') depth -= 1;
      cursor += 1;
    }

    if (depth !== 0) {
      output += content.slice(index, start + 1);
      index = start + 1;
      continue;
    }

    const label = content.slice(start + 1, closeLabel);
    const href = content.slice(closeLabel + 2, cursor - 1);
    output += content.slice(index, start);
    output += replacer(label, href);
    index = cursor;
  }

  return output;
}

function convertLinks(content, meta, titleMap, metas) {
  return replaceMarkdownLinks(content, (text, href) => {
    const resolved = resolveInternalLink(text, href, meta, titleMap, metas);
    if (!resolved) return text;
    return `[${text}](${resolved})`;
  });
}

function normalizeHeadings(content) {
  const lines = content.split('\n');
  const result = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) {
      result.push(line);
      continue;
    }

    const level = match[1].length;
    const text = cleanHeadingText(match[2]);
    if (!text) continue;

    if (level === 1) {
      continue;
    }

    const normalizedLevel = level <= 2 ? 2 : 3;
    result.push(`${'#'.repeat(normalizedLevel)} ${text}`);
  }

  return result.join('\n');
}

function ensureOverviewSection(content) {
  const lines = content.split('\n');
  const firstMeaningful = lines.findIndex((line) => line.trim());
  if (firstMeaningful === -1) return content;

  const firstLine = lines[firstMeaningful].trim();
  if (
    firstLine.startsWith('## ') ||
    firstLine.startsWith('---') ||
    firstLine.startsWith('<') ||
    firstLine.startsWith('|')
  ) {
    return content;
  }

  lines.splice(firstMeaningful, 0, '## 概述', '');
  return lines.join('\n');
}

function parseSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let current = { title: null, lines: [] };

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      sections.push(current);
      current = { title: cleanHeadingText(match[1]), lines: [] };
      continue;
    }

    current.lines.push(line);
  }

  sections.push(current);
  return sections;
}

function renderSections(sections) {
  const blocks = [];
  for (const section of sections) {
    const body = cleanupBlankLines(section.lines.join('\n'));
    if (section.title) {
      blocks.push(`## ${section.title}`);
      if (body) blocks.push(body);
    } else if (body) {
      blocks.push(body);
    }
  }

  return cleanupBlankLines(blocks.join('\n\n'));
}

function mergeAdjacentSections(sections) {
  const result = [];

  for (const section of sections) {
    const previous = result[result.length - 1];
    if (previous && previous.title && previous.title === section.title) {
      previous.lines.push('', ...section.lines);
      continue;
    }
    result.push(section);
  }

  return result;
}

function splitByH3(lines) {
  const sections = [];
  let intro = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^###\s+(.+)$/);
    if (match) {
      if (!current && intro.length > 0) {
        intro = trimBlankLines(intro);
      }
      if (current) {
        current.lines = trimBlankLines(current.lines);
        sections.push(current);
      }
      current = { title: cleanHeadingText(match[1]), lines: [] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    } else {
      intro.push(line);
    }
  }

  if (current) {
    current.lines = trimBlankLines(current.lines);
    sections.push(current);
  }

  return {
    intro: trimBlankLines(intro),
    sections,
  };
}

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function stepHeading(title, index) {
  let value = title
    .replace(/^步骤\s*[一二三四五六七八九十0-9]+\s*[：:.\-、]?\s*/u, '')
    .replace(/^第?[一二三四五六七八九十0-9]+步\s*[：:.\-、]?\s*/u, '')
    .trim();

  if (!value) value = '执行操作';
  return `### 步骤 ${index}：${value}`;
}

function renderSteps(sections) {
  const lines = ['<Steps>'];
  sections.forEach((section, index) => {
    lines.push('<Step>');
    lines.push(stepHeading(section.title, index + 1));
    if (section.lines.length > 0) {
      lines.push('');
      lines.push(...section.lines);
    }
    lines.push('</Step>');
  });
  lines.push('</Steps>');
  return lines;
}

function isStepSectionTitle(title) {
  return title && STEP_SECTION_KEYWORDS.some((keyword) => title.includes(keyword));
}

function transformSectionsToSteps(sections) {
  return sections.map((section) => {
    if (!section.title || !isStepSectionTitle(section.title)) {
      return section;
    }

    if (section.lines.some((line) => line.includes('<Steps>'))) {
      return section;
    }

    const parsed = splitByH3(section.lines);
    if (parsed.sections.length < 2) {
      return section;
    }

    const lines = [];
    if (parsed.intro.length > 0) {
      lines.push(...parsed.intro, '');
    }
    lines.push(...renderSteps(parsed.sections));
    return {
      ...section,
      lines,
    };
  });
}

function mergeTopLevelStepSections(sections) {
  const result = [];
  let run = [];

  const flush = () => {
    if (run.length >= 3) {
      result.push({
        title: '操作步骤',
        lines: renderSteps(run.map((item) => ({
          title: item.title,
          lines: item.lines,
        }))),
      });
    } else {
      result.push(...run);
    }
    run = [];
  };

  for (const section of sections) {
    if (section.title && /^(步骤\s*[一二三四五六七八九十0-9]+|第?[一二三四五六七八九十0-9]+步)/u.test(section.title)) {
      run.push(section);
      continue;
    }
    flush();
    result.push(section);
  }
  flush();

  return result;
}

function renderAccordions(items) {
  const lines = ['<Accordions>'];
  for (const item of items) {
    lines.push(`<Accordion title="${escapeAttr(item.title)}">`);
    if (item.lines.length > 0) {
      lines.push(...item.lines);
    } else {
      lines.push('待补充。');
    }
    lines.push('</Accordion>');
  }
  lines.push('</Accordions>');
  return lines;
}

function transformFaqSection(section) {
  if (!section.title || !FAQ_TITLES.has(section.title)) return section;

  const parsed = splitByH3(section.lines);
  if (parsed.sections.length > 0) {
    const lines = [];
    if (parsed.intro.length > 0) {
      lines.push(...parsed.intro, '');
    }
    lines.push(...renderAccordions(parsed.sections));
    return { ...section, lines };
  }

  return section;
}

function transformCallouts(content) {
  const lines = content.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    const blockquoteMatch = trimmed.match(/^>\s*\*\*(注意|警告|提醒|说明|提示|适用版本|关联功能)\*\*[：:]?\s*(.*)$/u);
    const inlineMatch = trimmed.match(/^\*\*(注意|警告|提醒|说明|提示)\*\*[：:]?\s*(.*)$/u);
    const refMatch = trimmed.match(/^📋\s*\*\*参考文档\*\*[：:]?\s*(.*)$/u);

    if (!blockquoteMatch && !inlineMatch && !refMatch) {
      result.push(lines[i]);
      continue;
    }

    const body = [];
    let type = 'info';

    if (blockquoteMatch || inlineMatch) {
      const match = blockquoteMatch ?? inlineMatch;
      if (match[2]) body.push(match[2]);
      if (['警告', '提醒', '注意'].includes(match[1])) type = 'warn';
    }

    if (refMatch?.[1]) {
      body.push(refMatch[1]);
    }

    if (blockquoteMatch) {
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) {
        i += 1;
        body.push(lines[i].trim().replace(/^>\s?/, ''));
      }
    }

    if (body.length === 0) {
      continue;
    }

    result.push(`<Callout type="${type}">`);
    result.push(...body.filter(Boolean));
    result.push('</Callout>');
  }

  return cleanupBlankLines(result.join('\n'));
}

function normalizeFenceToken(token) {
  const lower = token.toLowerCase();

  for (const language of KNOWN_LANGUAGES) {
    const normalized = LANGUAGE_ALIAS.get(language) ?? language;

    if (lower === language) {
      return { language: normalized, extra: '' };
    }

    if (lower.startsWith(language) && lower.length > language.length) {
      return { language: normalized, extra: token.slice(language.length) };
    }

    if (language.startsWith(lower) && lower.length >= 3) {
      return { language: normalized, extra: '' };
    }
  }

  return { language: 'text', extra: '' };
}

function normalizeFencedCodeBlocks(content) {
  const lines = content.split('\n');
  const result = [];

  for (const line of lines) {
    if (!line.trimStart().startsWith('```') && line.includes('```')) {
      const fenceIndex = line.indexOf('```');
      const prefix = line.slice(0, fenceIndex).replace(/\s+$/u, '');
      const rest = line.slice(fenceIndex + 3);
      const tokenMatch = rest.match(/^([A-Za-z0-9_-]*)/u);
      const token = normalizeFenceToken(tokenMatch?.[1] ?? '');
      const afterToken = rest.slice((tokenMatch?.[1] ?? '').length);
      const closingIndex = afterToken.indexOf('```');
      const leading = prefix.match(/^\s*/)?.[0] ?? '';
      const isList = /^(?:[-*+]|\d+\.)\s+/u.test(prefix.trim());
      const indent = isList ? `${leading}    ` : '';

      result.push(prefix, '');

      if (closingIndex >= 0) {
        const code = `${token.extra}${afterToken.slice(0, closingIndex)}`.trim();
        result.push(`${indent}\`\`\`${token.language}`);
        if (code) result.push(`${indent}${code}`);
        result.push(`${indent}\`\`\``);

        const suffix = afterToken.slice(closingIndex + 3).trim();
        if (suffix) result.push(suffix);
      } else {
        const code = `${token.extra}${afterToken}`.trim();
        result.push(`${indent}\`\`\`${token.language}`);
        if (code) result.push(`${indent}${code}`);
      }
      continue;
    }

    const openingWithCodeMatch = line.match(/^(\s*)```([A-Za-z0-9_-]+)(\S.+)$/u);
    if (openingWithCodeMatch) {
      const indent = openingWithCodeMatch[1];
      const token = normalizeFenceToken(openingWithCodeMatch[2]);
      const code = `${token.extra}${openingWithCodeMatch[3]}`.trim();
      result.push(`${indent}\`\`\`${token.language}`, `${indent}${code}`);
      continue;
    }

    const closingInlineMatch = line.match(/^(.*\S)\s*```$/u);
    if (closingInlineMatch && !line.trimStart().startsWith('```')) {
      result.push(closingInlineMatch[1], '```');
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

function normalizeFenceSequences(content) {
  const lines = content.split('\n');
  const result = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^```([A-Za-z0-9_-]+)?$/u);
    if (fenceMatch) {
      const leading = line.match(/^\s*/)?.[0] ?? '';
      if (!inFence) {
        const token = fenceMatch[1];
        if (!token) {
          result.push(`${leading}\`\`\`text`);
        } else {
          const normalized = normalizeFenceToken(token);
          result.push(`${leading}\`\`\`${normalized.language}`);
          if (normalized.extra) {
            result.push(`${leading}${normalized.extra}`);
          }
        }
        inFence = true;
      } else {
        result.push(`${leading}\`\`\``);
        inFence = false;
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

function replaceMarkdownImages(content, replacer) {
  let index = 0;
  let output = '';

  while (index < content.length) {
    const start = content.indexOf('![', index);
    if (start === -1) {
      output += content.slice(index);
      break;
    }

    const closeLabel = content.indexOf(']', start + 2);
    if (closeLabel === -1 || content[closeLabel + 1] !== '(') {
      output += content.slice(index, start + 2);
      index = start + 2;
      continue;
    }

    let cursor = closeLabel + 2;
    let depth = 1;
    while (cursor < content.length && depth > 0) {
      if (content[cursor] === '(') depth += 1;
      else if (content[cursor] === ')') depth -= 1;
      cursor += 1;
    }

    if (depth !== 0) {
      output += content.slice(index, start + 2);
      index = start + 2;
      continue;
    }

    const label = content.slice(start + 2, closeLabel);
    const href = content.slice(closeLabel + 2, cursor - 1);
    output += content.slice(index, start);
    output += replacer(label, href);
    index = cursor;
  }

  return output;
}

function createDocAssetContext(meta, fallbackImageFiles) {
  return {
    meta,
    fallbackImageFiles,
    fallbackIndex: 0,
    usedFallbackNames: new Set(),
    remoteAssets: [],
    remoteAssetMap: new Map(),
  };
}

function deriveExtensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = path.posix.extname(parsed.pathname);
    return IMAGE_FILE_PATTERN.test(ext) ? ext.toLowerCase() : '';
  } catch {
    return '';
  }
}

function deriveExtensionFromContentType(contentType) {
  if (!contentType) return '';
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSION.get(normalized) ?? '';
}

function buildRemoteImageFileName(url, index, contentType = '') {
  const urlExtension = deriveExtensionFromUrl(url);
  const ext = urlExtension || deriveExtensionFromContentType(contentType) || '.png';
  return `remote-${String(index + 1).padStart(2, '0')}${ext}`;
}

function buildMissingImageSvg(title, index) {
  const safeTitle = escapeXml(title);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">',
    '  <rect width="1200" height="720" fill="#f6f7f9" />',
    '  <rect x="40" y="40" width="1120" height="640" rx="24" fill="#ffffff" stroke="#d9dee7" stroke-width="4" />',
    '  <text x="600" y="305" text-anchor="middle" font-size="42" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#1f2937">图片资源暂不可用</text>',
    `  <text x="600" y="370" text-anchor="middle" font-size="26" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#6b7280">${safeTitle} 第 ${index} 张截图原始地址已失效</text>`,
    '</svg>',
  ].join('\n');
}

function registerRemoteImage(url, meta, assetContext) {
  const existing = assetContext.remoteAssetMap.get(url);
  if (existing) return existing.token;

  const index = assetContext.remoteAssets.length;
  const token = `__REMOTE_IMAGE_${index}__`;
  const asset = {
    index,
    token,
    url,
    localSrc: '',
  };

  assetContext.remoteAssets.push(asset);
  assetContext.remoteAssetMap.set(url, asset);
  return token;
}

function reserveFallbackName(fileName, assetContext) {
  if (fileName) assetContext.usedFallbackNames.add(fileName);
}

function nextFallbackImage(assetContext) {
  while (assetContext.fallbackIndex < assetContext.fallbackImageFiles.length) {
    const fileName = assetContext.fallbackImageFiles[assetContext.fallbackIndex];
    assetContext.fallbackIndex += 1;
    if (assetContext.usedFallbackNames.has(fileName)) continue;
    assetContext.usedFallbackNames.add(fileName);
    return fileName;
  }

  return null;
}

function convertImages(content, meta, assetContext) {
  return replaceMarkdownImages(content, (alt, rawHref) => {
    const cleanedHref = rawHref
      .trim()
      .replace(/\s+"[^"]*"$/u, '')
      .replace(/\s+""$/u, '')
      .replace(/^"|"$/g, '');
    if (!cleanedHref || cleanedHref === '""') return '';

    let src = cleanedHref;
    if (cleanedHref.startsWith('./')) {
      const fileName = path.basename(cleanedHref);
      if (!IMAGE_FILE_PATTERN.test(fileName)) {
        return '';
      }
      reserveFallbackName(fileName, assetContext);
      src = `/images/${meta.relativeNoExt}/${fileName}`;
    } else if (cleanedHref.startsWith('http://') || cleanedHref.startsWith('https://')) {
      src = registerRemoteImage(cleanedHref, meta, assetContext);
    }

    const imageAlt = escapeAttr(stripMarkdown(alt) || `${meta.title}截图`);
    return [
      '<ImageZoom',
      `  src="${src}"`,
      `  alt="${imageAlt}"`,
      `  width={${IMAGE_WIDTH}}`,
      `  height={${IMAGE_HEIGHT}}`,
      '/>',
    ].join('\n');
  });
}

function localizeRemoteImageSources(content, meta, assetContext) {
  return content.replace(/src="(https?:\/\/[^"\s]+)"/g, (_match, url) => {
    const token = registerRemoteImage(url, meta, assetContext);
    return `src="${token}"`;
  });
}

async function downloadRemoteImage(url, targetDir, index) {
  let response;

  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; DigitalSee-doc-rewriter/1.0)',
      },
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().startsWith('image/')) {
    return null;
  }

  const fileName = buildRemoteImageFileName(url, index, contentType);
  const targetPath = path.join(targetDir, fileName);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetPath, buffer);
  return fileName;
}

async function materializeRemoteImages(meta, assetContext) {
  if (assetContext.remoteAssets.length === 0) {
    return { downloaded: 0, fallback: 0, placeholders: 0 };
  }

  const targetImageDir = path.join(TARGET_IMAGES_DIR, meta.relativeNoExt);
  await ensureDir(targetImageDir);
  let downloaded = 0;
  let fallback = 0;
  let placeholders = 0;

  for (const asset of assetContext.remoteAssets) {
    const downloadedFileName = await downloadRemoteImage(asset.url, targetImageDir, asset.index);
    if (downloadedFileName) {
      asset.localSrc = `/images/${meta.relativeNoExt}/${downloadedFileName}`;
      downloaded += 1;
      continue;
    }

    const fallbackFileName = nextFallbackImage(assetContext);
    if (fallbackFileName) {
      asset.localSrc = `/images/${meta.relativeNoExt}/${fallbackFileName}`;
      fallback += 1;
      continue;
    }

    const placeholderFileName = `missing-${String(asset.index + 1).padStart(2, '0')}.svg`;
    await fs.writeFile(
      path.join(targetImageDir, placeholderFileName),
      buildMissingImageSvg(meta.title, asset.index + 1),
      'utf8'
    );
    asset.localSrc = `/images/${meta.relativeNoExt}/${placeholderFileName}`;
    placeholders += 1;
  }

  return { downloaded, fallback, placeholders };
}

function replaceRemoteImageTokens(content, assetContext) {
  let output = content;

  for (const asset of assetContext.remoteAssets) {
    output = output.split(asset.token).join(asset.localSrc);
  }

  return output;
}

function normalizeImageZoomBlocks(content) {
  const normalized = content.replace(/\/>\s*<ImageZoom/g, '/>\n\n<ImageZoom');
  const lines = normalized.split('\n');
  const result = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const markerIndex = line.indexOf('<ImageZoom');
    if (markerIndex === -1 || (markerIndex === 0 && line.trim() === '<ImageZoom')) {
      result.push(line);
      continue;
    }

    const prefix = line.slice(0, markerIndex).replace(/\s+$/g, '');
    const trimmedPrefix = prefix.trim();
    const imageLines = ['<ImageZoom'];

    while (i + 1 < lines.length) {
      i += 1;
      imageLines.push(lines[i].trimStart());
      if (lines[i].trim() === '/>') break;
    }

    const listOnlyPattern = /^(?:[-*+]|\d+\.)$/;
    const listWithTextPattern = /^(?:[-*+]|\d+\.)\s+/;

    if (!trimmedPrefix) {
      if (prefix.length > 0) {
        result.push(...imageLines.map((item) => `${prefix}${item}`));
      } else {
        result.push(...imageLines);
      }
      continue;
    }

    if (listOnlyPattern.test(trimmedPrefix)) {
      if (result.length > 0 && result[result.length - 1].trim()) {
        result.push('');
      }
      result.push(...imageLines, '');
      continue;
    }

    if (listWithTextPattern.test(trimmedPrefix)) {
      const leading = prefix.match(/^\s*/)?.[0] ?? '';
      const indent = `${leading}    `;
      result.push(prefix, ...imageLines.map((item) => `${indent}${item}`));
      continue;
    }

    result.push(prefix, '', ...imageLines);
  }

  return cleanupBlankLines(result.join('\n'));
}

function cleanupBlankLines(content) {
  return content
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isOverviewDoc(meta) {
  const folder = cleanFolderName(path.basename(meta.dir));
  return folder && meta.fileStem === folder;
}

function buildRelatedDocs(meta, metas) {
  if (meta.relativePath === '_catalog.md') return [];

  const seen = new Set([meta.relativePath]);
  const picks = [];

  const push = (candidate) => {
    if (!candidate || seen.has(candidate.relativePath) || candidate.relativePath === '_catalog.md') return;
    seen.add(candidate.relativePath);
    picks.push(candidate);
  };

  if (isOverviewDoc(meta)) {
    const children = metas
      .filter((item) => item.relativePath.startsWith(`${meta.dir}/`) && item.relativePath !== meta.relativePath)
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-Hans-CN'));
    children.slice(0, 4).forEach(push);
  } else {
    const siblings = metas
      .filter((item) => item.dir === meta.dir && item.relativePath !== meta.relativePath)
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-Hans-CN'));
    siblings.slice(0, 3).forEach(push);

    const folder = cleanFolderName(path.basename(meta.dir));
    const parentOverview = metas.find((item) => item.dir === meta.dir && item.fileStem === folder);
    push(parentOverview);
  }

  return picks.slice(0, 4);
}

function appendRelatedDocs(content, relatedDocs) {
  if (relatedDocs.length === 0) return content;

  const lines = [content, '', '## 相关文档', '', '<Cards>'];
  for (const doc of relatedDocs) {
    lines.push(`  <Card title="${escapeAttr(doc.title)}" href="${doc.route}" />`);
  }
  lines.push('</Cards>');
  return cleanupBlankLines(lines.join('\n'));
}

function removeRelatedDocsSection(sections) {
  return sections.filter((section) => section.title !== '相关文档');
}

function transformCatalogLinks(content) {
  return content.replace(/\.md\)/g, ')');
}

async function transformDocument(raw, meta, metas, titleMap, fallbackImageFiles) {
  const assetContext = createDocAssetContext(meta, fallbackImageFiles);
  let content = replaceProductTerms(cleanHtml(raw));
  content = convertLinks(content, meta, titleMap, metas);
  content = normalizeHeadings(content);
  content = ensureOverviewSection(content);

  let sections = parseSections(content);
  sections = mergeAdjacentSections(sections);
  sections = mergeTopLevelStepSections(sections);
  sections = transformSectionsToSteps(sections).map(transformFaqSection);
  sections = removeRelatedDocsSection(sections);

  content = renderSections(sections);
  content = transformCallouts(content);
  content = normalizeFencedCodeBlocks(content);
  content = normalizeFenceSequences(content);
  content = convertImages(content, meta, assetContext);
  content = localizeRemoteImageSources(content, meta, assetContext);
  const remoteStats = await materializeRemoteImages(meta, assetContext);
  content = replaceRemoteImageTokens(content, assetContext);
  content = normalizeImageZoomBlocks(content);

  if (meta.relativePath === '_catalog.md') {
    content = transformCatalogLinks(content);
  } else {
    content = appendRelatedDocs(content, buildRelatedDocs(meta, metas));
  }

  const description = extractDescription(content);
  const frontmatter = `---\ntitle: "${escapeYaml(meta.title)}"\ndescription: "${escapeYaml(description)}"\n---`;
  return {
    content: `${frontmatter}\n\n${cleanupBlankLines(content)}\n`,
    remoteStats,
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectCandidateImageDirs(meta, imageDirMap, existingImageDirMap) {
  const docDir = path.dirname(meta.sourcePath);
  const localImageDir = path.join(docDir, `${meta.fileStem}_images`);
  const candidateDirs = [];
  const seen = new Set();

  const push = (dirPath) => {
    if (!dirPath || seen.has(dirPath)) return;
    seen.add(dirPath);
    candidateDirs.push(dirPath);
  };

  if (await pathExists(localImageDir)) {
    push(localImageDir);
  }

  for (const alias of meta.aliases) {
    for (const candidate of imageDirMap.get(alias) ?? []) {
      push(candidate);
    }
  }

  for (const alias of meta.aliases) {
    for (const candidate of existingImageDirMap.get(alias) ?? []) {
      push(candidate);
    }
  }

  return candidateDirs;
}

async function collectCandidateImageFiles(candidateDirs) {
  const files = [];
  const seen = new Set();

  for (const dirPath of candidateDirs) {
    if (!(await pathExists(dirPath))) continue;
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!IMAGE_FILE_PATTERN.test(entry.name)) continue;
      if (seen.has(entry.name)) continue;
      seen.add(entry.name);
      files.push(entry.name);
    }
  }

  return files;
}

async function copyDocImages(meta, candidateDirs) {
  if (candidateDirs.length === 0) return 0;

  const targetImageDir = path.join(TARGET_IMAGES_DIR, meta.relativeNoExt);
  await ensureDir(targetImageDir);
  let count = 0;

  for (const sourceImageDir of candidateDirs) {
    const entries = await fs.readdir(sourceImageDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const src = path.join(sourceImageDir, entry.name);
      const dest = path.join(targetImageDir, entry.name);
      await fs.copyFile(src, dest);
      count += 1;
    }
  }

  return count;
}

async function main() {
  const { metas, titleMap } = await collectMetadata();
  const imageDirMap = await collectImageDirMap(SOURCE_DIR);
  const existingImageDirMap = mergeDirMaps(
    await collectNamedDirMap(TARGET_IMAGES_DIR),
    await collectNamedDirMap(LEGACY_IMAGE_DIR)
  );
  let imageCount = 0;
  let downloadedRemoteImages = 0;
  let fallbackRemoteImages = 0;
  let placeholderImages = 0;

  for (const meta of metas) {
    await ensureDir(path.dirname(meta.targetPath));
    const candidateDirs = await collectCandidateImageDirs(meta, imageDirMap, existingImageDirMap);
    imageCount += await copyDocImages(meta, candidateDirs);
    const fallbackImageFiles = await collectCandidateImageFiles(candidateDirs);
    const result = await transformDocument(meta.raw, meta, metas, titleMap, fallbackImageFiles);
    await fs.writeFile(meta.targetPath, result.content, 'utf8');
    downloadedRemoteImages += result.remoteStats.downloaded;
    fallbackRemoteImages += result.remoteStats.fallback;
    placeholderImages += result.remoteStats.placeholders;
  }

  console.log(`Rewrote ${metas.length} documents.`);
  console.log(`Copied ${imageCount} local images.`);
  console.log(`Downloaded ${downloadedRemoteImages} remote images.`);
  console.log(`Reused ${fallbackRemoteImages} legacy local images for expired remote references.`);
  console.log(`Generated ${placeholderImages} placeholder images for unrecoverable remote references.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
