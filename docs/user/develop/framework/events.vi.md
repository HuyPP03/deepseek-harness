# Hệ thống sự kiện

[English](events.md) | [中文](events.zh.md) | Tiếng Việt

Sự kiện là cơ chế giao tiếp cốt lõi giữa các plugin Cordis. Harness dùng chúng rộng rãi cho các điểm mở rộng ghép lỏng.

## Dùng cơ bản

### Lắng nghe một sự kiện

```ts ignore-check
ctx.on('event-name', (payload) => {
  // Handle the event.
})
```

### Phát một sự kiện

```ts ignore-check
ctx.emit('event-name', payload)
```

## Các chế độ sự kiện

Cordis cung cấp một số chế độ sự kiện cho các hợp đồng tương tác khác nhau.

### emit — phát sóng

Mọi listener chạy đồng bộ và các giá trị trả về bị bỏ qua:

```ts ignore-check
// Emit
ctx.emit('my-plugin/ready', { id: 'worker-1' })

// Listen
ctx.on('my-plugin/ready', ({ id }) => {
  console.log(`${id} is ready`)
})
```

### bail — ngắt sớm

Listener chạy theo thứ tự; kết quả đầu tiên khác `null`, `false` hay `undefined` trở thành kết quả cuối:

```ts ignore-check
// Dispatch
const result = ctx.bail('some-check', input)

// Listen: a returned value stops later listeners.
ctx.on('some-check', (input) => {
  if (shouldBlock(input)) return 'blocked'
  // Return null, false, or undefined to continue to the next listener.
})
```

### serial — thực thi có thứ tự

Listener chạy theo thứ tự đăng ký và các kết quả bất đồng bộ được await. Kết quả đầu tiên khác `null`, `false` hay `undefined` dừng việc thực thi tiếp:

```ts ignore-check
await ctx.serial('setup-phase', context)
```

### waterfall — ống dẫn (pipeline)

Mỗi listener có thể bọc kết quả phía hạ nguồn để tạo một chuỗi xử lý. Một listener **phải gọi `next()` để ủy quyền xuống hạ nguồn**; thiếu lời gọi là ngắt sớm pipeline:

```ts ignore-check
// Dispatch
const output = await ctx.waterfall('my-plugin/transform', input, async () => input)

// Listen: next() is mandatory.
ctx.on('my-plugin/transform', async (_input, next) => {
  const downstream = await next()
  return downstream.trim()
})
```

::: warning
Một listener waterfall **phải gọi `next()`**. Thiếu nó là ngắt sớm pipeline theo thiết kế, cho phép hành vi chặn (interception) và cổng (gateway).
:::

## Sự kiện có kiểu

Harness dùng declaration merging của TypeScript cho các sự kiện an toàn kiểu:

```ts
import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}

// ctx.on('my-plugin/ready', ...) and ctx.emit('my-plugin/ready', ...)
// are now inferred correctly.
```

## Sự kiện Cordis và bản ghi session

Các sự kiện Cordis của Harness dùng tên `namespace/action`, gồm `agent/step`, `agent/request`, `agent/request-error`, `tools/result` và `session/event`. Các vùng `cordis-surface` được sinh trên [các trang subsystem](../../../subsystems/core.md) ghi lại các chữ ký và chế độ hoàn chỉnh.

`turn/*`, `step/*`, `tool/call`, `tool/result` và `compaction/*` là các kiểu session-event bền vững, không phải các sự kiện Cordis đồng tên. Để quan sát chúng, hãy lắng nghe `session/event` và kiểm tra `event.type`.

## Listener sự kiện là effect

Một listener được đăng ký bằng `ctx.on()` được gỡ tự động khi plugin của nó unload:

```ts ignore-check
export function apply(ctx: Context) {
  // This listener is removed when the plugin disposes.
  ctx.on('tools/result', handler)
}
```

## Ví dụ: plugin ghi log

Plugin này ghi log các cuộc gọi tool và kết quả:

```ts
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    console.log(`[tool] ${exec.name}(${JSON.stringify(exec.arguments)})`)
    const text = result.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    console.log(`[tool result] ${text.slice(0, 100)}`)
  })
}
```

## Bước tiếp theo

- [Tầng hóa năng lực](../practice/) — hiểu các sự kiện bên trong các giao diện năng lực
- [LLM adapter](../practice/llm-adapter.md) — triển khai một backend LLM hoàn chỉnh
