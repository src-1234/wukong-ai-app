# 悟空 · AI 工作平台（Android）

钉钉生态风格的 AI 工作助手安卓客户端：**免密钥、免 Token、装完即用**。

## 下载安装
- APK：`悟空-AI工作平台-v1.1.0.apk`（v1 + v2 签名，Android 5.0+）
- 直接下载后安装即可，无需注册、无需填写任何 API Key。

## 功能
- **AI 问答**：流式打字机输出，标准 / 高级（推理加强）两档
- **对话历史**：登录后按会话列表回溯，点开即跳回当时的问答界面
- **新建对话**：右上「脑子+」一键回到首页
- **图片解读**：`+` 调系统相册，本机先做图像特征解析（主色 / 亮度 / 尺寸构图）再交给模型给建议
- **模型切换**：`⚡` 打开模型面板，当前免密钥通道开放 GPT-OSS 20B
- **登录**：邮箱 / 手机号（验证码倒计时）/ 钉钉扫码（App 内离线生成二维码）
- **本地持久化**：会话存于手机本地，不上传

## 免密钥实现说明
客户端直连公开免密钥模型通道 `https://text.pollinations.ai/openai`（OpenAI 兼容 SSE）。
匿名免费额度为 **每 IP 每 45 秒 1 次**，触发限流时 App 会自动排队并在气泡里显示倒计时。
若要无限额/更快，需要一把后端密钥或自建中转；把中转地址给我即可替换。

## 技术栈
Java + WebView 原生桥（`MainActivity.java`）：
- 流式 SSE 解析 → `evaluateJavascript` 增量推给前端
- ZXing 离线生成登录二维码
- 相册选图 → 压缩 → 前端 canvas 取色分析
- 返回键拦截，交给页面路由处理

## 构建
```bash
# JDK 17 + Android SDK 34
./gradlew assembleRelease
```
签名库不在仓库内（避免私钥外泄），正式发版请使用自己的 keystore。

## 目录
```
app/src/main/java/com/wukong/ai/MainActivity.java   WebView 容器 + JS 桥
app/src/main/assets/                                界面（index.html / app.css / app.js）
app/src/main/res/                                   图标与主题
```
