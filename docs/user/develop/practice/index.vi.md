# Thiết kế năng lực ba vai trò

[English](index.md) | [中文](index.zh.md) | Tiếng Việt

Trang này có hai phần: một tham chiếu khái niệm cho mẫu năng lực ba vai trò, kế đến là một tutorial nâng cao dựng một năng lực. Hoàn thành [luồng plugin cơ bản](../basic/) và [tutorial service](../framework/service.md) trước.

## Tham chiếu khái niệm

Khi một năng lực đủ tổng quát để cần các provider thay thế được, như chạy Bash, Harness tách ba vai trò: một **Service Definition**, một **Service Provider**, và một **Consumer**. Đặt các vai trò vào các package riêng khi chúng cần tiến hóa hoặc được thay thế độc lập; một package có thể sở hữu nhiều hơn một vai trò trong các trường hợp khác. Năng lực hoàn chỉnh chính là seam (khớp năng lực) của nó. Không vai trò cá nhân nào là seam.

## Ví dụ Bash

Năng lực chạy Bash gồm:

- **Service Definition** (`dsh-shell`) — định nghĩa service Cordis và các kiểu request và result của Bash
- **Service Provider** (`dsh-bash-local`) — thực thi lệnh trên máy cục bộ
- **Consumer** (`dsh-tool-bash`) — phơi năng lực như một tool model gọi được

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  dsh-shell   │────▶│  dsh-bash-local  │     │ dsh-tool-bash│
│(definition) │     │    (provider)     │     │(consumer/tool)│
└─────────────┘     └──────────────────┘     └──────────────┘
       ▲                                            │
       └────────────────────────────────────────────┘
                    inject: ['shell']
```

## Lợi ích của việc tách

### Thay thế provider

Một Service Definition có thể có nhiều provider được chọn qua `cordis.yml`:

```yaml
# Local execution
- name: '@deepseek-ai/dsh-bash-local'

# Replace this row with another package that provides the same service.
```

Service Definition và tool giữ nguyên trong khi provider đổi.

### Tiến hóa độc lập

- Service Definition hiếm đổi sau khi các caller phụ thuộc vào hợp đồng của nó.
- Các Service Provider có thể cải thiện hiệu năng và bảo mật độc lập.
- Các Consumer có thể đổi cách chúng trình bày năng lực cho model.

### Tách phụ thuộc (dependency)

- Service Provider phụ thuộc vào Service Definition.
- Consumer phụ thuộc vào Service Definition.
- Service Provider và Consumer **không phụ thuộc vào nhau**.

[Tham chiếu capability-seam](../../../capability-seams.md) sở hữu các họ tích hợp sẵn và liên kết package hiện tại.

## Tutorial: phát triển một năng lực ba vai trò

### Bước 1: viết Service Definition

```ts ignore-check
// packages/my-cap/my-cap/src/index.ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    myCap: MyCapService
  }
}

export abstract class MyCapService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myCap')
  }

  /** Execute the capability. */
  abstract execute(request: MyCapRequest): Promise<MyCapResult>
}

export interface MyCapRequest {
  input: string
}

export interface MyCapResult {
  output: string
}
```

### Bước 2: viết một Service Provider

```ts ignore-check
// packages/my-cap/my-cap-local/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { MyCapService, type MyCapRequest, type MyCapResult } from '@deepseek-ai/dsh-my-cap'

class MyCapLocal extends MyCapService {
  async execute(request: MyCapRequest): Promise<MyCapResult> {
    // Local provider behavior.
    return { output: request.input.toUpperCase() }
  }
}

export const name = 'my-cap-local'

export function apply(ctx: Context) {
  ctx.plugin(MyCapLocal)
}
```

### Bước 3: viết một consumer

```ts ignore-check
// packages/my-cap/tool-my-cap/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-my-cap'
export const inject = ['tools', 'myCap']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'my_cap',
    description: 'Execute my capability.',
    parameters: {
      input: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await ctx.myCap.execute({ input: args.input })
      return result.output
    },
  }))
}
```

### Tổ hợp chúng trong cordis.yml

```yaml
- name: '@deepseek-ai/dsh-my-cap-local'
- name: '@deepseek-ai/dsh-tool-my-cap'
```

## Các điểm thiết kế

- **Đừng tách trước tính toán** — chỉ dùng các package riêng khi các vai trò cần tiến hóa độc lập. Một plugin tool đơn giản thì không cần.
- **Service Definition sở hữu các kiểu Request/Result** — các Service Provider và Consumer chỉ phụ thuộc vào package Service Definition.
- **Rõ ràng > ngầm** — phân giải giá trị mặc định trong một bước `resolve(request): Spec` rõ ràng thay vì giấu các biểu thức `?? default` bên trong `run()`.

## Bước tiếp theo

- [LLM adapter](./llm-adapter.md) — triển khai một provider LLM
