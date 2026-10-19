import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'schemas', 'post.schema.json');

export function checkPathNfc(relPath) {
  return relPath === relPath.normalize('NFC');
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function listEntries(rootDir) {
  const entries = [];
  async function walk(relative = '') {
    const absolute = path.join(rootDir, relative);
    const children = await fs.readdir(absolute, { withFileTypes: true });
    for (const child of children) {
      if (child.name === '.git' || child.name === 'node_modules') continue;
      const childRel = relative ? path.join(relative, child.name) : child.name;
      entries.push({ relative: childRel, dirent: child });
      if (child.isDirectory()) await walk(childRel);
    }
  }
  await walk();
  return entries;
}

function error(errors, file, rule, message) {
  errors.push({ file: toPosix(file), rule, message });
}

function parseFrontmatter(source) {
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) return null;
  const newline = source.indexOf('\n');
  const close = /^---\s*\r?$/m;
  close.lastIndex = newline + 1;
  const rest = source.slice(newline + 1);
  const match = close.exec(rest);
  if (!match) return null;
  const yamlText = rest.slice(0, match.index);
  return parse(yamlText, { schema: 'core' });
}

function hasLocalPath(source) {
  return /\/Users\/|\/home\/|C:\\Users\\/i.test(source);
}

async function loadValidator() {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

export async function validateRepo(rootDir = process.cwd()) {
  const root = path.resolve(rootDir);
  const errors = [];
  const entries = await listEntries(root);
  const validate = await loadValidator();
  const posts = [];

  for (const entry of entries) {
    const rel = entry.relative;
    const normalizedRel = toPosix(rel);
    if (!checkPathNfc(rel)) error(errors, rel, 'path-nfc', 'Path must be NFC-normalized.');

    if (!normalizedRel.startsWith('posts/')) continue;
    const isMarkdown = entry.dirent.isFile() && path.extname(entry.dirent.name).toLowerCase() === '.md';
    const allowedKeep = entry.dirent.isFile() && entry.dirent.name === '.gitkeep';
    const parent = toPosix(path.dirname(rel));
    const inPostRoot = parent === 'posts/blog' || parent === 'posts/wiki';

    if (isMarkdown && !inPostRoot) {
      error(errors, rel, 'post-location', 'Posts must be directly under posts/blog or posts/wiki.');
      continue;
    }
    if (!isMarkdown && !allowedKeep && entry.dirent.isFile()) {
      error(errors, rel, 'post-location', 'Only Markdown posts and .gitkeep are allowed under posts/.');
    }
    if (!isMarkdown || !inPostRoot) continue;

    const source = await fs.readFile(path.join(root, rel), 'utf8');
    let frontmatter;
    try {
      frontmatter = parseFrontmatter(source);
      if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
        throw new Error('Missing YAML frontmatter.');
      }
    } catch (cause) {
      error(errors, rel, 'frontmatter-parse', cause.message || 'Invalid YAML frontmatter.');
      continue;
    }

    if (typeof frontmatter.slug === 'string' && frontmatter.slug !== frontmatter.slug.normalize('NFC')) {
      error(errors, rel, 'slug-nfc', 'slug must be NFC-normalized.');
    }
    if (Array.isArray(frontmatter.redirectFrom)) {
      for (const redirect of frontmatter.redirectFrom) {
        if (typeof redirect === 'string' && redirect !== redirect.normalize('NFC')) {
          error(errors, rel, 'slug-nfc', 'redirectFrom values must be NFC-normalized.');
        }
      }
    }
    if (!validate(frontmatter)) {
      for (const issue of validate.errors ?? []) {
        error(errors, rel, 'schema', `${issue.instancePath || '/'} ${issue.message}`);
      }
    }
    const expectedType = parent.split('/').pop();
    if (frontmatter.type !== expectedType) {
      error(errors, rel, 'type-folder', `type must be ${expectedType} for this folder.`);
    }
    if (typeof frontmatter.cover === 'string') {
      const cover = frontmatter.cover;
      const resolved = path.resolve(path.dirname(path.join(root, rel)), cover);
      const outside = path.relative(root, resolved).startsWith('..') || path.isAbsolute(cover) || /^https?:/i.test(cover);
      let exists = false;
      if (!outside) {
        try { exists = (await fs.stat(resolved)).isFile(); } catch { /* reported below */ }
      }
      if (outside || !exists) error(errors, rel, 'cover-missing', 'cover must be an existing relative file within the repository.');
    }
    if (hasLocalPath(source)) error(errors, rel, 'local-path', 'Local absolute paths are not allowed.');
    posts.push({ file: rel, frontmatter });
  }

  const seen = new Map();
  for (const post of posts) {
    const values = [post.frontmatter.slug, ...(Array.isArray(post.frontmatter.redirectFrom) ? post.frontmatter.redirectFrom : [])];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const key = value.toLowerCase();
      const prior = seen.get(key);
      if (prior) error(errors, post.file, 'slug-duplicate', `Slug "${value}" conflicts with ${toPosix(prior.file)} (${prior.value}).`);
      else seen.set(key, { file: post.file, value });
    }
  }
  return { errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = process.argv[2] ?? process.cwd();
  const { errors } = await validateRepo(rootDir);
  if (errors.length) {
    for (const item of errors) console.error(`${item.file}: [${item.rule}] ${item.message}`);
    process.exitCode = 1;
  } else {
    const files = await listEntries(path.resolve(rootDir));
    const count = files.filter(({ relative, dirent }) => dirent.isFile() && /^posts\/(blog|wiki)\/[^/]+\.md$/u.test(toPosix(relative))).length;
    console.log(`OK: ${count} posts`);
  }
}
