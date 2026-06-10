# 开发流程

[English](./DEVELOPMENT.md)

这份文档定义了本仓库的开发协作方式，重点说明默认分支、PR 流程，以及贡献质量标准。

## 开发基线

- `develop` 是开发协作与日常集成分支
- `master` 是稳定发布分支，由维护者从 `develop` 合入
- 日常功能开发和缺陷修复都应从最新 `develop` 开始
- 对于稍大一些的改动，建议使用短期功能分支

## 推荐流程

1. 先同步本地仓库。
2. 切换到 `develop`。
3. 拉取 `develop` 最新代码。
4. 如有需要，从 `develop` 拉出功能分支开展开发。
5. 在本地完成实现并做好校验。
6. 提交 PR 回到 `develop`。
7. 在通过评审和检查后合并。

## 示例命令

### 同步 `develop`

```bash
git checkout develop
git pull origin develop
```

### 从 `develop` 拉功能分支

```bash
git checkout develop
git pull origin develop
git checkout -b feat/short-description
```

### 推送分支

```bash
git push origin feat/short-description
```

## Pull Request 流程

默认目标分支：

- `develop`

典型流程如下：

1. 在从 `develop` 拉出的短期功能分支上开发
2. 将分支推送到远端
3. 发起指向 `develop` 的 PR
4. 根据 Review 意见继续修改
5. 在通过校验并获得认可后合并

## PR 前必须做的校验

至少执行：

```bash
npm run typecheck
npm run build
npm run test
```

如果改动影响运行时行为或 UI，额外建议执行：

```bash
npm run dev
```

并手动验证受影响流程后再发起 PR。

## PR 质量标准

代码不难，难得的是好品味。评审要守住产品体验，而不只是实现是否能跑。

一个合格的 PR 应当：

- 目标明确，只围绕一个主要主题
- 易于审阅
- 有明确的校验结果支撑
- 行为变更时同步更新文档

PR 描述建议至少包含：

- 改了什么
- 为什么要改
- 如何验证
- 如果涉及 UI，附上视频或 GIF
- 如果涉及项目逻辑，列出新增或更新的单元测试

## 改动范围标准

推荐：

- 一个 PR 聚焦一个主题
- 尽量减少无关格式化改动
- 非必要不要顺手做大范围重构

避免：

- 没有解释就把文档、重构、功能改动混在一起
- 大范围行为变化却没有文档说明
- 对高风险改动绕过正常评审流程

## 本地化标准

如果修改了用户可见文案：

- 尽量同步更新中英文内容
- 保持文档和 UI 用词一致

## 文档标准

当改动影响以下内容时，应同步更新文档：

- 安装或初始化方式
- 命令使用方式
- 运行时要求
- 分支策略
- 发布流程
- 贡献者协作方式

## 合并建议

贡献改动只有在满足以下条件后，才应该合入 `develop`：

- Review 意见已处理
- 检查项通过
- 改动已经达到适合进入日常集成分支的稳定程度

`master` 仅用于稳定发布。维护者确认 `develop` 中的改动适合发布后，再将 `develop` 合入 `master`。

## 自动发布

当同仓库内从 `develop` 指向 `master` 的 PR 被合并后，GitHub Actions 会自动发布稳定版本。

发布 workflow 会：

- 基于最新三段式 semver tag 自动生成下一个 `vX.Y.Z` patch tag
- 如果 rerun 时当前 merge commit 已经有 tag，则复用该 tag
- 构建已签名并公证的 macOS arm64/x64 包、Windows arm64/x64 安装器、Linux x64 AppImage
- 将发布产物和更新元数据上传到 GitHub Releases 与 R2 `stable` 渠道
- 只有在全部平台上传成功后，才会 promote R2 `stable/latest`

首次自动发布前，维护者需要配置这些 GitHub Actions secrets：

- R2：`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_PUBLIC_BASE_URL`，以及 `R2_ACCOUNT_ID` 或 `R2_ENDPOINT`
- 可选 R2 覆盖项：`R2_RELEASE_PREFIX`
- macOS 签名：`MAC_CODESIGN_P12_BASE64`、`CSC_KEY_PASSWORD`、`APPLE_API_KEY_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`

仓库的 Actions 设置还需要允许 `GITHUB_TOKEN` 写入 repository contents，这样 workflow 才能创建 tag 并发布 Release。

本地 `npm run release:mac` 和 `npm run release:win` 命令保留为手动兜底工具。

## 分支命名建议

示例：

- `feat/runtime-settings`
- `fix/connection-probe`
- `docs/bilingual-readme`
- `refactor/chat-store`

## 维护者说明

如果后续仓库调整受保护分支、强制 Reviewer、自动化测试门禁等规则，应同步更新本文件，保持与真实仓库规则一致。
