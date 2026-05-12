#!/usr/bin/env node
/*
 * obsidian-graph-check.js
 *
 * Scan a wiki with Obsidian graph semantics:
 * - include all Markdown files under the wiki root, not only 知识库/
 * - ignore generated assets and hidden runtime folders
 * - resolve [[wikilinks]] by full relative path or by unique basename
 * - report isolated Markdown files, broken wikilinks, and ambiguous basename links
 */

const fs = require("fs");
const path = require("path");

const wikiRoot = process.argv[2];

if (!wikiRoot) {
  console.error("Usage: node scripts/obsidian-graph-check.js <wiki_root>");
  process.exit(1);
}

const root = path.resolve(wikiRoot);

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`ERROR: wiki root not found: ${wikiRoot}`);
  process.exit(1);
}

const ignoredDirs = new Set([
  ".git",
  ".wiki-tmp",
  "assets",
  "node_modules",
]);

const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirs.has(entry.name)) continue;
      walk(fullPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
}

walk(root);

const byStem = new Map();
const byRelNoExt = new Map();

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  const relNoExt = rel.replace(/\.md$/i, "");
  const stem = path.basename(file, ".md");
  byRelNoExt.set(relNoExt, file);
  if (!byStem.has(stem)) byStem.set(stem, []);
  byStem.get(stem).push(file);
}

const degree = new Map(files.map((file) => [file, 0]));
const broken = [];
const ambiguous = [];
const linkRe = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

function resolveTarget(rawTarget) {
  const normalized = rawTarget.trim().replace(/\\/g, "/").replace(/\.md$/i, "");
  if (byRelNoExt.has(normalized)) return { targets: [byRelNoExt.get(normalized)] };

  const byName = byStem.get(path.basename(normalized)) || [];
  if (byName.length === 1) return { targets: byName };
  if (byName.length > 1) return { targets: byName, ambiguous: true };
  return { targets: [] };
}

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  let match;
  while ((match = linkRe.exec(content))) {
    const target = match[1].trim();
    const resolved = resolveTarget(target);
    if (resolved.targets.length === 0) {
      broken.push({
        from: path.relative(root, file).replace(/\\/g, "/"),
        target,
      });
      continue;
    }
    degree.set(file, (degree.get(file) || 0) + 1);
    for (const targetFile of resolved.targets) {
      degree.set(targetFile, (degree.get(targetFile) || 0) + 1);
    }
    if (resolved.ambiguous) {
      ambiguous.push({
        from: path.relative(root, file).replace(/\\/g, "/"),
        target,
        candidates: resolved.targets.map((candidate) =>
          path.relative(root, candidate).replace(/\\/g, "/")
        ),
      });
    }
  }
}

const isolated = [...degree.entries()]
  .filter(([, count]) => count === 0)
  .map(([file]) => path.relative(root, file).replace(/\\/g, "/"))
  .sort();

const result = {
  wiki_root: root,
  markdown_files: files.length,
  isolated_count: isolated.length,
  isolated,
  broken_count: broken.length,
  broken,
  ambiguous_count: ambiguous.length,
  ambiguous,
};

console.log(JSON.stringify(result, null, 2));
