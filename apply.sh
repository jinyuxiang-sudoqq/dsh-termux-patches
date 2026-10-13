#!/usr/bin/env sh
# 把 dsh-termux-patches 应用到一份 DSH 源码上。
#
# 用法:
#   sh apply.sh /path/to/deepseek-harness-master
#
# 需要 git（用 `git apply` 才能保证补丁严格匹配）。Termux 上可先 `pkg install git`，
# 或者改用 `patch -p1 < <补丁>`（GNU patch 也能吃 unified diff，但校验更宽松）。

set -eu

REPO="${1:-}"
if [ -z "$REPO" ]; then
  echo "用法: sh apply.sh /path/to/deepseek-harness-master" >&2
  exit 2
fi
if [ ! -d "$REPO" ]; then
  echo "目录不存在: $REPO" >&2
  exit 2
fi

HERE=$(cd "$(dirname "$0")" && pwd)

# 顺序有讲究：先导入、后调用点由补丁自身保证（同一补丁内已按行号排好）。
PATCHES="
native-system-entry-src-flock.patch
native-system-entry-lib-flock.patch
session-persistence-jsonl-src-index.patch
session-persistence-jsonl-lib-index.patch
session-persistence-jsonl-src-generation.patch
"

if ! command -v git >/dev/null 2>&1; then
  echo "未找到 git。Termux: pkg install git" >&2
  echo "或改用: patch -p1 -d \"$REPO\" < patches/<名称>.patch" >&2
  exit 2
fi

for p in $PATCHES; do
  printf '%s ... ' "$p"
  if git -C "$REPO" apply --check "$HERE/patches/$p" 2>/dev/null; then
    git -C "$REPO" apply "$HERE/patches/$p"
    echo "已应用"
  elif git -C "$REPO" apply --check --reverse "$HERE/patches/$p" 2>/dev/null; then
    echo "已应用过，跳过"
  else
    echo "失败"
    echo "  上下文不匹配。多半是 DSH 版本不同——请以 files/ 下的完整文件为准手动合并。" >&2
    exit 1
  fi
done

echo
echo "补丁应用完毕。还需要覆盖 node_modules 里的原生插件替身："
echo
echo "  cp \"$HERE/files/node-addon-require-builtin-shim.js\" \\"
echo "     \"$REPO/node_modules/.pnpm/node-addon-require-builtin@<版本>/node_modules/node-addon-require-builtin/lib/index.js\""
echo
echo "启动（注意 --expose-internals 不可省略）:"
echo
echo "  cd \"$REPO\" && node --expose-internals --import tsx/esm apps/cli/src/bin.ts web --port 8080 --no-open"
echo
echo "自检: node \"$HERE/scripts/verify.mjs\" \"$REPO\""
