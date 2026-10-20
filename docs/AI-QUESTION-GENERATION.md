# DeepSeek辅助出题：资料到教师审核

2026-10-20。按用户要求新增：教师从公共资料或专门上传的出题资料生成题目，AI自动填写，教师审核。复用现有题库和发布权限，不替换原有手工出题。

## 使用流程

**练习题管理 → 使用DeepSeek辅助出题 → 选择并预览资料 → 设置题型/数量 → 生成候选 → 逐题修改审核 → 入库为草稿 → 显式发布**。

1. 在“公共课程资料”选择已有资料，或切到“我的出题专用资料”。可以上传专用资料，保存在当前教师的个人资料中，不自动公开给学生或其他教师。
2. 最多选5份。PDF/PPTX选择实际页序范围，每份最多20页；PDF页序从1开始，不等同于教材印刷页码。TXT取可用文字。点击“预览出题摘录”先核对具体依据。
3. 模型最多接收24000字符摘录，单页最多6000字符。超出时提示截取或后续页面未发送，可缩小范围分批生成。不会自动把整个400页课件、全部资料库或图片内容送给模型。
4. 在独立页面选择章节、关联知识点、允许的题型、1–10题、难度和补充要求。候选可包含单选、多选、判断、简答、匹配/分类；题量小时不保证每种允许题型都出现。建议第一次生成2–3题测试。
5. 点击“调用DeepSeek生成候选题”才把预览摘录发送给后端配置的模型服务。页面明确显示模型与数据范围；可能产生服务商费用。没有自动重试或自动定时生成。
6. 成功后候选、来源片段和任务记录入数据库。刷新或重新登录仍可在最近任务中打开。来源必须匹配本次摘录，结构不合格/答案格式错误/重复题干的候选丢弃并提示；数量不足如实报告，不用假题补齐。
7. 点击“自动填写，进入审核”，进入整页题目编辑器。题干、选项、答案、解析、章节和知识点已填入；旁边的资料依据为生成时原文快照。可保存候选修改，之后继续审核。
8. 核对完成后勾选确认，再“审核通过，存为题库草稿”。此时学生仍看不到；可继续勾选“发布给学生”并保存题目，或继续审核本批其他候选。也可弃用候选。

**引用存在不代表题目或答案正确。** 教师需要确认知识准确性、歧义、答案和难度，特别是简答与计算题。简答仍只提供参考答案，不自动评分。

## 支持哪些资料

| 格式 | 出题方式与边界 |
|---|---|
| TXT / 平台文字资料 | 提取UTF-8正文，显示实际摘录和截取提示 |
| PPTX | 从指定幻灯片提取文字；不读取图片中的文字、图表含义、动画或讲者备注 |
| 文字PDF | pypdf提取指定页，AI解析文件上限50 MiB；使用已上传公共资料时不改变原上传上限 |
| 扫描PDF / 纯图片课件 | 没有可用文字时明确拒绝；需要用户先OCR或提供文字资料 |
| 旧PPT | 已补充直接文字读取：解析当前版本幻灯片索引和文字记录，不需会员转换；加密、损坏、图片文字和不受支持结构无法提取，需补充文字或用免费LibreOffice另存 |

专用上传复用个人资料限制：PDF/TXT 10 MiB，PPT/PPTX 50 MiB。公共资料的原上传规则不变。教师可以读取公共资料的草稿，但不能取其他用户的私人文件。资料替换或所选范围变化后，指纹不匹配返回409，需重新预览再生成，避免审核的依据与实际发送内容不一致。

## 配置真实DeepSeek

本功能使用独立的后端 `DEEPSEEK_*` 配置，不把原OpenAI的密钥发给DeepSeek，也不影响原智能问答的 `LLM_*` 配置。

在仓库根目录更新依赖。如果 `backend/.env` 不存在才复制示例，不覆盖已有数据库路径或其他配置：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System
git pull --ff-only
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if (!(Test-Path .\backend\.env)) { Copy-Item .\backend\.env.example .\backend\.env }
notepad .\backend\.env
```

在自己的 `.env` 中填写以下项，密钥从DeepSeek开放平台取得：

```dotenv
DEEPSEEK_API_KEY=在本机填写你自己的API密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

密钥不要发到聊天，不加VITE_前缀，不写入前端，不提交Git。没有密钥时页面仍能上传资料与预览摘录，但不能生成；配置存在也不代表服务商密钥、余额和网络一定可用，以实际调用为准。

停止旧后端后重新启动，不能只刷新网页：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System\backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

另开前端终端：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System
npm.cmd --prefix frontend run dev -- --strictPort
```

新增 `pypdf==6.21.1`，无新增前端依赖。云端工作环境若需要真实调用，也要允许其访问配置的DeepSeek域名；本轮没有真实密钥或调用记录，不声称外部网络已验证。

## 保存、权限、失败与迁移

- V6只追加 `ai_question_jobs`、`ai_question_drafts` 与索引，不删除旧题目、资料或学习记录。已有V5库迁移前成套备份到数据库旁 `backups/before-v6-*`；从更旧版本升级复用同次已有迁移前备份，不重复复制大课件。重复启动不重复创建。
- 任务保存当前教师、请求配置、实际摘录/来源指纹、模型、状态与错误；候选保存题目、引用、处理状态、编辑版本和入库题目ID。模型密钥不进入这些表。
- 任务/候选只有创建教师能访问；学生不能调用生成、读取候选或审核接口。专用原件仍遵循个人资料所有权校验。
- 生成时不写课程题库。审核确认后只插入未发布题目，后端拒绝直接把AI候选以published=true导入。发布沿用原题库教师接口与学生可见性。
- 相同请求标识和配置重试返回已存在任务，不重复请求模型；同教师同时只允许一个生成任务。不同配置不能复用请求标识。
- 模型请求超时90秒，连接超时10秒；认证/余额/限流/格式错误以可读错误返回，不展示供应商原始响应或密钥。没有自动付费重试。
- 本轮为HTTP内执行，不是后台任务队列。服务重启或连接中断时先查最近任务；5分钟以上仍在running的记录会标为中断，由教师明确重新生成。不会假装后台继续完成。
- 候选修改必须点“保存候选修改”才入数据库。未保存编辑不是自动保存；离开前先保存，审核/导入有版本冲突检查。入库失败不冒充发布成功。
- 原成套备份/恢复包含新表与原件，不把本地目录或GitHub当成永久云存储。

## API与主要文件

所有接口位于 `/api/teacher/ai-questions`，要求教师身份，写操作还需原CSRF校验。

| 路径 | 用途 |
|---|---|
| GET /status | 是否配置与模型名，不返回密钥 |
| POST /sources/preview | sources数组（document_id/start_page/end_page），返回chunks、warnings、characters、fingerprint |
| POST /generate | 来源、指纹、chapter_id、knowledge_ids、kinds、count、difficulty、focus、request_key |
| GET /jobs，GET /jobs/{id} | 本人最近30次任务/结果与来源快照 |
| GET/PUT /drafts/{id} | 本人候选读取/修改；修改需question与expected_version |
| POST /drafts/{id}/import | question、expected_version、reviewed=true；只存草稿 |
| POST /drafts/{id}/reject | expected_version，弃用候选 |

后端：`question_sources.py` 摘录与授权，`ai_questions.py` DeepSeek/任务/审核，`ai_question_migration.py` 增量表；前端：`pages/teacher/AIQuestions.tsx` 分步准备，`Questions.tsx` 自动填写与审核，`aiQuestions.ts` 类型/API。原题目编辑、学生作答和判分保留。

## 验证与尚未验证

- 本轮实测：后端84项测试通过，前端TypeScript检查与生产构建通过，完整浏览器联调通过（AI供应商使用模拟结果）。
- 后端覆盖资料/候选越权、模型HTTP协议和JSON解析、伪造引用拒绝、重复请求幂等、保存冲突、审核确认与禁止自动发布、真实发布后学生可见、资料更新指纹、PDF/PPTX摘录、供应商认证/余额/限流错误、任务中断和备份恢复。
- 浏览器用**明确标记的模拟模型结果**，验证专用资料真实上传、摘录、候选数据库保存、自动填写、修改后刷新、审核草稿及显式发布；模拟夹具仅允许总验收临时库，没有产品演示生成模式。
- 总验收清空真实DEEPSEEK_API_KEY与LLM_API_KEY，不产生模型账单；同时回归原教材、PPT、实验、资料权限、登录和练习。
- 当前环境没有真实DeepSeek密钥，**真实供应商调用、输出质量/难度、费用、用户Windows实机尚未验证**。没有OCR、整库RAG、AI自动发布、后台队列或主观题自动评分。

复现：仓库 `.venv/bin/python -m pytest -q`、`npm --prefix frontend run build`、`.venv/bin/python scripts/verify_v02.py`。Windows将Python路径换成 `.venv\Scripts\python.exe`，Playwright安装要求沿用 ACCEPTANCE.md。
