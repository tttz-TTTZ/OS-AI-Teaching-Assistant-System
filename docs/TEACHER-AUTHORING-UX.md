# 教师知识点编写：分步工作区改版

2026-10-16。依据用户实际试用反馈：操作区过小，同页事务太多，先定章/节/标题再编写正文的流程不清晰。本轮保留 React、FastAPI、SQLite 及既有内容与权限，重做教师编写动线。

## 设计与实际操作

采用“一个页面处理一类任务”的方式；表单纵向排列，顶部步骤导航保留位置提示。参考通行的管理后台分步表单、渐进展示模式。本环境无法访问外部设计站点，不宣称已审阅或复制某个小程序的具体实现。

1. **课程目录**：先新建章节，再添加小节。两种编辑操作都进入独立整页表单。教材编号、页码可留空、以后修订；不要求先录完正文。
2. **添加知识点标题**：选择章/节，每行一个标题，一次最多 30 个。提交一次建立整批草稿，失败整批回滚，不会给学生发布空内容。单个标题创建后进入基本信息；多个标题回到目录。
3. **知识点内容**：从目录选择“编写内容”，进入独立工作区。
4. **基本信息**：专门处理标题、归属、编号、顺序、摘要。章/节和来源页码不绑定数据库 ID。
5. **编写内容**：用“正在编写的模块”切换学习目标、导入、概念、精讲、案例、易错点、总结。一次只展开一个编辑器，底部目录只列标题。图片、图表、交互演示可按需要添加、复制、调整顺序或删除，不再把所有块的长表单同时铺开。动画随教学内容插入适当位置，不必到另一个独立系统录入。
6. **资料与关联**：专门维护出处/页码、前后知识点和实验关联；提供进入题库、公共资料的入口。在知识点入口打开题库可预选当前知识点；具体题目仍在题库维护。
7. **预览发布**：先整页阅读学生呈现，再查看检查清单，确认后发布。保存草稿不等于发布；章节、小节未发布也会影响学生可见性。
8. **版本记录**：历史版本、恢复为草稿、复制、归档独立放在这里。教师反馈移到独立页面，从工作台进入。

正文、学习目标、图片、图表、已有交互模板、练习跳转等原有能力保留。新增的是教师工作流，不表示正式教案已校对录入，也没有新建自由拖拽动画编辑器。

## 保存与边界

- 默认停笔 2 秒自动保存，可关闭；另有“保存草稿”。切换步骤和编辑器内返回列表前会先保存，保存失败停留当前步骤并提示。
- 未保存编辑按当前账号与知识点保存在本标签会话缓存；刷新后可恢复。关闭标签、浏览器清理、存储空间耗尽不保证保留；**仅后端确认保存的内容进入数据库**。
- 已有草稿被其他页面更新时，版本检查拒绝覆盖并保留当前编辑。重新读取会对未保存内容要求确认。
- 离开页面存在未保存改动时请求浏览器离开提示；通过侧栏离开后重新打开同一知识点，可恢复该标签的缓存。不会伪称所有离开行为均已自动入库。
- 模块删除对已填写内容要求确认；草稿修改不影响已发布版本，仍需显式重新发布。
- 本轮无数据库结构迁移，不删除数据库、文件、章节和原知识点 ID，无新增运行依赖。
- 历史“教材七章批量对齐”按钮移出常用章节界面，避免与正常编辑混淆；后端保护接口仍保留，既有数据不自动改动。以前文档提到的旧同屏入口以本指南为准。

## 关键文件与接口

| 文件 | 用途 |
|---|---|
| frontend/src/pages/teacher/CourseOutline.tsx | 章/节/知识点层次、批量标题规划 |
| frontend/src/pages/teacher/Chapters.tsx | 独立章节、小节表单 |
| frontend/src/pages/teacher/Knowledge.tsx | 五个任务步骤、预览发布与版本 |
| frontend/src/pages/teacher/Authoring.tsx | 页面框架与步骤导航 |
| frontend/src/learning/useAuthoring.ts | 保存、缓存恢复、失败与版本冲突 |
| frontend/src/learning/BlockEditor.tsx | 全宽单模块编辑 |
| frontend/src/pages/teacher/LearningFeedback.tsx | 独立教学反馈页 |
| frontend/src/style.css | 教师工作区纵向布局与尺寸 |
| backend/app/digital.py | 教师单条草稿读取、事务性批量创建 |

新增 `GET /api/teacher/learning-content/{id}`、`POST /api/teacher/learning-outline`，均检查教师权限；后者接收 `chapter_id`、可空 `section_id`、`titles` 数组。学生调用返回 403。其余内容保存、发布、历史、资料、练习接口复用原实现。

页面：`/teacher/chapters`、`/teacher/chapters/new`、`/teacher/chapters/:id/edit`、`/teacher/sections/new`、`/teacher/sections/:id/edit`、`/teacher/knowledge`、`/teacher/knowledge/new`、`/teacher/knowledge/:id/{settings|content|resources|preview|history}`、`/teacher/learning-feedback`。

## 更新和启动（Windows PowerShell）

先停止运行中的前后端，在项目根目录执行；若 Git 提示有本地修改，先检查并保留，不要强制覆盖。

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System
git switch feat/development-foundation
git pull --ff-only
```

本轮没有新增依赖。若此前数字教材版本的依赖尚未补齐，执行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm.cmd --prefix frontend ci
```

后端终端：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System\backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另开前端终端：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System
npm.cmd --prefix frontend run dev -- --strictPort
```

## 验收与验证范围

教师按上述 1—8 步创建一个测试章节、小节和两个知识点；关闭自动保存试写、刷新确认恢复，再保存；填齐一份内容并发布；学生打开同一知识点确认版面与互动/练习入口。修改已发布内容但不重新发布，学生应仍看到旧版；未发布知识点学生不可读。

自动化命令（云端 Linux，使用临时数据库，不替换用户本地库）：

```bash
cd backend
../.venv/bin/python -m pytest -q
cd ..
npm --prefix frontend run build
.venv/bin/python scripts/verify_v02.py
```

本轮验证：后端 55 项通过；TypeScript 与生产构建通过；HTTP 和真实浏览器流程通过。浏览器覆盖独立章/节表单、批量标题、单个正文可见且编辑宽度至少 650 像素、跨步骤保存、刷新恢复未保存草稿、整页预览发布，以及既有双角色/双标签登录、注册、资料越权、FCFS、练习和学习记录。另有空标题整批拒绝、创建草稿学生不可见、学生不得使用教师规划接口的后端检查。

以上属于自动化和截图检查，尚未在用户 Windows 电脑进行人工验收；真实教师长期录入的便利程度仍需下一轮试用反馈。阿里云部署不属于本轮，未对用户服务器做变更。
