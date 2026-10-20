# 大课件资料：PPT/PPTX 上传与阅读

2026-10-20。用户需要上传约400页的大课件。本次在已有资料模块上扩展格式和进度，不改登录，不删除资料，不新增数据库表。

## 能做什么

| 类型 | 教师公共资料上限 | 学生个人资料上限 | 使用方式 |
|---|---|---|---|
| PPTX | 500 MiB | 50 MiB | 完整原件上传/下载，网页按幻灯片顺序查看文字，每次10页，可跳页 |
| PPT | 500 MiB | 50 MiB | 完整原件上传/下载，下载后用PowerPoint/WPS打开 |
| PDF | 保持150 MiB | 保持10 MiB | 保留原查看/下载流程 |
| UTF-8 TXT | 保持10 MiB | 保持10 MiB | 保留原正文与下载 |

页数不是上传大小上限：400页图片课件可能远大于400页纯文字课件。PPTX文字读取最多支持2000页，XML部件最多8 MiB、XML总量64 MiB、ZIP声明解压总量2 GiB，限制异常文件消耗。原件按字节保存，数据库只存文件元数据和最多50000字符的正文摘录，**正文摘录不是完整课件，也不代表完整内容已进入AI知识库**。分页读取直接从受控原件重建，不依赖数据库摘录，因此第400页仍可读。

### 网页阅读的真实边界

- PPTX提供**文字分页**，不还原幻灯片排版，不展示图片/图表/公式图片/音视频/讲者备注，不播放PPT动画。纯图片页明确提示下载原件。
- 单页文字超过20000字符时提示截断；完整原件不截断。
- 不将课件发送到第三方在线预览服务，不执行宏或外链，不要求Office会员或付费拆分。
- 旧PPT没有网页文字预览。若需要，可以在自己的PowerPoint/WPS另存为PPTX并替换；需要保持原排版的浏览器阅读时可另上传PDF，原PPT仍保留。
- PPTM等宏课件扩展名不接收；PPTX宏主文档、加密/损坏ZIP、非法路径/引用会拒绝。旧PPT用OLE容器和PowerPoint文档流识别，不等于已通过完整Office修复验证。

## 教师怎么上传

1. 安装本轮依赖、重启前后端。
2. 教师登录，进入“公共资料”，选择PPT/PPTX和所属章节，点击“上传公共资料”。
3. 观察上传百分比。100%只表示文件已发送，仍需等待“校验并保存”完成；不要关闭页面。
4. 上传成功后默认草稿。填写/检查标题、摘要、出处、章节和知识点关联，勾选发布，保存资料设置。章节/课程也需已发布，学生才能看到。
5. 教师可展开“预览课件文字（原件可下载）”检查PPTX，不默认铺开长内容，避免阻挡设置。
6. 学生在“课程资料”点击“详情”或由知识点的关联资料进入，查看文字分页；点击下载原件可在本地打开完整课件。

替换文件沿用原资料入口：旧原件留存在版本记录，新文件取消发布，教师确认后重新发布。重复相同文件在可管理范围内提示使用已有资料，不重复制造资料。

## 大文件处理与保存

- 前后端按类型校验大小，上传请求额外留1 MiB表单开销。文件分块读写到暂存目录、校验后原子改名，再提交数据库元数据，不将整份课件作为Python字节串长期保存在内存。
- PPTX只读ZIP部件，不将整个压缩包解压到文件系统；下载设置正确MIME、附件响应和nosniff。
- PPT/PPTX文件在数据库旁 `uploads` 的随机文件名下，原文件名只作元数据；不是前端public目录，不提交GitHub。
- 公共课件的草稿/发布、个人课件所有权、撤回、回收站和替换版本沿用原授权；分页读取同样检查权限，返回private/no-store。其他学生或教师不能读取学生个人课件。
- 数据库与文件仍用原成套备份/恢复工具；本次不新增迁移。若从更旧版本一次更新，先前V5迁移仍会按原规则执行，不能删除数据库跳过。
- 本轮是单次请求上传，有百分比与网络错误反馈；没有断点续传、分片重试或后台Office转换服务。中断后先刷新列表确认是否已保存，再决定重传。
- 大文件上传会在请求暂存、multipart暂存和最终保存阶段占用额外磁盘空间，备份也需空间。建议为一次最大文件准备至少约3倍临时空间，并另留备份容量。

## Windows 更新

停止前后端，在仓库目录检查并保留自己的Git修改后：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System
git pull --ff-only
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
```

本轮增加小型解析依赖 `olefile==0.47` 用于旧PPT识别。PPTX使用Python标准库，不安装Office/LibreOffice。

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

如果仍显示“仅支持PDF/TXT”，先确认后端进程已停止并用当前仓库重启，不能只刷新网页。

本地Vite代理已沿用，未配置用户阿里云或IIS。以后部署时还需把反向代理请求大小设为至少501 MiB、配置足够请求超时和磁盘空间；否则可能在到达应用前收到413/连接断开。本次不声称服务器已配置或已上线。

## 文件、接口与验证

- 后端：`app/presentations.py` 安全识别与PPTX文字分页；`app/files.py` 文件保存/下载/分页；`app/upload_limit.py` 总请求边界；`app/main.py` 配置字段；`requirements.txt` 新依赖。
- 前端：`materialFiles.ts` 格式和上限；`api.ts` 带身份/CSRF和旧请求隔离的XHR上传进度；`learning/PresentationPreview.tsx` 分页；双端资料页与CSS。
- 新增 `GET /api/materials/{id}/slides?offset=0&limit=10`（limit 1–20），返回total、offset和slides（number/title/text/truncated）。每次检查当前用户权限。
- `/api/config` 新增 `public_presentation_upload_limit_bytes` 和 `personal_presentation_upload_limit_bytes`；原PDF/TXT配置字段保留。

后端74项通过，包含400页PPTX（含超过10 MiB的附件）、真实顺序与第400页、完整下载SHA、草稿/私人权限、替换后重新发布、损坏/越界路径/超限清理、PPT容器识别与MIME、备份恢复。旧请求体上限测试按新课件边界更新，仍验证超限拒绝。

浏览器覆盖400页合成课件实际上传、教师预览发布、学生翻页/跳页/刷新、附件下载、XHR上传通道及私人课件隔离；同时回归原教材、算法实验、登录/双标签、资料权限和练习。前端构建通过。

尚未用用户真实400页文件测试，也未进行500 MiB满上限网络传输或Windows/WPS打开实机验证；不把合成测试当成真实教学资料已验收。
