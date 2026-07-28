<div align="center">
  <img src="public/brand-mark.svg" width="72" height="72" alt="Echora" />
  <h1>Echora</h1>
  <p>跨 Web、桌面与移动端的音乐发现、播放与 AI 编排应用。</p>
  <p>
    <a href="https://echora-web.lili.uno">Web 应用</a>
    · <a href="https://echora-cloud.lili.uno">产品网站</a>
    · <a href="docs/platform-architecture.md">技术架构</a>
    · <a href="https://github.com/BearstOzawa/echora-cloud">云端服务</a>
  </p>
  <p>
    <a href="https://github.com/BearstOzawa/echora/actions/workflows/ci.yml"><img src="https://github.com/BearstOzawa/echora/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  </p>
</div>

## 关于 Echora

Echora 将跨平台音乐发现、个人收藏、播放队列与自然语言编排整合在一套应用中。用户可以从搜索、精选、榜单或本地音乐开始播放，也可以直接描述场景、节奏和偏好，由音乐场生成并持续调整队列。

账户、歌单、收藏、设置和会话由 Echora Cloud 管理；下载、导入音乐和播放缓存保留在设备上。原生客户端在离线时仍可使用本地音乐、已下载内容和最近的账户快照。

## 核心体验

| 能力 | 说明 |
| --- | --- |
| 发现 | 聚合搜索、精选、榜单和音乐平台内容，统一进入播放与收藏流程 |
| 编排 | 通过 EchoraAI 或自定义 AI，根据意图、时长和能量变化生成队列 |
| 播放 | 提供队列、歌词、音质、播放速度、音效和系统媒体控制 |
| 音乐库 | 管理收藏、歌单、本地音乐、下载内容与离线播放 |
| 多端账户 | 在 Web、桌面和移动端使用同一账户数据，并保留原生端离线能力 |

在线音乐解析由 Echora Cloud 发起，终端获得可播放地址后直接连接内容源。Cloud 不转发持续音频流量。

## 产品组成

| 产品 | 职责 |
| --- | --- |
| Echora Web | 面向桌面和移动浏览器的在线应用 |
| Echora Desktop | 提供本地音乐、下载、系统托盘和桌面媒体能力 |
| Echora Mobile | 提供移动布局、系统媒体会话、文件导入和离线播放 |
| Echora Cloud | 提供账户、在线音乐、EchoraAI、官网与版本管理 |

桌面与移动端拥有独立的导航和交互结构，共享播放、歌单、账户与音乐场等核心业务能力。

## 平台状态

| 平台 | 状态 |
| --- | --- |
| Web | 已部署，支持桌面与移动浏览器 |
| macOS | 客户端可构建，正式安装包发布链路已建立 |
| Android | 客户端可构建与调试，正式安装包发布链路已建立 |
| iOS | 支持模拟器验证，正式签名与分发暂未启用 |

项目处于 `0.1.x` 开发阶段。数据模型和客户端接口在正式版前可能调整。

## 开发

前端开发需要 Node.js 22。原生客户端还需要 Rust stable 和对应平台 SDK。

```bash
git clone https://github.com/BearstOzawa/echora.git
cd echora
npm ci
npm run dev
```

固定平台入口：

```bash
npm run dev:desktop
npm run dev:mobile
```

默认连接生产 Echora Cloud。本地联调时，在 `.env.development.local` 设置：

```bash
VITE_ECHORA_CLOUD_URL=http://127.0.0.1:8787
```

## 原生构建

```bash
# macOS
npm run client:desktop:dev
npm run client:desktop:build

# Android
npm run client:mobile:android:init
npm run client:mobile:android:dev

# iOS
npm run client:mobile:ios:init
npm run client:mobile:ios:dev
```

Android 使用 JDK 17 和 NDK `27.2.12479018`。iOS 构建依赖 Xcode；没有开发者签名时可以运行模拟器版本。

## 架构与质量

React 应用按桌面和移动端拆分界面层，Tauri 提供文件、下载、媒体会话、窗口和系统集成。平台边界、数据归属与构建目标见 [平台架构](docs/platform-architecture.md)。

提交前运行：

```bash
npm test
npm run build
npm run build:desktop
npm run build:mobile
npm run performance:budget
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

`main` 分支由 GitHub Actions 验证。版本标签会生成 macOS 与 Android 安装包草稿，正式发布后由 Echora Cloud 接管版本策略。

## 参与项目

开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请通过 GitHub Security Advisories 私下报告，处理范围见 [SECURITY.md](SECURITY.md)。

## 许可证

项目尚未发布开源许可证。在许可证确定前，仓库内容仅供查看，不授予复制、修改或再分发权利。
