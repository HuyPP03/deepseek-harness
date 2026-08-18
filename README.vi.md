# DeepSeek Harness

[English](README.md) | [中文](README.zh.md) | Tiếng Việt

DeepSeek Harness (`dsh`) là harness (khung hạ tầng) agent mã nguồn mở do [DeepSeek AI](https://deepseek.com) phát triển.

Nó chạy một agent trên các dự án của bạn qua Web UI trên trình duyệt, dòng lệnh, và Python SDK. Kiến trúc là **mọi thứ đều là plugin**: mọi năng lực — công cụ, adapter model, sandbox, panel UI — đều là plugin được tổ hợp thành một deployment lúc khởi động, và cùng một bản tổ hợp chạy nguyên vẹn trên mọi giao diện.

Khung nền tảng bên dưới là [Cordis](https://github.com/cordiverse/cordis), thiết kế của nó được mô tả trong bài [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Bản xem trước cho nhà phát triển

DeepSeek Harness hiện đang ở giai đoạn _bản xem trước cho nhà phát triển_ và đang lặp lại nhanh. **SẺ CÓ NHỮNG THAY ĐỔI MẤT TƯƠNG THÍCH.**

## Những gì nó làm được

- **Làm việc trong dự án của bạn.** Một session bám vào một thư mục workspace; agent đọc và sửa file, chạy các phiên shell bền vững, và lập kế hoạch tác vụ nhiều bước ngay trên trình duyệt.
- **Đối chiếu các dự án tham chiếu chỉ đọc.** Một session có thể gắn tối đa hai thư mục dự án bổ sung làm ngữ cảnh đối chiếu chỉ đọc cho model; chat không chọn dự án nào cả là một session thường, chạy ở thư mục bạn khởi động `dsh`.
- **Đưa vào model bất kỳ.** DeepSeek hoạt động sẵn; có thể thêm Anthropic, OpenAI và mọi gateway tương thích OpenAI, kèm chọn model theo từng session.
- **Giữ quyền kiểm soát.** Chính sách quyền hỏi trước các thao tác nhạy cảm, và mỗi lần chạy bị giới hạn chạy sau một sandbox nền tảng chỉ cho phép ghi vào workspace của session.
- **Tự động hóa.** Python SDK và server Agent Client Protocol điều khiển cùng một agent đã tổ hợp từ chính code của bạn.
- **Mở rộng.** Viết plugin bằng TypeScript — công cụ, adapter model, service, panel UI — và nạp chúng qua một file tổ hợp.

## Yêu cầu

- Một API key của DeepSeek, hoặc thông tin đăng nhập của một [nhà cung cấp được hỗ trợ khác](docs/user/guide/providers.md).
- Để chạy từ `npm`: Node.js, trên Linux hoặc macOS.
- Để chạy từ nguồn: Node.js `^22.19 || >=24` và `pnpm`.
- Để dùng Python SDK: Python 3.10 trở lên trên Linux x64/arm64, hoặc macOS 14 trở lên trên arm64.

## Chạy

### Chạy từ `npm`

Cài `Node.js`, rồi chạy:

```sh
npx @deepseek-ai/dsh web
```

Lệnh này khởi động Web UI, mặc định phục vụ tại `http://127.0.0.1:3080`. Xem [hướng dẫn Web UI](docs/user/guide/index.md).

### Chạy từ nguồn

Để chạy từ một bản checkout của repo:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

### Các bước đầu tiên

Khi server đã chạy, mở **Settings → Models** và lưu API key của DeepSeek. Chọn một hoặc nhiều thư mục dự án làm workspace của session — kèm tối đa hai dự án tham chiếu chỉ đọc, hoặc không chọn dự án nào để chat thường — rồi gửi tác vụ đầu tiên. [Hướng dẫn Web UI](docs/user/guide/index.md) đi qua từng bước.

## Tài liệu

| Bắt đầu ở đây | Nội dung |
|---|---|
| [Dùng Web UI](docs/user/guide/index.md) | Cấu hình model, chọn workspace, chạy và tiếp nối session |
| [Cấu hình model](docs/user/guide/providers.md) | DeepSeek, nhà cung cấp trong danh mục, endpoint OpenAI tương thích tùy chỉnh |
| [Python SDK](docs/user/guide/python-sdk.md) | Điều khiển cùng một agent từ chương trình Python của bạn |
| [Phát triển plugin](docs/user/develop/basic/index.md) | Plugin đầu tiên, công cụ, cấu hình, xuất bản |
| [Hướng dẫn framework](docs/user/develop/framework/index.md) | Vòng đời plugin, service và hệ thống sự kiện |
| [Kiến trúc](docs/architecture.md) | Harness được tổ hợp ra sao; đọc trước khi sửa `packages/` |
| [Cordis primer](docs/cordis-primer.md) | Khung plugin mà `dsh` xây trên đó |

## Cách nó hoạt động

Ba ý tưởng gánh phần thiết kế:

- **Mọi thứ đều là plugin.** Công cụ, adapter model, sandbox và panel UI đều là plugin; bản tổ hợp `cordis.yml` quyết định một deployment nạp gì. Plugin đăng ký năng lực trên một context dùng chung, và mọi đăng ký được dọn dẹp tự động khi plugin unloads.
- **Session là một log.** Một session là log chỉ-được-phép-thêm (append-only) các sự kiện có kiểu. Resume, fork và replay dựng lại session từ log đó, và mọi thứ model nhìn được đều tái tạo được từ log.
- **Năng lực, không phải lệnh.** Một năng lực như chạy Bash được tách thành Service Definition, Service Provider và Consumer, để các triển khai thay thế được qua cấu hình.

[Tài liệu kiến trúc](docs/architecture.md) vẽ bản đồ tổ hợp theo thứ tự, và [cookbook](docs/cookbook/adding-a-package.md) hướng dẫn từng bước khi bạn thêm một package, công cụ, hoặc plugin.

## Cộng đồng và hỗ trợ

- Hãy gửi phản hồi hoặc báo bug qua [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Thêm topic [`dsh-plugin`](https://github.com/topics/dsh-plugin) cho repo plugin của bạn để dễ được tìm thấy.
- Tham gia <a href="https://discord.gg/Ycq5dCaS4">cộng đồng Discord của DeepSeek Harness</a>.

## Đóng góp

Xem [CONTRIBUTING.md](CONTRIBUTING.md).

## Phát triển

Bắt đầu với [hướng dẫn phát triển](docs/development.md) và [tài liệu kiến trúc](docs/architecture.md).

Với các agent, làm theo [AGENTS.md](AGENTS.md).

## Giấy phép

[MIT](LICENSE)

Các dependency bên thứ ba và giấy phép của chúng được công bố trong [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
