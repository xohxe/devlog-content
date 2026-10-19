import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { checkPathNfc, validateRepo } from '../scripts/validate.mjs';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const validPost = (overrides = {}, body = '본문입니다.') => {
  const fields = {
    title: '테스트 글',
    slug: 'test-post',
    date: '2026-10-19',
    type: 'blog',
    ...overrides,
  };
  const yaml = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      if (Array.isArray(value)) return `${key}:\n${value.map((item) => `  - ${item}`).join('\n')}`;
      if (value === null) return `${key}: null`;
      return `${key}: ${value}`;
    })
    .join('\n');
  return `---\n${yaml}\n---\n\n${body}\n`;
};

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), 'devlog-content-'));
  await Promise.all([
    mkdir(join(root, 'posts', 'blog'), { recursive: true }),
    mkdir(join(root, 'posts', 'wiki'), { recursive: true }),
    mkdir(join(root, 'assets', 'images'), { recursive: true }),
    mkdir(join(root, 'schemas'), { recursive: true }),
  ]);
  await writeFile(
    join(root, 'schemas', 'post.schema.json'),
    await readFile(join(projectRoot, 'schemas', 'post.schema.json')),
  );
  return root;
}

async function post(root, folder, filename, content) {
  const path = join(root, 'posts', folder, filename);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

async function rulesFor(root) {
  return (await validateRepo(root)).errors.map((error) => error.rule);
}

test('checkPathNfc detects decomposed paths independently of the filesystem', () => {
  assert.equal(checkPathNfc('posts/blog/무결성.md'), true);
  assert.equal(checkPathNfc(`posts/blog/${'무결성'.normalize('NFD')}.md`), false);
});

test('accepts valid posts, independent filenames, covers, redirects, and uppercase slugs', async () => {
  const root = await makeRepo();
  await post(root, 'blog', 'english-name.md', validPost({ slug: 'english-slug' }));
  await post(root, 'wiki', '한글-파일명.md', validPost({ slug: '한글-슬러그', type: 'wiki' }));
  await post(root, 'blog', 'unrelated-file.md', validPost({ slug: 'different-slug' }));
  await post(root, 'blog', 'xcode.md', validPost({ slug: 'Xcode-inital-setting' }));
  await mkdir(join(root, 'assets', 'images', 'xcode'), { recursive: true });
  await writeFile(join(root, 'assets', 'images', 'xcode', 'cover.jpg'), '');
  await post(root, 'blog', 'cover.md', validPost({ slug: 'cover-post', cover: '../../assets/images/xcode/cover.jpg' }));
  await post(root, 'blog', 'redirect.md', validPost({ slug: 'new-slug', redirectFrom: ['old-slug'] }));
  assert.deepEqual(await validateRepo(root), { errors: [] });
});

test('reports path-nfc for a decomposed Korean filename when the filesystem preserves it', async (t) => {
  const root = await makeRepo();
  const name = `${'무결성'.normalize('NFD')}.md`;
  await post(root, 'blog', name, validPost());
  const names = await readdir(join(root, 'posts', 'blog'));
  if (!names.includes(name)) t.skip('filesystem normalizes names');
  assert.ok((await rulesFor(root)).includes('path-nfc'));
});

const invalidCases = [
  ['NFD slug', async (root) => post(root, 'blog', 'a.md', validPost({ slug: '무결성'.normalize('NFD') })), 'slug-nfc'],
  ['empty slug', async (root) => post(root, 'blog', 'a.md', validPost({ slug: '' })), 'schema'],
  ['space and punctuation slug', async (root) => post(root, 'blog', 'a.md', validPost({ slug: 'bad slug!' })), 'schema'],
  ['leading and repeated hyphens', async (root) => post(root, 'blog', 'a.md', validPost({ slug: '-bad--slug' })), 'schema'],
  ['duplicate slug', async (root) => {
    await post(root, 'blog', 'a.md', validPost({ slug: 'same' }));
    await post(root, 'wiki', 'b.md', validPost({ slug: 'same', type: 'wiki' }));
  }, 'slug-duplicate'],
  ['case-insensitive duplicate slug', async (root) => {
    await post(root, 'blog', 'a.md', validPost({ slug: 'Same' }));
    await post(root, 'wiki', 'b.md', validPost({ slug: 'same', type: 'wiki' }));
  }, 'slug-duplicate'],
  ['redirect collides with another slug', async (root) => {
    await post(root, 'blog', 'a.md', validPost({ slug: 'first', redirectFrom: ['taken'] }));
    await post(root, 'wiki', 'b.md', validPost({ slug: 'taken', type: 'wiki' }));
  }, 'slug-duplicate'],
  ['type folder mismatch', async (root) => post(root, 'blog', 'a.md', validPost({ type: 'wiki' })), 'type-folder'],
  ['nested post', async (root) => post(root, 'blog', 'sub/a.md', validPost()), 'post-location'],
  ['missing frontmatter', async (root) => post(root, 'blog', 'a.md', 'no frontmatter\n'), 'frontmatter-parse'],
  ['missing required field', async (root) => post(root, 'blog', 'a.md', validPost({ title: undefined })), 'schema'],
  ['unknown status field', async (root) => post(root, 'blog', 'a.md', validPost({ status: 'draft' })), 'schema'],
  ['invalid date', async (root) => post(root, 'blog', 'a.md', validPost({ date: '2026-99-99' })), 'schema'],
  ['missing cover', async (root) => post(root, 'blog', 'a.md', validPost({ cover: '../../assets/images/nope.jpg' })), 'cover-missing'],
  ['cover outside repository', async (root) => post(root, 'blog', 'a.md', validPost({ cover: '../../../x.jpg' })), 'cover-missing'],
  ['local path in body', async (root) => post(root, 'blog', 'a.md', validPost({}, '비밀: /Users/someone/secret')), 'local-path'],
  ['unquoted numeric slug parses as a number', async (root) => post(root, 'blog', 'a.md', validPost({ slug: '2' })), 'schema'],
  ['slug repeated in its own redirectFrom', async (root) => post(root, 'blog', 'a.md', validPost({ slug: 'same', redirectFrom: ['same'] })), 'slug-duplicate'],
];

test('accepts a quoted numeric slug', async () => {
  const root = await makeRepo();
  await post(root, 'blog', 'a.md', validPost({ slug: '"2"' }));
  assert.deepEqual(await validateRepo(root), { errors: [] });
});

for (const [name, arrange, expectedRule] of invalidCases) {
  test(`reports ${expectedRule}: ${name}`, async () => {
    const root = await makeRepo();
    await arrange(root);
    assert.ok((await rulesFor(root)).includes(expectedRule));
  });
}

test('the actual repository is valid and contains no posts', async () => {
  const result = await validateRepo(projectRoot);
  assert.deepEqual(result.errors, []);
  const posts = await readdir(join(projectRoot, 'posts', 'blog'));
  assert.equal(posts.filter((name) => name.endsWith('.md')).length, 0);
});
