import fs from 'node:fs';
import path from 'node:path';

const roots = [
  'src',
  'server',
  'docs',
  'README.md',
  'README.zh-CN.md',
].map((entry) => path.resolve(process.cwd(), entry));

const skippedDirs = new Set([
  '.git',
  'dist',
  'dist-server',
  'node_modules',
  'coverage',
  '.cache',
]);

const textFilePattern = /\.(?:tsx?|jsx?|mjs|cjs|json|md|css|html?)$/i;

const suspiciousPatterns = [
  {
    name: 'replacement character',
    pattern: /\uFFFD/u,
  },
  {
    name: 'latin-1 mojibake fragment',
    pattern: /(?:\u00E2[\u0080-\u00BF]|\u00C3[\u0080-\u00BF])/u,
  },
  {
    name: 'common Chinese mojibake fragment',
    pattern: /[\u951B\u9428\u9352\u6D63\u5A32\u9225\u4F99\u6B7F\u93C6\u6434\u9A9E\u95BF\u95F8\u95B8\u95EA\u704F\u935C\u9365\u6FEF\u95B7\u93B4\u8F70\u934B\u9435\u9418\u93C6\u7027\u6D7C\u7B17\u95C5\u93C9\u60D7\u58A0\u599D\u891D\u934A\u95AB\u7D09\u93CC\u59DD\u7EAD\u9422\u9A9E]/u,
  },
  {
    name: 'common mojibake token',
    pattern: /(?:\u9239\u20AC|\u93C6\u6682|\u7027\u7845|\u934A\u53D9|\u95AB\u95C6|\u7D09\u9E3F|\u93CC\u67E9|\u59DD\u8A4E|\u7EAD\u60E7|\u9422\u5997|\u6FE1\u65AF|\u9A9E\u6D38)/u,
  },
];

function walk(entry) {
  if (!fs.existsSync(entry)) return [];
  const stat = fs.statSync(entry);
  if (stat.isDirectory()) {
    if (skippedDirs.has(path.basename(entry))) return [];
    return fs.readdirSync(entry).flatMap((child) => walk(path.join(entry, child)));
  }
  return textFilePattern.test(entry) ? [entry] : [];
}

const findings = [];

for (const filePath of roots.flatMap((root) => walk(root))) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const matched = suspiciousPatterns.find(({ pattern }) => pattern.test(line));
    if (matched) {
      findings.push({
        filePath: path.relative(process.cwd(), filePath),
        line: index + 1,
        reason: matched.name,
        text: line.trim().slice(0, 180),
      });
    }
  }
}

if (findings.length > 0) {
  console.error('Potential mojibake text found:');
  for (const finding of findings) {
    console.error(`${finding.filePath}:${finding.line}: [${finding.reason}] ${finding.text}`);
  }
  process.exit(1);
}

console.log('No mojibake patterns found.');
