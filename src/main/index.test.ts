import { beforeEach, describe, expect, it, vi } from 'vitest'

// electron nativeImage 是测试对象,只 stub 出 createAppIcon 用到的 4 个方法
const createFromBuffer = vi.fn()
const createFromPath = vi.fn()
const createFromDataURL = vi.fn()
const createEmpty = vi.fn()

vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer,
    createFromPath,
    createFromDataURL,
    createEmpty
  }
}))

// node:fs 也需要 stub —— 用 vi.hoisted 把 mock 函数提到 vi.mock 工厂之前,
// 这样工厂能拿到同一个引用,后续可以直接通过 fsMock.readFileSync 控制行为
const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn()
}))

vi.mock('node:fs', () => fsMock)

// PNG 文件头: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

type AppIconModule = typeof import('./app-icon')

/**
 * electron-vite 的 main config 用 Rollup 处理资源,?url import 在 dev 和打包后
 * 都返回 *相对于 main bundle* 的路径(例如 'chunks/kun-XXXX.png')。
 * main bundle 输出在 out/main/,所以运行时 __dirname = out/main/。
 * 因此 resolveAppIconPath 只需要做一件事:把相对路径 join 到 baseDir 上。
 * 这个 baseDir 在生产里是 __dirname,在测试里可以显式传入。
 */
describe('app icon loader', () => {
  let mod: AppIconModule

  beforeEach(async () => {
    vi.resetModules()
    createFromBuffer.mockReset()
    createFromPath.mockReset()
    createFromDataURL.mockReset()
    createEmpty.mockReset()
    fsMock.readFileSync.mockReset()
    // 让 mock 在被调用时返回非 undefined 的 NativeImage 占位符
    createFromBuffer.mockReturnValue({ isEmpty: () => false } as unknown as Electron.NativeImage)
    createEmpty.mockReturnValue({ isEmpty: () => true } as unknown as Electron.NativeImage)
    mod = await import('./app-icon')
  })

  describe('resolveAppIconPath', () => {
    it('joins a relative source with the provided baseDir', () => {
      const resolved = mod.resolveAppIconPath('chunks/kun-XXXX.png', '/app/bundle')
      // 路径分隔符因平台而异(Windows 是 \,其它是 /),用 toMatch 避免硬编码
      expect(resolved.replace(/\\/g, '/')).toBe('/app/bundle/chunks/kun-XXXX.png')
    })

    it('strips a leading slash before joining with baseDir (dev mode quirk)', () => {
      // Vite ?url import 在 dev 模式下会返回 '/chunks/kun-XXXX.png'(带前导斜杠)。
      // 在 Windows 上 path.isAbsolute('/foo') === true,但实际文件并不在当前盘根下,
      // 而是在 main bundle 输出目录里 —— 必须把前导斜杠剥掉,当作相对路径 join。
      const resolved = mod.resolveAppIconPath('/chunks/kun-XXXX.png', 'd:\\app\\bundle')
      expect(resolved.replace(/\\/g, '/')).toBe('d:/app/bundle/chunks/kun-XXXX.png')
    })

    it('passes an absolute source through unchanged', () => {
      const absolute = 'C:\\Users\\me\\app.asar\\kun.png'
      expect(mod.resolveAppIconPath(absolute, '/ignored')).toBe(absolute)
    })

    it('passes a data: URL through unchanged', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
      expect(mod.resolveAppIconPath(dataUrl, '/ignored')).toBe(dataUrl)
    })
  })

  describe('createAppIcon', () => {
    it('decodes a data: URL via nativeImage.createFromDataURL', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
      mod.createAppIcon(dataUrl)
      expect(createFromDataURL).toHaveBeenCalledTimes(1)
      expect(createFromDataURL).toHaveBeenCalledWith(dataUrl)
      expect(createFromBuffer).not.toHaveBeenCalled()
      expect(createFromPath).not.toHaveBeenCalled()
      expect(createEmpty).not.toHaveBeenCalled()
    })

    it('reads the file via readFileSync and passes the buffer to createFromBuffer', () => {
      const pngBytes = Buffer.concat([PNG_MAGIC, Buffer.alloc(2048, 0xab)])
      fsMock.readFileSync.mockReturnValue(pngBytes)

      const icon = mod.createAppIcon('chunks/kun-XXXX.png')

      // 关键的反向断言:createFromPath 永远不应被调用 ——
      // 旧实现 (createFromPath) 既读不了 dev server URL,也读不了 asar,
      // 才是 Windows 托盘图标消失的根因。
      expect(createFromPath).not.toHaveBeenCalled()
      expect(fsMock.readFileSync).toHaveBeenCalledTimes(1)
      const [calledPath] = fsMock.readFileSync.mock.calls[0] as [string]
      expect(calledPath.replace(/\\/g, '/')).toContain('chunks/kun-XXXX.png')

      expect(createFromBuffer).toHaveBeenCalledTimes(1)
      const buffer = createFromBuffer.mock.calls[0]?.[0] as Buffer
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.length).toBeGreaterThan(0)
      expect(buffer.subarray(0, 8).equals(PNG_MAGIC)).toBe(true)
      expect(createEmpty).not.toHaveBeenCalled()
      expect(icon).toBeDefined()
    })

    it('falls back to nativeImage.createEmpty when readFileSync throws', () => {
      fsMock.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      // 故意指向一个不存在的路径
      const icon = mod.createAppIcon('chunks/missing.png')

      expect(createEmpty).toHaveBeenCalledTimes(1)
      expect(createFromBuffer).not.toHaveBeenCalled()
      expect(createFromPath).not.toHaveBeenCalled()
      expect(icon).toBeDefined()
    })
  })

  describe('pickTrayIcon', () => {
    function fakeImage(empty: boolean): Electron.NativeImage {
      return { isEmpty: () => empty } as unknown as Electron.NativeImage
    }

    it('returns the primary (tray) icon when both are non-empty', () => {
      const tray = fakeImage(false)
      const main = fakeImage(false)
      expect(mod.pickTrayIcon(tray, main)).toBe(tray)
    })

    it('falls back to the main app icon when the tray icon is empty', () => {
      const tray = fakeImage(true)
      const main = fakeImage(false)
      expect(mod.pickTrayIcon(tray, main)).toBe(main)
    })

    it('returns the fallback when both are empty — the function does not silently promote primary', () => {
      // 两个都空时返回 fallback —— 行为简单可预测;"返回 primary 还是
      // fallback"功能上等价(都是空),但保持"primary 空就用 fallback"
      // 这条规则不破例,调用方更清楚在拿什么。
      const tray = fakeImage(true)
      const main = fakeImage(true)
      expect(mod.pickTrayIcon(tray, main)).toBe(main)
    })
  })
})
