# Đóng gói và cài đặt một plugin

[English](publish.md) | [中文](publish.zh.md) | Tiếng Việt

Các tutorial trước đã nạp một plugin cục bộ qua một overlay `--patch`. Tutorial này đóng gói nó thành một **bundle** có thể cài, cài nó vào một **profile** bằng `dsh plugin add`, và giải thích thứ tự lớp quyết định cấu hình đã tổ hợp. Giả định `dsh` CLI đã được cài. Hoàn thành [cấu hình plugin](./config.md) trước.

Để dùng một bản checkout nguồn mới thay vì vậy, hoàn thành [phần chạy từ nguồn](../../../../README.vi.md#chạy-từ-nguồn), giữ nguyên thư mục `hello-plugin` của tutorial này ở gốc repo, và chạy các lệnh `dsh ...` còn lại từ đó dưới dạng `pnpm dsh ...`. Xem [chạy từ nguồn](../../../../apps/cli/reference/README.md#source-execution) cho hành vi build và launcher.

## Hai khái niệm, hai manifest

Việc cài đặt dựng trên hai khái niệm. Cả hai đều do một `package.json` mô tả, nhưng chúng mang các loại manifest khác nhau dưới key `dsh`, và trả lời những câu hỏi khác nhau:

- Một **bundle** là package npm phát hành một lớp cấu hình. Manifest của nó khai báo `dsh.bundle`, trả lời "package này đóng góp gì?": một file patch chèn hoặc ghi đè các dòng plugin.
- Một **profile** là thư mục dưới `$DSH_HOME/profiles/<name>` mô tả một bản tổ hợp có thể chạy. Manifest của nó khai báo `dsh.profile`, trả lời "những bundle nào tổ hợp nên thiết lập này, theo thứ tự gì?".

Bundle là thứ bạn viết và phân phối; profile là thứ một user khởi động bằng `dsh --profile <name>`. Không thứ nào vừa là cả hai.

### Manifest của bundle

Tạo thư mục package:

```sh
mkdir -p hello-plugin
```

```
hello-plugin/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # the layer applied when a profile lists this bundle
└── index.js           # plugin modules the patch rows reference
```

Tạo `hello-plugin/package.json`:

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

Tạo `hello-plugin/index.js` với điểm vào plugin:

```js
export const name = 'hello-plugin'

export function apply() {
  console.log('[hello-plugin] plugin loaded!')
}
```

Tạo `hello-plugin/cordis.patch.yml`. Patch là một mảng YAML giống các overlay `--patch` bạn đã viết, trừ việc các dòng plugin tham chiếu package theo tên thay vì đường nguồn tương đối để Node resolution tìm được code đã cài:

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

Một package không có khai báo `dsh.bundle` vẫn cài được, nhưng chỉ như một dependency thường: `dsh plugin` in cảnh báo và không kích hoạt lớp nào. Dùng định dạng package đó cho một library mà các plugin package import, chứ không phải một plugin để user kích hoạt.

### Manifest của profile

Thư mục profile giữ hai file:

- `package.json` — các dependency plugin ngoài cây của profile (do pnpm quản lý) cùng manifest `dsh.profile` với danh sách `bundles` có thứ tự.
- `cordis.patch.yml` — lớp patch của chính user, áp dụng sau mọi lớp bundle.

Bạn không bao giờ tự viết manifest profile: `dsh plugin` tạo và duy trì nó. Mục kế tiếp cho thấy kết quả.

## Cài vào một profile

`dsh plugin --profile <name> <args...>` chuyển tiếp sang pnpm trong thư mục profile, nên mọi động từ pnpm đều chạy được. Từ thư mục chứa `hello-plugin`, cài bản checkout package:

```sh
dsh plugin --profile demo add ./hello-plugin
```

Lần dùng đầu khởi tạo profile (với `@deepseek-ai/dsh-base` làm bundle đầu), pnpm link bản checkout, và `dsh` nối bundle vào `dsh.profile.bundles` vì package khai báo `dsh.bundle`:

```json
{
  "name": "dsh-profile-demo",
  "private": true,
  "dependencies": {
    "dsh-hello-plugin": "link:/path/to/hello-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-hello-plugin"
      ]
    }
  }
}
```

Kiểm tra lớp mà không khởi động, rồi khởi động:

```sh
dsh --profile demo --dump-config   # shows a "# == dsh-hello-plugin" layer
dsh --profile demo
```

`dsh plugin --profile demo remove dsh-hello-plugin` gỡ cả dependency lẫn lớp.

## Thứ tự nạp

Cấu hình hiệu lực tổ hợp trên một gốc rỗng bằng cách áp dụng, theo thứ tự:

1. Mỗi bundle patch được nêu trong danh sách `dsh.profile.bundles` của profile, theo thứ tự danh sách — `@deepseek-ai/dsh-base` trước, rồi từng bundle đã cài theo thứ tự được thêm.
2. `cordis.patch.yml` của chính profile.
3. `$DSH_HOME/cordis.patch.yml` cấp home — sở thích cục bộ máy dùng chung cho mọi profile.
4. Mỗi overlay `--patch <path>`, theo thứ tự argv.

Đối số lệnh không phải là một lớp patch khác. Một bundle surface có thể phân giải chúng qua một service do app sở hữu bình thường, mô tả bên dưới.

Lớp sau thắng theo từng dòng, và một patch thay thế toàn bộ giá trị `config` của dòng chứ không merge sâu các key. Hai hệ quả cho tác giả bundle:

- Patch của bạn có thể ghi đè các dòng từ lớp trước theo `id` — cùng cách [bundle `dsh-web-app`](../../../../packages/bundle/web-app/cordis.patch.yml) ghi đè các dòng `dsh-base` — nhưng phải viết lại mọi key mà dòng cần, không chỉ key đã đổi.
- User có thể ghi đè các dòng của bạn trong `cordis.patch.yml` của profile họ mà không đụng package của bạn, nên hãy ưu tiên giá trị mặc định cấu hình mà user có thể giữ lại và để schema gánh phần còn lại.

Tên bundle in-box luôn phân giải từ chính bản cài đặt dsh; pnpm chỉ quản lý các package ngoài cây, nên bundle của bạn có thể dựa vào việc `@deepseek-ai/dsh-base` có mặt và mới nhất.

## Cho một bundle surface dòng lệnh riêng

Một bundle định nghĩa một app có thể chạy sẽ gắn một plugin provider bình thường:

```yaml
- id: hello-startup
  name: 'dsh-hello-plugin/startup'
```

Plugin xuất `inject = ['cmdlineArgs']`, gọi `parseCmdline` từ [`@deepseek-ai/dsh-cmdline`](../../../../packages/boot/cmdline/README.md) với program commander của chính nó, và cung cấp service do app sở hữu từ action của program. Launcher trao cho mọi plugin cùng một tập đối số bất biến sau các flag của launcher, nên các flag riêng app không cần sửa launcher và nhiều plugin có thể parse cùng một snapshot. Dòng Loader không cần marker launcher hay dạng đặc biệt.

Các dòng được cấu hình bởi những đối số đó inject service của provider và đọc nó từ tùy chọn `!!js` của chính mình, với giá trị deployment đặt cạnh làm fallback:

```yaml
- id: my-app
  name: '@example/my-app'
  inject: [myAppStartup]
  config:
    port: !!js ctx.myAppStartup.port ?? 8080
```

Ở `--help`, provider không xuất service nào, nên các dòng đó không bao giờ kích hoạt. Loader gắn bản tổ hợp một lần, chờ các injection bình thường của từng dòng, và chỉ khi đó mới đánh giá cấu hình `!!js` của dòng đó so với context đã inject.

## Cài từ GitHub: cái bẫy script build

Xuất bản lên registry không bắt buộc — user có thể cài thẳng từ một git host:

```sh
dsh plugin --profile demo add github:you/hello-plugin
```

Nhưng một bản cài git kéo về **nguồn, không phải artifact đã build**: không gì chạy script `build` của bạn, nên một package TypeScript đến mà thiếu output `lib/` và thất bại khi nạp. Hai việc phải xảy ra, mỗi bên một:

- **Tác giả** phát hành một script `prepare` — pnpm chạy nó sau bản cài git — build các điểm vào đã phát hành từ nguồn, tự chứa: nó không được giả định ngữ cảnh chỉ dành cho dev như một bản checkout monorepo hàng xóm. [turtle-ui](https://github.com/deepseek-harness/turtle-ui) là một ví dụ chạy được: `prepare` của nó chạy một config tsdown riêng, transpile `src/` không cần project references hay type checking.
- **User** đưa build vào allowlist. pnpm ≥10 từ chối chạy script `prepare` của một git dependency cho đến khi được cho phép rõ ràng, nên `add` đầu tiên thất bại; `dsh` chỉ ra cách sửa — copy chính xác package key mà pnpm đã in vào `pnpm-workspace.yaml` của profile:

  ```yaml
  allowBuilds:
    dsh-hello-plugin: true
  ```

  rồi chạy lại `add`.

Hãy coi sự cho phép đó là đúng bản chất của nó: **quyền thực thi code của package trên máy của bạn lúc cài đặt**, bên ngoài mọi sandbox mà agent chạy. Chỉ cho phép các package mà bạn tin nguồn của chúng, và ghim một commit (`github:you/hello-plugin#<sha>`) để một push sau đó không thể âm thầm đổi thứ được chạy.

Nếu bạn không muốn hỏi user sự cho phép đó, hãy phân phối artifact đã build thay vì vậy — cả hai dạng đều không cần bất kỳ quyền build nào:

- **Xuất bản lên npm** với `lib/` được build lúc `pnpm publish`; khi đó `dsh plugin add your-package` cài code đã build sẵn.
- **Phát một tarball** từ `pnpm pack`; user chạy `dsh plugin add ./hello-plugin-0.1.0.tgz`.

## Bước tiếp theo

- [Plugin và vòng đời](../framework/) — toàn bộ vòng đời plugin
- [Tham chiếu hành vi CLI](../../../../apps/cli/reference/README.md) — thứ tự ưu tiên lớp chính xác, flag và cơ chế profile
