# V0.2 验收报告与本机操作

## 逐阶段结果

| 阶段 | 主要文件 | 真实实现与阶段检查 |
|---|---|---|
| 1 检查/设计 | requirements.md、V02-DESIGN.md | 用户确认需求与保留 React；变更前25项测试、依赖/构建和实际健康接口通过；原数据库只读检查 |
| 2 认证授权 | auth.py、access.py、migrations.py、manage.py、main.py、files.py、learning.py | Argon2、会话、CSRF、所有权/发布可见性；阶段28项测试通过，原功能回归保留 |
| 3 角色布局 | auth.tsx、Login.tsx、main.tsx、api.ts | 教师/学生守卫和菜单、Cookie恢复；实际浏览器验证登录、刷新、角色拦截、退出；构建通过 |
| 4 课程内容 | teaching.py、pages/teacher/Chapters/Knowledge/Questions | 增改、顺序与发布、空章删除限制；教师接口403与草稿/发布实际代理联调通过 |
| 5 资料授权 | files.py、access.py、pages/teacher/Materials、学生Materials | 公共草稿上传/发布/关联，所有者隔离；实际验证文件与AI上下文越权拒绝；阶段30项测试通过 |
| 6 界面联调 | Home.tsx、Knowledge.tsx、Markdown.tsx、style.css | 紧凑首页、实际访问继续学习、三栏阅读、基础正文；完整跨角色浏览器操作通过 |
| 7 最终回归 | tests、smoke.py、verify_v02.py、browser-check.cjs、文档 | 见下方结果；Windows/真实模型单独标注 |

## 本轮实际验证

- 后端自动化：**34项 pytest 测试通过**；覆盖原 CRUD/文件类型大小/FCFS/模拟模型协议，新增认证、CSRF、角色/所有者越权、草稿、课程父级发布、迁移备份与隔离。
- 前端 TypeScript 检查和 Vite 构建通过；依赖完整性检查通过。
- 实际 HTTP：使用真实 Vite 代理与 FastAPI、SQLite；登录/退出、课程、知识点、文件、FCFS、练习、AI未配置503通过。
- 实际 Chromium：隔离临时数据库及随机账号；两角色登录、刷新保留会话、学生错误角色路由拦截、教师写接口403、章节/知识点创建与发布、公共文件上传及关联、发布后读取/撤回后直链拒绝、个人上传删除/另一学生拒绝、AI资料引用拒绝、FCFS空闲时间轴、原练习与教师新增题目判分、后端500提示、退出后401、640px窗口首页加载通过；无 JS 运行时异常。
- 原实例数据库：迁移前后保持 **1份资料、7章节、7知识点、7题目、1条问答**，quick_check=ok；升级前自动备份已生成。自动测试还用带私人文件和问答的旧数据库验证内容/ID/文件不变、快照可读、重复迁移不重复建数据；无归属私人内容不可被新用户读取。
- 未验证：**Windows 11 实机操作、真实大模型凭据/额度、生产部署**。浏览器及服务验证是在 Linux 上执行的，不能代替本机验收。AI测试使用未配置提示和模拟传输，不冒充真实供应商回答。
- 一条 Starlette/AnyIO 的弃用警告不影响测试执行；没有为消除警告而禁用断言或跳过测试。

## 本地启动与验收路径

完整安装命令在 README。已经安装依赖时，从根目录：

```powershell
# 终端一
cd backend
..\.venv\Scripts\python.exe init_db.py
..\.venv\Scripts\python.exe manage.py --username myteacher --role teacher
..\.venv\Scripts\python.exe manage.py --username mystudent --role student
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# 新终端从根目录
npm.cmd --prefix frontend run dev -- --strictPort
```

浏览器地址栏输入 `http://127.0.0.1:5173/login`。同名账号已存在时无需重复创建，不会覆盖其密码。

1. 教师登录后打开“章节管理”，新建章节，保持草稿；在学生隐私窗口确认看不到。
2. 教师新建知识点，选刚才章节，填写正文并勾发布；章节仍草稿时学生不能通过详情ID访问。
3. 发布章节，学生刷新后能在目录看到；改变排序，再刷新观察位置。尝试删除有内容的章应得到409提示，数据保留。
4. 教师打开公共资料，选择PDF/TXT和章节上传；默认草稿。点“设置”，关联知识点，勾发布并保存。
5. 学生从知识点右侧打开资料详情/文件；取消发布文件后，再请求旧直链应失败。已下载的本地副本不能远程收回。
6. 学生上传私人资料，记录URL；用另一个学生或教师浏览器打开应404。退出登录后请求应401。注意两个普通标签页共享同一Cookie，不能用它们冒充独立账号。
7. 学生在知识点页检查标题、段落、列表、表格、代码块；点击FCFS入口。示例2等待均值0，CPU空闲两段；三组算法数据同V0.1保留。
8. 章节练习选择答案提交查看解析；教师可新增人工单选题并发布，学生刷新相应章节可练习。
9. 无AI密钥时发问，应503并明确提示，不产生假回答。自行配置实际密钥重启后才可验收真实回答，会产生供应商费用。
10. 页面刷新不应丢失未过期登录；退出后访问原工作区应跳到登录。登录过期由服务器与前端统一处理。
11. 打开后端8000端口 `/docs` 查看接口；密码哈希、登录Cookie、原始模型错误不会出现在业务返回中。

## 重复自动验收

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm.cmd --prefix frontend run build
# 已安装Playwright浏览器后运行；无需先启动个人开发服务
.\.venv\Scripts\python.exe scripts\verify_v02.py
```

脚本用8010/5174，开始前检查端口冲突；随机凭据仅留在临时目录，结束清理；不写原数据库和真实模型账单。Linux自动使用已有系统Chromium，Windows可先在frontend执行 `npx.cmd playwright install chromium`。`npm run test:browser` 为底层脚本，需专用临时账号文件，通常直接运行Python总验收入口即可。

## 实现程度与下一阶段

**已实现**：本地教师/学生账号权限、可撤销会话、后端写权限与文件所有权校验、统一课程数据、章节排序及增改删、知识点增改、公共/个人文件、资料知识点多对多、发布规则、教师基础题目管理、原FCFS/问答/练习保留、双工作区、兼容迁移与文档。

**部分实现**：单门统一演示课程，无选课/授课分配；基础Markdown（不支持完整规范或HTML）；知识点与题目没有删除管理；课程内容仅少量示例；TXT正文截取、PDF不提取；继续学习仅本浏览器会话实际访问；单问AI接口而非完整上下文会话。

**尚未实现**：公网生产安全、登录防暴力破解、审计、找回密码、用户管理UI、PPTX、RAG、SJF、完整学习记录、AI出题、主观题评分。旧无归属个人内容暂时隔离，不提供自动认领。

下一阶段建议先由你在Windows逐项验收并确认教材章节，再做账号恢复/管理和真实学习记录；不急于部署公网或加入复杂AI能力。
