# 标签页登录升级与验收（2026-10-16）

## 问题与范围

1bd2360 已按 sessionStorage 中的上下文选择独立 HttpOnly Cookie，普通新标签可以独立登录。但浏览器复制标签或 window.open 可能复制 sessionStorage；旧代码没有检测重复上下文，副本会恢复原账号，无法直接选择另一个账号，并可能共用退出/切换效果。

另外，原请求封装对任何 401 都广播退出事件。旧身份请求在退出、重新登录后延迟返回时，会影响新身份；旧的成功响应也可能把旧内容交给新页面。这些是前端会话生命周期问题，不能据此认定数据库损坏。

## 修改

- `frontend/src/session.ts`：独立管理非敏感上下文；现代浏览器通过 Web Locks 检测页面占用，复制副本建立新上下文，普通刷新保留账号。无 Web Locks 时使用 BroadcastChannel 探测作为兼容回退。恢复浏览器往返缓存时重新加载并建立所有权。
- `frontend/src/api.ts`：登录使用全新上下文；请求记录身份版本和上下文，在收到响应和解析正文后检查。身份变化后丢弃旧响应（AbortError），旧 401 不再注销新账号。每次请求仍携带后端会话 Cookie/CSRF。
- `frontend/src/auth.tsx`：登录、退出、过期和初始恢复增加版本校验，防止迟到的身份恢复结果覆盖当前账号。
- `scripts/browser-check.cjs`：新增复制标签、刷新、跨账号重新登录、旧 401/200 延迟返回、当前 401 退出与重新登录测试。
- `scripts/verify_v02.py`：Linux 端口检查排除已退出服务的 TIME_WAIT 误报，仍拒绝活跃监听；Windows 保留原有检查。

没有更换认证依赖、数据库模型、密码哈希或后端角色权限；没有删除或迁移资料。不把令牌/密码放入 localStorage 或 sessionStorage。标签独立用于开发验收，不是同一浏览器所有者之间的安全隔离。

## 本地更新和启动

在原仓库目录拉取 `feat/development-foundation`，保留本地未提交修改。关闭旧的前端服务后重新启动；已打开的旧页面刷新一次才能加载新逻辑。

PowerShell 第一个终端：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System\backend
# 使用现有虚拟环境；如果已经激活，直接执行下面的 python 命令。
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

第二个终端：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System\frontend
npm run dev
```

使用同一地址，例如始终使用 `http://127.0.0.1:5173`，不要混用 localhost。

## 浏览器人工验收

1. 普通标签 A 登录教师；新建普通标签 B 登录学生。
2. 两页分别刷新，身份仍各自保持。
3. 复制 A 标签，新副本应进入登录页；在副本登录学生，A 刷新仍是教师。
4. 副本退出，A 仍可打开账号或章节管理；B 仍保持学生。
5. 关闭并重启本地前后端，保留原标签刷新，未过期会话仍有效。
6. 当前会话过期、被停用或被重置密码后需重新登录，不能承诺永不退出。后端会话仍为 8 小时。

## 自动验收

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend run build
.venv/bin/python scripts/verify_v02.py
```

浏览器验收使用临时数据库、随机账号和独立服务，包含学生访问教师写入接口及其他学生私人资料的越权拒绝，保留 FCFS/课程/资料流程。不会读写用户 Windows 数据，不调用付费模型。

本次没有部署阿里云，也没有验证用户 Windows 实机或连续运行 8 小时。延迟/过期竞态通过受控响应验证，不能冒充实际长时间运行测试。建议使用当前 Chrome/Edge，在 localhost 或 HTTPS 下使用 Web Locks；旧浏览器回退依赖跨标签消息，后台冻结兼容性未做全面验证。

### 本轮执行结果

- 后端 pytest：40 项通过，1 个已有 Starlette/AnyIO 弃用警告。
- TypeScript/Vite：构建通过。
- 真实 HTTP 与 Chromium：原有课程、资料、权限、FCFS 流程及本次新增登录回归全部通过，无 JS 运行时异常。
- 反向验证：保留新测试，将 api.ts/auth.tsx 临时还原到 1bd2360，复制标签独立登录测试失败（副本自动进入原教师账号）；恢复修复后通过。
- 全部数据库写入使用隔离测试库，未触及用户本地数据库或教材。
