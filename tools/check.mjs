#!/usr/bin/env node
/**
 * 零依赖静态检查（本项目的 "typecheck"）：
 *  1. 语法：对每个源文件跑 node --check。
 *  2. 导入路径：相对 import 必须真实存在于磁盘。
 *  3. 属性遮蔽：实例属性名不得与同类的原型方法/getter 同名——
 *     否则 constructor / reset 里的一次赋值会静默地把方法覆盖成 null 值。
 *     这正是本项目踩过两次的缺陷类型（HUD.banner、Renderer.hitStop）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : (extname(full) === '.js' ? [full] : []);
});

const files = walk(SRC);
const problems = [];

// ── 1. 语法 ────────────────────────────────────────────────
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    const msg = err.stderr?.toString().split('\n').slice(0, 6).join('\n') || err.message;
    problems.push(`[syntax] ${file.replace(ROOT + '/', '')}\n${msg}`);
  }
}

// ── 2. 导入路径 ────────────────────────────────────────────
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"](\.[^'"]+)['"]/g;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const target = resolve(dirname(file), m[1]);
    try {
      statSync(target);
    } catch {
      problems.push(`[import] ${file.replace(ROOT + '/', '')} → 找不到 ${m[1]}`);
    }
  }
}

// ── 3. 属性遮蔽 ────────────────────────────────────────────
/** 从 startIndex 的 '{' 开始，返回配对的 '}' 下标 */
function matchBrace(text, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const CLASS_RE = /class\s+([A-Za-z_$][\w$]*)\s*(?:extends\s+[\w$.]+\s*)?\{/g;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const cls of text.matchAll(CLASS_RE)) {
    const bodyStart = cls.index + cls[0].length - 1;
    const bodyEnd = matchBrace(text, bodyStart);
    if (bodyEnd < 0) continue;
    const body = text.slice(bodyStart + 1, bodyEnd);

    // 原型成员：方法、getter/setter（缩进 2 空格起，避免匹配到嵌套语句）
    const members = new Set();
    for (const m of body.matchAll(/^\s{2}(?:static\s+)?(?:get\s+|set\s+|async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) {
      if (m[1] !== 'constructor' && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while') members.add(m[1]);
    }

    // 构造函数体内的 this.x = 赋值
    const ctorIdx = body.search(/\bconstructor\s*\(/);
    if (ctorIdx >= 0) {
      const braceIdx = body.indexOf('{', ctorIdx);
      const ctorEnd = matchBrace(body, braceIdx);
      if (ctorEnd > 0) {
        const ctor = body.slice(braceIdx, ctorEnd);
        for (const m of ctor.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*=/g)) {
          if (members.has(m[1])) {
            problems.push(
              `[shadow] ${file.replace(ROOT + '/', '')} · class ${cls[1]}: 实例属性 this.${m[1]} 与同类方法/访问器同名，构造时会把方法覆盖掉`,
            );
          }
        }
      }
    }
  }
}

if (problems.length) {
  console.error(`\n✖ 检查未通过（${problems.length} 项）\n`);
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}

console.log(`✔ 检查通过：${files.length} 个源文件 · 语法 / 导入路径 / 属性遮蔽`);
