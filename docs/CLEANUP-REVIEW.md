# 大清理核对表

核对基线：Git 提交 `5500d7c`。本轮清理按用户要求提交至开发分支，不包含环境发布操作。

## 实际删除的实现

| 文件/位置 | 清理内容 |
| --- | --- |
| `backend/app/simulations.py` | 删除内存分配、时间片、打印等旧教学状态机和回放计算 |
| `backend/app/simulation_config.py` | 删除模拟模板和参数模型 |
| `frontend/src/simulation.ts` | 删除模拟配置、轨迹和画面类型 |
| `frontend/src/learning/Interaction.tsx` | 删除模拟参数输入控件 |
| `frontend/src/learning/PersonalModule.tsx` | 删除模拟调用、播放定时器、逐步回放、帧状态和参数修改逻辑 |
| `backend/app/personal_learning.py` | 删除动画生成类型/提示词、画面模型和模拟回放接口 |
| `backend/app/main.py` | 删除旧聊天 HTTP 客户端、旧聊天/会话接口，以及已无前端使用的 JSON 资料新增和编辑接口 |
| `backend/.env.example` | 删除旧聊天的 `LLM_*` 配置，仅保留当前使用的 DeepSeek 等配置 |
| `backend/app/upload_limit.py` | 删除教材图片上传路径的特殊分支 |
| `frontend/src/pages/teacher/Authoring.tsx` | 删除旧编写页包装器，教师首页统一使用公共 Page 组件 |
| `frontend/src/main.tsx` | 删除目录、知识点、实验、题库、备课等已撤下模块的路由及旧主页映射 |
| `backend/init_db.py` | 删除重复初始化入口；初始化仍由服务启动、建号及迁移完成 |
| `backend/tests/conftest.py` | 删除只剩说明文字、没有夹具或测试配置的空壳文件 |
| `frontend/src/style.css` | 删除旧模拟、编写页及已不存在组件的样式 |
| `backend/requirements.txt` | 移除未使用的 Pillow，将 pytest 及其依赖移至 requirements-dev.txt |

后端旧接口 `/api/chat`、`/api/conversations`、`/api/student/personal/jobs/{id}/simulate` 不再注册；资料正常上传、读取、替换、发布、回收站仍可使用。删除的旧页面显示“页面不存在”，不会恢复或加载旧模块。

个人测验的两个书签地址 `/student/ai-practice` 与 `/student/practice` 仅保留短重定向至智慧学习，保留 job 参数；它们没有独立页面或第二套练习实现。

## 改名并保留的当前功能

| 旧名称 | 现名称 | 保留原因 |
| --- | --- | --- |
| `backend/app/knowledge_pilot.py` | `backend/app/distillation.py` | 当前导图、闪卡的资料提炼和证据核对，不读写旧课程知识点表 |
| `frontend/src/learning/PilotEvidence.tsx` | `frontend/src/learning/EvidenceDetails.tsx` | 当前成果的原文依据与分析报告 |
| `backend/tests/test_knowledge_pilot.py` | `backend/tests/test_distillation.py` | 保留当前提炼功能的回归测试 |
| `backend/tests/fixtures/pilot_fixture.py` | `backend/tests/fixtures/distillation_fixture.py` | 合成资料与模型替身，不参与应用运行 |
| `scripts/evaluate_knowledge_pilot.py` | `scripts/evaluate_distillation.py` | 在临时数据库中验证提炼覆盖，不调用真实模型 |

已保存任务中的 `pilot` 等字段是现有提炼结果的存储键。本次不为改名而重写记录或强制重新调用模型。

## 维护结构修正

每日任务数不限与提炼的模型调用保护是两个独立计数。提炼仍保留原有每日 60 次模型调用保护；本轮未改动这项限制，并补充界面说明。

新增 `backend/app/database.py`，统一配置读取、数据库路径和事务。业务模块不再反向导入 `main.py`，修复单独导入资料提炼模块时发生的循环导入。账号命令、备份命令和测试也使用同一配置入口。

`main.py` 现在负责应用启动、路由装配、健康检查与资料入口。当前业务实现位于 `backend/app` 和 `frontend/src`，无需阅读已撤下模块才能维护现有功能。

## 保留内容及边界

- `migrations.py`：旧库升级和清理需要知道旧表名，不能把这些名字当成旧模块实现直接删掉。本次没有修改数据库结构或删除本机数据。
- `persistence.py`、`storage_admin.py`：保护数据库、上传文件及恢复能力。
- `legacy_ppt.py`：当前仍支持用户实际上传的 `.ppt` 文件；这是解析器，不是旧算法实验。
- `distillation.py`、`self_test.py`、`MindMap.tsx`：当前资料整理、个人测验和导图导出使用的实现。
- `backend/tests/fixtures/v9_schema.sql`：仅用于验证旧数据库升级，不在正常启动时创建旧模块。
- 旧聊天表 `conversations` 的定义仅在升级保护代码中保留，用于保存早期历史数据；应用已无读取或写入它的业务接口。
- `docs/reports`、`docs/learning`：课程研究报告与学习笔记，不是运行代码，也没有参与本次测试或初始化。保留以免误删论文材料。
- 账号、公共/个人资料、AI 历史、自测、笔记、收藏及文件版本保持可用。已停用内容的历史记录只显示保存文字，不提供执行、播放或参数面板；原始记录不改写。

## 验证

已验证前端构建及未使用代码检查、当前功能回归、旧接口不可用、被停用类型在模型调用前被拒绝、历史数据只读、跨账号隔离、旧库升级/回滚，以及布局和测验浏览器检查。单独导入业务模块的测试还检查不会启动 Web 应用或创建数据库。

测试只使用隔离库、合成账号与模型替身，不调用真实付费模型。可复现步骤见 [人工开发与调试](DEVELOPMENT.md)。本轮结果：112 项后端回归、5 项独立导入检查通过；前端构建通过；28 项通用页面检查、横屏布局、测验与已停用记录只读检查通过。保留的模型调用保护也已专项复核。
