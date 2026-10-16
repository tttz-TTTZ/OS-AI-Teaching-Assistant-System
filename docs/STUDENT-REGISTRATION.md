# 学生自注册与角色入口（2026-10-16）

## 使用方式

- `/login` 默认学生入口，顶部可切换“学生端”和“教师端”。
- 学生点击“没有账号？注册学生账号”进入 `/register`，填写用户名、密码、确认密码。密码12–128字符；用户名1–80字符，去除两端空格，不能仅为空格或包含控制字符。
- 注册成功返回学生登录入口，显示成功提示；使用刚创建的账号登录。
- 教师入口只提供登录，账号由管理员提前创建/分配；没有教师自注册页面或接口。已有教师账号继续有效。
- 注册学生进入统一 users 表，已有教师账号管理页面可查询、停用、重置密码。资料和权限继续使用同一数据库。

## API 和权限

匿名 POST `/api/auth/register`：只接收 username/password，服务端固定 role=student、管理员权限仍为默认false。额外的 role/is_admin 等字段返回422；同名409，不覆盖已有账号；Origin不允许403。成功201只返回 id/username/role，不返回密码/哈希，不自动创建会话。

登录可传 expected_role。账号真实角色与入口不匹配时403，在签发新会话前拒绝；不根据页面选择修改数据库角色。旧API客户端不传该字段仍兼容。教师接口继续校验数据库角色，注册学生不能调用教师写入接口。

保留 Argon2 密码哈希、HttpOnly Cookie、CSRF、会话过期、标签独立上下文与旧响应隔离。本次没有修改数据库结构、迁移或删除已有账号/文件。

## 本地更新

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System
git pull --ff-only
```

如果此前缺失 filelock，先用同一个解释器补齐依赖（不新建/删除虚拟环境）：

```powershell
& .\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

后端终端：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System\backend
& ..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

前端终端：

```powershell
cd D:\A-bishe\OS-AI-Teaching-Assistant-System
npm --prefix frontend run dev -- --strictPort
```

关闭此前由自己启动的旧服务再启动新版本，浏览器刷新一次加载新页面。

## 验收

1. 学生端注册新用户名；确认密码不同应提示，重名应提示，注册成功后可登录并刷新保持身份。
2. 教师端只有登录；用学生账号尝试教师入口，应提示入口不符。
3. 登录现有教师账号，账号管理中能查询到新注册学生。
4. 教师、学生普通双标签或复制标签分别登录，刷新、退出仍保持隔离。

已执行：43项pytest通过（含3项新增注册/角色入口测试）、TypeScript/Vite构建通过、HTTP及Chromium全流程通过。浏览器覆盖学生注册/确认密码/登录/刷新/教师查询/权限拒绝，保留复制标签和延迟401/200回归。测试使用临时数据库和随机账号，未改用户Windows数据库。

Windows实机与阿里云部署尚未验证。没有邮箱/短信核验、学号身份核验、找回密码或公网注册限流，本次不代表公网部署验收完成。
