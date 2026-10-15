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
