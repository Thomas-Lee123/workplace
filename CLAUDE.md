# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 服务器 & GitHub 连接

**SSH 连接已配置在 `~/.ssh/config`，免密直连：**

```bash
ssh travel-server          # 连接生产服务器 (8.148.24.128, 阿里云ECS, root)
ssh -T git@github.com      # 测试 GitHub 连接 (Thomas-Lee123/AI-.git)
```

| 资源 | 地址/命令 |
|------|----------|
| 站点 | https://lsy567.com |
| 服务器前端目录 | `/var/www/travel/` |
| 服务器后端目录 | `/opt/travel-server/` |
| 后端进程管理 | `pm2 status` / `pm2 logs travel-api` / `pm2 restart travel-api` |
| 数据库 | PostgreSQL `travel_db`, 用户 `travel_user`, 本地 `.env` 有连接字符串 |

## 项目概述

一键旅行 — 旅行行程规划工具。前端 React + Vite，后端 Express + Prisma + PostgreSQL。

## 常用命令

```bash
# 开发
cd client && npm run dev        # 前端开发服务器 (Vite, /api → localhost:3000)
cd server && npm run dev        # 后端开发服务器 (tsx watch)

# 构建
cd client && npm run build      # tsc + vite build → client/dist/
cd server && npx tsc            # TypeScript → server/dist/

# 数据库
cd server && npx prisma db push        # 直接推送 schema 到数据库
cd server && npx prisma migrate dev    # 创建迁移
cd server && npx prisma generate       # 生成 Prisma Client
```

## 架构

```
client/                          server/
  src/                             src/
    App.tsx — 路由+侧边栏           index.ts — Express 入口
    i18n.tsx — 国际化               app.ts — 中间件+路由挂载
    api.ts — 后端 API 调用封装       routes/
    pages/                           auth.ts — 登录/注册
      Login.tsx                      trips.ts — CRUD 行程/天/项目
      TripDetail.tsx                 ai.ts — AI 生成行程
      AddItem.tsx                    import.ts — 文件导入行程
      ImportTrip.tsx                 export.ts — 导出行程
      AIGenerate.tsx                 parse.ts — 解析导入文件
                                    middleware/
                                      auth.ts — JWT 认证
                                    lib/
                                      prisma.ts — Prisma 单例
```

**数据模型**: User → Trip → Day → Item（四级层级，详见 `server/prisma/schema.prisma`）

## 部署

```bash
# 1. 本地构建
cd client && npm run build
cd server && npx tsc

# 2. 上传
scp -r client/dist/* travel-server:/var/www/travel/
scp -r server/dist/* travel-server:/opt/travel-server/dist/
scp server/package.json travel-server:/opt/travel-server/

# 3. 服务器安装+重启
ssh travel-server "cd /opt/travel-server && npm install && npx prisma generate && pm2 restart travel-api"
```
