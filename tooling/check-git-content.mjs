// Check publication scope and secrets without printing matching values.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === '--staged') ||
  (args.length === 2 && args[0] === '--tree'), 'Usage: check-git-content.mjs [--staged | --tree REV]');
const staged = args[0] === '--staged';
const git = (...args) => {
  const r = spawnSync('git', args, { windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr?.toString()); return r.stdout;
};
const tree = args[0] === '--tree' ? git('rev-parse', '--verify', `${args[1]}^{tree}`).toString().trim() : null;
const files = [...new Set((tree ? git('ls-tree', '-r', '-z', '--name-only', tree)
  : git('ls-files', '-z', ...(staged ? ['--cached'] : ['--cached', '--others', '--exclude-standard'])))
  .toString().split('\0').filter(Boolean))];
const forbidden = [
  ['local assistant tooling', /(^|\/)(?:skills|stack-plugins|\.agents|\.codex|\.claude|\.claude-plugin|\.codex-plugin)(\/|$)|(^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$|(^|\/)(?:plugin|marketplace|mcp)\.json$/i],
  ['local administration or reference cache', /^(?:\.repo-[^/]+\/|tooling\/\.github\/|tooling\/(?:github-repository\.mjs|git-scan-allowlist\.json)$|research\/(?:git-workflow\.md|handoff\.md|plugin-status\.md|sources\/|security\/(?:sources\/|skill-installation\.json$))|web\/(?:evidence\/project-renamed\.png$|server-(?:output|error)\.(?:txt|log)$))/i],
  ['private or installed path', /(^|\/)(?:\.testnet|node_modules|\.cargo|\.rustup|\.npm-cache)(\/|$)|\.(?:pczt|age|db|sqlite)(?:-.*)?$|(^|\/)keys\.toml$|(^|\/)\.env(?:\.|$)/i],
  ['local working notes', /^(?:TASKS\.md|brand\/previous-naming\.md|research\/(?:account-recovery|direct-exchange-design|ecosystem-and-privacy|initial-assessment|integration-inventory|language-feasibility|offline-web-plan|ownership-and-settlement|prerequisites|private-proof-statement|product-thesis|witness-delivery)\.md|research\/security\/(?:binance-aave|campaign-register|security-model)\.md)$/i],
];
const patterns = [
  ['saved prompt field', /(?:^|[\r\n])\s*["']?(?:(?:style|system|assistant|developer|user)[_-]prompt(?:[_-](?:short|full))?|prompt[_-](?:short|full))["']?\s*:/i],
  ['PEM private key', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['age secret key', /AGE-SECRET-KEY-[A-Z0-9]{40,}/],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{35,})/],
  ['NEAR secret key', /ed25519:[1-9A-HJ-NP-Za-km-z]{80,100}/],
  ['AWS access key', /(?:AKIA|ASIA)[A-Z0-9]{16}/],
  ['assigned credential', /["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret[_-]?key|private[_-]?key|mnemonic)["']?\s*[:=]\s*["'][^"'\r\n]{24,}["']/i],
  ['shared conversation link', /https:\/\/(?:claude\.ai\/share|chatgpt\.com\/share|chat\.openai\.com\/share|g\.co\/gemini\/share)\/[^\s)"<>]+/i],
  ['conversation working note', /\b(?:the\s+user\s+(?:asked|requested|chose|resumed|confirmed|wanted|explicitly)|user['’]s\s+(?:continuation\s+prompt|request|stated\s+goal)|interrupted\s+chat|previous\s+chat|preceding\s+chat|in\s+this\s+chat|this\s+continuation|project\s+handoff)\b/i],
  ['assistant direction', /\b(?:apply|use)\s+(?:the\s+)?[a-z][a-z0-9-]*\s+skill\s+(?:to|for)|<\|(?:im_start|im_end|system|assistant|developer)\|>|send_user_message_question[_]reply|<environment[_]context>|in-app-browser[-]context/i],
];
const localPath = /[A-Z]:[\\/]+Users[\\/]+[A-Za-z0-9_. -]+[\\/]|\/(?:Users|home)\/[A-Za-z0-9_.-]+\/|<user-home>[\\/]+(?:Documents|Desktop)[\\/]+/i;
const findings = [];
let bytes = 0;
for (const file of files) {
  for (const [rule, pattern] of forbidden) {
    if (pattern.test(file) && !(rule === 'private or installed path' && /\.env\.(example|sample)$/.test(file))) findings.push({ file, rule });
  }
  // Read exact bytes; decoding binary Git blobs first would corrupt the scan.
  const buffer = tree ? git('cat-file', 'blob', `${tree}:${file}`) : staged ? git('show', `:${file}`) : await readFile(file);
  bytes += buffer.length;
  if (buffer.length > 50 * 1024 * 1024) findings.push({ file, rule: 'large artifact' });
  // Compiler strings can expose machine paths inside binary artifacts too.
  if (localPath.test(buffer.toString('latin1'))) findings.push({ file, rule: 'local machine path' });
  // Embedded strings in binary assets need the same publication checks.
  const content = buffer.toString('utf8');
  for (const [rule, pattern] of patterns) {
    for (const match of content.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))) {
      // RPC receipts contain public signatures of the same encoded length as secret keys.
      if (rule === 'NEAR secret key' && /(?:\\?"|')signature(?:\\?"|')\s*:\s*(?:\\?"|')$/.test(content.slice(Math.max(0, match.index - 45), match.index))) continue;
      findings.push({ file, rule, line: content.slice(0, match.index).split('\n').length });
    }
  }
}
console.log(JSON.stringify({ mode: tree ? 'tree' : staged ? 'staged' : 'working', tree, files: files.length, bytes, findings }, null, 2));
if (findings.length) process.exitCode = 1;
