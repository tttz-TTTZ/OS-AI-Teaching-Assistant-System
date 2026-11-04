# 操作系统课程 AI 助教系统 · V0.3

以资料和个人智能问答为核心。教师管理公共资料与账号；学生查看公共资料、上传个人资料、连续提问，并生成讲解、导图、闪卡和个人自测。

旧课程目录、知识点教材、算法实验、教师题库/AI出题和学生正式章节练习已移除；旧模拟回放、聊天栈及入口代码也已删除。目录/教材等旧数据库存储由 schema 10 迁移清理。个人 AI 自测和已有个人学习成果保留。

完整删除清单和保留依据见 [大清理核对表](docs/CLEANUP-REVIEW.md)。

**已有安装先阅读 [数据库清理与 Windows 更新说明](docs/DATABASE-CLEANUP.md)。** 首次启动自动备份现有数据库及上传文件，再进行 schema 10 迁移；不要删除整个 data 或 uploads 目录。

## 开发运行

人工开发先看 [代码地图、Windows 运行和 VS Code 断点调试](docs/DEVELOPMENT.md)。

后端使用 Python、FastAPI、SQLite；前端使用 React、TypeScript、Vite。后端运行依赖在 `backend/requirements.txt`，开发测试依赖在 `backend/requirements-dev.txt`；前端依赖由 `frontend/package-lock.json` 锁定。

Windows 在项目根目录：

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements-dev.txt
npm --prefix frontend ci
```

后端（单独终端）：

```powershell
cd backend
..\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

前端（项目根目录另一终端）：

```powershell
npm --prefix frontend run dev
```

后端配置见 `backend/.env.example`，复制为 `backend/.env` 后在本机填写密钥。个人学习使用 `DEEPSEEK_*`；个人每日任务默认不限，已有 `PERSONAL_AI_DAILY_LIMIT=20` 请改为 `0` 并重启。资料大小、单任务并发、完整提炼每日 60 次模型调用保护及模型服务商限制仍然适用。密钥不得提交至 Git。

首次安装学生可自行注册；教师/管理员账号在 backend 目录运行 `..\.venv\Scripts\python manage.py --username 教师用户名 --role teacher --admin` 创建（密码交互输入），不开放网页注册教师。已有账号和密码在本次迁移中保留。

## 验证

```powershell
cd backend
..\.venv\Scripts\python -m pytest -q
cd ..
npm --prefix frontend run build
```

浏览器验收脚本为 `scripts/v03-browser.cjs`，仅对隔离验收服务使用；通过 `TEST_ACCOUNTS_FILE` 指定临时教师/学生账号文件。

`docs/reports` 和 `docs/learning` 保留课程研究及学习记录，不参与程序运行。旧模块说明已从当前目录清理，可在 Git 历史中查阅。GitHub 推送、应用部署与编辑环境发布彼此独立。
