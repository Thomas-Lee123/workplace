# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 服务器 & GitHub 连接

**SSH 连接已配置在 `~/.ssh/config`，免密直连：**

```bash
ssh 8.148.24.128           # 连接生产服务器 (8.148.24.128, 阿里云ECS, root)
ssh -T git@github.com      # 测试 GitHub 连接 (Thomas-Lee123/workplace.git)
```

| 资源 | 地址/命令 |
|------|----------|
| 站点 | https://lsy567.com |
| 服务器前端目录 | `/var/www/travel/` |
| 服务器后端目录 | `/opt/travel-server/` |
| 后端进程管理 | `pm2 status` / `pm2 logs travel-api` / `pm2 restart travel-api` |
| 数据库 | PostgreSQL `travel_db`, 用户 `travel_user`, 本地 `.env` 有连接字符串 |
| MC 服务器 | **Forge 1.18.2** `/opt/mc-forge/`, `systemctl status mc-forge` |
| MC 连接地址 | `8.148.24.128:25565`, 离线模式, 无需正版 |

## 项目结构

```
travel-planner/client/        — 旅行规划前端 (React + Vite)
travel-planner/server/        — 旅行规划后端 (Express + Prisma + PostgreSQL)
mc-forge/                     — MC 服务器配置和模组
docs/                         — 项目文档
```

## 常用命令

```bash
# 开发
cd travel-planner/client && npm run dev        # 前端开发服务器 (Vite, /api → localhost:3000)
cd travel-planner/server && npm run dev        # 后端开发服务器 (tsx watch)

# 构建
cd travel-planner/client && npm run build      # tsc + vite build → dist/
cd travel-planner/server && npx tsc            # TypeScript → dist/

# 数据库
cd travel-planner/server && npx prisma db push        # 直接推送 schema 到数据库
cd travel-planner/server && npx prisma migrate dev    # 创建迁移
cd travel-planner/server && npx prisma generate       # 生成 Prisma Client
```

## 架构

```
travel-planner/
  client/
    src/
      App.tsx — 路由+侧边栏
      i18n.tsx — 国际化
      api.ts — 后端 API 调用封装
      pages/
        Login.tsx
        TripDetail.tsx
        AddItem.tsx
        ImportTrip.tsx
        AIGenerate.tsx
  server/
    src/
      index.ts — Express 入口
      app.ts — 中间件+路由挂载
      routes/
        auth.ts — 登录/注册
        trips.ts — CRUD 行程/天/项目
        ai.ts — AI 生成行程
        import.ts — 文件导入行程
        export.ts — 导出行程
        parse.ts — 解析导入文件
        proxy.ts — 图片代理
      middleware/
        auth.ts — JWT 认证
      lib/
        prisma.ts — Prisma 单例
        ai-config.ts — AI 配置
```

**数据模型**: User → Trip → Day → Item（四级层级，详见 `travel-planner/server/prisma/schema.prisma`）

## 部署

```bash
# 1. 本地构建
cd travel-planner/client && npm run build
cd travel-planner/server && npx tsc

# 2. 上传
scp -r travel-planner/client/dist/* 8.148.24.128:/var/www/travel/
scp -r travel-planner/server/dist/* 8.148.24.128:/opt/travel-server/dist/
scp travel-planner/server/package.json 8.148.24.128:/opt/travel-server/

# 3. 服务器安装+重启
ssh 8.148.24.128 "cd /opt/travel-server && npm install && npx prisma generate && pm2 restart travel-api"
```
