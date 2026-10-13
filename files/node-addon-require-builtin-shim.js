'use strict'

/**
 * `node-addon-require-builtin` 的纯 JavaScript 替身。
 *
 * 原本的实现是一个 N-API 原生插件，它绕过 Node 的模块系统去挖出 `internal/...`
 * 内部模块。问题是那个插件在 npm 上只有 darwin / linux / win32 的预编译包，
 * **没有 android-arm64**，而它的 C++ 源码也不在 DSH 仓库里，所以手机上既装不了
 * 也编不出来，DSH 启动时会直接 MODULE_NOT_FOUND。
 *
 * 好在 Node 自己留了后门：启动时带上 `--expose-internals`，普通的 `require()`
 * 就能加载 `internal/...`。这个替身只是把那三个函数包装到这条路径上，语义与原生
 * 版本一致，因此 DSH 的调用方不需要任何改动。
 *
 * 用法（手机上）：
 *   node --expose-internals --import tsx/esm apps/cli/src/bin.ts web --port 8080 --no-open
 *
 * 覆盖安装位置：
 *   node_modules/.pnpm/node-addon-require-builtin@<版本>/node_modules/
 *     node-addon-require-builtin/lib/index.js
 */

/**
 * 加载一个 Node 内置或内部模块。
 *
 * 原生版走 N-API 直取；这里走 `--expose-internals`。没有那个标志时 `require`
 * 会抛 MODULE_NOT_FOUND，与原生版缺二进制时的行为一致，调用方的 try/catch 照常生效。
 *
 * @param {string} moduleId - 例如 'internal/modules/esm/loader'。
 * @returns {unknown} 模块导出对象。
 */
function requireBuiltin(moduleId) {
  return require(moduleId)
}

/**
 * 原生版对任何输入都返回 true（连 '../../etc/passwd' 也是），它不是一个安全
 * 白名单，只是「本机有没有这个能力」的探针。这里保持同样语义。
 *
 * @returns {boolean} 恒为 true。
 */
function isAllowedInternalId() {
  return true
}

/**
 * 诊断信息。字段与原生版对齐，便于 DSH 的启动诊断打印同类内容。
 *
 * @returns {object} 绑定来源描述。
 */
function getBindingInfo() {
  return {
    mode: 'js-shim',
    product: 'require-builtin',
    backend: 'expose-internals',
    abi: null,
    exposed: process.execArgv.includes('--expose-internals'),
    node: process.versions.node,
    platform: `${process.platform}-${process.arch}`,
  }
}

const api = { requireBuiltin, isAllowedInternalId, getBindingInfo }

module.exports = api
module.exports.default = api
