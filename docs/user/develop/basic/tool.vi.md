# Xây một tool

[English](tool.md) | [中文](tool.zh.md) | Tiếng Việt

Tutorial này thêm một tool `greet` vào Web UI. Hoàn thành [Plugin đầu tiên](./) trước và giữ nguyên thư mục `scratch-plugin` của nó.

## Tạo plugin tool

Thay `scratch-plugin/src/my-plugin.ts` bằng:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

`inject` khiến Cordis chờ tool registry. `defineTool` suy ra và validate `args` từ `parameters`; `execute` trả về giá trị chính tắc (canonical) do `output.schema` khai báo, và `output.render` chuyển giá trị đó thành nội dung cho model.

## Chạy và gọi tool

Khởi động lại lệnh phát triển nếu nó chưa chạy:

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

Mở `http://127.0.0.1:3080` và hỏi: `Use the greet tool to greet Ada.` Model có thể gọi `greet` và nhận `Hello, Ada!` làm kết quả tool.

## Bước tiếp theo

- [Cấu hình plugin](./config.md) — làm cho lời chào cấu hình được.
- [Tham chiếu viết tool](../../../cookbook/adding-a-tool.md) — tra cứu schema lồng nhau, giá trị chính tắc, công việc nền, policy hook, Code Mode và thẻ UI.
- [Tầng hóa năng lực](../practice/) — tách một năng lực thay thế được thành package Service Definition, Service Provider và Consumer.
