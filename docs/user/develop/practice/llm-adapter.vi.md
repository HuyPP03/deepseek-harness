# LLM adapter

[English](llm-adapter.md) | [中文](llm-adapter.zh.md) | Tiếng Việt

Hướng dẫn này nối một provider LLM mới vào Harness.

## Tổng quan

Một LLM adapter kế thừa `LlmAdapter` và implement `stream()`, dịch request không phụ thuộc provider của Harness thành một cuộc gọi API provider và dịch phản hồi ngược lại thành các chunk của Harness.

## Triển khai tối thiểu

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class MyAdapter extends LlmAdapter {
  private apiKey: string

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. Convert options.messages to the provider format.
    // 2. Call the streaming API.
    // 3. Convert the response into StreamChunk values.
  }
}

export interface Config {
  apiKey: string
  providers: string[]
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().required(),
  providers: Schema.array(Schema.string()).required(),
})

export const name = 'my-llm-adapter'
export const inject = ['llm']

export function apply(ctx: Context, config: Config) {
  const adapter = new MyAdapter(config.apiKey)
  ctx.llm.registerAdapter(config.providers, adapter)
}
```

## Giao thức StreamChunk

`stream()` yield các chunk theo giao thức này:

```ts
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'

async function* exampleChunks(): AsyncIterable<StreamChunk> {
  // 1. Start each content block with block-start.
  yield { type: 'block-start', index: 0, blockType: 'text' }

  // 2. Stream text through text-delta.
  yield { type: 'text-delta', index: 0, text: 'Hello' }
  yield { type: 'text-delta', index: 0, text: ' world' }

  // 3. End each content block with block-end and the complete block.
  yield {
    type: 'block-end',
    index: 0,
    block: { type: 'text', text: 'Hello world' },
  }

  // 4. Tool-call block.
  yield { type: 'block-start', index: 1, blockType: 'tool-call' }
  yield {
    type: 'tool-call-delta',
    index: 1,
    id: CallId('call-123'),
    name: 'bash',
    argumentsDelta: '{"command":"ls"}',
  }
  yield {
    type: 'block-end',
    index: 1,
    block: {
      type: 'tool-call',
      id: CallId('call-123'),
      name: 'bash',
      arguments: '{"command":"ls"}',
    },
  }

  // 5. Token usage.
  yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }

  // 6. Finish reason.
  yield { type: 'finish', reason: { kind: 'stop' } }
  // Alternatively, { kind: 'tool-calls' } requests tool execution.
}
```

### Quy tắc chính

- Mọi `block-start` có một `block-end` khớp.
- `index` tăng từ 0 và nhận diện thứ tự của các khối nội dung.
- Một `tool-call-delta` mang text JSON thô trong `argumentsDelta`, hoặc một lần hoặc qua nhiều chunk.
- `finish` là chunk cuối.
- Phát `usage` trước `finish`.

## GenerateOptions

`stream()` nhận kiểu `GenerateOptions` đã export. Nó bao gồm model, id reasoning-effort do adapter sở hữu, lịch sử hội thoại, system prompt, các schema tool, tham số sinh, stop sequence và abort signal; coi kiểu TypeScript do `@deepseek-ai/dsh-llm` export là chuẩn. Map các trường được hỗ trợ sang API provider. Nếu provider không thể đáp ứng một trường, hãy ném `LlmError` với một mã ổn định thay vì âm thầm bỏ rơi nó.

Override `resolveModel(provider, model, signal?)` để trả về bản dạng provider/model chính xác cùng metadata `context` và `reasoning` tùy chọn trong một lần tra cứu. Metadata reasoning chứa các id mờ (opaque) có thứ tự và tên hiển thị cùng một mặc định đã cấu hình tùy chọn; giữ lại danh sách có thể chọn chuẩn của adapter, gồm cả `off` khi API năng lực upstream của nó trả về giá trị đó, thay vì nâng các giá trị đó thành một enum lõi. Đáp ứng signal tùy chọn cho tra cứu bất đồng bộ để hủy và dispose đạt trạng thái tĩnh. Service validate tổ hợp và từ chối các effort tường minh không hỗ trợ trước `stream()`; bỏ `reasoning` nghĩa là model đó không có năng lực reasoning-effort có thể chọn.

## Đăng ký một adapter

```ts ignore-check
ctx.llm.registerAdapter(['my-provider'], adapter)
```

Đối số đầu liệt kê các tuyến provider do adapter xử lý. `GenerateOptions.provider` chọn adapter đã đăng ký, trong khi `GenerateOptions.model` truyền một model id do adapter sở hữu mà không cần đăng ký vòng đời. Override `listModels()` khi adapter có thể quảng bá các lựa chọn model cho các bộ chọn.

## Dùng từ cordis.yml

```yaml
- id: my-llm
  name: './src/my-llm-adapter.ts'
  config:
    apiKey: !!js process.env.MY_API_KEY
    providers:
      - my-provider

- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  config:
    agents:
      - id: main
        provider: my-provider
        model: my-model-v1
```

## Các triển khai tham chiếu

Repo chứa các triển khai hoàn chỉnh:

- `packages/llm/llm-deepseek/` — adapter API DeepSeek dùng định dạng OpenAI tương thích
- `packages/llm/llm-pi-ai/` — adapter Pi AI dùng một định dạng API khác

So sánh hai adapter đã phát hành để thấy cùng một hợp đồng harness được implement trên các SDK provider khác nhau.

## Xử lý lỗi

Adapter ném các sự cố transport và protocol thành các giá trị `LlmError` với các mã ổn định. Agent loop giữ nguyên lỗi và mã cho chẩn đoán và chính sách; nó không tự động chuyển một `Error` thường. Mọi request HTTP của provider cũng phải merge `attributionHeaders()` và chuyển tiếp `options.signal`.

```ts
import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class HttpAdapter extends LlmAdapter {
  constructor(private readonly endpoint: string) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({ model: options.model, messages: options.messages }),
      ...options.signal ? { signal: options.signal } : {},
    })
    if (!response.ok) {
      throw new LlmError(`Provider API error: ${response.status}`, 'PROVIDER_HTTP_ERROR')
    }
    // A real adapter parses the response and emits the complete chunk sequence.
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
```
