# 关键词检索过滤与终端排查

2026-10-27。普通提问的快速关键词检索增加逐条正分过滤；资料概览仍按文件轮流取片段，完整小节提炼仍走原流程。无新依赖、迁移或数据修改。

## 更新本机

本轮替代之前手工加入的print。先停止后端，在仓库根目录保留两个文件的学习修改，再更新：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System
git stash push -m "保留本地检索学习修改" -- backend/app/personal_sources.py backend/app/personal_chat.py
git pull --ff-only
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

分支应为 `feat/development-foundation`。如果其他本地文件阻止拉取，保留错误信息并单独核对，不reset/clean。不必立刻stash pop，旧学习修改仍保存在stash；恢复同一代码可能产生冲突或重复日志。

## 查看后端终端

用默认INFO级别启动Uvicorn即可看到日志，无需自己插入print或设置额外配置。勾选资料并在中间输入框提问，可能出现：

```text
[学习问答] 已启用资料检索，资料数=1
[学习检索] 进入 retrieve 文件=...personal_sources.py 模式=quick 概览=False 资料数=1
[学习检索] 过滤前分数：[...]
[学习检索] 过滤后分数：[...]
[学习检索] 返回片段数=... 候选片段数=...
```

其他路径会明确说明：

- `跳过检索：未启用结合资料`：开关关闭。
- `跳过检索：未选择资料`：有效资料列表为空。
- `所有候选片段均为0分` / `转为通用解释`：未找到可用依据；问答仍可通用回答，所以HTTP200不代表成功检索。
- `资料概览...不按正分过滤`：概览采用轮流选片段。
- `转入完整小节提炼`：该模式不经过快速检索的过滤分支。

日志显示代码文件位置、模式、数量和得分，不记录问题正文、课件正文、密钥或Cookie。随Uvicorn配置输出INFO；如果刻意使用warning级别会隐藏这些日志。

同一次提问可能出现两组检索日志：生成前检索和生成后资料指纹一致性检查，不表示调用了两次模型。若前后分数一样，可能原本全为正分，并非过滤失败。

## 修复与边界

`personal_sources.retrieve()` 原先取最高分前8项，只拒绝全0分，因此部分0分片段可能混入。现仅在普通问题且有正分时过滤，保持排序、同分顺序、最多8项及文字预算。`personal_chat.ask()` 说明检索跳过/回退原因。两处沿用Uvicorn的INFO日志通道，避免应用日志默认级别导致“代码有日志但终端看不到”。

这仍是关键词检索。正分只说明词项匹配，不证明引用包含答案，也没有增加向量检索、语义重排序或引用支持度判定。

验证结果：相关29项与全量211项后端测试通过，默认Uvicorn INFO日志通道验证通过；原工作区数据库未改动。

新增测试通过真实资料上传与预览接口验证正/零分混合排序、全0分、概览不被误过滤、问答回退、资料开关和空选择的日志，以及正文不写日志。模型使用模拟响应，不调用付费API。

```bash
.venv/bin/python -m pytest backend/tests/test_retrieval_filter.py backend/tests/test_personal_chat.py backend/tests/test_personal_learning.py -q
.venv/bin/python -m pytest backend/tests -q
```
