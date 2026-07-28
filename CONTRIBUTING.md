# 贡献指南

## 开始之前

- 功能与修复应同时考虑 Web、桌面和移动端的行为边界。
- 不要提交第三方服务密钥、账户数据、下载音乐、签名文件或构建产物。
- 涉及产品交互的修改应提供桌面与移动端的验证说明。

## 本地验证

```bash
npm ci
npm test
npm run build:desktop
npm run build:mobile
npm run performance:budget
cargo check --manifest-path src-tauri/Cargo.toml
```

原生平台修改还应在对应平台完成实际运行验证。Android 使用 JDK 17 和 NDK `27.2.12479018`；iOS 构建依赖 Xcode。

## 提交要求

- 一个提交只处理一个明确主题。
- 行为变化必须补充或更新测试。
- 不以 CSS 覆盖堆叠代替组件或布局问题的修复。
- 新增平台能力时，先扩展能力接口，再接入具体平台实现。

提交 Pull Request 时说明影响的平台、验证命令和仍未覆盖的风险。
