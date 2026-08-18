# Cấu hình plugin

[English](config.md) | [中文](config.zh.md) | Tiếng Việt

Nhận cấu hình được cung cấp qua `cordis.yml`.

## Định nghĩa kiểu Config

Export một kiểu `Config` và một schema Schemastery đồng tên. Đặt giá trị mặc định trực tiếp trên các trường của schema:

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-plugin'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  console.log(config.greeting)  // User value or schema default.
}
```

Thêm cấu hình vào dòng plugin local đã insert trong `scratch-plugin/cordis.yml`:

```yaml
- insert:
    - id: hello
      name: './src/my-plugin.ts'
      config:
        greeting: 'Hi there'
        maxRetries: 5
```

Khi nạp plugin, Cordis dùng schema đã export để validate cấu hình và điền giá trị mặc định. Đừng export một object trần làm `Config`; nó không implement giao diện Standard Schema mà Cordis yêu cầu.

## Validation bằng schema

Dùng Schemastery để diễn đạt validation chặt hơn:

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'validated-plugin'

export interface Config {
  apiKey: string
  timeout: number
  mode: 'fast' | 'accurate'
}

export const Config = Schema.object({
  apiKey: Schema.string().required(),
  timeout: Schema.number().default(30000),
  mode: Schema.union(['fast', 'accurate']).default('fast'),
})

export function apply(ctx: Context, config: Config) {
  // config is validated and type-safe.
}
```

Schema chạy trong lúc plugin nạp. Cấu hình sai làm bước nạp thất bại kèm một lỗi có thể xử lý được.

## Nguyên tắc thiết kế

### Đừng hardcode giá trị có thể chỉnh

Harness yêu cầu **mọi thứ mà hai deployment có thể muốn đặt khác nhau phải là một trường cấu hình**.

```ts
// Wrong: hardcoded timeout.
const TIMEOUT = 30000

// Correct: configurable.
export interface Config {
  timeoutMs: number  // Defaults to 30000.
}
```

Tiêu chí là `cordis.yml` có thể đổi giá trị đó mà không cần sửa code.

### Lỗi lớn (fail loud) với cấu hình sai

Diễn đạt các ràng buộc tự chứa trong schema để cấu hình sai thất bại trong lúc plugin nạp. Tham chiếu các service hay tài nguyên đã đăng ký đòi hỏi dependency injection; [tutorial service](../framework/service.md) giới thiệu hợp đồng đó.

## Làm việc với HMR

Một chỉnh sửa cấu hình hot-replace plugin: framework unload instance cũ và nạp instance mới. Vì các đăng ký là effect và tự dọn dẹp, việc thay thế không giữ lại các đăng ký của instance cũ.

## Bước tiếp theo

- [Đóng gói và cài plugin](./publish.md) — phát hành plugin như một package có thể cài
- [Plugin và vòng đời](../framework/) — hiểu toàn bộ vòng đời plugin
- [Service và dependency](../framework/service.md) — cung cấp một service cho các plugin khác
