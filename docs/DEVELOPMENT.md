# 人工开发与调试

## 先看这几处

| 修改目标 | 主要文件 |
| --- | --- |
| 顶部导航、登录后路由、角色工作区 | `frontend/src/main.tsx` |
| 智慧学习三栏、选择资料、发问、生成工具 | `frontend/src/pages/LearningNotebook.tsx` |
| 测验作答、提交、解析与历史 | `frontend/src/learning/NotebookQuiz.tsx` |
| 学生成果、闪卡和代码展示 | `frontend/src/learning/PersonalModule.tsx` |
| 资料列表、上传、删除、发布设置 | `frontend/src/pages/Materials.tsx`、`frontend/src/pages/teacher/Materials.tsx` |
| 页面布局和样式 | `frontend/src/style.css` |
| HTTP 请求、资料和账号接口 | `frontend/src/api.ts` |
| 个人 AI 接口及数据类型 | `frontend/src/personal.ts` |
| 应用启动、路由装配与资料接口 | `backend/app/main.py` |
| 配置读取、数据库路径与事务 | `backend/app/database.py` |
| 连续问答 | `backend/app/personal_chat.py` |
| 学习材料生成、个人自测及判分 | `backend/app/personal_learning.py` |
| DeepSeek 请求、响应解析与错误 | `backend/app/ai_provider.py` |
| 授权后读取、解析、检索资料 | `backend/app/personal_sources.py` |
| 完整提炼、导图与闪卡的分批生成 | `backend/app/distillation.py` |
| 资料上传和文件版本 | `backend/app/files.py` |
| 身份、文件可见性与写权限 | `backend/app/auth.py`、`access.py` |
| 数据库升级、完整备份和恢复 | `backend/app/migrations.py`、`persistence.py` |

普通问答链路：页面输入 → `personalApi.ask` → `/api/student/personal/ask` → `personal_chat.py` → 检索资料（可选）→ `ai_provider.py` → 保存个人记录 → 页面显示。

学习工具链路：工具按钮 → 资料预览/检索 → 生成接口 → `personal_learning.py`；导图/闪卡还会进入 `distillation.py`。

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

不要同时用普通命令和 F5 在同一端口启动两个后端。修改数据相关代码时先备份，升级规则见 [数据库清理说明](DATABASE-CLEANUP.md)。

## 验证改动

```powershell
.\.venv\Scripts\python -m pytest -q
npm --prefix frontend run build
```

构建会检查 TypeScript 类型、未使用的局部变量/导入和参数。后端测试默认使用临时数据库和模型替身，不调用真实付费模型，也不改正常运行库。

浏览器检查：`scripts/v03-browser.cjs` 检查页面与旧地址；`landscape-browser.cjs` 检查布局；`notebook-quiz-browser.cjs` 检查五种题型。仅对隔离测试服务使用，通过 `TEST_ACCOUNTS_FILE` 读取临时账号，通过 `BROWSER_EXECUTABLE` 选择浏览器。不要把账号文件提交到 Git。

`backend/tests/fixtures/` 存放合成课件、模型替身和旧库结构；它们只用于测试，不参与正常启动。`scripts/evaluate_distillation.py` 在临时目录中检查提炼覆盖，不代表真实模型质量。

## 目录边界

- `backend/app`、`frontend/src`：当前程序。
- `backend/tests`：回归测试，样例与测试数据也在这里。
- `scripts`：安装/启动及当前有效的验收脚本。
- `docs/DATABASE-CLEANUP.md`：已有数据库升级与恢复。
- `docs/reports`、`docs/learning`：保留的课程研究和学习笔记，不是运行依赖。
- `backend/data`：本机数据库、上传文件与备份；`.env` 是本机配置。它们不提交 Git，本次清理不改动这些数据。

旧模块与迭代记录可以从清理前的 Git 提交 `044e564` 查看，例如 `git show 044e564:docs/SECTION-KNOWLEDGE-PILOT.md`。历史研究报告中的旧实现链接也应按该版本阅读。

当前保留功能已通过 112 项后端回归、5 项独立导入检查、前端构建、28 项通用页面检查及横屏/测验专项检查。VS Code 配置的 JSON 已校验，实际 F5 调试需在本机安装推荐扩展并选择解释器。

本轮完整删除清单与保留依据见 [大清理核对表](CLEANUP-REVIEW.md)。运行依赖与测试依赖已拆分，Pillow 及旧聊天的 LLM_* 配置不再需要。
