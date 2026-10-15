const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = createRequire(
  path.resolve(__dirname, "../frontend/package.json"),
)("playwright");
// 由 verify_v02.py 生成随机临时账号，不在源码中保存密码。
const accountFile = process.env.TEST_ACCOUNTS_FILE;
if (!accountFile)
  throw Error("请运行 Python scripts/verify_v02.py，它会创建隔离验收环境。");
const accounts = JSON.parse(fs.readFileSync(accountFile, "utf8"));
const base = process.env.APP_TEST_BASE_URL || "http://127.0.0.1:5173";
(async () => {
  const browser = await chromium.launch({
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const errors = [];
    const contexts = await Promise.all(
      accounts.map(() =>
        browser.newContext({ viewport: { width: 1366, height: 768 } }),
      ),
    );
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    for (const p of pages) p.on("pageerror", (e) => errors.push(e.message));
    async function login(page, account) {
      await page.goto(base + "/login");
      await page.getByLabel("用户名").fill(account.username);
      await page.getByLabel("密码", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.waitForURL(`**/${account.role}/dashboard`);
    }
    const [t, s, b] = pages;
    await Promise.all(pages.map((p, i) => login(p, accounts[i])));
    await s.reload();
    await s.getByRole("heading", { name: "学习首页", exact: true }).waitFor();
    await s.goto(base + "/teacher/dashboard");
    await s.getByRole("heading", { name: "无权访问" }).waitFor();
    await s.goto(base + "/student/dashboard");
    async function apiCall(p, method, url, options = {}) {
      const context = await p.evaluate(() =>
        sessionStorage.getItem("os:session-context"),
      );
      return p.request[method](url, {
        ...options,
        headers: { ...options.headers, "X-Session-Context": context },
      });
    }
    const csrf = async (p) =>
      (await (await apiCall(p, "get", base + "/api/auth/me")).json())
        .csrf_token;
    const deny = await apiCall(s, "post", base + "/api/teacher/chapters", {
      headers: { "X-CSRF-Token": await csrf(s) },
      data: { title: "forbidden" },
    });
    if (deny.status() !== 403 || !(await deny.json()).detail.includes("教师"))
      throw Error("role enforcement missing");
    const suffix = Date.now();
    const chapterTitle = `浏览器验收章-${suffix}`;
    const pointTitle = `浏览器知识点-${suffix}`;
    await t.getByRole("link", { name: "章节管理", exact: true }).click();
    await t.getByLabel("章节标题").fill(chapterTitle);
    await t.getByLabel("章节说明").fill("浏览器真实提交的演示章节");
    await t.getByRole("button", { name: "保存章节", exact: true }).click();
    await t.getByRole("status").filter({ hasText: "章节已保存" }).waitFor();
    const chapters = await (
      await apiCall(t, "get", base + "/api/teacher/chapters")
    ).json();
    const cid = chapters.find((c) => c.title === chapterTitle).id;
    if (
      (await (await apiCall(s, "get", base + "/api/chapters")).json()).some(
        (c) => c.id === cid,
      )
    )
      throw Error("draft exposed");
    await t.getByRole("link", { name: "知识点管理", exact: true }).click();
    await t.getByLabel("所属章节", { exact: true }).selectOption(String(cid));
    await t.getByLabel("知识点标题").fill(pointTitle);
    await t
      .getByLabel("正文（支持基础 Markdown）")
      .fill(
        '# 测试概念\n- 真实课程内容\n\n```python\nprint("FCFS")\n```\n\n|指标|公式|\n|---|---|\n|等待|开始减到达|',
      );
    await t.getByLabel("关联 FCFS 实验").check();
    await t.getByLabel(/^发布给学生/).check();
    await t.getByRole("button", { name: "保存知识点", exact: true }).click();
    await t.getByRole("status").filter({ hasText: "知识点已保存" }).waitFor();
    const points = await (
      await apiCall(t, "get", base + "/api/teacher/knowledge")
    ).json();
    const kid = points.find((k) => k.title === pointTitle).id;
    if (
      (await apiCall(s, "get", base + `/api/knowledge/${kid}`)).status() !== 404
    )
      throw Error("unpublished parent exposed");
    await t.getByRole("link", { name: "公共资料", exact: true }).click();
    await t.getByLabel("公共资料文件").setInputFiles({
      name: `public-${suffix}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("公共资料正文"),
    });
    await t
      .getByLabel("上传所属章节", { exact: true })
      .selectOption(String(cid));
    await t.getByRole("button", { name: "上传公共资料", exact: true }).click();
    await t.getByRole("status").filter({ hasText: "上传已保存" }).waitFor();
    await t.getByLabel(pointTitle, { exact: true }).check();
    await t.getByLabel(/^发布给学生/).check();
    await t.getByRole("button", { name: "保存资料设置" }).click();
    await t.getByRole("status").filter({ hasText: "资料设置已保存" }).waitFor();
    const docs = await (
      await apiCall(t, "get", base + "/api/teacher/documents")
    ).json();
    const did = docs.find((d) => d.title === `public-${suffix}.txt`).id;
    if (
      (
        await apiCall(s, "get", base + `/api/materials/${did}/file`)
      ).status() !== 404
    )
      throw Error("file parent visibility");
    await t.getByRole("link", { name: "章节管理", exact: true }).click();
    const row = t.getByRole("row").filter({ hasText: chapterTitle });
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await t.getByLabel(/^发布给学生/).check();
    await t.getByRole("button", { name: "保存章节", exact: true }).click();
    await t.getByRole("status").filter({ hasText: "章节已保存" }).waitFor();
    await s.goto(base + `/student/knowledge?chapter=${cid}`);
    await s.getByRole("heading", { name: pointTitle, exact: true }).waitFor();
    await s.getByRole("heading", { name: "测试概念", exact: true }).waitFor();
    await s.getByRole("table").waitFor();
    if ((await s.locator("pre code").innerText()) !== 'print("FCFS")')
      throw Error("code rendering");
    if (
      (await (
        await apiCall(s, "get", base + `/api/materials/${did}/file`)
      ).text()) !== "公共资料正文"
    )
      throw Error("public download");
    await s
      .getByRole("link", { name: `public-${suffix}.txt →`, exact: true })
      .click();
    await s
      .getByRole("heading", { name: `public-${suffix}.txt`, exact: true })
      .waitFor();
    await s.getByLabel("上传资料").setInputFiles({
      name: `private-${suffix}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from("学生私人正文"),
    });
    await s
      .locator("button")
      .filter({ hasText: /^上传资料$/ })
      .click();
    const privateRow = s
      .getByRole("row")
      .filter({ hasText: `private-${suffix}.txt` });
    await privateRow.waitFor();
    const personal = await (
      await apiCall(s, "get", base + "/api/materials?category=personal")
    ).json();
    const pid = personal.find((d) => d.title === `private-${suffix}.txt`).id;
    if (
      (
        await apiCall(b, "get", base + `/api/materials/${pid}/file`)
      ).status() !== 404
    )
      throw Error("other student read");
    const aiDenied = await apiCall(b, "post", base + "/api/chat", {
      headers: { "X-CSRF-Token": await csrf(b) },
      data: { question: "read", material_id: pid },
    });
    if (aiDenied.status() !== 404) throw Error("AI context access");
    s.once("dialog", (d) => d.accept());
    await privateRow
      .getByRole("button", { name: "移入回收站", exact: true })
      .click();
    await privateRow.waitFor({ state: "detached" });
    await s.getByRole("link", { name: "算法实验", exact: true }).click();
    await s.getByRole("button", { name: "示例 2（含空闲）" }).click();
    await s.getByRole("button", { name: "运行 FCFS", exact: true }).click();
    await s.getByText("平均等待 0.00", { exact: true }).waitFor();
    if ((await s.getByText("CPU 空闲", { exact: true }).count()) !== 2)
      throw Error("FCFS timeline");
    await s.getByRole("link", { name: "章节练习", exact: true }).click();
    await s.getByLabel("选择章节").selectOption("1");
    await s.getByLabel("A. 管理系统资源", { exact: true }).check();
    await s.getByRole("button", { name: "提交练习", exact: true }).click();
    await s.getByText("本次得分：1 / 1", { exact: true }).waitFor();
    await s.getByRole("link", { name: "智能问答", exact: true }).click();
    await s.getByLabel("输入问题").fill("解释进程");
    await s.getByRole("button", { name: "发送问题", exact: true }).click();
    await s
      .getByRole("alert")
      .filter({ hasText: "尚未配置 AI 服务" })
      .waitFor();
    // 取消发布后学生不能通过直链访问已看过的文件。
    const meta = await (
      await apiCall(t, "get", base + "/api/teacher/documents")
    ).json();
    const doc = meta.find((d) => d.id === did);
    const unpublish = await apiCall(
      t,
      "put",
      base + `/api/teacher/documents/${did}`,
      {
        headers: { "X-CSRF-Token": await csrf(t) },
        data: {
          title: doc.title,
          chapter_id: cid,
          knowledge_ids: [kid],
          published: false,
        },
      },
    );
    if (unpublish.status() !== 200) throw Error("unpublish failed");
    if (
      (
        await apiCall(s, "get", base + `/api/materials/${did}/file`)
      ).status() !== 404
    )
      throw Error("unpublish cache exposure");
    await t.getByRole("link", { name: "练习题管理", exact: true }).click();
    await t.getByRole("heading", { name: "练习题管理", exact: true }).waitFor();
    await t.getByLabel("所属章节", { exact: true }).selectOption(String(cid));
    await t.getByLabel("题干").fill("浏览器新题目");
    await t.getByLabel("选项 A", { exact: true }).fill("正确选项");
    await t.getByLabel("选项 B", { exact: true }).fill("错误选项");
    await t.getByLabel("解析", { exact: true }).fill("真实管理提交");
    await t.getByLabel(/^发布给学生/).check();
    await t.getByRole("button", { name: "保存题目" }).click();
    await t.getByRole("status").filter({ hasText: "练习题已保存" }).waitFor();
    await s.goto(base + `/student/practice?chapter=${cid}`);
    await s.getByLabel("A. 正确选项", { exact: true }).check();
    await s.getByRole("button", { name: "提交练习", exact: true }).click();
    await s.getByText("本次得分：1 / 1", { exact: true }).waitFor();
    await t.route("**/api/teacher/chapters", (r) =>
      r.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "验收模拟后端错误" }),
      }),
    );
    await t.getByRole("link", { name: "章节管理", exact: true }).click();
    await t
      .getByRole("alert")
      .filter({ hasText: "验收模拟后端错误" })
      .waitFor();
    await s.getByRole("button", { name: "退出登录", exact: true }).click();
    await s.waitForURL("**/login");
    if ((await apiCall(s, "get", base + "/api/materials")).status() !== 401)
      throw Error("logout did not revoke");
    await b.setViewportSize({ width: 640, height: 800 });
    await b.goto(base + "/student/dashboard");
    await b.getByRole("heading", { name: "学习首页", exact: true }).waitFor();
    // 同一个浏览器上下文中开第二个普通标签，独立账号并刷新。
    await t.goto(base + "/teacher/accounts");
    const createdName = "browser-student-" + suffix;
    await t.getByLabel("用户名", { exact: true }).fill(createdName);
    await t.getByLabel("初始密码", { exact: true }).fill("test-only-" + suffix);
    await t.getByRole("button", { name: "创建账号", exact: true }).click();
    await t.getByRole("row").filter({ hasText: createdName }).waitFor();
    const sameBrowserStudent = await contexts[0].newPage();
    sameBrowserStudent.on("pageerror", (e) => errors.push(e.message));
    await login(sameBrowserStudent, accounts[1]);
    await sameBrowserStudent.reload();
    await sameBrowserStudent
      .getByRole("heading", { name: "学习首页", exact: true })
      .waitFor();
    await t.reload();
    await t.getByRole("heading", { name: "账号管理", exact: true }).waitFor();
    if (
      (await (await apiCall(t, "get", base + "/api/auth/me")).json()).role !==
      "teacher"
    )
      throw Error("teacher tab switched");
    await sameBrowserStudent
      .getByRole("button", { name: "退出登录", exact: true })
      .click();
    await sameBrowserStudent.waitForURL("**/login");
    if ((await apiCall(t, "get", base + "/api/auth/me")).status() !== 200)
      throw Error("other tab logout revoked teacher");
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "PASS browser V0.2: 两角色登录/刷新/路由，教师章节知识点编辑与发布，公共资料关联/撤回，私人文件越权与AI引用，FCFS/练习，教师题目，错误提示，退出撤销，窄屏；同浏览器双标签独立登录/刷新/退出、账号创建；无JS异常",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
