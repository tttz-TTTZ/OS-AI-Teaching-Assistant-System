# 操作系统课程 AI 助教系统 · MVP V0.1

面向个人学习的可信本地单用户应用。复用现有 **React 19 + TypeScript + Vite / FastAPI / SQLite** 工程，没有改成 Vue，没有引入微服务或大型 UI 库。六个学习入口已实现可操作的 MVP。

## 当前功能

| 模块 | 实现范围 |
|---|---|
| 学习首页 | 课程介绍、章节导航、功能入口、实际服务配置状态；不虚构学习统计 |
| 课程资料 | 公共示例文本、个人 PDF / UTF-8 TXT 上传、分类分页、详情、查看、下载、删除 |
| 知识点 | 7 个示例章节、知识点列表与详情、关联资料、调度实验入口 |
| 算法实验 | Python FCFS、进程编辑、甘特时间轴、CPU 空闲、各进程及平均指标、3 组示例 |
| 智能问答 | 消息列表、加载与错误、清空当前页面对话、真实模型适配；无密钥时明确提示 |
| 章节练习 | 每章一题人工示例单选题、服务器判分、正确答案与解析、重新练习 |

公共/个人只是资料分类，没有实现认证或安全权限隔离。本项目只监听本机回环地址，不用于公网。内容为人工编写的示例，应按实际教材校对。

## Windows 11 + VS Code + PowerShell

安装 Python 3.12+（建议 3.12）和 Node.js 22+，用 VS Code 打开项目根目录。以下命令都从根目录开始，无需激活虚拟环境，避免 PowerShell 执行策略问题。

```powershell
# 1. 创建虚拟环境并安装后端
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
# 2. 安装前端（按锁文件安装）
npm.cmd --prefix frontend ci
# 3. 初始化数据库（也会在后端首次启动时自动完成）
cd backend
..\.venv\Scripts\python.exe init_db.py
# 4. 启动后端；保持此终端运行
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

VS Code 新开第二个终端，仍在项目根目录：

```powershell
npm.cmd --prefix frontend run dev -- --strictPort
```

在本机浏览器地址栏输入 `http://127.0.0.1:5173`。接口文档地址输入 `http://127.0.0.1:8000/docs`。Vite 自动代理 `/api` 至后端，无需额外放开 CORS。此云环境不提供本机页面预览链接。

## Linux / macOS

```bash
bash scripts/install.sh
# 终端一
bash scripts/backend.sh
# 终端二
npm --prefix frontend run dev -- --strictPort
```

## 配置真实 AI（可选，不影响其余模块）

复制 `backend/.env.example` 为 `backend/.env`，使用文本编辑器只在后端填写密钥：

```dotenv
LLM_MODE=openai
LLM_API_KEY=请在本地安全填入实际密钥
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
DATABASE_PATH=data/assistant.db
```

重启后端。默认模式为 openai；没有密钥时 `/api/chat` 返回 503“尚未配置 AI 服务”，不会生成假回答。服务兼容 OpenAI Chat Completions 的 HTTPS 接口；修改供应商时需同时调整地址与模型，并允许相应网络域名。

保留原有显式 `LLM_MODE=mock` 仅供开发测试，它明确返回演示标记。切换真实服务时请改回 openai。已有进程环境变量优先于 `.env`。绝不要将密钥写入前端、加 `VITE_` 前缀或提交 `.env`。

聊天页面展示当前会话消息，但每次只向模型发送当前问题，不自动携带历史；刷新或清空会移除当前页面消息，后端成功回答记录仍保留。普通问答不具有 RAG 或资料可靠溯源能力。PDF 仅存储和预览，尚未提取文本；TXT 最多提取前 50000 字作正文。

## 测试与验收

Windows 根目录运行：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd --prefix frontend run build
# 两个服务已运行时：实际经过前端代理做接口联调
.\.venv\Scripts\python.exe scripts\smoke.py
# 可选：安装浏览器后执行完整页面操作测试（AI 应保持未配置以验证错误提示）
cd frontend
npx.cmd playwright install chromium
npm.cmd run test:browser
```

Linux 对应使用 `.venv/bin/python`；可选浏览器验证参见 `docs/ACCEPTANCE.md`。自动化结果和逐项点击验收见该文档。Windows 实机运行尚未验证，本环境验证基于 Linux；命令路径已经按实际工程编写。

## 目录与核心代码

```text
backend/
  app/main.py          服务生命周期、资料 CRUD、现有 AI 适配与聊天记录
  app/course.py        示例课程、知识点、题目的一次性数据库种子
  app/learning.py      课程/知识点查询、练习判分、实验 API
  app/algorithms.py    可独立测试的 FCFS 算法及 Pydantic 参数校验
  app/files.py         文件校验、安全存储、按资料 ID 查看与下载
  app/upload_limit.py  multipart 解析之前限制请求大小
  init_db.py           可重复执行的初始化命令
  tests/              后端自动化测试
frontend/src/
  api.ts              统一请求、错误处理、各模块类型和接口
  components.tsx      页面框架、章节选择、错误提示等复用组件
  main.tsx            侧边栏与路由
  pages/              Home / Materials / Knowledge / Lab / Chat / Practice
scripts/              安装、后端启动、HTTP 冒烟与浏览器验收
```

数据默认在 `backend/data/assistant.db`，上传文件在相邻 `uploads` 文件夹，均不提交 Git。停止服务后备份整个 `backend/data`，不能只备份数据库而漏掉文件。数据库初始化不会覆盖已有资料；旧版本资料表会自动添加文件元数据字段，新种子仅导入一次。课程数据后续应通过正式迁移更新，不会靠重启覆盖修改。

## 常见问题

- `py` 或 `npm` 找不到：安装对应运行时并重开 VS Code；Windows 可用 `python` 替换已安装版本的 `py -3.12`。
- `npm.ps1 无法加载`：按上述命令使用 `npm.cmd`；无需修改系统执行策略。
- `No module named app`：启动后端必须先 `cd backend`；测试从根目录运行有 `pytest.ini` 提供导入路径。
- `Failed to fetch`、500 或代理连接被拒绝：确认后端在 8000 端口，前端在 5173；检查后端终端，不要直接双击 HTML 文件。
- 端口占用：停止自己之前启动的进程再启动。若改后端端口，须同步修改 `frontend/vite.config.ts` 的代理目标。
- 上传失败：仅接收非空 PDF / UTF-8 TXT，文件上限 10 MB；PDF 检查扩展名和文件头，TXT 检查编码和 NUL 字节。上传不是杀毒或完整 PDF 合法性验证。
- AI 503：配置后端密钥并重启；502：检查地址、模型、凭据、网络及额度；504：上游 45 秒内未响应。原始上游错误不会暴露给前端。
- 数据库只读：确认运行用户可写 `backend/data`；不要从两个项目副本误用同一数据库路径。

后续范围：按教材充实内容、SJF、上传内容提取、资料检索与 RAG、账号权限、学习记录。当前没有 AI 出题、主观题评分、知识图谱或完整产品级部署。
