# 基础接口 v0.1

前端请求以 `/api` 开头；JSON 请求及响应，删除成功返回空体。当前没有认证，仅用于本地开发。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/health | 检查数据库连接、返回模型模式（不检测模型可用性） |
| GET | /api/materials?limit=50&offset=0 | 分页资料列表，limit 1–100 |
| POST | /api/materials | 创建资料，201 |
| GET | /api/materials/{id} | 获取资料 |
| PUT | /api/materials/{id} | 替换资料 |
| DELETE | /api/materials/{id} | 删除资料，204 |
| POST | /api/chat | 调用模型并持久化问答记录 |
| GET | /api/conversations | 最近 50 条问答 |

资料输入：`{"title":"进程管理","chapter":"第二章","content":"进程是资源分配的单位"}`。title 长度 1–200，content 最长 50000，chapter 最长 100。响应额外包含 id、created_at、updated_at（UTC）。PUT 未提供 content/chapter 时重置为空字符串。

问答输入：`{"question":"解释进程","material_id":1}`。question 长度 1–8000；material_id 可省略，指定时读取资料正文作为模型上下文（只是直接注入参考资料，未实现检索增强）。响应：`{"id":1,"answer":"...","model":"mock","mode":"mock"}`。真实调用 mode 为 openai。

```bash
curl -X POST http://127.0.0.1:8000/api/materials -H 'Content-Type: application/json' -d '{"title":"进程管理","content":"进程是资源分配的单位"}'
curl -X POST http://127.0.0.1:8000/api/chat -H 'Content-Type: application/json' -d '{"question":"解释进程","material_id":1}'
```

错误使用 FastAPI 的 `detail` 字段：404 资料不存在；422 参数错误；503 模型配置缺失/无效；502 上游错误或无效响应；504 上游超时。上游错误不透出凭据或原始响应。

## 数据设计

- materials：id 主键；title、content、chapter；created_at、updated_at。
- conversations：id 主键；material_id 可空的历史资料编号；question、answer、model、mode、created_at。

material_id 是历史引用而非外键：删除资料不级联删除问答。只持久化问答文本，不保存当时的资料快照。SQLite 单文件存储，SQL 参数化执行；数据库初始化可重复执行。

## MVP V0.1 新增接口与更新

| 方法 | 路径 | 输入/输出 |
|---|---|---|
| GET | /api/chapters | 返回章节 id/title/description |
| GET | /api/knowledge?chapter_id=3 | 章节知识点列表 |
| GET | /api/knowledge/{id} | 知识点详情、关联资料、可选 lab_path |
| POST | /api/materials/upload | multipart：file、可选 chapter（章节名称）；201 返回资料 |
| GET | /api/materials/{id}/file | 内联查看；`?download=true` 下载 |
| POST | /api/labs/fcfs | `{"processes":[{"pid":"P1","arrival":0,"burst":4}]}` |
| GET | /api/questions?chapter_id=1 | 题目与选项，提交前不返回答案 |
| POST | /api/practice/submit | `{"answers":{"1":0}}`；选项从 0 开始 |

资料列表新增可选 `category=public` 或 `personal`；返回新增 category、original_name、stored_name、file_size、file_type。前端按 50 条分页。无附件的旧资料保持可读。公共资料 PUT/DELETE 返回 403，只是防止误操作，不构成认证或用户隔离。

上传使用 UUID 文件名，拒绝不允许的扩展名、空文件、无效 PDF 文件头、非 UTF-8 TXT 或 NUL 内容；文件上限 10 MB（413），解析前请求体总上限 11 MB。非法类型 415。文件路径只能由 ID 查数据库获得，并校验解析后路径不逃出存储目录。PDF 未做全文解析或内容安全扫描。

FCFS 输出 results（每个进程的 pid/arrival/burst/start/completion/waiting/turnaround）、timeline（含 idle 空闲区间）、average_waiting、average_turnaround。参数最多 100 个进程，到达时间 ≥0，运行时间 >0，均 ≤1000000 且为有限数，ID 去除首尾空格后必须唯一。同到达时间按输入顺序，算法独立于 AI。

练习响应示例：`{"score":1,"total":1,"results":[{"id":1,"selected":0,"correct":true,"answer":0,"explanation":"..."}]}`。练习不写入学习历史；示例题与课程内容来自服务器数据库。

健康检查新增 ai_configured（只表示已设置真实模式和密钥，不证明供应商可用）。**默认模式已从 mock 调整为 openai**，缺少密钥时聊天返回 503“尚未配置 AI 服务”。显式 mock 仍保留供测试使用。

新增表：chapters（章节）、knowledge（知识点与章节关联）、questions（选项 JSON、正确选项及解析）、schema_versions（种子版本）。materials 通过向后兼容的加列升级保留旧数据。初始化自动执行，也可从 backend 运行 `python init_db.py`。
