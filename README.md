# BiosBot - Agent System

基于文档生成的完整项目代码。

## 项目结构

```
coobot/
├── backend/           # 后端服务
│   ├── src/
│   │   ├── db/       # 数据库Schema
│   │   ├── services/  # 核心服务
│   │   ├── routes/   # API路由
│   │   └── index.ts  # 入口文件
│   └── config/       # 配置文件
├── web/              # 前端应用
│   ├── src/
│   │   ├── components/ # React组件
│   │   ├── stores/    # 状态管理
│   │   └── api/      # API客户端
│   └── index.html
└── docs/             # 开发文档
    └── Agent 开发文档/
```

## 快速开始

### 1. 安装依赖

```bash
# 后端依赖
cd backend
npm install

# 前端依赖
cd ../web
npm install
```

### 2. 启动服务

```bash
# 终端1: 启动后端
cd backend
npm run dev

# 终端2: 启动前端
cd web
npm run dev
```

### 3. 访问应用

- 前端: http://localhost:5173
- 后端: http://localhost:3001
- API: http://localhost:3001/api

## 功能特性

- 任务管理：创建、查询、取消任务
- Agent编排：自动任务分解和执行
- 知识库：文档存储和检索
- 记忆系统：会话记忆和持久记忆
- 权限管理：基于策略的权限控制
- 实时通信：WebSocket事件推送

## 技术栈

- 后端: Node.js + TypeScript + Express + SQLite
- 前端: React + TypeScript + Vite + Zustand
- 数据库: SQLite (Drizzle ORM)