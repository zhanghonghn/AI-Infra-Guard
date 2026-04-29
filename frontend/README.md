# A.I.G Frontend (源码工程)

本目录是 `common/websocket/static/` 下已编译压缩前端的**源码形式重写**，基于 Vite + React 18 + TypeScript + Ant Design。

## 重要背景

仓库中 `common/websocket/static/` 目录里目前是一份 **已压缩、无 sourcemap** 的 Vite 构建产物（约 2.7MB JS + 113KB CSS），无法 1:1 反推为可读源码。本 `frontend/` 工程以**渐进式重写**方式提供一份可演进的源码骨架：

- ✅ 已实现：脚手架、API 客户端、统一布局/路由、**任务列表**、**AI 应用指纹**、关于页
- 🚧 待补齐（已留 Placeholder 路由）：漏洞库、MCP 插件、评测集、模型管理，以及任务详情、SSE 实时输出、文件上传、Garak Findings、模型红队评测等深度交互页面

> 本 PR **不会替换** `common/websocket/static/` 里的现有 bundle，因此线上 UI 行为完全不变。新前端要正式接管时，运行 `npm run deploy:static` 后再 `go build` 即可。

## 目录结构

```
frontend/
├── index.html
├── package.json
├── vite.config.ts            # dev 代理 /api → 127.0.0.1:8088
├── tsconfig*.json
├── .env.development          # VITE_API_TARGET 等
├── scripts/
│   └── deploy-to-static.mjs  # 把 dist/ 拷入 common/websocket/static/
└── src/
    ├── main.tsx              # 入口：BrowserRouter + ConfigProvider
    ├── App.tsx               # 路由表
    ├── api/
    │   ├── client.ts         # axios 封装 + 统一解包 {status,message,data}
    │   ├── tasks.ts
    │   ├── knowledge.ts
    │   └── version.ts
    ├── components/
    │   ├── AppLayout.tsx     # 侧边栏 + 顶栏
    │   └── PageHeader.tsx
    ├── pages/
    │   ├── TaskList.tsx      # 示范页面 ①
    │   ├── Fingerprints.tsx  # 示范页面 ②
    │   ├── About.tsx
    │   └── Placeholder.tsx
    └── types/
        ├── api.ts            # ApiResponse<T>, PageResult<T>
        ├── task.ts
        └── knowledge.ts
```

## 本地开发

前置：Node.js ≥ 18（推荐 20）。

```bash
cd frontend
npm install

# 1) 在另一个终端跑后端 Go 服务（API 提供方）
#    cd .. && go run ./cmd/cli webserver --server 127.0.0.1:8088

# 2) 启动前端开发服务器（自动代理 /api → 127.0.0.1:8088）
npm run dev
# → http://127.0.0.1:5173
```

如需改后端地址，复制 `.env.development` 为 `.env.local` 并修改 `VITE_API_TARGET`。

## 构建

```bash
npm run build       # 产物输出到 frontend/dist/
npm run preview     # 本地预览构建产物
```

## 接入 Go 后端（可选 / 谨慎）

`common/websocket/server.go` 通过 `embed.FS` 嵌入 `common/websocket/static/`：

```go
//go:embed static/*
var staticFS embed.FS
```

要让 Go 二进制使用本工程的产物，请：

```bash
cd frontend
npm run build
npm run deploy:static     # 拷贝 dist/* → ../common/websocket/static/，
                          # 自动保留 aigdocs/ images/ fonts/ 等非构建产物
cd ..
go build -o ai-infra-guard ./cmd/cli/main.go
```

> ⚠️ 该操作会覆盖现有 `static/index.html` 与 `assets/`。仅在新前端覆盖度足以替代旧 bundle 时再执行；可先在 feature 分支验证。

## 添加新页面（贡献指南）

1. 在 `src/types/` 中按需添加类型；如果是分页接口，复用 `PageResult<T>`。
2. 在 `src/api/` 新增模块化客户端函数（参考 `tasks.ts` / `knowledge.ts`）。所有请求经 `api.get/post/...` 自动解包后端 `{status,message,data}` 信封。
3. 在 `src/pages/` 新建页面组件，复用 `<PageHeader />`、Ant Design 的 `Card/Table/Form` 等。
4. 在 `src/App.tsx` 注册路由；同步在 `src/components/AppLayout.tsx` 的 `NAV_ITEMS` 增删导航项。
5. 路径别名 `@/*` 已配置，建议统一用 `import xx from '@/xxx'`。

## 接口约定

- 基础地址：开发态走 vite dev proxy；生产态由 Go 服务同源提供。
- 通用响应：`{ status: number, message: string, data: T }`，`status === 0` 视作成功。
- 身份识别：后端 `setupIdentityMiddleware` 读取请求头 `username`；客户端默认从 `localStorage.aig.username` 读取，缺省为 `public_user`。
- 例外：`GET /api/v1/version` 返回非信封结构 `{ version, changelog }`，已在 `client.ts` 中兼容。

## 不做什么

- 不做与现有 bundle 像素级对比，只保证功能等价 + Antd 设计语言一致。
- 不引入 Tailwind / shadcn 等额外样式体系，沿用 Antd 主题以减少依赖面与体积。
- 不引入状态管理库（Redux/Zustand/...），现有页面 useState/useEffect 已足够；按需再引入。
