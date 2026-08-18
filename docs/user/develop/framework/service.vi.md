# Service và dependency

[English](service.md) | [中文](service.zh.md) | Tiếng Việt

Một service là một năng lực mà một plugin phơi ra cho các plugin khác. `inject` khai báo các service mà một plugin đòi hỏi.

## Service là gì?

Trong Harness, `tools`, `llm` và `agents` là các service. Mỗi cái là một năng lực có tên được gắn lên `ctx`:

```ts ignore-check
ctx.tools    // ToolRuntime service
ctx.llm      // LLM service
ctx.agents   // Agent service
```

Bất kỳ plugin nào cũng có thể cung cấp một service để các plugin khác dùng.

## Dùng một service

Khai báo `inject` để dùng một service có sẵn:

```ts ignore-check
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools exists and is ready here.
  ctx.tools.register(/* ... */)
}
```

Khi `apply` chạy, mọi service do `inject` khai báo đều sẵn sàng. Nếu một service chưa sẵn sàng, plugin chờ thay vì chạy.

## Cung cấp một service

### Kế thừa Service

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  // Public service method.
  record(event: string, value: number) {
    // ...
  }
}
```

Sau khi nạp plugin này, các bên dùng tiếp cận service dưới dạng `ctx.metrics`:

```ts ignore-check
export const inject = ['metrics']

export function apply(ctx: Context) {
  ctx.metrics.record('tool_call', 1)
}
```

### Khai báo kiểu của nó

Dùng declaration merging của TypeScript để kiểu hóa `ctx.metrics`:

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) { /* ... */ }
}
```

## Hành vi dependency

### Dependency bắt buộc và tùy chọn

```ts ignore-check
// Required: the plugin does not load while the service is absent.
export const inject = ['tools']

// Optional: omit inject and query with ctx.get() at the use site.
export function apply(ctx: Context) {
  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)
}
```

### Khi một service biến mất

Nếu một service bắt buộc biến mất trong khi ứng dụng đang chạy, ví dụ vì provider của nó unload:

1. Các plugin phụ thuộc tự động dispose.
2. Chúng nạp lại khi service quay trở lại.

Điều này ngăn một plugin gọi một service không còn tồn tại.

## Cách ly service

`cordis.yml` có thể cách ly các service để các nhóm plugin riêng biệt nhìn thấy các instance riêng của cùng một service:

```yaml
- id: group-a
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 5000
    - name: './src/plugin-a.ts'

- id: group-b
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 60000
    - name: './src/plugin-b.ts'
```

`plugin-a` và `plugin-b` mỗi cái nhìn thấy instance Bash trong nhóm của chính nó, không có ảnh hưởng xuyên nhóm.

## Service tích hợp sẵn của Harness

Repo sinh các tên service, phương thức công khai và vị trí nguồn vào [trang subsystem](../../../subsystems/core.md) của từng service. Dùng các vùng được sinh đó và giao diện TypeScript của service khi phát triển plugin; đừng duy trì một danh sách tĩnh thứ hai.

## Bước tiếp theo

- [Hệ thống sự kiện](./events.md) — giao tiếp giữa các plugin không ghép chặt
- [Tầng hóa năng lực](../practice/) — dùng service như các giao diện năng lực
