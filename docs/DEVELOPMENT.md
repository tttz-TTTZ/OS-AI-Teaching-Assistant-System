# 人工开发与调试

## 先看这几处

按 `main.tsx → pages → workspace/components → personal.ts/api.ts → 后端路由 → 资料/模型/数据库` 阅读。原 learning 目录已更名为 workspace，里面是当前智慧学习工具；课件预览移入共用 components。

学生现有页面是首页、课程资料、智慧学习和个人账户；教师现有页面是首页、公共资料、账号管理和个人账户。旧知识点教材、课程目录、算法实验、教师题库没有页面或业务模块。

| 修改目标 | 主要文件 |
| --- | --- |
| 顶部导航、登录后路由、角色工作区 | `frontend/src/main.tsx` |
| 智慧学习三栏、选择资料、发问、生成工具 | `frontend/src/pages/StudyWorkspace.tsx` |
| 测验作答、提交、解析与历史 | `frontend/src/workspace/NotebookQuiz.tsx` |
| 学生成果、闪卡和代码展示 | `frontend/src/workspace/PersonalModule.tsx` |
| 资料列表、上传、删除、发布设置 | `frontend/src/pages/Materials.tsx`、`frontend/src/pages/teacher/Materials.tsx` |
| 页面布局和样式 | `frontend/src/style.css` |
| HTTP 请求、资料和账号接口 | `frontend/src/api.ts` |
| 个人 AI 接口及数据类型 | `frontend/src/personal.ts` |
| 应用启动、路由装配与资料接口 | `backend/app/main.py` |
| 教师公共资料发布与编辑 | `backend/app/public_materials.py` |
| 配置读取、数据库路径与事务 | `backend/app/database.py` |
| 连续问答 | `backend/app/personal_chat.py` |
| 学习材料生成、个人自测及判分 | `backend/app/study_tools.py` |
| DeepSeek 请求、响应解析与错误 | `backend/app/ai_provider.py` |
| 授权后读取、解析、检索资料 | `backend/app/personal_sources.py` |
| 完整提炼、导图与闪卡的分批生成 | `backend/app/distillation.py` |
| 资料上传和文件版本 | `backend/app/files.py` |
| 身份、文件可见性与写权限 | `backend/app/auth.py`、`access.py` |
| 数据库升级、完整备份和恢复 | `backend/app/migrations.py`、`persistence.py` |

普通问答链路：页面输入 → `personalApi.ask` → `/api/student/personal/ask` → `personal_chat.py` → 检索资料（可选）→ `ai_provider.py` → 保存个人记录 → 页面显示。

学习工具链路：工具按钮 → 资料预览/检索 → 生成接口 → `study_tools.py`；导图/闪卡还会进入 `distillation.py`。

## Windows 日常运行

项目根目录准备依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements-dev.txt
npm --prefix frontend ci
```

第一次配置时，将 `backend/.env.example` 复制为 `backend/.env`，在本机填写配置。已有 `.env` 时直接使用，不要覆盖。

后端终端：

```powershell
cd backend
..\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

前端终端（根目录）：

```powershell
npm --prefix frontend run dev
```

前端改动由 Vite 自动更新，后端 `--reload` 会重启进程。查看前端终端实际端口；5173 被占用时先关闭自己之前启动的进程，避免看到旧页面。

## VS Code 断点

直接用 VS Code 打开项目根目录。仓库的 `.vscode` 已提供调试配置，并在资源管理器中隐藏缓存、依赖和构建产物；这些文件仍在本机，并没有被删除。

1. 安装推荐的 Python 和 Python Debugger 扩展，执行“Python: Select Interpreter”选择项目 `.venv`。
2. 调试后端：停止普通终端中的后端，按 F5 选择“后端：Python 断点调试”。配置从 `backend/.env` 读取变量，不使用 `--reload`，断点更容易跟踪。
3. 调试前端：先运行前端和后端，再选择“前端：Edge 断点调试”。调试器打开 `127.0.0.1:5173`，可在 TSX 中下断点；若前端使用其他端口，同步修改 launch.json 的 url。
4. 查看请求：浏览器开发者工具 Network 筛选 `/api/`；查看请求内容、状态码和响应。后台模型与检索日志在后端终端。数据库路径和连接统一在 `backend/app/database.py`，业务模块不应反向导入 `main.py`。

不要同时用普通命令和 F5 在同一端口启动两个后端。修改数据相关代码时先备份，升级规则见 [数据库清理说明](DATABASE.md)。

## 验证改动

```powershell
.\.venv\Scripts\python -m pytest -q
npm --prefix frontend run build
```

构建会检查 TypeScript 类型、未使用的局部变量/导入和参数。后端测试默认使用临时数据库和模型替身，不调用真实付费模型，也不改正常运行库。

浏览器检查：`scripts/pages-browser.cjs` 检查页面与旧地址；`landscape-browser.cjs` 检查布局；`notebook-quiz-browser.cjs` 检查五种题型。仅对隔离测试服务使用，通过 `TEST_ACCOUNTS_FILE` 读取临时账号，通过 `BROWSER_EXECUTABLE` 选择浏览器。不要把账号文件提交到 Git。

`backend/tests/fixtures/` 存放合成课件、模型替身和旧库结构；它们只用于测试，不参与正常启动。`scripts/evaluate_distillation.py` 在临时目录中检查提炼覆盖，不代表真实模型质量。

## 目录边界

- `backend/app`、`frontend/src`：当前程序。
- `backend/tests`：回归测试，样例与测试数据也在这里。
- `scripts`：安装/启动及当前有效的验收脚本。
- `docs/DATABASE.md`：已有数据库升级与恢复。
- `backend/data`：本机数据库、上传文件与备份；`.env` 是本机配置。它们不提交 Git，本次清理不改动这些数据。

## 手动跟踪一次请求

1. 问答：在 `StudyWorkspace.tsx` 的发送处理处下断点，跟到 `personal.ts` 的 `personalApi.ask`，浏览器 Network 检查 `/api/student/personal/ask`，再进入 `personal_chat.py` 的 `ask`。无资料也可以提问；有资料时进入 `personal_sources.py`，模型请求进入 `ai_provider.py`。
2. 工具生成：跟踪 `personalApi.generate` 和 `/api/student/personal/generate`，后端断在 `study_tools.py` 的 `generate`；导图和闪卡继续进入 `distillation.py`。结果由 `workspace/PersonalModule.tsx` 展示。
3. 测验：从 `workspace/NotebookQuiz.tsx` 跟到 `/api/student/personal/jobs/{id}/submit`，后端断在 `study_tools.py` 的 `submit`；题型校验在 `self_test.py`，作答记录仍归当前个人账号。
4. 资料：从学生或教师 Materials 页面跟到 `api.ts`，上传、替换、下载和预览进入 `files.py`；教师发布设置进入 `public_materials.py`。共用课件预览在 `components/PresentationPreview.tsx`。
5. 登录/权限：从 `Login.tsx`、`auth.tsx`、`session.ts` 跟到 `auth.py`；文件权限在 `access.py`；账号管理在 `accounts.py`。

调试时先看 Network 的第一个失败请求，再定位对应处理函数。401/403 查看登录上下文与权限，404 核对路由和记录 ID，422 查看请求字段，模型错误查看后端终端与 DeepSeek 配置。不要只根据目录名判断功能是否停用。

## 必须保留的支持代码

`migrations.py` 和测试用 `fixtures/v9_schema.sql` 需要出现旧表名，用于验证旧库清理、备份与回滚，不是旧模块入口。`legacy_ppt.py` 是仍在使用的 PPT 文件格式解析器。历史 AI 结果的只读兼容保护已有成果；资料提炼中的存储字段保持兼容，不为目录改名而重建记录或重复计费。

历史章节实施报告、算法/动画规格、旧升级设计和历次清理记录已从当前树移除，需要查考时使用 Git 历史。当前说明只保留 README、这份维护指南以及数据库升级恢复指南。
