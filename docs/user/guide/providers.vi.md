# Cấu hình model

[English](providers.md) | [中文](providers.zh.md) | Tiếng Việt

Hướng dẫn này giả sử bạn đã khởi động Web UI qua [README gốc](../../../README.vi.md#chạy). Thay đổi model hiệu lực từ yêu cầu kế tiếp mà không cần khởi động lại server.

## Cấu hình DeepSeek

Mở **Settings → Models**. Thẻ DeepSeek phơi ra một trường API key; nhập key và lưu.

![Trang Models: thẻ DeepSeek, bên dưới là Add provider và Add a custom provider](providers-models-page.png)

Key là write-only. Trang nhận về một mô tả đã che (redacted) sau khi lưu, không bao giờ là bí mật gốc. Key được lưu trong `$DSH_HOME/.credentials.yaml`, còn settings chỉ giữ tham chiếu credential của nó.

## Thêm một nhà cung cấp trong danh mục

Chọn **Add provider**, chọn một nhà cung cấp như Anthropic hoặc OpenAI, nhập API key của nó và lưu. Danh mục đã cài cấp sẵn endpoint, giao thức và danh sách model.

Các nhà cung cấp có xác thực bản địa cần thông tin đăng nhập bản địa của họ. Bedrock, Vertex, Azure và Codex lần lượt dùng credential AWS kèm region, một dự án ADC, một `api-version` và OAuth; chỉ điền trường API key sẽ không cấu hình được chúng.

## Thêm một nhà cung cấp tùy chỉnh

Chọn **Add a custom provider** cho gateway của công ty, server tự host, hoặc nhà cung cấp vắng mặt khỏi danh mục đã cài. Cung cấp một Provider ID viết thường, base URL, giao thức API, credential và ít nhất một model.

![Mẫu nhà cung cấp tùy chỉnh: Provider ID, display name, base URL, giao thức API và API key](providers-custom-form.png)

Provider ID là vĩnh viễn vì các yêu cầu, session đã lưu, model mặc định và tham chiếu credential đều dùng nó. Để đổi tên một nhà cung cấp, thêm nhà cung cấp mới và xóa cái cũ. Display name, base URL, giao thức, credential và các model vẫn sửa được.

Trong **Model catalog**, chọn **Fetch available models** để truy vấn base URL và credential hiện đang hiển thị trong mẫu. Chọn các ứng viên sẽ cập nhật bản nháp; nhà cung cấp không được lưu cho đến khi bạn lưu. Nhà cung cấp danh mục dùng danh mục đã cài mà không có yêu cầu mạng.

### Nhận ảnh đầu vào

Một model bạn nhập tay được xem là chỉ-text cho đến khi có khai báo khác, vì không gì có thể hỏi endpoint chấp nhận modalities nào. Gắn một ảnh vào model như vậy sẽ bị từ chối trước khi gửi, kèm tên model.

Một model vision trên nhà cung cấp tùy chỉnh vì thế cần một dòng. Mẫu không có trường cho nó; thêm `input` vào model trong `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input` chấp nhận `text` và `image`, và chỉ áp dụng cho riêng model đó, nên một route có thể phục vụ cả hai loại. Bỏ nó — hoặc viết danh sách rỗng, nghĩa như nhau — giữ lại những gì danh mục đã cài ghi cho model đó, và rơi về `defaultInput` của route cho model mà danh mục không mô tả.

Nếu mọi model bạn nhập tay đều nhận ảnh, hãy đặt fallback một lần trên route thay vì trên từng model:

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput` là fallback chứ không phải override, và mặc định là `[text]`: trên nhà cung cấp danh mục nó chỉ trả lời cho các model mà danh mục không mô tả, nên không bao giờ tước ảnh của một model danh mục vốn có. Muốn thu hẹp một model như vậy, dùng `input` riêng của model đó. Nhà cung cấp danh mục không có danh sách `models` để đặt nó, nên viết trong `modelOverrides`, theo key id của model:

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

Mọi danh sách phải nêu ít nhất một modality, trừ riêng `input` của model, nơi danh sách rỗng nghĩa như bỏ. Một modality không biết bị từ chối ở bất cứ đâu nó được viết.

Cả hai trường là một tuyên bố về endpoint của bạn chứ không phải kiểm tra nó. Một model khai báo ảnh mà endpoint không phục vụ sẽ không bị bắt ở đây; provider sẽ từ chối yêu cầu thay vào đó.

## Chọn một model

Các nhà cung cấp đã cấu hình xuất hiện trong bộ chọn model. Chọn một model cũng làm nó thành mặc định cho các session mới. Một session đã gửi yêu cầu giữ model được ghi trong log của chính nó.

Nếu một mặc định đã lưu trỏ đến nhà cung cấp đã bị xóa, composer hiển thị **Select model** và chặn nhập cho đến khi chọn model khác.

## Xử lý sự cố

- **`MISSING_CREDENTIAL`** — Lưu key của nhà cung cấp qua trang Models hoặc cung cấp biến môi trường được tham chiếu.
- **`UNKNOWN_MODEL`** — Chọn một model đã cấu hình hoặc thêm model thiếu vào nhà cung cấp tùy chỉnh.
- **Fetch available models trả về 401** — Kiểm tra key. Khám phá model gọi endpoint `GET /models` tương thích OpenAI; nhập model tay cho các endpoint không có.
- **Một ảnh bị từ chối trước khi gửi** — Model không khai báo modality ảnh. Cho model của nhà cung cấp tùy chỉnh `input: [text, image]`; route chat-completions của chính DeepSeek là chỉ-text và không cấu hình khác được.
- **Nhà cung cấp từ chối một yêu cầu kèm ảnh** — Model khai báo ảnh mà endpoint thực tế không phục vụ. Bỏ `image` khỏi danh sách đã cấp nó — `input` của model hoặc `defaultInput` của route — rồi khởi động một session mới: ảnh đã gắn vẫn nằm trong log của session, nên cùng yêu cầu lặp lại cho đến khi session chuyển khỏi nó.

## Cấu hình nâng cao

[Danh mục cấu hình plugin](../../config-catalog.md) do sinh ra liệt kê mọi trường và giá trị mặc định được hỗ trợ. Tham chiếu của [`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md) và [`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.md) sở hữu cấu hình `settings.yaml` trực tiếp, phân giải danh mục, điều khiển reasoning, credential và lỗi adapter.
