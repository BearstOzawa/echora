# Echora

Echora 是面向 Web、桌面与移动端的音乐应用。它将在线音乐、本地音乐、播放管理与 AI 编排统一在同一套产品体验中。

- Web：[echora-web.lili.uno](https://echora-web.lili.uno)
- 官网与账户：[echora-cloud.lili.uno](https://echora-cloud.lili.uno)
- 云端服务：[BearstOzawa/echora-cloud](https://github.com/BearstOzawa/echora-cloud)

## 产品能力

- 搜索、发现、精选、榜单、歌单、收藏与播放队列
- 通过对话生成并调整音乐编排
- Web、桌面和移动端使用各自的交互界面，共享核心业务能力
- 账户、歌单、收藏、设置和会话保存在 Echora Cloud
- 桌面与移动客户端支持本地音乐、下载和离线播放
- 支持 EchoraAI，也支持用户配置自己的 AI 服务
- 桌面媒体控制、系统托盘、移动端媒体会话与应用快捷入口

## 平台状态

| 平台 | 界面 | 当前状态 |
| --- | --- | --- |
| Web | 桌面与移动浏览器 | 可部署 |
| macOS | Tauri 桌面客户端 | 可构建 |
| Android | Tauri 移动客户端 | 可构建与调试 |
| iOS | Tauri 移动客户端 | 支持模拟器验证，正式签名发布尚未启用 |

在线音乐解析由 Echora Cloud 发起，音频地址返回后由终端直接播放。下载与导入的音乐保存在设备本地，不上传至账户。原生客户端在离线时可继续使用本地音乐、已下载内容和账户快照。

## 开发

需要 Node.js 22。构建原生客户端时，还需要 Rust stable 和对应平台的原生 SDK。

```bash
npm ci
npm run dev
```

固定界面入口：

```bash
npm run dev:desktop
npm run dev:mobile
```

常用验证：

```bash
npm test
npm run build:desktop
npm run build:mobile
npm run performance:budget
cargo check --manifest-path src-tauri/Cargo.toml
```

默认连接生产 Echora Cloud。本地联调时，在 `.env.development.local` 中设置：

```bash
VITE_ECHORA_CLOUD_URL=http://127.0.0.1:8787
```

## 原生客户端

```bash
npm run client:desktop:dev
npm run client:desktop:build

npm run client:mobile:android:init
npm run client:mobile:android:dev

npm run client:mobile:ios:init
npm run client:mobile:ios:dev
```

Android 需要 JDK 17、Android SDK 与 NDK `27.2.12479018`。iOS 需要 Xcode；没有开发者签名时仍可构建模拟器版本。

## 项目结构

```text
src/                  React 应用、业务状态与平台界面
src/platforms/        桌面与移动端界面入口
src/components/       共享交互组件
src-tauri/            桌面与移动端原生能力
scripts/              构建、图标和稳定性工具
docs/                 架构与维护文档
```

架构边界见 [docs/platform-architecture.md](docs/platform-architecture.md)。

## 贡献与安全

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 中的方式私下报告，不要公开提交包含凭据、个人数据或可复现攻击细节的 Issue。

## 许可证

项目尚未发布开源许可证。在许可证确定前，仓库内容仅供查看，不授予复制、修改或再分发权利。
