# dsh-termux-patches

让 **DeepSeek Harness 在 Android / Termux（aarch64）上跑起来**的一组兼容补丁。

DSH 目前的可发布平台是 macOS / Linux / Windows。在 Termux 上从源码运行会遇到四处
「平台假设不成立」的问题：两个 npm 原生插件没有 android-arm64 预编译包，两处文件
发布流程依赖 Android 的 `/data` 分区不支持的硬链接。这些补丁把四处问题各自绕开，
**不改变其它平台的行为**。

在一台 OPPO/ColorOS 16（Android 16、aarch64）的机器上从源码构建 DSH
`0.2.1-alpha.2`、以 `dsh web` 跑起来并完成真实对话（含会话落盘）验证通过。

---

## 四个问题分别是什么

### 1. 会话写入被 flock 挡住 → 每次「运行失败」

```
ERR_FLOCK_UNSUPPORTED_PLATFORM: flock is not supported on android-arm64
```

会话持久化（`session-persistence-jsonl`）用 `flock(fd, LOCK_EX | LOCK_NB)` 做文件锁。
`native/system` 的入口只认 `linux` / `darwin`；Termux 上 `process.platform` 是
`android`，而且 npm 上没有 `android-arm64` 的预编译二进制（C++ 源码也不在 DSH 仓库里，
手机上既装不了也编不出来）。

**处理**：新增一条 `android` 分支，直接放行锁请求。这不是发明——仓库里
`packages/experimental/webworker-runtime/src/node/external_packages/node-addon-system-flock.ts`
对单进程 worker 构建做的就是同一件事，注释写明了依据：
**JSONL 后端的进程内写入声明已经排除了所有其他写入者**。Termux 安装同样只跑一个 DSH 进程，
前提成立。

- `patches/native-system-entry-src-flock.patch`
- `patches/native-system-entry-lib-flock.patch`

### 2. `node-addon-require-builtin` 没有 android 包 → 启动即 MODULE_NOT_FOUND

DSH 的 Loader 需要拿到 Node 的 `internal/...` 模块（`internal/modules/esm/loader` 等）
来接管模块解析。上游做法是一个 N-API 原生插件；同样没有 android-arm64 预编译包。

**处理**：换成一个纯 JS 替身，走 Node 自带的后门——启动时带 `--expose-internals`，
普通 `require('internal/...')` 即可。替身导出与原生版同名同语义的三个函数
（`requireBuiltin` / `isAllowedInternalId` / `getBindingInfo`），DSH 侧无需任何改动。

- `patches/node-addon-require-builtin-shim.patch`（或直接覆盖下面那个文件）
- 配套启动脚本：`scripts/start-dsh.sh`，关键就是 `--expose-internals`

> 注意：`--expose-internals` 是**必须**的。替身在缺失该标志时会让 `require` 抛
> `MODULE_NOT_FOUND`，与原生版缺二进制的行为一致——调用方照常拿到失败，不会静默走错路。

### 3. 会话物化用硬链接发布 → `EACCES ... link`

真机上「本轮运行失败」的实际报错是这个：

```
EACCES: permission denied, link
  '…/session-<id>/session.v4.jsonl.zstd.<hash>.tmp'
  -> '…/session-<id>/session.v4.jsonl.zstd'
```

DSH 物化会话时**故意**用 `link()` 而不是 `rename()`，源码注释写得很清楚：
link 在目标已存在时返回 `EEXIST`，因此两个进程同时物化同一个 id 时不会互相覆盖，
而 `rename()` 会静默覆盖。**Android 的 `/data` 分区拒绝硬链接**，于是这一步必然失败——
会话永远不落盘，表现就是每次提问都以「本轮运行失败」结束。

**处理**：硬链接失败时回退到 `copyFile(..., COPYFILE_EXCL)`。「仅当目标不存在才创建」
这一语义完全一致：成功即本次发布生效，目标已存在时同样抛 `EEXIST`，
上层的防覆盖/冲突校验分支原样复用。

- `patches/session-persistence-jsonl-src-index.patch`（物化路径，**就是报错的那处**）
- `patches/session-persistence-jsonl-src-generation.patch`（代际发布的同类路径）

### 4. 编译产物 `lib/` 也要一起改

`session-persistence-jsonl` 与 `native/system/packages/entry` 的 `package.json`
里 `main` 指向 **`lib/`（预编译产物）**，运行时加载的是它，不是 `src/*.ts`。
只改 `src` 不会生效——这是我们在真机上白改两遍才确认的。

所以每个补丁都提供 **src 与 lib 两份**。

---

## 安装

假设 DSH 源码在 `$REPO`（例如 Termux 里的 `~/deepseek-harness-master`）。
五种改动里前四种有补丁；**原生插件替身必须先装**，否则 DSH 根本起不来。

### 第一步：装原生插件替身（必需）

```sh
cp files/node-addon-require-builtin-shim.js \
   "$REPO/node_modules/.pnpm/node-addon-require-builtin@<版本>/node_modules/node-addon-require-builtin/lib/index.js"
```

`<版本>` 按实际安装的填（本仓库验证时是 `0.1.9`）：

```sh
ls "$REPO/node_modules/.pnpm" | grep node-addon-require-builtin
```

### 第二步：应用补丁

```sh
sh apply.sh "$REPO"
```

脚本先用 `git apply --check` 校验再应用，已应用过的会跳过，上下文不匹配时会明确
报错并提示改用 `files/` 下的完整文件。等价的手工命令：

```sh
for p in patches/*.patch; do git -C "$REPO" apply "$p"; done
```

### 第三步：启动

```sh
cd "$REPO"
node --expose-internals --import tsx/esm apps/cli/src/bin.ts web --port 8080 --no-open
```

`scripts/start-dsh.sh` 是一份可直接用的启动脚本，建议放在 tmux 里跑：

```sh
tmux new -s dsh -d 'sh scripts/start-dsh.sh'
```

DSH 首次启动与后续构建耗时较长，前台会话被系统回收会直接中断它。

### 备选：直接覆盖完整文件

`files/` 下的三个文件是改好之后的**完整版本**，不依赖版本上下文，
DSH 版本与本文不同时比补丁更稳：

| `files/` 下的文件 | 覆盖到 |
|---|---|
| `native-system-entry-src-flock.ts` | `native/system/packages/entry/src/flock.ts` |
| `native-system-entry-lib-flock.js` | `native/system/packages/entry/lib/flock.js` |
| `node-addon-require-builtin-shim.js` | `node_modules/.pnpm/node-addon-require-builtin@<版本>/node_modules/node-addon-require-builtin/lib/index.js` |

后两个在 `node_modules` 里、不受版本控制，补丁覆盖不到，所以替身只能走覆盖这一步。

> 覆盖前先备份原文件。这些包更新后 `files/` 里的版本会过期。

---

## 验证

`scripts/verify.mjs` 检查上述改动是否都在位（只读，不改任何文件）：

```sh
node scripts/verify.mjs "$REPO"
```

全部就位时会逐条打印 `applied`。真机上的端到端验证是：
**发一条消息，确认回复正常，且 `$DSH_HOME/sessions/<workspace>/<session-id>/`
下出现 `session.v4.jsonl.zstd`**（补丁生效前那里只有 `.lock` 文件）。

---

## 环境参考

在一台 Android 16 / aarch64 设备上跑通的组合，供对照：

- Node.js `24.18.0`（Termux `nodejs-lts`）
- DSH `0.2.1-alpha.2`（私有 monorepo，从源码构建）
- 依赖用 npmmirror 源安装：`pnpm install --registry=https://registry.npmmirror.com`
- 需要在手机上重装依赖以获得 arm64 产物，**不能**把桌面机的 `node_modules` 拷过来
- `koffi` 在 Android Bionic 上编译失败（缺 `spawn.h`）。它只被纯 Windows 的包使用，
  可以从依赖里去掉；本组补丁不涉及它

---

## 已知限制

- **只验证过 aarch64 / Android 16 / 上述 Node 版本**。其它 ABI、其它 Android 版本
  未验证。补丁本身与架构无关（都是平台分支与文件系统语义），但请自行验证。
- **flock 补丁会让多进程并发写同一个会话失去内核级保护**。单进程使用（Termux 的常规
  形态）没有问题；如果你确实要在同一 `$DSH_HOME` 上跑多个 DSH 进程，这个补丁不适用。
- **上游更新会覆盖这些改动**。DSH 是私有仓库、以源码方式运行，`pnpm install` 或重新
  拉取源码都会把补丁冲掉。建议把本仓库的补丁脚本留好，升级后重新应用。
- 启动时仍会打印一条 `session-persistence-jsonl: failed to import` 告警。经排查它
  不影响使用（会话持久化实际工作正常，落盘验证通过）；真实原因未知，未再深究。

---

## 与上游的关系

本仓库**只包含补丁与说明**，不含 DSH 源码，也与 DeepSeek 官方无关。
所有改动的目标都是「让已有实现能在 Android 上成立」，没有改变任何对外行为：

- flock：平台上不满足前提时放行，依据是上游自己对单进程构建的同类处理
- require-builtin：语义等价替换，导出签名一致
- 硬链接回退：保留「仅当不存在才创建」的原子语义

如果上游日后为这些包提供 android 支持，本仓库即可弃用。

## License

MIT
