# 操作系统课程 AI 助教系统 · V0.2 课程与算法实验平台

**当前入口已重新分工：** 「知识点学习」恢复教师编写、审核发布和学生按章/节阅读；三栏资料—对话—Studio工作台移到「智能问答」。讲解、导图、闪卡、代码、总结、AI自测和算法入口全部保留，个人记录不删除。教师不再被限制为只上传资料，也可继续维护正式知识点内容。[本轮使用、兼容与验收说明](docs/KNOWLEDGE-AND-AI-WORKSPACES.md)。

**兼容与边界：** 原基础问答保留为次级入口；旧知识学习中的AI任务链接自动跳转到智能问答。原教师AI自动备课写接口仍停用，恢复的是人工内容编辑与发布。旧PPT提取继续供出题和学生学习使用。本轮无数据库迁移、无新增依赖，不修改已有资料、账号或学习记录。

**DeepSeek辅助出题：** 教师选择公共资料或上传私有出题资料，预览摘录后生成候选题，自动填写题目编辑器，逐题审核为草稿后再发布。[配置与使用指南](docs/AI-QUESTION-GENERATION.md)。需配置后端DEEPSEEK_API_KEY、新增pypdf依赖并重启；首次追加V6表，迁移前备份。真实模型调用尚待密钥验证。

**大课件升级：** 公共 PPT/PPTX 最高500 MiB，个人课件50 MiB；有上传进度，PPTX支持按页阅读文字，完整排版/动画下载原件查看。[安装、使用与边界](docs/PRESENTATION-MATERIALS.md)。需补装 `olefile` 并重启后端，无新增数据库迁移。

**算法实验平台升级：** 教师分步配置、试运行和发布 FCFS/SJF/RR 教学实验；学生运行回放、记录观察并返回关联知识点。[更新、迁移与验收指南](docs/EXPERIMENT-PLATFORM.md)。本次有 V5 新增表迁移，重启后端前自动备份；无需新增依赖。

**学生知识点界面已改版：** 独立课程目录 → 全宽逐模块阅读与动画 → 练习巩固；相关资料、笔记与反馈分别查看。参见 [学生学习与更新指南](docs/STUDENT-LEARNING-UX.md)。该界面改版本身无新依赖或迁移；最新实验升级迁移见上文。

**正式课程知识点：** 已恢复教师内容编辑、预览发布与学生阅读入口。[历史教师操作指南](docs/TEACHER-AUTHORING-UX.md)。

**知识点数字教材试用升级：** 已增加可修改章/节/编号/页码、内容块、草稿发布版本、受控图片、教学交互、多题型练习和账号学习记录。先看 [更新与验收步骤](docs/DIGITAL-TEXTBOOK-DELIVERY.md)。不自动导入尚未校对的12点正式内容，不删除旧数据；本轮需补装后端Pillow依赖。

一个前端、一个 FastAPI 后端、一套 SQLite 数据库的本地课程平台。**现有实际技术栈为 React 19 + TypeScript + Vite，用户已确认继续沿用 React。** 教师和学生使用独立路由布局，复用组件；没有换框架或引入微服务。

**当前进度与 VS Code 继续开发：先读 [docs/CODEX-HANDOFF.md](docs/CODEX-HANDOFF.md)。账号、独立标签登录、资料回收站与成套备份已增量实现，Windows/阿里云部署仍待实机验收；本页原V0.2细节以交接文档为准。**

需求依据：[docs/requirements.md](docs/requirements.md)。设计与迁移：[docs/V02-DESIGN.md](docs/V02-DESIGN.md)。接口：[docs/API.md](docs/API.md)。测试及逐项验收：[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

## 已实现范围

| 模块 | 功能 |
|---|---|
| 账号 | Argon2id 密码哈希；登录、退出、当前用户；8 小时服务端会话、角色路由、CSRF、过期提示 |
| 教师 | 章节增改删与顺序；知识点增改、章节/实验关联；公共 PDF/TXT 上传、知识点多选关联；发布/取消发布；多题型题库与知识点关联 |
| 学生 | 已发布课程章节与知识点；分模块结构化教材、草稿发布版本、教学互动、基础 Markdown；公共资料；仅本人的个人文件上传/查看/下载/删除 |
| 学习功能 | FCFS/SJF/RR 教学实验、版本与本人运行观察；原 FCFS API、AI 接口、人工章节练习与后端判分继续保留 |
| 数据 | 兼容迁移、迁移前数据库/文件备份、旧数据隔离保留、可重复初始化 |

课程为演示数据，不代表学校正式教学资料。首页“继续学习”只使用本浏览器会话中当前账号的实际知识点访问，不展示虚构进度或学习统计。

## Windows 11 + VS Code + PowerShell

要求 Python 3.12（建议）、Node.js 22+。VS Code 打开项目根目录。无需激活 venv，不需要修改 PowerShell 执行策略：

```powershell
# 1. 安装依赖
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm.cmd --prefix frontend ci

# 2. 初始化/兼容迁移数据库，不会删除现有数据
cd backend
..\.venv\Scripts\python.exe init_db.py

# 3. 创建自己的本地测试账号，各命令都会安全提示输入并确认密码
..\.venv\Scripts\python.exe manage.py --username myteacher --role teacher
..\.venv\Scripts\python.exe manage.py --username mystudent --role student
# 可再创建第二个学生，用于验证个人文件隔离
..\.venv\Scripts\python.exe manage.py --username secondstudent --role student

# 4. 启动后端；保持此终端运行
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

密码至少 12 字、最多 128 字；**没有默认密码或默认生产账号；学生可在网页自行注册，教师账号由管理员分配**。脚本重复执行不会覆盖已有用户（同名会明确报错）。测试账号只用于自己的本地开发环境。

新开第二个 PowerShell 终端，从项目根目录启动前端：

```powershell
npm.cmd --prefix frontend run dev -- --strictPort
```

本机浏览器地址栏输入 `http://127.0.0.1:5173/login`，选择学生端或教师端。学生可点击“注册学生账号”进入 `/register`，注册成功后返回学生入口登录；教师入口只有登录，不提供教师自注册。脚本创建学生账号是可选的本地测试方式。教师登录后进入 `/teacher/dashboard`，学生进入 `/student/dashboard`。接口文档地址输入 `http://127.0.0.1:8000/docs`。文件上传需登录及 CSRF；Swagger 中可先调用登录和 me 获取 csrf_token，再在需写入的请求中使用 `X-CSRF-Token`（常规操作建议用前端）。

要同时验收教师和学生，可自行新建浏览器标签页，打开 `/login` 分别登录。侧栏不展示额外的多账号入口。新前端用标签上下文选择不同HttpOnly会话Cookie，刷新保持各自账号，退出一个标签不会退出另一个账号。复制已登录标签时，新副本会进入登录页；原标签保持身份。登录页支持重新选择教师或学生账号。新请求不会接受旧身份延迟返回的数据或过期通知；文件查看/下载链接会携带非秘密的上下文选择器，真实登录令牌仍不存于JavaScript存储。

## Linux / macOS

```bash
bash scripts/install.sh
cd backend
../.venv/bin/python init_db.py
../.venv/bin/python manage.py --username myteacher --role teacher
../.venv/bin/python manage.py --username mystudent --role student
cd ..
# 终端一
bash scripts/backend.sh
# 终端二
npm --prefix frontend run dev -- --strictPort
```

默认只监听回环地址。Vite `/api` 代理后端，前端与 API 同源，不需要放开跨域。

## AI 可选配置

复制 `backend/.env.example` 为 `backend/.env`，只在后端安全填写：

```dotenv
LLM_MODE=openai
LLM_API_KEY=请在本地安全填入自己的密钥
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
DATABASE_PATH=data/assistant.db
```

修改后重启后端。无密钥时 AI 接口明确返回 503“尚未配置 AI 服务”，不影响课程、资料、算法和练习。OpenAI 兼容服务可修改 HTTPS 地址与模型。显式 `LLM_MODE=mock` 仅供演示测试，不代表真实模型调用。

密钥不能加 `VITE_` 前缀、不能写入前端、不能提交 `.env`。后端进程环境变量优先于 `.env`。每次聊天为单问调用，不携带完整多轮历史；成功问答仅所属账号可查询。未实现 RAG 或可靠资料溯源。

## 自动测试

从根目录执行：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd --prefix frontend run build
# 可选：准备 Playwright 浏览器（仅首次需要）
cd frontend
npx.cmd playwright install chromium
cd ..
# 使用独立临时数据库、随机账号和服务端口，不写个人数据库
.\.venv\Scripts\python.exe scripts\verify_v02.py
```

Linux 使用 `.venv/bin/python`。如果已有系统 Chromium，验收脚本会自动使用 `/usr/bin/chromium`；也可设置 `BROWSER_EXECUTABLE` 为实际浏览器路径。

`verify_v02.py` 自动在 8010/5174 启动隔离的后端/前端，创建临时随机密码并运行 HTTP + 浏览器验收，结束后停止自己启动的服务并删除临时目录；不读取你的真实 AI 密钥做收费调用。需要 Node、前端依赖与可用浏览器。该命令可能需要十余秒，端口占用时应先停止自己的冲突进程。

对已运行的本地系统，仅做实际接口冒烟：

```powershell
.\.venv\Scripts\python.exe scripts\smoke.py --username mystudent
```

交互输入学生密码；会创建再删除一份临时个人资料，不修改课程。默认示例章节需存在。AI 未配置时检查 503，不主动调用收费模型。

## 数据库与备份

默认数据库 `backend/data/assistant.db`，上传目录 `backend/data/uploads`。均被 Git 忽略。迁移前自动在 `backend/data/backups/<UTC时间>/` 保存数据库一致性快照和 uploads 副本；失败时不会进入新结构迁移。升级前仍建议停止后端，额外备份整个 data 目录。

V0.1 `materials`、`knowledge` 重命名为 `documents`、`knowledge_points`，保留 ID 和原有字段，并保留旧名称的只读视图；新增所有者、章节 ID、发布状态、用户、会话、课程和资料知识点关系。不要继续用旧表名写数据。初始化会自动补齐旧版本，重复运行不会重复插入演示内容。

**旧的个人资料和问答没有可靠所有者，升级后保留在数据库和文件目录但对新账号不可见。** 不会自动归给第一个学生，也不会公开给教师。需要恢复归属时应另做经过明确确认的管理员数据迁移。本轮没有提供随意认领入口。旧公共资料保持公开演示属性，章节名称尽可能映射为 ID；知识点显式关联由教师维护。

删除章节仅允许删除空章，有关联知识点、题目或资料时返回 409，不级联删除。取消发布优先于删除。恢复备份时应停止服务，保存当前目录后再整体恢复匹配的数据库及上传文件，不要混用两个时点的数据。

## 结构与阅读顺序

```text
backend/app/
  migrations.py    版本迁移、备份与 V0.1 兼容
  auth.py          Argon2、Cookie 会话、CSRF、角色依赖
  access.py        内容可见性与资料所有权
  teaching.py      教师章节/知识点/资料元数据/题目接口
  learning.py      已发布课程、章节、知识点、练习与 FCFS
  files.py         上传、受控存储、授权下载
  main.py          生命周期、资料 CRUD、现有 AI 与问答记录
  algorithms.py    不依赖数据库和 AI 的 FCFS 纯函数
frontend/src/
  auth.tsx         登录状态恢复与上下文
  main.tsx         双角色路由、守卫与布局、旧路由兼容跳转
  api.ts           请求封装、CSRF、401 处理、类型
  pages/teacher/   教师管理表格和表单
  pages/           学生学习页面与 Login
  Markdown.tsx     受控标签的基础正文排版，不执行 HTML
scripts/           安装/启动、接口冒烟、隔离浏览器验收
```

先理解 `auth.py → access.py → teaching.py`：前端守卫负责界面，后端身份/角色/所有者检查负责实际权限。课程发布规则同时应用于列表、知识点详情、文件直链和问答资料上下文。

## 常见问题与边界

- `npm.ps1` 受执行策略限制：使用 `npm.cmd`，无需修改系统策略。
- `No module named app`：启动后端、运行 init_db/manage 时先进入 backend；pytest 从根目录执行。
- 401：未登录或 8 小时会话过期，重新登录；403：角色不足、CSRF 过期或请求来源错误。
- 刷新后跳登录：检查后端是否运行，是否禁用 Cookie，是否混用了 localhost 与 127.0.0.1。Cookie 不存于 localStorage。
- 看不到刚创建的内容：检查课程、章节和内容本身的发布状态；公共文件上传后默认草稿。
- 上传：仅非空 PDF / UTF-8 TXT，教师公共PDF ≤150 MiB，TXT/个人文件 ≤10 MiB；请求解析前限制并磁盘暂存；随机存储名、编码/文件头检查、授权文件访问。不是杀毒或完整 PDF 格式审查；PDF 未抽取正文，TXT 最多提取 50000 字。
- Vite 端口/代理改变：默认 API 在 8000、前端 5173。可用 `API_PROXY_TARGET` 覆盖代理目标，并同步后端 `APP_ORIGINS`（逗号分隔的准确前端 Origin）；不要添加任意公网来源。
- 测试浏览器下载失败：本机执行 `npx playwright install chromium`；在云环境可用已有系统 Chromium。Windows 实机和真实 AI 仍需你本机验收。
- 开发脚本不含密码重置；忘记密码应另做管理员恢复操作，不能直接删库。

本轮没有公网部署、登录防暴力破解与完整审计/找回密码、生产 TLS、课程选课/授课分配、PPTX、SJF、完整 Markdown/RAG、AI 出题、主观题评分或正式学习记录。新增登录不代表已经达到生产安全标准；继续仅在可信本地开发运行。
