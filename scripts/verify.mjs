// 只读自检：确认 dsh-termux-patches 的改动是否都在位。
//
// 用法: node verify.mjs /path/to/deepseek-harness-master
//
// 不修改任何文件；逐条打印 applied / NOT-APPLIED / missing。

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const repo = process.argv[2]
if (!repo) {
  console.error('用法: node verify.mjs /path/to/deepseek-harness-master')
  process.exit(2)
}
if (!existsSync(repo)) {
  console.error(`目录不存在: ${repo}`)
  process.exit(2)
}

/** 在 node_modules/.pnpm 里按前缀找实际安装的版本目录。 */
function findAddonShim() {
  const pnpm = join(repo, 'node_modules', '.pnpm')
  if (!existsSync(pnpm)) return null
  const dir = readdirSync(pnpm).find((n) => n.startsWith('node-addon-require-builtin@'))
  if (!dir) return null
  return join(pnpm, dir, 'node_modules', 'node-addon-require-builtin', 'lib', 'index.js')
}

const shimPath = findAddonShim()

const CHECKS = [
  {
    id: 'flock 支持 android（src）',
    file: 'native/system/packages/entry/src/flock.ts',
    marker: "platform === 'android'",
  },
  {
    id: 'flock 支持 android（lib）',
    file: 'native/system/packages/entry/lib/flock.js',
    marker: "platform === 'android'",
  },
  {
    id: '会话物化：硬链接回退（src）',
    file: 'packages/session/session-persistence-jsonl/src/index.ts',
    marker: 'COPYFILE_EXCL',
  },
  {
    id: '会话物化：硬链接回退（lib）',
    file: 'packages/session/session-persistence-jsonl/lib/index.js',
    marker: 'COPYFILE_EXCL',
  },
  {
    id: '代际发布：硬链接回退（src）',
    file: 'packages/session/session-persistence-jsonl/src/generation.ts',
    marker: 'COPYFILE_EXCL',
  },
  {
    id: '原生插件替身（node_modules）',
    file: shimPath,
    marker: 'js-shim',
  },
  {
    id: '启动脚本带 --expose-internals',
    file: 'scripts/start-dsh.sh',
    marker: 'expose-internals',
    optional: true,
  },
]

let failed = 0
for (const c of CHECKS) {
  if (!c.file) {
    console.log(`  missing      ${c.id}  (没找到 node-addon-require-builtin 安装目录)`)
    if (!c.optional) failed += 1
    continue
  }
  const abs = join(repo, c.file)
  if (!existsSync(abs)) {
    console.log(`  missing      ${c.id}  -> ${c.file}`)
    if (!c.optional) failed += 1
    continue
  }
  const text = readFileSync(abs, 'utf8')
  if (text.includes(c.marker)) {
    console.log(`  applied      ${c.id}`)
  } else {
    console.log(`  NOT-APPLIED  ${c.id}  -> ${c.file}`)
    if (!c.optional) failed += 1
  }
}

console.log()
if (failed === 0) {
  console.log('全部就位。启动: node --expose-internals --import tsx/esm apps/cli/src/bin.ts web --port 8080 --no-open')
} else {
  console.log(`${failed} 项未就位。若补丁因版本差异打不上，请以 files/ 下的完整文件为准。`)
  process.exit(1)
}
