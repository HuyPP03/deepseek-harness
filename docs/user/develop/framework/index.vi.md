# Plugin và vòng đời

[English](index.md) | [中文](index.zh.md) | Tiếng Việt

Trang này mô tả mô hình plugin Cordis và máy trạng thái vòng đời.

## Máy trạng thái Fiber

Mỗi plugin đã nạp sở hữu một scope **Fiber** với các trạng thái sau:

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED
ACTIVE → UNLOADING → DISPOSED
```

| Trạng thái | Ý nghĩa |
|------|------|
| PENDING | Đã khai báo, nhưng các dependency bắt buộc chưa sẵn sàng |
| LOADING | Dependency đã sẵn sàng và `apply` đang chạy |
| ACTIVE | Plugin đang chạy |
| FAILED | `apply` ném một lỗi |
| UNLOADING | Plugin đang unload và dispose các resource |
| DISPOSED | Plugin đã unload hoàn toàn |

## Nạp theo dependency

Một plugin có `inject` chờ mọi service bắt buộc trước khi nạp:

```ts ignore-check
export const inject = ['tools', 'llm']

export function apply(ctx: Context) {
  // ctx.tools and ctx.llm are ready here.
}
```

Nếu một service bắt buộc biến mất, ví dụ trong lúc thay thế provider, plugin tự động unload (ACTIVE → DISPOSED) và nạp lại khi service quay trở lại.

## Dọn dẹp tự động

Mọi đăng ký thực hiện qua `ctx` được đảo ngược khi plugin unload:

```ts ignore-check
export function apply(ctx: Context) {
  // Event listener: removed automatically on unload.
  ctx.on('some-event', handler)

  // Custom resource: the returned disposer runs on unload.
  ctx.effect(() => {
    const connection = createConnection()
    return () => connection.close()
  })
}
```

Framework theo dõi và dispose tất cả các thao tác này:
- `ctx.on(event, handler)` — event listener
- `ctx.tools.register(tool)` — đăng ký tool
- `ctx.llm.registerAdapter(names, adapter)` — đăng ký LLM adapter
- `ctx.effect(() => cleanup)` — resource tùy chỉnh

Trong lúc unload, việc gọi disposer bắt đầu theo thứ tự ngược của đăng ký, nhưng nhiều disposer async chạy song song và không có bảo đảm hoàn thành nối tiếp. Đặt dọn dẹp phụ thuộc thứ tự vào một disposer trả về từ một `ctx.effect()` duy nhất và await các bước của nó nối tiếp tại đó.

## Context lồng nhau

`ctx.plugin()` tạo một Fiber con kế thừa context cha nhưng có vòng đời độc lập:

```ts ignore-check
export function apply(ctx: Context) {
  // Register a child plugin.
  ctx.plugin(childPlugin)

  // The child has its own Fiber and unloads with its parent.
}
```

## Ngữ nghĩa dispose

Để dừng một instance plugin sớm:

```ts
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare function myPlugin(ctx: Context): void

const fiber = ctx.plugin(myPlugin)

// Dispose it manually later.
await fiber.dispose()
```

`dispose` bảo đảm:
1. Mọi đăng ký do plugin sở hữu được gỡ bỏ.
2. Các plugin con được unload đệ quy.
3. Promise trả về resolve sau khi mọi dọn dẹp bất đồng bộ hoàn tất.

## Thay nóng (HMR)

Khi `@deepseek-ai/cordis-plugin-hmr` được nạp từ `cordis.yml`, sửa một file nguồn plugin kích hoạt:

1. Unload plugin cũ và dọn các đăng ký của nó.
2. Nạp code mới.
3. Chạy `apply` mới.

Vì các đăng ký plugin tự dọn dẹp, thay nóng không giữ lại đăng ký nào từ instance cũ.

## Vòng đời ví dụ

```ts ignore-check
export function apply(ctx: Context) {
  console.log('plugin loading')

  ctx.effect(() => {
    console.log('effect registered')
    return () => console.log('effect cleaned up')
  })
}
```

Nạp in ra:
```
plugin loading
effect registered
```

Unload in ra:
```
effect cleaned up
```

## Bước tiếp theo

- [Service và dependency](./service.md) — phơi một năng lực cho các plugin khác
- [Hệ thống sự kiện](./events.md) — giao tiếp giữa các plugin
- [Tutorial Cordis](../../../cordis-tutorial/index.md) — cùng vòng đời, service và sự kiện được dựng từng bước với runtime Cordis
