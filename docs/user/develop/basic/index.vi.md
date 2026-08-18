# Plugin đầu tiên của bạn

[English](index.md) | [中文](index.zh.md) | Tiếng Việt

Bài học này tạo một plugin Harness tối thiểu và nạp nó vào Web UI. Bắt đầu từ một bản checkout repo đã hoàn tất [luồng chạy từ nguồn](../../../../README.vi.md#chạy-từ-nguồn).

## Tạo một project cục bộ

Từ gốc repo, tạo một project nháp cho bài học:

```sh
mkdir -p scratch-plugin/src
```

## Plugin là gì?

Trong Harness, một plugin là module TypeScript xuất một hàm `apply`. Framework gọi `apply` khi nạp plugin và truyền qua một object context `ctx` để plugin đăng ký các năng lực:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // Register capabilities here.
}
```

Đó là toàn bộ cấu hình.

## Tạo file plugin

Tạo `scratch-plugin/src/my-plugin.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'

export function apply(ctx: Context) {
  // Required dependencies are ready before apply runs.
  console.log('[hello-plugin] plugin loaded!')
}
```

## Đăng ký nó trong cordis.yml

Chạy `pwd` từ gốc repo, rồi tạo `scratch-plugin/cordis.yml` như một Web overlay chèn plugin cục bộ. Thay `/absolute/path/to/deepseek-harness` bên dưới bằng đường được in ra:

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
```

Đường plugin phải tuyệt đối. Một file patch đóng góp cấu hình nhưng không đổi thư mục profile mà loader phân giải đường module.

Khởi động Web UI với overlay đó:

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

Mở `http://127.0.0.1:3080`. Terminal in `[hello-plugin] plugin loaded!` trong khi khởi động.

## Dọn dẹp tự động

Mọi thứ được đăng ký qua `ctx` — listener sự kiện, tool, hoặc timer — được dọn dẹp khi plugin unloads. Bạn không cần gọi removeListener hay clearInterval tay.

Với một resource cần dọn dẹp rõ ràng, như một kết nối mạng, dùng `ctx.effect()` để cung cấp disposer của nó:

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('heartbeat')
    }, 5000)

    // The returned function runs when the plugin unloads.
    return () => clearInterval(timer)
  })
}
```

## Khai báo dependency

Nếu plugin dùng một service khác như `tools` hay `llm`, khai báo nó trong `inject`:

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools is ready here.
  ctx.tools.register(/* ... */)
}
```

Framework chờ mọi service bắt buộc trước khi nạp plugin.

## Ba dạng plugin

Ngoài dạng hàm, một plugin có thể dùng dạng object hoặc class.

### Dạng object

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) {
    // ...
  },
}
```

### Dạng class

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, 'myService')
    // Perform synchronous initialization in the constructor.
  }
}
```

Dạng hàm đủ trong hầu hết trường hợp. Dùng dạng class khi plugin cung cấp một service cho các plugin khác; xem [service và dependency](../framework/service.md).

## Bước tiếp theo

- [Xây một tool](./tool.md) — học DSL định nghĩa tool
- [Cấu hình plugin](./config.md) — nhận cấu hình từ người dùng
- [Tutorial Cordis](../../../cordis-tutorial/index.md) — khung plugin bên dưới, dựng từ một thư mục nháp không cần API key
