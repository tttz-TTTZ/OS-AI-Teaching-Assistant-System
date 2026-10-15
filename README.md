# 操作系统课程智能助教系统 · 开发底座

面向二次开发的前后端分离框架。技术栈：React 19 / TypeScript / Vite / FastAPI / SQLite。现有代码实现基础设施与接口示例，不包含完整课程业务。

## 本地启动

要求 Python 3.12+、Node.js 22+、npm。

```bash
bash scripts/install.sh
# 终端一：自动初始化 SQLite，默认演示模型
bash scripts/backend.sh
# 终端二
npm --prefix frontend run dev
```

浏览器打开本机 5173 端口。后端 8000 端口的 `/docs` 提供交互式接口文档。Vite 将 `/api` 转发到后端，同源开发不需要开放 CORS。生产部署需自行配置 HTTPS、前端静态资源与 `/api` 反向代理；前端路由需回退到 index.html。

## 真实大模型

复制 `backend/.env.example` 为 `backend/.env`，仅在后端安全填写：

```dotenv
LLM_MODE=openai
LLM_API_KEY=在本地填入实际密钥
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

重启后端，然后在智能问答页发送请求。兼容 OpenAI Chat Completions 的服务可调整地址和模型。仅支持 HTTPS、非流式文本回答。默认 `mock` 明确返回演示标记，不代表真实模型调用成功。密钥不进入前端、不提交版本库、不通过接口返回。

## 验证

```bash
cd backend
../.venv/bin/python -m pytest -q
cd ../frontend
npm run build
cd ..
# 先启动两个服务；经前端代理执行 CRUD→资料上下文→问答→数据库记录
.venv/bin/python scripts/smoke.py
```

真实模型验收：配置后端凭据及网络访问后运行同一 smoke；返回 mode 应为 openai。该检查会产生一次模型调用及费用，测试数据随后清理，问答记录保留。

## 目录与扩展

- `frontend/src/main.tsx`：布局、路由与页面骨架，资料只读列表和问答调用示例。
- `frontend/src/api.ts`：统一请求与错误处理，预留 CRUD、模型调用方法。
- `backend/app/main.py`：服务入口、数据访问与模型适配；后续可拆分 routers/services/repositories。
- `backend/requirements.txt`、`frontend/package-lock.json`：已锁定依赖。
- `docs/API.md`：接口和数据表说明。

资料、知识点、算法实验、智能问答、练习测试路由已预留。下一阶段可增加资料编辑、上传、权限、算法模拟、题库等业务。本阶段未实现账号认证、文件上传、RAG、自动评分等能力。当前无身份隔离，仅适合可信本地开发，联网部署前需添加认证、授权、限流和配额。

数据库默认保存在 `backend/data/assistant.db`（已忽略），可用 `DATABASE_PATH` 覆盖。首次启动自动建表，重启保留数据。表结构迭代时需引入迁移工具；当前初始化不自动升级旧表。备份请在停止服务后复制数据库文件。
