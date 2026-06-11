# workplace

个人工作空间 — 包含多个平行项目。

## 项目列表

### [travel-planner](travel-planner/) — 一键旅行

旅行行程规划工具。React + Vite 前端，Express + Prisma + PostgreSQL 后端，集成 AI 自动生成行程。

- 站点: [lsy567.com](https://lsy567.com)
- 技术栈: React, Vite, TypeScript, Express, Prisma, PostgreSQL, DeepSeek AI
- 详见 [travel-planner/](travel-planner/)

### [mc-forge](mc-forge/) — MC 服务器

Minecraft Forge 1.18.2 服务器配置与模组管理。

- 地址: `8.148.24.128:25565`
- 详见 [mc-forge/](mc-forge/)

## 目录结构

```
├── travel-planner/     # 旅行规划 (前后端)
│   ├── client/         # React 前端
│   └── server/         # Express 后端
├── mc-forge/           # MC 服务器
│   └── mods/           # Forge 模组
└── docs/               # 共用文档
```

## 服务器

所有项目部署在同一台阿里云 ECS，详见 [docs/部署指南.md](docs/部署指南.md)。
