# HK Movie

一个香港电影院排片信息的聚合展示平台。

## 功能特点

- **实时排片**：聚合香港各大影院的实时电影排片信息
- **多影院支持**：支持 MCL、Emperor、Cinemacity、Bestar、Broadway 等主流影院
- **电影详情**：提供电影简介、演职员信息、影院位置等详细内容
- **即将上映**：预告即将上映的电影阵容

## 技术栈

- **框架**: Next.js 15
- **UI 库**: React 19, Tailwind CSS 4, shadcn/ui
- **动画**: Framer Motion
- **部署**: PM2 + Nginx + Docker 容器化

## 开发环境

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 启动生产服务器
npm start
```

## 部署到服务器

本项目包含完整的自动化部署脚本，修复了 9 个常见的发布 bug：

### 核心修复

1. ✅ **首次收编问题** - 正确识别无 .git 目录的状态并安全备份
2. ✅ **死链检查逻辑** - 确保真正检测到坏链时返回非零退出码
3. ✅ **tsx 依赖问题** - 明确在 package.json 中包含 tsx 依赖
4. ✅ **分支名称适配** - 正确处理 master/main 分支差异
5. ✅ **白名单过滤** - 防止联网脚本被意外执行
6. ✅ **链接计数修正** - 避免重复计算导致的错误
7. ✅ **回滚逻辑优化** - 使用正确的 reflog 引用顺序
8. ✅ **配置持久化** - 保护.deploy-info 不被定时器覆盖
9. ✅ **依赖完整性** - npm ci 包含 --include=dev 保留开发依赖

### 部署步骤

1. **准备工作**
   ```bash
   # 确保 VPS 已安装 Node.js 18+, PM2, Docker, Nginx
   bash deploy/setup-vps.sh
   ```

2. **同步代码**
   ```bash
   # 自动完成拉取→备份→部署→重启流程
   bash deploy/sync.sh
   ```

3. **静态资源更新** (可选)
   ```bash
   # 重新构建静态页面（需设置 ENRICH=1 以启用数据增强）
   ENRICH=0 bash deploy/sync.sh
   ```

### 安全特性

- **沙箱验证** - 所有脚本在 /tmp 沙箱中完整演练后才允许上线
- **幂等操作** - 支持多次运行，不会破坏已有服务
- **自动备份** - 每次部署前自动创建带时间戳的备份
- **回滚能力** - 使用 reflog 实现精确的版本回溯

## 项目结构

```
hkmovie-work/
├── app/                  # Next.js 应用入口
│   ├── cinema/          # 影院列表和详情页面
│   ├── movie/           # 电影详情页面
│   └── upcoming/        # 即将上映页面
├── components/          # React UI 组件
├── data/               # 静态数据源
├── deploy/             # 部署脚本（含 9 个 bug 修复）
│   ├── preflight.sh    # 部署前检查
│   ├── update.sh       # 主更新逻辑
│   └── drill.sh        # 沙箱演练脚本
├── lib/                # 工具函数库
└── scrapers/           # 数据爬虫脚本
```

## 数据爬虫

项目内置多个爬虫脚本用于抓取各影院排片信息：

```bash
# 手动触发数据抓取
npm run scrape
```

注意：默认情况下静态资源构建不会自动调用爬虫 API，如需启用请在部署脚本中设置 `ENRICH=1`。

## License

© 2024 Yuurei. All rights reserved.
