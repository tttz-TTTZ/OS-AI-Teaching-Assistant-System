# V0.2 API 与数据模型

统一 `/api`。JSON 请求及响应；文件上传用 multipart。除 health/login/register 外，业务接口均需会话 Cookie。浏览器通过非敏感 `X-Session-Context` 选择 `os_session_<context>`；文件链接用 `session_context` 查询参数。未传上下文的旧 API 客户端继续使用 `os_session`。选择器本身不能认证，必须同时携带对应 HttpOnly Cookie。Cookie 为 HttpOnly、SameSite=Strict、Path=/api；本地 HTTP 下 Secure=false，配置 COOKIE_SECURE=true 时需 HTTPS。

写操作还需 `X-CSRF-Token`，由登录或 me 响应取得。浏览器前端自动处理。401 表示未登录/会话过期；403 表示角色不足、CSRF/来源校验失败；404 同时用于内容不存在或不可读，避免透露私人资料；422 参数错误；409 章节仍有关联内容。

## 账号

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 无需登录；数据库状态和 AI 配置标志，不证明模型可调用 |
| POST | /api/auth/register | `{"username":"自选用户名","password":"12–128字符密码"}`；201 返回 id/username/role=student，不自动登录；重名409、非法字段/密码422、来源拒绝403 |
| POST | /api/auth/login | `{"username":"自己的账号","password":"自己的密码"}`，返回 id/username/role/csrf_token，设置 Cookie |
| GET | /api/auth/me | 同上用户信息，不返回密码哈希或会话令牌 |
| POST | /api/auth/logout | CSRF 校验；撤销当前服务端会话并清 Cookie，204 |

密码 Argon2id 哈希；会话随机 256 位令牌，数据库只保存 SHA-256 摘要，8 小时过期。登录可传 expected_role=student/teacher，用于验证账号是否匹配所选入口，匹配失败403，不签发会话；该参数不能赋予角色。学生可匿名调用注册接口，后端固定创建 student，拒绝 role/is_admin 等额外字段。注册不签发 Cookie，不影响其他标签已有会话。教师由管理员 manage.py 或已有管理员账号管理功能创建，不提供教师自注册或默认密码。

## 学习接口（教师可读草稿，学生仅可读已发布内容）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/courses | 可见课程；本版统一一门演示课程 |
| GET | /api/chapters | 按 sort_order、id 排序 |
| GET | /api/knowledge?chapter_id=3 | 可见知识点列表 |
| GET | /api/knowledge/{id} | 详情，materials 为经授权过滤的显式关联资料 |
| GET | /api/questions?chapter_id=1 | 题目与 options，不返回 answer/explanation |
| POST | /api/practice/submit | `{"answers":{"1":0}}`；0-based 选项；返回 score/total/results（答案、解析） |
| POST | /api/labs/fcfs | 保留原 FCFS 输入输出，必须登录和传 CSRF |
| POST | /api/chat | `{"question":"...","material_id":1}`，资料可选，引用前检查所有权/发布状态 |
| GET | /api/conversations | 最近 50 条本人成功问答；历史无归属记录不公开 |

FCFS 输入 `{"processes":[{"pid":"P1","arrival":0,"burst":4}]}`。最多 100 进程，ID 去空格唯一，arrival≥0、burst>0 且有限，均≤1000000。稳定排序到达时间，返回 results（start/completion/waiting/turnaround）、timeline（含 idle）、平均指标。无需 AI。

AI 仅后端读 LLM_API_KEY，兼容 HTTPS Chat Completions 非流式接口；成功返回 id/answer/model/mode 并记录 user_id。503 未配置，502 上游错误/响应无效，504 超时。默认 openai，无密钥不编造回答；显式 mock 仅演示。每次为单问调用，无完整多轮记忆/RAG。

## 资料接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/materials?limit=50&offset=0&category=personal | 公共已发布资料 + 本人个人资料；教师可读公共草稿，但不可读其他人的私有文件 |
| POST | /api/materials | 原文本 CRUD 兼容入口：title/content/chapter；自动创建本人个人资料，不接受客户端指定所有者/公共角色 |
| GET | /api/materials/{id} | 资料详情，统一授权 |
| PUT | /api/materials/{id} | 原文本编辑入口；本人私有或教师公共资料 |
| DELETE | /api/materials/{id} | 本人私有或教师公共资料；204；删除物理文件与资料关联 |
| POST | /api/materials/upload | multipart：file、可选 chapter_id、category=personal/public；兼容旧 chapter 名称字段；public 仅教师 |
| GET | /api/materials/{id}/file | 授权内联查看；download=true 下载；不提供 uploads 静态目录 |

文件 ≤10 MB，请求体 ≤11 MB（解析前限制）；类型仅 PDF/TXT，PDF 检查头，TXT 验证 UTF-8/NUL，使用 UUID 服务端名。非法类型415、过大413、空文件422。新公共上传为草稿；个人文件无论学生还是教师只能本人访问。文件访问与 API 响应 no-store。

返回字段：id、title、content、chapter（兼容显示）、chapter_id、course_id、category、owner_id、published、original_name、stored_name、file_size、file_type、created_at、updated_at。客户端不能将 stored_name 作为任意路径传入下载接口。PDF 无正文提取；TXT 正文最多 50000 字。

## 教师管理（路由级 require teacher）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST | /api/teacher/chapters | 列表 / 新增 |
| PUT / DELETE | /api/teacher/chapters/{id} | 编辑 / 删除空章节，关联内容存在返回409 |
| GET / POST | /api/teacher/knowledge | 列表 / 新增 |
| PUT | /api/teacher/knowledge/{id} | 编辑、调整章节、发布状态 |
| GET | /api/teacher/documents | 公共资料（含草稿）及 knowledge_ids |
| PUT | /api/teacher/documents/{id} | 标题、章节、多知识点、发布；仅公共资料 |
| GET / POST | /api/teacher/questions | 列表（含答案）/ 新增人工题 |
| PUT | /api/teacher/questions/{id} | 编辑、发布 |

章节请求：`{"title":"新章","description":"...","course_id":1,"sort_order":10,"published":false}`。
知识点：`{"chapter_id":1,"title":"概念","content":"# 标题\n正文","lab_path":null,"published":false}`；lab_path 只允许现有 FCFS 路径。
资料元数据：`{"title":"讲义","chapter_id":1,"knowledge_ids":[1,2],"published":true}`；知识点必须与资料同课程，chapter_id 可空。
题目：`{"chapter_id":1,"prompt":"问题","options":["A内容","B内容"],"answer":0,"explanation":"解析","published":false}`。

课程、章节、知识点/题目任一层未发布时学生不可读。公共文件受课程、自身及所属章节状态控制；知识点的取消发布会隐藏该知识点，但不会自动撤销一个独立已发布文件（应在资料管理中取消发布文件本身）。

## 数据库

| 表 | 关键关系 |
|---|---|
| users | username 唯一、password_hash、teacher/student、active |
| sessions | token_hash 主键、user_id、csrf_token、expires_at |
| courses | title、description、published、is_demo |
| chapters | course_id、sort_order、published，保留原 id |
| knowledge_points | chapter_id、title、content、lab_path、published |
| documents | course_id、chapter_id、owner_id、category、published、受控文件元数据 |
| document_knowledge_points | document_id + knowledge_point_id 复合主键；文档删除级联移除关联 |
| questions | chapter_id、prompt、options JSON、answer、explanation、published |
| conversations | user_id、历史 material_id、question、answer、model、mode |
| schema_versions | 迁移标记，防止重复初始化 |

V0.1 表 materials/knowledge 迁移为规范名，旧名称为只读兼容视图。旧个人资料 owner_id=NULL、旧问答 user_id=NULL，保留不公开。旧 chapter 文本仅用于显示和旧 API 兼容，新的关系使用 ID。历史表中未重建的外键通过写入校验和删除限制维护；不要绕过 API 直接改数据库。


## 数字教材增量接口

权限仍使用现有标签Cookie和CSRF；教师接口始终后端鉴权。详细边界见 DIGITAL-TEXTBOOK-DELIVERY.md。

| 方法/路径 | 行为 |
|---|---|
| GET /api/sections | 学生只读可见章下已发布小节；教师可管理草稿 |
| POST /api/teacher/sections，PUT /api/teacher/sections/{id} | 小节编号/标题/排序/发布；不会删除知识点 |
| GET /api/learning-content，GET /api/learning-content/{id} | 摘要目录与已发布结构化详情；preview=true仅教师 |
| GET/POST /api/teacher/learning-content，PUT /api/teacher/learning-content/{id} | 教师目录、新建与保存草稿；expected_version冲突409 |
| POST /api/teacher/learning-content/{id}/{publish,withdraw,archive,restore} | 独立发布动作；restore需revision_id，只恢复新草稿 |
| GET /api/teacher/learning-content/{id}/history | 不可变修订历史（限最近100条） |
| POST /api/teacher/learning-assets，GET /api/learning-assets/{id} | 图片上传与授权读取，不提供公开静态路径 |
| POST /api/learning-content/{id}/run | block_id/revision_id/config生成真实模拟事件，返回运行ID |
| POST /api/interaction-runs/{id}/complete | 本人运行记录last_step核对，记录观察操作完成 |
| GET/PUT /api/learning-content/{id}/progress | 本人记录；PUT需revision_id和expected_version |
| GET /api/my/learning-resume | 本人最近可访问的已保存学习位置 |
| POST /api/learning-content/{id}/feedback | 主动反馈message，与私人笔记分开 |
| GET /api/teacher/study/summary | 当前发布修订真实学习计数与主动反馈，无私人笔记 |
| GET /api/teacher/study/questions，POST/PUT对应题目路径 | 多题型、知识点关联，更新带expected_version |
| GET /api/study/questions?chapter_id=或knowledge_id= | 最多100题，不返回标准答案/解析 |
| POST /api/study/submit | request_key/answers/versions，可选knowledge_id/revision_id；本人幂等成绩快照 |
| GET /api/study/attempts | 本人最近50次成绩及错题；简答correct=null、ungraded计数 |

旧单选接口保留；已由新版管理的知识点/题目不能用旧写接口绕过版本控制。页码自由文本仅是引用说明，不提供未经授权的文件访问能力。
