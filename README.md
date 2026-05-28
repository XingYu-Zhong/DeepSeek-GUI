<p align="center">
  <img src="src/asset/img/deepseek.png" width="96" alt="DeepSeek GUI 图标">
</p>

# DeepSeek GUI

[English](./README.en.md) | 简体中文

> 把 CodeWhale 的本地智能体能力带进桌面窗口：**Code** 写代码、**Write** 写文档、**Claw** 接 IM 自动化——聊天、审查改动、管理 Skill/MCP 和更新，都在一个图形化工作台里完成。

[官网](https://deepseek-gui.com) | [下载](https://deepseek-gui.com)

[![GitHub release](https://img.shields.io/github/v/release/XingYu-Zhong/DeepSeek-GUI?label=github)](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases)
[![License](https://img.shields.io/github/license/XingYu-Zhong/DeepSeek-GUI)](./LICENSE)

DeepSeek GUI 是一个面向开发者和高频 AI 工作者的本地桌面工作台。它基于 [CodeWhale](https://github.com/Hmbown/CodeWhale) 的能力，把终端里的智能体体验整理成更容易上手、更适合长期使用的应用：选择工作目录，发起任务，实时查看推理、工具调用和文件改动，并在需要时审批或回退。

这个项目的目标不是再造一个聊天壳，而是让 DeepSeek 变成一个可以稳定参与真实项目工作的桌面伙伴。

---

<p align="center">
  <img src="src/asset/img/code.gif" alt="Code 模式演示" width="49%" style="max-width: 100%;">
  <img src="src/asset/img/write.gif" alt="Write 模式演示" width="49%" style="max-width: 100%;">
</p>

## 我们做了什么

- 把 CodeWhale 的本地运行时封装进桌面应用，默认可以自动启动和管理。
- 做了一套完整的聊天工作台，支持多会话、实时流式输出、历史回看、中断和重新发送。
- 打通本地工作目录，让智能体可以围绕真实项目读取、编辑和创建文件。
- 做了文件变更审查视图，让每一次修改都能被看见、理解和确认。
- 做了首次引导、设置页、语言/主题/字体大小、系统通知、错误日志和更新入口。
- 做了 Skill 与 MCP 的图形化管理，让用户不用手写很多配置也能扩展智能体能力。
- 做了 Claw 后台自动化，支持飞书 / Lark 接入、独立 IM Agent、本地 webhook / relay 和定时任务。
- 做了 Write 写作工作台，提供独立写作空间、Markdown 文件树、live 编辑/预览、文本补全和选中文本 inline agent。
- 提供 macOS、Windows 预构建安装包；Linux/Unix 用户可从源码自行构建。

## 功能亮点

- **桌面聊天工作台**：多会话、流式回复、推理过程、工具调用、审批请求和文件改动都在同一个界面中展示。
- **项目级工作区**：为每个任务选择本地目录，按工作区管理会话，并支持文件预览、编辑器打开和 Git 分支选择。
- **变更审查**：内联 diff 和侧边审查面板会记录智能体产生的文件改动，便于在应用内完成 review。
- **权限可控**：支持只读、工作区可写、完全访问等模式，并可配置工具调用前是否需要审批。
- **运行时托管**：默认使用内置 CodeWhale；也可以在设置中指定自己的 `codewhale` 可执行文件。
- **Skill 与 MCP**：在图形界面中创建 Skill、保存 MCP 配置、添加常用工具，并打开对应目录继续管理。
- **Claw 后台自动化**：可开启独立于普通聊天的后台 Agent，当前支持飞书 / Lark 接入、IM webhook / relay，以及按计划自动执行任务。
- **Write 写作模式**：独立管理 `~/.deepseekgui/write_workspace` 和自定义写作空间，读取 Markdown 文件树，支持 live Markdown 编辑、相对图片预览、DeepSeek FIM 短补全 / 灵感长补全（可用跨文本 BM25 + 关键词检索增强）、当前文档导出为 `HTML / PDF / DOC / DOCX`，以及选中文本后直接唤起 inline 写作助手。
- **首次配置友好**：首次启动会引导你选择语言、填写 DeepSeek API Key，并按需配置兼容服务地址。
- **本地优先**：设置、会话状态、日志和运行时配置保存在本机；模型调用使用你自己的 DeepSeek API Key。
- **中英文界面**：应用和 README 均提供中文、英文版本，界面语言可随时切换。
- **跨平台使用**：提供 macOS `.dmg/.zip`、Windows `.exe`；Linux/Unix 用户可从源码构建。

## 适合谁

- 想用 DeepSeek 处理真实代码库，但不想一直留在终端里的开发者。
- 希望清楚看到智能体做了什么、改了哪些文件、哪些操作需要批准的团队。
- 需要长期维护多个项目、多个会话，并希望把 Skill/MCP 配置沉淀下来的用户。
- 想用本地工作台连接 DeepSeek 官方 API 或 OpenAI 兼容服务的人。

---

## 三种工作台模式

DeepSeek GUI 在左侧顶栏提供 **Code**、**Write**、**Claw** 三种模式，分别面向代码开发、长文写作和后台自动化。三种模式共享同一套 DeepSeek 运行时与设置，但会话、工作区和界面布局彼此独立，可按任务随时切换。

### Code 模式

面向真实代码库的开发工作台：绑定本地项目目录，围绕仓库读写文件、执行命令、审查改动。

<p align="center">
  <img src="src/asset/img/codemode.png" alt="DeepSeek GUI Code 模式" width="860">
</p>

- 按工作区管理多个 Agent 会话，实时查看推理、工具调用与文件变更。
- 支持内联 diff、变更审查面板，以及只读 / 工作区可写 / 完全访问等权限策略。
- 提供快捷任务卡片，可一键发起结构梳理、排错、实现方案或 UI 优化等对话。

### Write 模式

独立的 Markdown 写作工作台，把写作文件、保存状态与 AI 助手从 Code 会话里拆出来单独管理。

<p align="center">
  <img src="src/asset/img/writemode.png" alt="DeepSeek GUI Write 模式" width="860">
</p>

- 管理 `~/.deepseekgui/write_workspace` 与多个自定义写作空间，左侧文件树支持新建、重命名与删除。
- 编辑器支持 **Live / Source / Split / Preview**，Live 模式在当前行保留 Markdown 源码，其余行实时渲染。
- 工具栏支持把当前 Markdown 文档导出为 `HTML / PDF / DOC / DOCX`，导出时会尽量保留标题、列表、代码块、表格和本地图片。
- 内置 DeepSeek FIM 短补全与灵感长补全；选中文本可唤起 inline agent，右侧写作助手支持摘要、大纲与润色等快捷操作。

### Claw 模式

后台自动化与 IM 接入工作台，让 Agent 在普通聊天之外持续处理消息与定时任务。

<p align="center">
  <img src="src/asset/img/clawmode.png" alt="DeepSeek GUI Claw 模式" width="860">
</p>

- 为飞书 / Lark 等渠道配置独立 Agent，分别设定人设、默认模型与工作目录。
- 每个 IM Agent 拥有独立会话线程，可在 GUI 内直接调试回复与工具调用。
- 支持本地 webhook / relay 与定时任务，适合把 DeepSeek 接到团队协作或自动化流程中。

---

## 下载安装

### 下载预构建安装包

前往 [GitHub Releases](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases) 下载最新版本：

| 平台 | 安装包 |
| --- | --- |
| macOS | `.dmg` 或 `.zip`，支持 Intel 与 Apple Silicon |
| Windows | `.exe`，NSIS 安装器，x64 |

目前暂不提供 Linux/Unix 预构建下载包。Linux 用户可以从源码自行构建；由于应用内终端依赖 `node-pty` 原生模块，请在 Linux 平台上构建 Linux 包，不建议在 macOS 或 Windows 上交叉打包 Linux 版本。

首次启动时需要填写 [DeepSeek API Key](https://platform.deepseek.com/api_keys)。如果你使用兼容 DeepSeek / OpenAI 的服务，也可以在设置里修改 Base URL。

### 从源码运行

适合贡献者或需要本地开发的人：

```bash
git clone https://github.com/XingYu-Zhong/DeepSeek-GUI.git
cd DeepSeek-GUI
npm install
npm run dev
```

环境要求：

- Node.js 20+
- 可用的 DeepSeek API Key
- 首次安装依赖时需要联网

中国大陆访问较慢时，可以使用 npm 镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

---

## 首次使用

1. 打开 DeepSeek GUI。
2. 在首次引导中选择界面语言。
3. 填入 DeepSeek API Key；如果需要，设置自定义 Base URL。
4. 选择默认工作目录，或使用应用自动创建的默认目录。
5. 新建会话，输入任务，让智能体开始工作。

常用流程（**Code 模式**）：

- 在左侧选择或切换工作区。
- 在聊天框描述你要完成的任务。
- 观察回复中的推理、工具调用、命令执行和文件改动。
- 对需要审批的操作选择允许或拒绝。
- 在变更审查面板里检查改动，再决定下一步。

**Claw** 与 **Write** 模式的详细说明见上文 [三种工作台模式](#三种工作台模式)。简要步骤：

- **Claw**：在设置页启用后台自动化 → 添加飞书 / Lark 连接 → 配置 Agent 人设、模型与工作目录 → 按需开启 webhook / relay 或定时任务。
- **Write**：切换到 Write 模式 → 使用默认写作空间或添加新空间 → 在 Live 编辑器中写作，配合补全、选区 inline agent 与右侧写作助手。

## 设置与使用

设置页集中管理这些内容：

- DeepSeek API Key、Base URL、运行时端口和运行时 Token。
- 是否自动启动本地运行时，以及是否使用自定义 `deepseek` 路径。
- 工具审批策略和文件系统权限范围。
- 默认工作目录、语言、主题、字体大小和完成通知。
- GUI 更新、CodeWhale 更新、本地错误日志。
- Skill 创建与目录管理、MCP 配置编辑。
- Claw 后台自动化、飞书 / Lark 连接、Webhook / Relay 和定时任务。

快捷键：

| 按键 | 功能 |
| --- | --- |
| `Enter` | 发送消息 |
| `Shift+Enter` | 在输入框中换行 |
| `Ctrl+Enter` | 发送消息 |
| `Esc` | 关闭面板或退出当前浮层 |

## Write 模式设计参考

Write 模式的目标是把 DeepSeek GUI 从“代码/聊天工作台”扩展成真正可长期写作的桌面工作区。实现时参考了本地 `textide` 与 `openhanako` 项目中的几个方案：

- 工作区与文件树：借鉴 textide 的写作空间概念，把写作文件、当前文件、保存状态和 AI 上下文从 code 会话里拆出来独立管理。
- Markdown live 编辑：借鉴 openhanako 的 CodeMirror decorations 思路，当前行保留 Markdown 源码，非当前行用装饰层渲染标题、任务项、图片、分割线和表格。
- 选区 inline agent：借鉴 openhanako 的选区捕获与浮动输入框交互，用户选中文本后可以直接输入“润色/续写/分析”等指令，并把文件路径、行号和原文作为结构化引用交给写作助手。
- AI 会话隔离：Write 仍复用 CodeWhale 的普通 agent thread，但在 GUI 本地按写作空间维护 write thread registry，避免写作会话污染 code/claw 侧栏。
- 文本补全：写作补全不走本地 TUI serve，而是直接调用 DeepSeek FIM Completion API，方便在纯写作场景里获得低延迟 ghost text。短补全使用较短 debounce、较小 token 预算和严格本地过滤；灵感长补全使用更长停顿触发、更大 token 预算，并只在行尾 / 段落边界工作。补全前会对写作空间内的 Markdown / 文本文件建立短 TTL 轻量索引，使用 BM25 + 关键词匹配召回跨文本片段，并以隐藏 Markdown comment 的形式注入 prompt，帮助模型保持术语、事实和风格连续性。

---

## 卸载

### Windows

- 打开“设置 -> 应用 -> 已安装的应用”，找到 `DeepSeek GUI` 并卸载。
- 或在“控制面板 -> 程序和功能”中卸载。
- 也可以运行安装目录中的卸载程序。

Windows 安装器默认会创建开始菜单和桌面快捷方式。安装包不会强制固定到任务栏；如需固定，可在开始菜单中右键 `DeepSeek GUI` 并选择固定。

### macOS

- 将 `DeepSeek GUI.app` 从“应用程序”移到废纸篓。
- 如果首次打开被系统拦截，可在 Finder 中右键应用并选择“打开”。
- 本地未公证构建可先运行：

```bash
npm run mac:unquarantine -- '/Applications/DeepSeek GUI.app'
```

### Linux

- 如果你是从源码构建的 Linux 包，删除对应的 `.AppImage` 或安装文件即可。
- 如果你手动创建了桌面入口或快捷方式，也一并删除。

### 清理本地数据

默认卸载只移除应用文件，会保留本地设置、会话和运行时配置，便于后续重装恢复。若要彻底清理，可按需删除：

| 平台 | 应用数据位置 |
| --- | --- |
| macOS | `~/Library/Application Support/DeepSeek GUI` |
| Windows | `%APPDATA%\DeepSeek GUI` |
| Linux | `~/.config/DeepSeek GUI` |

CodeWhale 的共享配置通常位于 `~/.deepseek`。删除前请确认其中没有你还需要的 API Key、MCP 或 Skill 配置。

---

## 更新

- 普通用户：macOS/Windows 可在设置页检查 GUI 更新，或前往 [GitHub Releases](https://github.com/XingYu-Zhong/DeepSeek-GUI/releases) 下载最新安装包；Linux/Unix 请从源码构建。
- CodeWhale 运行时：如果使用 GUI 托管运行时，可在设置页检查并升级内置 CodeWhale 运行时。

## 贡献指南

欢迎提交 bug 修复、UI/UX 优化、文档改进、本地化内容、构建发布流程和运行时集成相关改动。

协作约定：

- 当前默认协作分支为 `develop`。
- 新功能和修复建议从最新 `develop` 拉出短期功能分支开始。
- PR 默认提交到 `develop`，由维护者审核后再合入 `master`。
- 对高风险改动请先沟通范围，再进入实现。
- 发起 PR 前运行 `npm run typecheck`、`npm run build`，以及 `npm run test`。
- 如果改动影响界面，请附上视频或 GIF。
- 如果改动影响项目逻辑，请附上对应单元测试。
- 如果改动影响使用方式，请同步更新 `README.md` 和 `README.en.md`。

详见 [CONTRIBUTING.zh-CN.md](./docs/CONTRIBUTING.zh-CN.md) 和 [DEVELOPMENT.zh-CN.md](./docs/DEVELOPMENT.zh-CN.md)。

## 本地构建

```bash
npm run build           # 生产构建
npm run dist:mac        # macOS 安装包
npm run dist:win        # Windows 安装包
npm run dist:linux      # Linux AppImage；请在 Linux 平台上运行
```

Linux/Unix 预构建下载包暂不发布。需要 Linux 版本时，请在目标 Linux 环境中安装依赖后自行运行 `npm run dist:linux`；应用内终端依赖 `node-pty`，跨平台打包可能导致终端启动失败。

更多开发流程请看 [DEVELOPMENT.zh-CN.md](./docs/DEVELOPMENT.zh-CN.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [CONTRIBUTING.zh-CN.md](docs/CONTRIBUTING.zh-CN.md) | 贡献说明 |
| [DEVELOPMENT.zh-CN.md](docs/DEVELOPMENT.zh-CN.md) | 本地开发与协作流程 |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | 社区行为准则 |
| [SECURITY.md](SECURITY.md) | 安全漏洞披露方式 |

底层运行时的完整说明请参考 [CodeWhale](https://github.com/Hmbown/CodeWhale)。

---

## 致谢

- [CodeWhale](https://github.com/Hmbown/CodeWhale)：提供本地智能体运行时能力。
- [LobsterAI](https://github.com/netease-youdao/LobsterAI)：IM 管理、扫码绑定、Agent 绑定与自定义人设流程给了本项目 Claw IM 集成很多启发。
- OpenHanako 与 textide：Markdown live 编辑、写作空间、选中文本 inline agent 等 Write 模式交互和实现方案给了本项目重要参考。
- [DeepSeek](https://github.com/deepseek-ai)：提供模型与 API。
- 所有为 DeepSeek GUI 提交 issue、建议、代码和文档的贡献者。

> [!NOTE]
> 本项目与 DeepSeek Inc. 无隶属关系。

## 许可证

[MIT](./LICENSE)

## Star 历史

[![Star History Chart](https://api.star-history.com/chart?repos=XingYu-Zhong/DeepSeek-GUI&type=date&legend=top-left)](https://www.star-history.com/?repos=XingYu-Zhong%2FDeepSeek-GUI&type=date&logscale=&legend=top-left)
