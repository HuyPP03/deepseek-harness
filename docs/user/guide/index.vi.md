# Dùng Web UI

[English](index.md) | [中文](index.zh.md) | Tiếng Việt

Khởi động Web UI qua [README gốc](../../../README.vi.md#chạy); lệnh sẽ in ra URL của nó. Hướng dẫn này bắt đầu sau khi server đó đã chạy. Tiến trình `dsh` dùng thư mục nơi khởi động nó làm vị trí hệ thống tệp mặc định, nhưng một Web UI mới chưa có workspace nào được chọn cho đến khi bạn thêm.

## Cấu hình model

Mở **Settings → Models**, nhập [API key của DeepSeek](https://platform.deepseek.com/), rồi lưu. Tuyến model trở nên dùng được ngay lập tức mà không cần khởi động lại server.

[Hướng dẫn cấu hình model](./providers.md) bao quát các nhà cung cấp khác và các endpoint OpenAI tương thích tùy chỉnh.

## Chọn workspace

Nhấp **Choose workspace** để mở bộ chọn workspace. Thêm các thư mục dự án bạn muốn làm việc, rồi xác nhận: dự án bạn chọn trước hết trở thành dự án chính của session, và bạn có thể thêm tối đa hai dự án nữa làm dự án tham chiếu chỉ đọc để đối chiếu. Bạn cũng có thể bắt đầu một chat không có dự án: khi đó session chạy ở thư mục nơi bạn khởi động `dsh`. Composer của session dùng được ngay khi bạn xác nhận.

Trong khi một session đang chạy, bộ điều khiển tham chiếu trên header của session gắn và gỡ các dự án tham chiếu (trong cùng giới hạn); model nhìn thấy chúng như ngữ cảnh đối chiếu chỉ đọc từ bước kế tiếp của nó.

## Chạy một tác vụ

Khởi động một session và gửi:

> Tóm tắt repository này và xác định các package chính của nó.

Agent có thể đọc và sửa file của workspace, chạy lệnh, ủy quyền công việc, và duy trì một kế hoạch. Web UI hỏi trước các thao tác cần phê duyệt theo chính sách quyền đang hiệu lực.

## Tiếp tục

- [Cấu hình model](./providers.md)
- [Dùng Python SDK](./python-sdk.md)
- [Dùng các chế độ CLI khác](../../../apps/cli/README.md)
- [Phát triển một plugin](../develop/basic/)
