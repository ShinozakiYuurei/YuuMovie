# Changelog

所有重要的代码变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，采用 [Semantic Versioning](https://semver.org/spec/v2.0.0.html) 规范。

## [未发布]

### 待添加...

---

## [0.1.1] - 2026-09-19

### ✨ Added (新增功能)
- **版本管理系统**: 新增 `deploy/version.sh` 脚本，支持自动化版本号管理和 Git 标签创建
- **发布文档**: 添加 `HOW_TO_RELEASE.md`，详细指导如何安全、规范地发布新版本
- **部署版本追踪**: 增强版 `update.sh` 自动记录当前部署的版本号和提交哈希

### 🔧 Changed (修改)
- **package.json**: 版本号从 0.1.0 升级到 0.1.1

### 📝 Documentation (文档)
- 添加完整的 README.md，包含项目介绍、技术栈、部署指南和项目结构说明

---

## [0.1.0] - 2026-09-19

### 🎉 Initial Release (首发版本)

### ✨ Added (新增功能)
- **核心功能**: 
  - 香港电影院排片信息聚合展示平台
  - 支持 MCL, Emperor, Cinemacity, Bestar, Broadway 等主流影院
  - 实时排片、电影详情、即将上映页面
  
### 🔧 Infrastructure (基础设施)
- **完整部署链路**: 83 个文件，包含自动化部署脚本和 9 个已修复的关键 bug
- **爬虫系统**: 内置多源数据抓取脚本（icirena, broadway, mcl）
- **Docker 支持**: Dockerfile 和容器化部署配置
- **静态资源构建**: Next.js SSG + 增量静态再生成

### 🛡️ Fixes (问题修复 - 发布前调试阶段)
1. 首次收编时目录无 .git 导致护栏失效
2. 死链检查返回码错误导致假健康
3. tsx 依赖不在 package.json 中导致服务器运行失败
4. 分支名误用 main 实际是 master
5. 白名单过滤失效导致联网脚本被误执行
6. 链接数重复计算导致的显示错误
7. 回滚时使用错误的 reflog 引用顺序
8. .deploy-info 文件被定时器覆盖
9. npm ci 缺少 --include=dev 参数移除开发依赖

### 📦 Components (组件)
- React UI 组件库集成
- Tailwind CSS 4 样式系统
- Framer Motion 动画效果

---

[0.1.1]: https://github.com/ShinozakiYuurei/YuuMovie/tree/v0.1.1
[0.1.0]: https://github.com/ShinozakiYuurei/YuuMovie/tree/v0.1.0
