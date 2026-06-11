# 一键旅行

旅行行程规划工具。

## 功能

- AI 自动生成旅行行程
- 从链接 / 文件 / 文本导入行程
- 每日项目拖拽排序
- 购买状态跟踪 + 预算统计
- 导出 Excel / Word
- 中英文国际化
- PWA 离线支持
- 移动端响应式布局

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React, Vite, TypeScript |
| 后端 | Express, TypeScript |
| 数据库 | PostgreSQL + Prisma |
| AI | DeepSeek API |
| 部署 | Nginx, PM2, 阿里云 ECS |

## 开发

```bash
# 前端
cd client && npm install && npm run dev

# 后端
cd server && npm install && npm run dev
```

## 部署

详见 [docs/部署指南.md](../docs/部署指南.md)
