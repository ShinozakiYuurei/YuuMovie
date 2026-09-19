# 如何发布新版本

这个文档指导你如何通过 Git 和版本管理脚本发布代码到 GitHub。

## 📋 版本编号规则（Semantic Versioning）

我们使用 **主版本。次版本.修订版本** (MAJOR.MINOR.PATCH) 的格式：

- **主版本号** (0.x.0 → 1.0.0): 不兼容的重大 API 或架构改动
- **次版本号** (x.0.x → x.1.x): 向后兼容的功能新增
- **修订号** (x.y.0 → x.y.1): 向后兼容的问题修复

## 🚀 快速发布流程

### 情况 1: 日常小修改 (bug 修复、UI 调整等)

```bash
cd C:/Users/Yuurei/hkmovie-work

# 1. 本地修改并确认工作区干净
git status

# 2. 发布命令
./deploy/version.sh release
```

`version.sh release` 会自动完成以下步骤：
1. ✨ 将版本号加 1 (如 0.1.0 → 0.1.1)
2. 💾 提交修改并打上 Git 标签 (v0.1.1)
3. 🚀 推送到远程仓库

### 情况 2: 需要大量测试后再发布

#### Step 1: 本地开发阶段

```bash
# 在功能分支开发
git checkout -b feature/my-new-feature

# 做完修改后提交
git add .
git commit -m "feat: add new feature description"
git push origin feature/my-new-feature
```

创建 Pull Request 进行审查（可选）。

#### Step 2: 合并到主分支

```bash
# 切换回主分支
git checkout main

# 拉取最新代码
git pull origin main

# 合并你的功能分支
git merge feature/my-new-feature
```

#### Step 3: 正式发版

```bash
# 检查版本更新内容
cat package.json | grep version

# 发布新版本
./deploy/version.sh release

# 查看 GitHub Releases 页面
# https://github.com/ShinozakiYuurei/YuuMovie/releases
```

## 📝 手动版本控制方法

如果不想用自动化脚本，也可以手动操作：

### 步骤 1: 更新版本号

编辑 `package.json`:

```json
{
  "version": "0.1.0"  // ← 改为新的版本号
}
```

### 步骤 2: 提交代码

```bash
git add package.json
git commit -m "chore: bump version to 0.1.1"
```

### 步骤 3: 打标签

```bash
git tag -a v0.1.1 -m "Release v0.1.1"
```

### 步骤 4: 推送

```bash
git push origin main --tags
```

## 🔍 验证发布结果

发布后，验证以下内容：

```bash
# 1. 检查远程标签
git ls-remote --tags origin

# 2. 查看版本信息
./deploy/version.sh show

# 3. 访问 GitHub 页面
#   -  releases/        ← 查看发布的标签
#   -   commits/main    ← 查看最新的提交记录
```

## ⚠️ 注意事项

### 回滚处理

如果需要回滚到之前的版本：

```bash
# 1. 找出要回滚的 tag
git tag -l

# 2. 检出该版本的代码
git checkout v0.1.0

# 3. 另存新分支保存当前状态
git checkout -b rollback-to-v0.1.0

# 4. 继续开发修复问题
```

### 紧急热修复

如果生产环境出现问题，需要立即修复：

```bash
# 1. 从当前主分支创建热修分支
git checkout -b hotfix/urgent-fix main

# 2. 修复 bug
# ... 修改文件 ...

# 3. 提交并提交消息格式要特殊标注
git add .
git commit -m "hotfix: fix critical issue #123"

# 4. 合并回主分支并立即发布
git checkout main
git merge hotfix/urgent-fix
./deploy/version.sh release
```

## 🎯 推荐的发布频率

根据项目发展阶段：

| 阶段 | 建议频率 | 理由 |
|------|----------|------|
| **Alpha** (开发中) | 每天 | 频繁迭代，快速试错 |
| **Beta** (测试期) | 每周 | 稳定功能，收集反馈 |
| **Stable** (生产) | 每月 | 保证稳定性，避免过度变更 |

---

## 常用命令速查表

| 操作 | 命令 | 说明 |
|------|------|------|
| 查看版本 | `./deploy/version.sh show` | 显示当前版本和最近提交 |
| 升级修订版 | `./deploy/version.sh bump patch` | 0.1.0 → 0.1.1 |
| 升级次版本 | `./deploy/version.sh bump minor` | 0.1.0 → 0.2.0 |
| 升级主版本 | `./deploy/version.sh bump major` | 0.1.0 → 1.0.0 |
| 创建标签 | `./deploy/version.sh tag` | 为当前版本打标签 |
| 完整发布 | `./deploy/version.sh release` | 自动执行所有步骤 |
| 查看标签 | `git tag -l | tail -10` | 列出最近的标签 |
| 回退版本 | `git checkout vX.Y.Z` | 检出特定版本 |

---

**最后提醒：** 
每次发布前确保完成以下检查：
- ✅ 本地测试通过 (`npm run dev`)
- ✅ 代码已提交且没有未追踪的重要文件
- ✅ 有清晰的 commit message 说明改动内容
- ✅ 如果是重大改动，已经经过测试验证

祝发布顺利！🎉
