#!/data/data/com.termux/files/usr/bin/sh
# 在 Termux 的 tmux 会话里启动 DSH。
#
# 为什么要 --expose-internals：
#   node-addon-require-builtin 是个原生插件，npm 上没有 android-arm64 的预编译包，
#   它的源码也不在 DSH 仓库里。DSH 的 vendor/Loader 里留了后门 —— 带上这个标志时
#   直接用普通 require 加载 internal/... 模块。配套的纯 JS 替身放在
#   node_modules/.pnpm/node-addon-require-builtin@0.1.9/.../lib/index.js。
#
# 建议放在 tmux 里跑：首次启动与后续构建耗时较长，前台会话被系统回收会直接中断它。
#   tmux new -s dsh -d 'sh start-dsh.sh'

set -eu

export HOME=/data/data/com.termux/files/home
export PATH=/data/data/com.termux/files/usr/bin:$PATH

REPO="${DSH_REPO:-$HOME/deepseek-harness-master}"
PORT="${DSH_PORT:-8080}"

cd "$REPO" || exit 1

exec node --expose-internals --import tsx/esm apps/cli/src/bin.ts web --port "$PORT" --no-open
