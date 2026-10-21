const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = createRequire(
  path.resolve(__dirname, "../frontend/package.json"),
)("playwright");
const accounts = JSON.parse(
  fs.readFileSync(process.env.TEST_ACCOUNTS_FILE, "utf8"),
);
const base = process.env.APP_TEST_BASE_URL;
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  try {
    const contexts = await Promise.all([
      browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      browser.newContext(),
    ]);
    const [t, s] = await Promise.all(contexts.map((c) => c.newPage()));
    const errors = [];
    t.on("pageerror", (e) => errors.push(e.message));
    s.on("pageerror", (e) => errors.push(e.message));
    for (const [p, a] of [
      [t, accounts[0]],
      [s, accounts[1]],
    ]) {
      await p.goto(base + "/login");
      await p
        .getByRole("link", {
          name: a.role === "teacher" ? "教师端" : "学生端",
          exact: true,
        })
        .click();
      await p.getByLabel("用户名").fill(a.username);
      await p.getByLabel("密码", { exact: true }).fill(a.password);
      await p.getByRole("button", { name: "登录", exact: true }).click();
      await p.waitForURL(`**/${a.role}/dashboard`);
    }
    async function api(p, method, url, data) {
      const context = await p.evaluate(() =>
        sessionStorage.getItem("os:session-context"),
      );
      const me = await p.request.get(base + "/api/auth/me", {
        headers: { "X-Session-Context": context },
      });
      const csrf = (await me.json()).csrf_token;
      return p.request[method](base + "/api" + url, {
        headers: { "X-Session-Context": context, "X-CSRF-Token": csrf },
        ...(data ? { data } : {}),
      });
    }
    const created = await api(t, "post", "/teacher/chapters", {
      title: "PPT审核浏览器验收",
      published: true,
    });
    const cid = (await created.json()).id;
    await t.goto(base + "/teacher/knowledge");
    await t
      .getByRole("link", { name: "查看新版第一章内容", exact: true })
      .click();
    await t
      .getByRole("heading", { name: "第一章课程内容", exact: true })
      .waitFor();
    const choices = t.getByLabel("选择查看内容");
    await choices.selectOption("CH01-K014");
    if ((await choices.locator("option").count()) !== 17)
      throw Error("内容未完整填写");
    await t.getByRole("img", { name: /MAP-04/ }).waitFor();
    if ((await t.locator("path[stroke-dasharray]").count()) !== 3)
      throw Error("未保留待核实关系方向");
    await choices.selectOption("CH01-K009");
    await t.getByRole("img", { name: /FLOW-02/ }).waitFor();
    await t.getByLabel("导入目标章节").selectOption(String(cid));
    await t
      .getByRole("button", { name: "应用新内容并直接发布", exact: true })
      .click();
    await t
      .getByRole("status")
      .filter({ hasText: "第一章已替换并发布" })
      .waitFor();
    const result = await (
      await api(t, "post", "/teacher/chapter-content/chapter01/import", {
        chapter_id: cid,
      })
    ).json();
    if (!result.already_imported || result.points.length !== 16)
      throw Error("幂等草稿保存失败");
    const point = result.points.find((p) => p.code === "CH01-K009");
    if ((await api(s, "get", `/learning-content/${point.id}`)).status() !== 200)
      throw Error("直接应用后学生不可见");
    if (
      (await api(s, "get", "/teacher/chapter-content/chapter01")).status() !==
      403
    )
      throw Error("课程包越权");
    if (
      !(await t
        .getByRole("button", { name: "应用新内容并直接发布", exact: true })
        .isDisabled())
    )
      throw Error("已应用状态应阻止重复覆盖");
    await s.goto(base + `/student/knowledge?chapter=${cid}&point=${point.id}`);
    await s
      .getByRole("button", { name: /FLOW-02|RR时间片轮转流程/ })
      .first()
      .click();
    await s.getByRole("img", { name: /FLOW-02/ }).waitFor();
    await s.reload();
    await s.getByRole("img", { name: /FLOW-02/ }).waitFor();
    if (process.env.BROWSER_SCREENSHOT_DIR) {
      await s.locator(".knowledge-diagram").screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "chapter-content-flow.png",
        ),
      });
      await t.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "chapter-content-review.png",
        ),
        fullPage: false,
      });
      await s.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "chapter-content-student.png",
        ),
      });
    }
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "第一章内容：内容查看、图示、直接替换发布、重复应用保护、权限与学生刷新通过",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
