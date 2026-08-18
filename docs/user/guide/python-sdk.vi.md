# Bắt đầu với Python SDK

[English](python-sdk.md) | [中文](python-sdk.zh.md) | Tiếng Việt

Bài học này là phương án thay thế bằng chương trình của Web UI. Nó cài Python SDK đã phát hành, chạy một bản tổ hợp agent được kiểm tra vào repo, và chỉ cách gọi cùng một API từ chương trình của chính bạn.

## Tiền đề

- Python 3.10 trở lên
- Git
- Linux x64, Linux arm64, hoặc macOS 14 trở lên trên arm64
- Một endpoint API tương thích DeepSeek và thông tin đăng nhập
- Một workspace biệt lập mà agent được phép sửa

## Cài SDK

Clone repo để lấy ví dụ chạy được, tạo môi trường ảo, và cài SDK cùng runtime đóng gói đồng bản version:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install deepseek-harness-sdk
```

Runtime đã cài không cần Node.js hệ thống. Người đóng góp repo cần build runtime hoặc wheels từ nguồn nên dùng [luồng làm việc cho người đóng góp Python](../../../python/development.md).

## Chạy ví dụ được kiểm tra vào repo

Đặt thông tin đăng nhập vào môi trường. Đặt thêm `DEEPSEEK_BASE_URL` khi model được phục vụ bởi một proxy tương thích OpenAI thay vì endpoint DeepSeek mặc định.

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
# export DSH_MODEL=deepseek-v4-flash
# export DSH_SYSTEM_PROMPT='You are a helpful software engineer assistant.'
```

Chạy một tác vụ trên một workspace và thư mục session biệt lập:

```sh
python examples/jsonrpc-agent/minimal.py \
  --workspace /absolute/path/to/workspace \
  --session-root /absolute/path/to/sessions \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

Script in phản hồi assistant cuối cùng. Thư mục session nhận một log JSONL chứa các yêu cầu model đã tổ hợp và các cuộc gọi tool.

## Dùng SDK trong chương trình của bạn

Ví dụ được kiểm tra vào repo là một lớp bọc mỏng quanh cuộc gọi SDK này:

```python
from pathlib import Path

from deepseek_harness import DeepSeekHarness

config = Path("examples/jsonrpc-agent/minimal.cordis.yml").resolve()
workspace = Path("/absolute/path/to/workspace").resolve()
sessions = Path("/absolute/path/to/sessions").resolve()

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

`DeepSeekHarness` khởi động runtime đóng gói một cách trì hoãn và tái dùng nó cho đến khi thoát context manager. Tái dùng cùng một harness và session id giữ nguyên tiến trình Bash do session sở hữu, bao gồm thư mục làm việc, các biến đã export và các hàm shell. Dùng một session id mới cho tác vụ độc lập; chỉ tái dùng id khi cuộc gọi kế tiếp nên tiếp nối cùng một hội thoại bền vững.

## Hiểu bản tổ hợp của ví dụ

| Thuộc tính | Giá trị |
|---|---|
| System prompt | `DSH_SYSTEM_PROMPT`, rơi về `You are a helpful software engineer assistant.` |
| Model trong `minimal.py` | `--model`, rồi `DSH_MODEL`, rồi `deepseek-v4-flash` |
| Tool model có thể gọi | Chỉ `bash` bền vững và `str_replace_editor` |
| Timeout của Bash | 300 giây |
| Giới hạn output của editor | 16.000 ký tự |
| Nén ngữ cảnh (compaction) | Tắt |
| Filesystem | backend local trần; đường dẫn tuyệt đối của editor có thể trỏ mọi đường nhìn thấy được từ tiến trình runtime |
| Lưu bền session | JSONL không nén dưới `DSH_SESSION_ROOT` |

Bản tổ hợp bỏ qua identity của harness, văn bản prompt của workspace, skills, Bash one-shot, các tool tác vụ, compaction và mọi plugin model thấy được khác. Các sự kiện chính sách sandbox được ghi như ngữ cảnh user của runtime thay vì nối vào system prompt.

## Chọn workspace và session ID

`cwd` chọn workspace có sẵn cho agent, còn `session_root` lưu log và trạng thái của session. Dùng một session id mới cho tác vụ độc lập; chỉ tái dùng id khi cuộc gọi kế tiếp nên tiếp nối cùng hội thoại và cùng trạng thái shell bền vững.

Bản tổ hợp dùng `danger-full-access`. Chỉ chạy nó trong một checkout hay container dùng một lần: Bash và editor có thể sửa mọi đường được phép cho tiến trình runtime. Backend PTY bền vững cần một nền terminal POSIX, nên bản tổ hợp này không hỗ trợ agent Windows.

[Tham chiếu ví dụ `jsonrpc-agent`](../../../examples/jsonrpc-agent/README.md) sở hữu bản tổ hợp chính xác. [Tham chiếu Python SDK](../../../python/sdk/README.md) bao phủ vòng đời, kết quả, thông báo, chọn runtime và cấu hình; [bài nhập môn Cordis](../../cordis-primer.md) bao phủ cú pháp tổ hợp.
