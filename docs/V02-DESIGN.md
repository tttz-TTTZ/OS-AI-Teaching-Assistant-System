# V0.2 设计与分阶段变更计划

## 基线

React 19 / TypeScript / Vite 6，无组件库；FastAPI / sqlite3；Git 干净，当前分支 feat/development-foundation。25 项后端测试、依赖检查、前端构建在变更前通过。实际启动前后端并检查代理健康接口。

本地数据库 quick_check=ok：7 chapters、7 knowledge、7 questions、1 materials、1 conversations；uploads 无文件。不据此判定旧数据可删除，问答一律按个人数据处理。

## 数据设计

- users：唯一用户名、Argon2 哈希、teacher/student、启用状态；角色由管理员初始化命令指定，不允许客户端自选注册角色。
- sessions：随机会话令牌的 SHA-256 摘要、user_id、过期时间、CSRF 令牌；HttpOnly / SameSite cookie，不将登录令牌放 localStorage；退出删除数据库会话。
- courses：统一演示课程及发布状态；本轮教师管理同一课程，不做复杂选课/授课分配。
- chapters：course_id、sort_order、published；保持原主键。
- knowledge_points：原 knowledge 表兼容重命名，保留内容和主键，新增 published。
- documents：原 materials 表兼容重命名，新增 owner_id、chapter_id、course_id、published，原文件名/路径/正文保留；category public/personal 保留。
- document_knowledge_points：资料和知识点多对多。
- questions：原题目结构保留，新增 published；由章节定位课程。
- conversations：新增 user_id；旧无归属记录保留而不展示给任意新用户。

## 迁移策略与风险

迁移前用 SQLite backup API 一致性备份，复制 uploads，保存于受忽略的 backend/data/backups 下；版本表标记迁移，仅执行一次。备份失败则不开始迁移。

表重命名不改变现有 ID；旧名称保留只读兼容视图。新代码写入规范表名。已有章节和知识点标记为发布，属于演示课程；旧公共资料按章节名称尽可能映射，作为演示公开内容保留。旧个人资料 owner_id=NULL：隔离，不自动给首个学生；旧问答同样保留且不公开。后续明确所有权后另做管理员迁移。

章节删除只允许无知识点/题目/资料关联的空章节，避免级联丢数据；章节名称不再是关联键。知识点和公共资料可取消发布；课程/章节未发布时其内容也不可向学生访问。文件列表、详情、下载、删除、聊天上下文均走同一授权规则。

本轮仍沿用 SQLite，不换数据库或 ORM。新增关系与索引；历史列缺少外键约束部分由写入接口验证，升级测试覆盖失效引用。

## 文件计划

阶段 1：docs/requirements.md、本文。
阶段 2：backend/app/auth.py、migrations.py、access.py、backend/manage.py；修改 main.py、files.py、learning.py 统一服务端授权，新增认证/越权/迁移测试。
阶段 3：frontend/src/auth.tsx、pages/Login.tsx、main.tsx、api.ts、独立教师/学生路由，复用现有学习页面。
阶段 4：backend/app/teaching.py、教师章节/知识点/题目管理页面与真实 CRUD/发布接口。
阶段 5：扩展 files.py 及资料页面，owner 校验、公共资料发布、知识点关联。
阶段 6：学生首页紧凑布局、三栏知识点详情、正文排版、状态反馈。
阶段 7：pytest、实际服务 HTTP、浏览器双角色/越权/刷新测试；README、API、验收报告。

认证先用成熟 Argon2 库哈希；会话是标准服务端 cookie 机制，CSRF 头保护写操作，不设计加密协议。不提供生产默认凭据，账号初始化交互读取密码。只监听回环地址。
