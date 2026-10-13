/** Lazy POSIX flock entry; importing it does not load a native addon. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { getSystemErrorName } from 'node:util'

interface FlockBinding {
  tryLock(fd: number, callback: (errno: number) => void): void
}

let binding: FlockBinding | undefined

function loadBinding(): FlockBinding {
  if (binding) return binding
  const { platform, arch } = process
  // Patched for Android/Termux: process.platform is "android", which the upstream
  // guard below rejects, and no android-arm64 prebuilt addon exists.
  // Termux runs a single DSH process and the JSONL backend's in-process write claim
  // already excludes every writer, so granting the lock locally is the same trade the
  // webworker build makes (see packages/experimental/webworker-runtime/src/node/
  // external_packages/node-addon-system-flock.ts). Other platforms keep the native binding.
  if (platform === 'android') {
    binding = {
      tryLock: (_fd: number, callback: (errno: number) => void) => {
        queueMicrotask(() => callback(0))
      },
    } as unknown as FlockBinding
    return binding
  }

  if (platform !== 'linux' && platform !== 'darwin') {
    throw Object.assign(new Error(`flock is not supported on ${platform}-${arch}`), {
      code: 'ERR_FLOCK_UNSUPPORTED_PLATFORM',
      syscall: 'flock',
    })
  }

  let filename = 'system.node'
  if (platform === 'linux') {
    // Node's report types omit the libc field supplied by Linux reports.
    const report = process.report.getReport() as { header: { glibcVersionRuntime?: string } }
    filename = join(report.header.glibcVersionRuntime ? 'glibc' : 'musl', filename)
  }
  const require = createRequire(import.meta.url)
  const manifest = require.resolve(`@deepseek-ai/node-addon-system-${platform}-${arch}/package.json`)
  binding = require(join(dirname(manifest), 'bin', filename)) as FlockBinding
  return binding
}

/**
 * Attempt an exclusive, nonblocking POSIX flock on the caller's descriptor.
 * The syscall runs in asynchronous work, so acquisition can occur after this
 * call returns. Keep fd open until the promise settles; the binding never
 * opens, duplicates, or closes it. Closing the locked descriptor releases the
 * lock once all descriptors for its open file description are closed.
 * @param fd - Open file descriptor to lock; ownership remains with the caller.
 * @returns A promise resolving to void on acquisition. Contention rejects with
 *   EAGAIN/EWOULDBLOCK; other syscall failures also reject. Syscall errors carry
 *   code, positive errno, and syscall='flock'. Native setup errors, unsupported
 *   platforms, and addon loading failures reject; importing alone does not load it.
 */
export async function tryLockExclusive(fd: number): Promise<void> {
  const errno = await new Promise<number>((resolve) => {
    loadBinding().tryLock(fd, resolve)
  })
  if (errno === 0) return
  throw Object.assign(new Error(`${getSystemErrorName(errno)}: flock`), {
    code: getSystemErrorName(errno),
    errno,
    syscall: 'flock',
  })
}
