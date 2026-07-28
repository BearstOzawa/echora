# 平台架构

## 产品组成

Echora 代码库交付三个产品目标：

- Web：同一部署根据设备选择桌面或移动界面。
- Desktop：Tauri 桌面壳，使用桌面界面与原生文件、窗口和媒体能力。
- Mobile：Tauri 移动壳，使用移动界面与系统媒体、文件和生命周期能力。

Echora Cloud 是独立服务，负责账户、云端数据、在线音乐、EchoraAI 和版本登记。终端不保存官方服务密钥。

## 前端边界

```text
src/main.tsx
  -> src/platforms/uiPlatform.ts
      -> desktop/DesktopApplication.tsx
      -> mobile/MobileApplication.tsx
  -> shared application controller and domain modules
  -> platformBridge.ts / nativePlatformGateway.ts
```

桌面与移动端拥有独立的页面结构、导航、媒体控制器和样式文件。播放、歌单、会话、设置与云端会话等业务状态保持共享。平台差异通过能力接口表达，不在业务模块中直接判断窗口宽度。

## 数据边界

| 数据 | Web | 原生客户端 | Echora Cloud |
| --- | --- | --- | --- |
| 账户、歌单、收藏、设置、会话 | 会话缓存 | 离线快照与待提交更改 | 主数据 |
| 在线音乐目录与解析结果 | 临时缓存 | 临时缓存 | 聚合与解析 |
| 下载音乐 | 浏览器下载 | 应用本地目录 | 不存储 |
| 导入音乐 | 浏览器会话 | 设备本地目录 | 不存储 |
| EchoraAI 凭据 | 不保存官方密钥 | 不保存官方密钥 | 服务端保管 |
| 自定义 AI 配置 | 账户数据 | 账户数据与离线快照 | 加密保存 |

在线音乐解析请求经过 Cloud，最终音频由终端直连内容地址。Cloud 不转发持续播放流量。

## 构建目标

| 命令 | 产物 |
| --- | --- |
| `npm run build` | 自动选择界面的 Web 构建 |
| `npm run build:desktop` | 仅桌面界面的前端构建 |
| `npm run build:mobile` | 仅移动界面的前端构建 |
| `npm run client:desktop:build` | 当前桌面平台安装包 |
| `npm run client:mobile:android:build` | Android 安装包 |
| `npm run client:mobile:ios:build:simulator` | iOS 模拟器应用 |

`scripts/check-bundle-budget.mjs` 同时检查桌面与移动构建，防止平台样式和代码重新合并进同一产物。

## 原生能力

`src-tauri/src/lib.rs` 暴露文件导入、下载、媒体控制、窗口、系统托盘和平台桥接能力。Android 与 iOS 的系统集成分别位于 `src-tauri/android`、`src-tauri/ios` 以及生成的原生项目中。

浏览器请求通过 Echora Cloud 解决跨域和官方密钥保护问题；原生请求同样遵循 Cloud API 契约，避免平台之间出现不同的音乐与账户行为。
