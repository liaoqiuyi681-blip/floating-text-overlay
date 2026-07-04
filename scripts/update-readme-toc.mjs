import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const readmePath = path.resolve(process.cwd(), 'README.md');
const startMarker = '<!-- TOC:start -->';
const endMarker = '<!-- TOC:end -->';
const source = fs.readFileSync(readmePath, 'utf8');

const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  throw new Error('README.md must contain <!-- TOC:start --> and <!-- TOC:end --> markers.');
}

let inCodeFence = false;
const headings = [];
for (const line of source.split(/\r?\n/)) {
  if (line.trimStart().startsWith('```')) {
    inCodeFence = !inCodeFence;
    continue;
  }
  if (inCodeFence) continue;
  const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
  if (!match) continue;
  const level = match[1].length;
  const title = match[2]
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+#+$/, '')
    .trim();
  if (/^(table of contents|contents)$/i.test(title)) continue;
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  headings.push({ level, title, slug });
}

const toc = [
  '<details>',
  '<summary><strong>Table of contents</strong></summary>',
  '',
  ...headings.map(({ level, title, slug }) => `${'  '.repeat(level - 2)}- [${title}](#${slug})`),
  '',
  '</details>'
].join('\n');

const updated = `${source.slice(0, start + startMarker.length)}\n${toc}\n${source.slice(end)}`;
if (updated !== source) {
  fs.writeFileSync(readmePath, updated);
  console.log('README table of contents updated.');
} else {
  console.log('README table of contents is already current.');
}
