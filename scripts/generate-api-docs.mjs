import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateFiles } from 'fumadocs-openapi';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOCS_ROOT = path.join(PROJECT_ROOT, 'content', 'docs');
const MODULE_ROOT = path.join(DOCS_ROOT, '08-API使用手册');
const API_REFERENCE_ROOT = path.join(MODULE_ROOT, 'API参考');
const SOURCE_SPEC_PATH = path.resolve(PROJECT_ROOT, '..', 'IDAAS API.json');
const TARGET_SPEC_PATH = path.join(PROJECT_ROOT, 'api', 'idaas-api.json');
const ROUTE_MAP_PATH = path.join(PROJECT_ROOT, 'api', 'idaas-api-route-map.json');
const INPUT_SPEC = './api/idaas-api.json';
const OUTPUT_DIR = './content/docs/08-API使用手册/API参考';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const GROUPS = [
  {
    tag: '1-安全认证',
    slug: '认证鉴权',
    title: '认证鉴权',
    description: '获取 access_token，并为后续 Bearer Token 调用做准备。',
    typicalUse: '首次接入、联调前准备、Token 刷新策略确认。',
    defaultAuth: '无需 Bearer Token',
    defaultPrerequisites: ['准备好 client_id 与 client_secret'],
    recommendedOperationKeys: ['post /iam/token', 'post /iam/token/basic'],
    operationOrder: ['post /iam/token', 'post /iam/token/basic'],
    steps: [
      '准备应用的 client_id 与 client_secret。',
      '优先调用请求体方式的 Token 接口获取 access_token。',
      '将 access_token 写入后续业务接口的 Authorization 头。',
    ],
  },
  {
    tag: '2-组织部门API',
    slug: '组织与部门',
    title: '组织与部门',
    description: '管理部门树、查询部门详情，并按组织结构同步上下级关系。',
    typicalUse: '组织架构同步、部门初始化、按部门维度查询成员范围。',
    defaultAuth: 'Bearer Token',
    defaultPrerequisites: ['已获取 access_token', '调用方具备组织架构管理权限'],
    recommendedOperationKeys: ['get /iam/api/orgs', 'post /iam/api/orgs', 'get /iam/api/orgs/{org_id}'],
    operationOrder: [
      'get /iam/api/orgs',
      'post /iam/api/orgs',
      'get /iam/api/orgs/{org_id}',
      'patch /iam/api/orgs/{org_id}',
      'get /iam/api/orgs/{org_id}/subs',
      'post /iam/api/orgs/search',
      'delete /iam/api/orgs/{org_id}',
    ],
    steps: [
      '先用“获取部门列表”确认当前组织树结构。',
      '需要新增或调整结构时，再调用创建、修改或删除部门接口。',
      '如果只需要按条件定位部门，优先使用过滤部门接口。',
    ],
  },
  {
    tag: '3-用户API',
    slug: '用户管理',
    title: '用户管理',
    description: '查询、创建、修改、启停和删除用户，是最常见的联调接口组。',
    typicalUse: '账号同步、用户主数据维护、批量排查用户状态。',
    defaultAuth: 'Bearer Token',
    defaultPrerequisites: ['已获取 access_token', '调用方具备用户管理权限'],
    recommendedOperationKeys: ['get /iam/api/users', 'post /iam/api/users', 'get /iam/api/user'],
    operationOrder: [
      'get /iam/api/users',
      'post /iam/api/users',
      'post /iam/api/users/search',
      'get /iam/api/user',
      'patch /iam/api/user',
      'put /iam/api/users/status',
      'post /iam/api/users/password',
      'post /iam/api/users/delete',
    ],
    steps: [
      '联调阶段先用查询用户确认账号是否已存在。',
      '新增账号走创建用户，已有账号的资料调整走修改用户。',
      '状态变更、密码重置、逻辑删除分别使用对应的专用接口。',
    ],
  },
  {
    tag: '5-角色管理',
    slug: '角色与标签',
    title: '角色与标签',
    description: '管理角色定义以及用户与角色之间的静态绑定关系。',
    typicalUse: '角色初始化、按应用查询角色、为用户批量授予角色。',
    defaultAuth: 'Bearer Token',
    defaultPrerequisites: ['已获取 access_token', '调用方具备角色管理权限'],
    recommendedOperationKeys: [
      'post /iam/api/tags',
      'post /iam/api/tags/search',
      'post /iam/api/tags/{id}/users',
    ],
    operationOrder: [
      'post /iam/api/tags/search',
      'post /iam/api/tags',
      'get /iam/api/tags/{id}',
      'put /iam/api/tags/{id}',
      'delete /iam/api/tags/{id}',
      'get /iam/api/tags/{id}/users',
      'post /iam/api/tags/{id}/users',
      'delete /iam/api/tags/{id}/users',
      'get /iam/api/tags/getTagList',
      'get /iam/api/tags/getTagList/user',
    ],
    steps: [
      '先查询角色列表或详情，确认目标角色是否已存在。',
      '角色定义完成后，再为用户批量添加或移除角色。',
      '按应用或按用户排查授权时，可使用两个角色查询接口辅助定位。',
    ],
  },
  {
    tag: '6-数据连接',
    slug: '数据连接',
    title: '数据连接',
    description: '通过 Webhook 方式触发连接流，适合外部系统驱动集成流程。',
    typicalUse: '系统事件触发连接流、外部平台回调到集成平台。',
    defaultAuth: '路径中的 apiKey',
    defaultPrerequisites: ['准备 actionId、flowId 和 apiKey', '确认连接流已发布并可触发'],
    recommendedOperationKeys: ['post /acm/flows/start/{actionId}/{flowId}/{apiKey}'],
    operationOrder: ['post /acm/flows/start/{actionId}/{flowId}/{apiKey}'],
    steps: [
      '确认目标连接流已发布，并拿到 actionId、flowId 与 apiKey。',
      '由外部系统按约定路径发起 Webhook 请求。',
      '收到异常时优先核对 apiKey、路径参数和值班日志。',
    ],
  },
  {
    tag: '4-通讯录集成连接器事件通知',
    slug: '事件通知',
    title: '事件通知',
    description: '向通讯录集成连接器发送事件通知，驱动指定租户和连接器的动作。',
    typicalUse: '连接器回调、下游系统通知、事件驱动的数据同步。',
    defaultAuth: '路径中的 apiKey',
    defaultPrerequisites: ['准备 tenantId、connectorId 和 apiKey', '确认目标连接器已启用'],
    recommendedOperationKeys: ['post /iam/api/open/event/{tenantId}/{connectorId}/{apiKey}'],
    operationOrder: ['post /iam/api/open/event/{tenantId}/{connectorId}/{apiKey}'],
    steps: [
      '确认目标租户和连接器标识正确。',
      '使用路径中的 apiKey 发起事件通知请求。',
      '如果回调未生效，先核对连接器状态和事件日志。',
    ],
  },
];

const OPERATION_OVERRIDES = {
  'post /iam/token': {
    title: '获取 access_token（请求体方式）',
    slug: '获取access-token-请求体方式',
    description: '使用 client_id 和 client_secret 通过请求体换取 access_token。',
    summary: '推荐作为默认的 Token 获取方式。',
    auth: '无需 Bearer Token',
    prerequisites: ['准备好 client_id 与 client_secret'],
    bodyLines: [
      '## 调用建议',
      '',
      '- 推荐把这个接口作为默认的 Token 获取方式。',
      '- 返回的 `access_token` 建议按实际过期时间缓存，并在失效前刷新。',
      '- 如果联调阶段频繁返回 401，先重新获取新的 Token 再重试业务接口。',
      '',
      '<Callout>',
      '如果你的调用方本身采用标准 OAuth2 Basic 认证客户端形态，可改用“获取 access_token（Basic 认证方式）”。',
      '</Callout>',
    ],
  },
  'post /iam/token/basic': {
    title: '获取 access_token（Basic 认证方式）',
    slug: '获取access-token-basic认证方式',
    description: '使用 Basic 认证头换取 access_token。',
    summary: '适合已接入标准 OAuth2 客户端认证方式的系统。',
    auth: '无需 Bearer Token',
    prerequisites: ['准备好 client_id 与 client_secret', '调用方支持 Basic 认证头'],
  },
  'get /iam/api/orgs': {
    title: '获取部门列表',
    slug: '获取部门列表',
    description: '查询当前租户下的组/部门列表。',
    summary: '通常作为组织架构联调的第一条验证接口。',
    bodyLines: [
      '## 调用建议',
      '',
      '- 首次联调建议先调用该接口，确认 Token、权限和组织数据是否可读。',
      '- 如果你的场景只需要定位指定部门，再结合“过滤部门”或“获取部门详情”缩小范围。',
      '- 当返回结果为空时，优先确认当前租户是否已同步组织数据。',
    ],
  },
  'post /iam/api/orgs': {
    title: '创建部门',
    slug: '创建部门',
    description: '在当前租户下创建新的组/部门。',
    summary: '用于组织初始化或从外部系统同步新部门。',
    bodyLines: [
      '## 调用建议',
      '',
      '- 创建前建议先调用“获取部门列表”或“过滤部门”，避免重复创建。',
      '- 如果需要维护上下级关系，请先确认父部门标识在平台内已经存在。',
      '- 创建成功后，可再调用“获取部门详情”做结果校验。',
    ],
  },
  'get /iam/api/orgs/{org_id}': {
    title: '获取部门详情',
    slug: '获取部门详情',
    description: '根据 org_id 查询指定组/部门的详情。',
    summary: '适合在更新前做详情核验，或用于单条问题排查。',
  },
  'patch /iam/api/orgs/{org_id}': {
    title: '修改部门',
    slug: '修改部门',
    description: '更新指定组/部门的信息。',
    summary: '用于调整组织名称、属性或结构信息。',
  },
  'delete /iam/api/orgs/{org_id}': {
    title: '删除部门',
    slug: '删除部门',
    description: '删除指定组/部门。',
    summary: '执行前建议确认下级部门与关联成员的处置策略。',
  },
  'get /iam/api/orgs/{org_id}/subs': {
    title: '获取下级部门',
    slug: '获取下级部门',
    description: '根据 org_id 查询下级组/部门信息。',
    summary: '适合按树结构逐层展开组织数据。',
  },
  'post /iam/api/orgs/search': {
    title: '过滤部门',
    slug: '过滤部门',
    description: '根据过滤条件查询部门信息。',
    summary: '适合定向查询部门而不是拉取整棵组织树。',
  },
  'get /iam/api/users': {
    title: '查询用户',
    slug: '查询用户',
    description: '按条件查询用户列表。',
    summary: '建议作为用户联调的首条验证接口。',
    bodyLines: [
      '## 调用建议',
      '',
      '- 首次联调优先调用该接口，确认 Bearer Token 是否有效。',
      '- 如果只需要获取单个账号详情，可改用“获取用户详情”。',
      '- 如果需要复杂过滤条件，使用“过滤查询用户”会更直接。',
    ],
  },
  'post /iam/api/users': {
    title: '创建用户',
    slug: '创建用户',
    description: '在当前租户下创建用户。',
    summary: '适合主数据同步、新用户开户和初始化导入。',
    bodyLines: [
      '## 调用建议',
      '',
      '- 创建前建议先调用“查询用户”确认账号是否已存在。',
      '- 如果接口返回参数错误，优先核对必填字段和字段格式。',
      '- 创建成功后，可通过“获取用户详情”或“查询用户”立即校验结果。',
    ],
  },
  'post /iam/api/users/search': {
    title: '过滤查询用户',
    slug: '过滤查询用户',
    description: '根据多个条件过滤并查询用户信息。',
    summary: '适合批量排查用户属性或按条件做同步校验。',
  },
  'get /iam/api/user': {
    title: '获取用户详情',
    slug: '获取用户详情',
    description: '根据用户帐号获取用户信息。',
    summary: '适合单账号核验、更新前校验和问题定位。',
    bodyLines: [
      '## 调用建议',
      '',
      '- 如果你已经知道用户帐号，这是比“查询用户”更直接的单条详情接口。',
      '- 适合作为修改用户、启停用户和修改密码前的前置校验。',
    ],
  },
  'patch /iam/api/user': {
    title: '修改用户',
    slug: '修改用户',
    description: '修改指定用户的信息。',
    summary: '用于更新用户主数据而不是状态变更。',
  },
  'put /iam/api/users/status': {
    title: '启用或禁用用户',
    slug: '启用或禁用用户',
    description: '启用或禁用指定用户。',
    summary: '适合账号冻结、恢复和批量状态治理场景。',
  },
  'post /iam/api/users/delete': {
    title: '删除用户',
    slug: '删除用户',
    description: '删除指定用户。',
    summary: '执行前建议核对租户内关联关系和后续恢复策略。',
  },
  'post /iam/api/users/password': {
    title: '修改用户密码',
    slug: '修改用户密码',
    description: '修改指定用户的密码。',
    summary: '适合首次初始化、人工重置或迁移后的密码矫正。',
  },
  'post /iam/api/tags': {
    title: '创建角色',
    slug: '创建角色',
    description: '创建角色定义。',
    summary: '通常作为角色初始化的第一步。',
  },
  'get /iam/api/tags/{id}': {
    title: '获取角色详情',
    slug: '获取角色详情',
    description: '根据角色 ID 获取角色详情。',
    summary: '适合在修改或排障前核对角色当前状态。',
  },
  'put /iam/api/tags/{id}': {
    title: '修改角色',
    slug: '修改角色',
    description: '修改角色定义。',
    summary: '适合调整角色名称、属性和配置。',
  },
  'delete /iam/api/tags/{id}': {
    title: '删除角色',
    slug: '删除角色',
    description: '删除指定角色。',
    summary: '删除前建议先确认角色是否仍被用户引用。',
  },
  'post /iam/api/tags/search': {
    title: '查询角色列表',
    slug: '查询角色列表',
    description: '根据条件查询角色列表。',
    summary: '适合角色排查、初始化校验和同步对账。',
  },
  'get /iam/api/tags/getTagList': {
    title: '根据应用与用户获取角色列表',
    slug: '根据应用与用户获取角色列表',
    description: '根据应用 ID 和用户 ID 获取角色列表。',
    summary: '适合校验用户在某个应用下的角色绑定结果。',
  },
  'get /iam/api/tags/{id}/users': {
    title: '查看角色下的用户',
    slug: '查看角色下的用户',
    description: '查看指定角色对应的用户列表。',
    summary: '适合排查“角色绑定到了哪些人”。',
  },
  'post /iam/api/tags/{id}/users': {
    title: '给用户添加角色',
    slug: '给用户添加角色',
    description: '给多个用户添加静态角色。',
    summary: '适合批量授权和角色分配。',
  },
  'delete /iam/api/tags/{id}/users': {
    title: '删除用户角色',
    slug: '删除用户角色',
    description: '删除用户的静态角色。',
    summary: '适合回收授权和批量解绑角色。',
  },
  'get /iam/api/tags/getTagList/user': {
    title: '获取用户角色信息',
    slug: '获取用户角色信息',
    description: '获取指定用户的角色信息。',
    summary: '适合从用户视角排查授权结果。',
  },
  'post /acm/flows/start/{actionId}/{flowId}/{apiKey}': {
    title: 'Webhook 启动连接流',
    slug: 'Webhook启动连接流',
    description: '通过 Webhook 路径参数触发指定连接流。',
    summary: '适合由外部系统主动触发集成流程。',
    auth: '路径中的 apiKey',
    prerequisites: ['准备 actionId、flowId 和 apiKey', '确认连接流已发布并可用'],
    bodyLines: [
      '## 调用建议',
      '',
      '- 这是一个面向外部系统触发的入口接口，请优先保护好路径中的 `apiKey`。',
      '- 如果调用没有触发流程，先核对 actionId、flowId 是否对应到已发布的连接流。',
      '- 联调失败时，建议同时查看平台运行日志和调用方的请求日志。',
    ],
  },
  'post /iam/api/open/event/{tenantId}/{connectorId}/{apiKey}': {
    title: '连接器事件通知',
    slug: '连接器事件通知',
    description: '向指定租户和连接器发送事件通知。',
    summary: '适合连接器回调和事件驱动的数据同步。',
    auth: '路径中的 apiKey',
    prerequisites: ['准备 tenantId、connectorId 和 apiKey', '确认目标连接器已启用'],
    bodyLines: [
      '## 调用建议',
      '',
      '- 调用前先确认 tenantId 与 connectorId 对应关系无误。',
      '- 如果回调处理失败，优先排查 apiKey、事件体结构和连接器运行状态。',
    ],
  },
};

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function jsonString(value) {
  return JSON.stringify(value);
}

function escapeAttr(text) {
  return text.replace(/"/g, '&quot;');
}

function slugifyLegacyTag(text) {
  return text.replace(/\s+/g, '-').toLowerCase();
}

function slugifyDocName(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function operationKey(method, routePath) {
  return `${method.toLowerCase()} ${routePath}`;
}

function moduleRoute(...segments) {
  return `/docs/${['08-API使用手册', ...segments].join('/')}`;
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

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${content.trim()}\n`, 'utf8');
}

async function walkFiles(rootDir) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) continue;

    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

async function copySpecFile() {
  if (!(await pathExists(SOURCE_SPEC_PATH))) {
    throw new Error(`未找到接口源文件: ${SOURCE_SPEC_PATH}`);
  }

  await ensureDir(path.dirname(TARGET_SPEC_PATH));
  await fs.copyFile(SOURCE_SPEC_PATH, TARGET_SPEC_PATH);
}

async function readSpec() {
  const raw = await fs.readFile(TARGET_SPEC_PATH, 'utf8');
  return JSON.parse(raw);
}

function buildSpecOperationIndex(spec) {
  const index = new Map();

  for (const [routePath, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method];
      if (!operation) continue;
      index.set(operationKey(method, routePath), { routePath, method, operation });
    }
  }

  return index;
}

function pickGroupByTag(tag) {
  const group = GROUPS.find((item) => item.tag === tag);
  if (!group) {
    throw new Error(`未配置分组映射: ${tag}`);
  }

  return group;
}

function buildOperationRoute(groupSlug, fileSlug) {
  return moduleRoute('API参考', groupSlug, fileSlug);
}

function buildOperationDescription(summary, groupTitle) {
  if (summary) return summary;
  return `${groupTitle}接口`;
}

function normalizeOperationTitle(summary, method, routePath) {
  const value = (summary ?? '').trim();
  if (value) return value;
  return `${method.toUpperCase()} ${routePath}`;
}

function ensureUniqueSlug(baseSlug, usedSlugs, fallbackParts) {
  let slug = baseSlug || slugifyDocName(fallbackParts.join('-'));
  if (!slug) slug = 'api-operation';

  if (!usedSlugs.has(slug)) {
    usedSlugs.add(slug);
    return slug;
  }

  const fallback = slugifyDocName(fallbackParts.join('-')) || 'api-operation';
  let suffix = 2;
  while (usedSlugs.has(`${fallback}-${suffix}`)) {
    suffix += 1;
  }

  const unique = `${fallback}-${suffix}`;
  usedSlugs.add(unique);
  return unique;
}

function buildOperations(spec) {
  const specIndex = buildSpecOperationIndex(spec);
  const operations = [];
  const groupBuckets = new Map();
  const groupOrderMaps = new Map();

  for (const group of GROUPS) {
    groupBuckets.set(group.tag, []);
    groupOrderMaps.set(group.tag, new Map(group.operationOrder.map((key, index) => [key, index])));
  }

  for (const value of specIndex.values()) {
    const tag = value.operation.tags?.[0];
    if (!tag) {
      throw new Error(`接口缺少 tags: ${value.method.toUpperCase()} ${value.routePath}`);
    }

    const group = pickGroupByTag(tag);
    groupBuckets.get(group.tag)?.push(value);
  }

  for (const group of GROUPS) {
    const bucket = groupBuckets.get(group.tag) ?? [];
    const orderMap = groupOrderMaps.get(group.tag) ?? new Map();
    const usedSlugs = new Set();

    bucket.sort((left, right) => {
      const leftKey = operationKey(left.method, left.routePath);
      const rightKey = operationKey(right.method, right.routePath);
      const leftOrder = orderMap.has(leftKey) ? orderMap.get(leftKey) : Number.MAX_SAFE_INTEGER;
      const rightOrder = orderMap.has(rightKey) ? orderMap.get(rightKey) : Number.MAX_SAFE_INTEGER;

      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.routePath.localeCompare(right.routePath, 'zh-Hans-CN');
    });

    for (const item of bucket) {
      const key = operationKey(item.method, item.routePath);
      const override = OPERATION_OVERRIDES[key] ?? {};
      const title = override.title ?? normalizeOperationTitle(item.operation.summary, item.method, item.routePath);
      const summary = override.summary ?? title;
      const description = override.description ?? buildOperationDescription(item.operation.summary, group.title);
      const slug = ensureUniqueSlug(
        override.slug ?? slugifyDocName(title),
        usedSlugs,
        [group.slug, item.method, item.routePath],
      );

      operations.push({
        key,
        method: item.method.toUpperCase(),
        routePath: item.routePath,
        title,
        slug,
        summary,
        description,
        group,
        auth: override.auth ?? group.defaultAuth,
        prerequisites: override.prerequisites ?? [...group.defaultPrerequisites],
        bodyLines: override.bodyLines ?? [],
        route: buildOperationRoute(group.slug, slug),
      });
    }
  }

  return operations;
}

function buildOperationMap(operations) {
  return new Map(operations.map((operation) => [operation.key, operation]));
}

function buildOperationsByGroup(operations) {
  const grouped = new Map();

  for (const group of GROUPS) {
    grouped.set(group.tag, []);
  }

  for (const operation of operations) {
    grouped.get(operation.group.tag)?.push(operation);
  }

  return grouped;
}

function tableRow(columns) {
  return `| ${columns.join(' | ')} |`;
}

function buildOverviewPage(operationsByGroup) {
  const totalOperations = [...operationsByGroup.values()].reduce((sum, group) => sum + group.length, 0);
  const lines = [
    '---',
    'title: "API 使用手册"',
    'description: "面向开发联调的接入手册，覆盖快速开始、调用规范、排错和完整 API 参考。"',
    '---',
    '',
    '## 模块定位',
    '',
    `当前手册覆盖 **${totalOperations}** 个接口操作，优先服务开发联调、二次开发和实施排障场景。`,
    '',
    '<Callout>',
    '推荐阅读顺序：先看《快速开始》，再看《认证与请求规范》，最后按能力进入《API参考》。',
    '</Callout>',
    '',
    '## 开始接入',
    '',
    '<Cards>',
    `  <Card title="快速开始" href="${moduleRoute('快速开始')}" />`,
    `  <Card title="认证与请求规范" href="${moduleRoute('认证与请求规范')}" />`,
    `  <Card title="错误处理与排查" href="${moduleRoute('错误处理与排查')}" />`,
    '</Cards>',
    '',
    '## 按能力查接口',
    '',
    tableRow(['分组', '接口数', '典型用途', '入口']),
    tableRow(['---', '---', '---', '---']),
  ];

  for (const group of GROUPS) {
    const count = operationsByGroup.get(group.tag)?.length ?? 0;
    lines.push(
      tableRow([
        group.title,
        String(count),
        group.typicalUse,
        `[查看分组](${moduleRoute('API参考', group.slug, '概览')})`,
      ]),
    );
  }

  lines.push(
    '',
    '## 高频入口',
    '',
    '<Cards>',
    `  <Card title="获取 access_token" href="${moduleRoute('API参考', '认证鉴权', '获取access-token-请求体方式')}" />`,
    `  <Card title="查询用户" href="${moduleRoute('API参考', '用户管理', '查询用户')}" />`,
    `  <Card title="获取部门列表" href="${moduleRoute('API参考', '组织与部门', '获取部门列表')}" />`,
    `  <Card title="查询角色列表" href="${moduleRoute('API参考', '角色与标签', '查询角色列表')}" />`,
    '</Cards>',
  );

  return lines.join('\n');
}

function buildQuickStartPage(operationMap) {
  const tokenRoute = operationMap.get('post /iam/token')?.route ?? moduleRoute('API参考', '认证鉴权', '获取access-token-请求体方式');
  const queryUserRoute = operationMap.get('get /iam/api/users')?.route ?? moduleRoute('API参考', '用户管理', '查询用户');
  const queryOrgRoute = operationMap.get('get /iam/api/orgs')?.route ?? moduleRoute('API参考', '组织与部门', '获取部门列表');

  return [
    '---',
    'title: "API 快速开始"',
    'description: "用最短路径完成首次联调：获取 Token，并调用第一条受保护接口。"',
    '---',
    '',
    '## 你需要准备什么',
    '',
    '- 应用的 `client_id`',
    '- 应用的 `client_secret`',
    '- 当前部署环境的访问域名',
    '',
    '<Callout>',
    '如果你只想验证联调链路，建议先按“获取 Token -> 查询用户”完成第一次调用。',
    '</Callout>',
    '',
    '## 三步完成首次调用',
    '',
    '<Steps>',
    '  <Step>',
    '',
    '### 第一步：获取 access_token',
    '',
    '优先使用请求体方式获取 Token，后续业务接口统一复用该 Token。',
    '',
    '  </Step>',
    '  <Step>',
    '',
    '### 第二步：拼接业务接口地址',
    '',
    '将环境域名与接口路径拼接，例如 `/iam/api/users`、`/iam/api/orgs`。',
    '',
    '  </Step>',
    '  <Step>',
    '',
    '### 第三步：携带 Authorization 头调用业务接口',
    '',
    '对需要鉴权的接口统一添加 `Authorization: Bearer <access_token>` 请求头。',
    '',
    '  </Step>',
    '</Steps>',
    '',
    '## 示例 1：获取 Token',
    '',
    '<APIPage',
    '  document={"./api/idaas-api.json"}',
    '  operations={[{ path: "/iam/token", method: "post" }]}',
    '  webhooks={[]}',
    '  hasHead={false}',
    '/>',
    '',
    '## 示例 2：验证用户查询接口',
    '',
    '<APIPage',
    '  document={"./api/idaas-api.json"}',
    '  operations={[{ path: "/iam/api/users", method: "get" }]}',
    '  webhooks={[]}',
    '  hasHead={false}',
    '/>',
    '',
    '## 下一步去哪里',
    '',
    '<Cards>',
    `  <Card title="认证与请求规范" href="${moduleRoute('认证与请求规范')}" />`,
    `  <Card title="获取 Token 接口" href="${tokenRoute}" />`,
    `  <Card title="查询用户接口" href="${queryUserRoute}" />`,
    `  <Card title="获取部门列表接口" href="${queryOrgRoute}" />`,
    '</Cards>',
  ].join('\n');
}

function buildRequestGuidePage(operationMap) {
  const tokenRoute = operationMap.get('post /iam/token')?.route ?? moduleRoute('API参考', '认证鉴权', '获取access-token-请求体方式');
  const tokenBasicRoute = operationMap.get('post /iam/token/basic')?.route ?? moduleRoute('API参考', '认证鉴权', '获取access-token-basic认证方式');
  const eventRoute = operationMap.get('post /iam/api/open/event/{tenantId}/{connectorId}/{apiKey}')?.route ?? moduleRoute('API参考', '事件通知', '连接器事件通知');
  const flowRoute = operationMap.get('post /acm/flows/start/{actionId}/{flowId}/{apiKey}')?.route ?? moduleRoute('API参考', '数据连接', 'Webhook启动连接流');

  return [
    '---',
    'title: "认证与请求规范"',
    'description: "说明域名拼接、Token 使用方式、请求头和路径参数等通用约定。"',
    '---',
    '',
    '## Base URL 约定',
    '',
    '当前 OpenAPI 定义中未声明固定 `servers`，实际调用时请使用你所在环境的站点域名作为根地址，例如：',
    '',
    '```text',
    'https://{your-domain}',
    '```',
    '',
    '## 鉴权方式',
    '',
    '### 1. Bearer Token',
    '',
    '组织、用户、角色等大部分业务接口默认使用 Bearer Token：',
    '',
    '```http',
    'Authorization: Bearer <access_token>',
    '```',
    '',
    '### 2. 路径中的 apiKey',
    '',
    '数据连接与事件通知接口使用路径参数中的 `apiKey` 完成入口鉴权，请重点保护该值，不要暴露在前端代码中。',
    '',
    '## 内容类型',
    '',
    '- 获取 Token 接口通常使用 `application/x-www-form-urlencoded`。',
    '- 业务接口通常使用 `application/json`。',
    '- 具体请求体字段、参数结构和响应体以对应接口页为准。',
    '',
    '## 请求组织建议',
    '',
    '- 先获取 Token，再调用受保护接口。',
    '- 先查询，再创建或修改，能显著降低重复写入和误删风险。',
    '- 对带路径参数的接口，先核对 `org_id`、`tenantId`、`connectorId`、`apiKey` 等值是否属于当前环境。',
    '',
    '## 推荐入口',
    '',
    '<Cards>',
    `  <Card title="获取 Token（请求体方式）" href="${tokenRoute}" />`,
    `  <Card title="获取 Token（Basic 认证方式）" href="${tokenBasicRoute}" />`,
    `  <Card title="连接器事件通知" href="${eventRoute}" />`,
    `  <Card title="Webhook 启动连接流" href="${flowRoute}" />`,
    '</Cards>',
  ].join('\n');
}

function buildTroubleshootPage() {
  return [
    '---',
    'title: "错误处理与排查"',
    'description: "针对联调阶段最常见的鉴权、参数和路径问题给出排查顺序。"',
    '---',
    '',
    '## 推荐排查顺序',
    '',
    '<Steps>',
    '  <Step>',
    '',
    '### 第一步：确认访问域名和接口路径',
    '',
    '先核对环境域名、HTTP 方法、路径参数和值是否对应到当前租户或当前连接器。',
    '',
    '  </Step>',
    '  <Step>',
    '',
    '### 第二步：确认鉴权方式',
    '',
    'Bearer Token 接口先检查 Token 是否有效；apiKey 接口先检查路径中的 apiKey 是否使用了正确的环境值。',
    '',
    '  </Step>',
    '  <Step>',
    '',
    '### 第三步：确认请求体和必填字段',
    '',
    '参数错误时，优先对照对应接口页里的字段定义和示例结构重新核对请求体。',
    '',
    '  </Step>',
    '</Steps>',
    '',
    '## 常见 HTTP 状态与建议',
    '',
    tableRow(['状态码', '常见原因', '优先排查']),
    tableRow(['---', '---', '---']),
    tableRow(['401', 'Token 缺失、Token 失效、鉴权方式不匹配', '重新获取 Token，并确认 Authorization 头格式是否正确']),
    tableRow(['403', '调用方没有对应接口权限', '确认应用授权、租户权限和接口使用范围']),
    tableRow(['404', '路径错误、资源不存在、环境不匹配', '检查域名、路径参数和值是否正确']),
    tableRow(['405', 'HTTP 方法错误', '确认使用的 GET/POST/PUT/PATCH/DELETE 是否与接口定义一致']),
    tableRow(['422', '字段缺失或字段格式不符合要求', '对照接口页逐项核对请求体与参数']),
    tableRow(['500', '平台内部处理异常或下游依赖异常', '保留请求参数和时间点，结合平台日志进一步排查']),
    '',
    '## 典型问题',
    '',
    '### Token 已获取，但业务接口仍返回 401',
    '',
    '- 确认请求头使用的是 `Authorization: Bearer <access_token>`。',
    '- 重新获取一枚新的 Token 再试，排除过期或缓存旧 Token 的问题。',
    '- 确认当前接口不是 apiKey 入口接口。',
    '',
    '### 事件通知或连接流入口无法触发',
    '',
    '- 先检查路径中的 `tenantId`、`connectorId`、`actionId`、`flowId` 和 `apiKey` 是否匹配当前环境。',
    '- 确认目标连接器或连接流已经启用并发布。',
    '- 结合平台运行日志检查请求是否已到达平台侧。',
    '',
    '<Callout type="warn">',
    '当前规范中未提供统一错误码字典时，请以具体接口响应和平台日志为准，不要只凭 HTTP 状态码下结论。',
    '</Callout>',
  ].join('\n');
}

function buildApiReferenceOverview(operationsByGroup, operationMap) {
  const lines = [
    '---',
    'title: "API参考"',
    'description: "按能力分组查看全部接口定义，并从高频入口直接进入联调页面。"',
    '---',
    '',
    '## 如何使用这一部分',
    '',
    '- 如果你是第一次接入，请先阅读《快速开始》和《认证与请求规范》。',
    '- 如果你已经知道要调用哪类能力，直接进入对应分组的概览页。',
    '- 每个分组页都提供推荐调用顺序、高频接口和完整接口列表。',
    '',
    '## 分组导航',
    '',
    tableRow(['分组', '接口数', '典型用途', '入口']),
    tableRow(['---', '---', '---', '---']),
  ];

  for (const group of GROUPS) {
    const operations = operationsByGroup.get(group.tag) ?? [];
    lines.push(
      tableRow([
        group.title,
        String(operations.length),
        group.typicalUse,
        `[查看分组](${moduleRoute('API参考', group.slug, '概览')})`,
      ]),
    );
  }

  lines.push(
    '',
    '## 高频接口',
    '',
    '<Cards>',
  );

  for (const group of GROUPS) {
    const operationKeyValue = group.recommendedOperationKeys[0];
    const operation = operationMap.get(operationKeyValue);
    if (!operation) continue;
    lines.push(`  <Card title="${escapeAttr(operation.title)}" href="${operation.route}" />`);
  }

  lines.push('</Cards>');
  return lines.join('\n');
}

function buildGroupOverviewPage(group, operations) {
  const lines = [
    '---',
    `title: ${jsonString(`${group.title}接口`)}`,
    `description: ${jsonString(group.description)}`,
    '---',
    '',
    '## 这组接口适合做什么',
    '',
    group.typicalUse,
    '',
    '<Callout>',
    `本组共收录 **${operations.length}** 个接口操作，推荐先阅读下面的调用顺序，再进入具体接口页。`,
    '</Callout>',
    '',
    '## 推荐调用顺序',
    '',
    '<Steps>',
  ];

  for (const step of group.steps) {
    lines.push('  <Step>', '', step, '', '  </Step>');
  }

  lines.push(
    '</Steps>',
    '',
    '## 高频接口',
    '',
    '<Cards>',
  );

  for (const operationKeyValue of group.recommendedOperationKeys) {
    const operation = operations.find((item) => item.key === operationKeyValue);
    if (!operation) continue;
    lines.push(`  <Card title="${escapeAttr(operation.title)}" href="${operation.route}" />`);
  }

  lines.push(
    '</Cards>',
    '',
    '## 全部接口',
    '',
    tableRow(['接口', '方法', '路径', '说明']),
    tableRow(['---', '---', '---', '---']),
  );

  for (const operation of operations) {
    lines.push(
      tableRow([
        `[${operation.title}](${operation.route})`,
        `\`${operation.method}\``,
        `\`${operation.routePath}\``,
        operation.summary,
      ]),
    );
  }

  return lines.join('\n');
}

function buildOperationPage(operation) {
  const bodyLines = [
    '## 接口定位',
    '',
    `- 所属能力分组：${operation.group.title}`,
    `- 典型用途：${operation.summary}`,
    `- 请求路径：\`${operation.routePath}\``,
    '',
    ...operation.bodyLines,
  ];

  const lines = [
    '---',
    `title: ${jsonString(operation.title)}`,
    `description: ${jsonString(operation.description)}`,
    'full: true',
    'api:',
    `  group: ${jsonString(operation.group.title)}`,
    `  groupHref: ${jsonString(moduleRoute('API参考', operation.group.slug, '概览'))}`,
    `  method: ${jsonString(operation.method)}`,
    `  path: ${jsonString(operation.routePath)}`,
    `  auth: ${jsonString(operation.auth)}`,
    `  summary: ${jsonString(operation.summary)}`,
    '  prerequisites:',
    ...operation.prerequisites.map((item) => `    - ${jsonString(item)}`),
    '  related:',
    `    - title: ${jsonString('快速开始')}`,
    `      href: ${jsonString(moduleRoute('快速开始'))}`,
    `    - title: ${jsonString('认证与请求规范')}`,
    `      href: ${jsonString(moduleRoute('认证与请求规范'))}`,
    `    - title: ${jsonString(`${operation.group.title}概览`)}`,
    `      href: ${jsonString(moduleRoute('API参考', operation.group.slug, '概览'))}`,
    '_openapi:',
    '  operations:',
    `    - path: ${jsonString(operation.routePath)}`,
    `      method: ${jsonString(operation.method.toLowerCase())}`,
    '---',
    '',
    ...bodyLines,
    '',
  ];

  return lines.join('\n');
}

function parseLegacyOperationFrontmatter(content) {
  const methodMatch = content.match(/^\s*method:\s*([A-Z]+)\s*$/m);
  const routeMatch = content.match(/^\s*route:\s*(\/[^\s]*)\s*$/m);

  if (!methodMatch || !routeMatch) return null;

  return {
    method: methodMatch[1].toLowerCase(),
    routePath: routeMatch[1],
  };
}

async function generateLegacyRoutes(operationMap) {
  await fs.rm(API_REFERENCE_ROOT, { recursive: true, force: true });
  await generateFiles({
    cwd: PROJECT_ROOT,
    input: INPUT_SPEC,
    output: OUTPUT_DIR,
    groupBy: 'tag',
    per: 'operation',
  });

  const files = await walkFiles(API_REFERENCE_ROOT);
  const redirects = {};

  for (const filePath of files) {
    if (!filePath.endsWith('.mdx')) continue;

    const content = await fs.readFile(filePath, 'utf8');
    const parsed = parseLegacyOperationFrontmatter(content);
    if (!parsed) continue;

    const key = operationKey(parsed.method, parsed.routePath);
    const operation = operationMap.get(key);
    if (!operation) continue;

    const legacyRoute = toPosix(path.relative(DOCS_ROOT, filePath)).replace(/\.mdx$/i, '');
    redirects[legacyRoute] = operation.route;
  }

  for (const group of GROUPS) {
    const legacyGroupSlug = slugifyLegacyTag(group.tag);
    redirects[`08-API使用手册/API参考/${legacyGroupSlug}/概览`] = moduleRoute('API参考', group.slug, '概览');
  }

  redirects['08-API使用手册/调用指南'] = moduleRoute('快速开始');
  return redirects;
}

async function writeRootPages(operationsByGroup, operationMap) {
  await writeJson(path.join(MODULE_ROOT, 'meta.json'), {
    title: 'API使用手册',
    pages: ['概览', '快速开始', '认证与请求规范', '错误处理与排查', 'API参考'],
  });

  await writeText(path.join(MODULE_ROOT, '概览.mdx'), buildOverviewPage(operationsByGroup));
  await writeText(path.join(MODULE_ROOT, '快速开始.mdx'), buildQuickStartPage(operationMap));
  await writeText(path.join(MODULE_ROOT, '认证与请求规范.mdx'), buildRequestGuidePage(operationMap));
  await writeText(path.join(MODULE_ROOT, '错误处理与排查.mdx'), buildTroubleshootPage());
}

async function writeReferencePages(operationsByGroup, operationMap) {
  await writeJson(path.join(API_REFERENCE_ROOT, 'meta.json'), {
    title: 'API参考',
    pages: ['概览', ...GROUPS.map((group) => group.slug)],
  });

  await writeText(path.join(API_REFERENCE_ROOT, '概览.mdx'), buildApiReferenceOverview(operationsByGroup, operationMap));

  for (const group of GROUPS) {
    const operations = operationsByGroup.get(group.tag) ?? [];
    const groupDir = path.join(API_REFERENCE_ROOT, group.slug);

    await writeJson(path.join(groupDir, 'meta.json'), {
      title: group.title,
      pages: ['概览', ...operations.map((operation) => operation.slug)],
    });

    await writeText(path.join(groupDir, '概览.mdx'), buildGroupOverviewPage(group, operations));

    for (const operation of operations) {
      await writeText(path.join(groupDir, `${operation.slug}.mdx`), buildOperationPage(operation));
    }
  }
}

function buildLegacyRedirectPage(relativePath, destination) {
  return [
    '---',
    `title: ${jsonString(`旧地址兼容：${relativePath}`)}`,
    `description: ${jsonString(`旧地址兼容跳转到 ${destination}`)}`,
    `redirect: ${jsonString(destination)}`,
    '---',
    '',
    `本文档已迁移，请跳转到 [新地址](${destination})。`,
  ].join('\n');
}

async function writeLegacyRedirectPages(redirects) {
  for (const [relativePath, destination] of Object.entries(redirects)) {
    const filePath = path.join(DOCS_ROOT, `${relativePath}.mdx`);
    await writeText(filePath, buildLegacyRedirectPage(relativePath, destination));
  }
}

async function main() {
  await copySpecFile();
  const spec = await readSpec();
  const operations = buildOperations(spec);
  const operationMap = buildOperationMap(operations);
  const operationsByGroup = buildOperationsByGroup(operations);
  const legacyRedirects = await generateLegacyRoutes(operationMap);

  await fs.rm(MODULE_ROOT, { recursive: true, force: true });
  await ensureDir(MODULE_ROOT);
  await writeRootPages(operationsByGroup, operationMap);
  await writeReferencePages(operationsByGroup, operationMap);
  await writeLegacyRedirectPages(legacyRedirects);
  await writeJson(ROUTE_MAP_PATH, legacyRedirects);

  console.log(`✅ API 文档生成完成，共生成 ${operations.length} 个接口页`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
