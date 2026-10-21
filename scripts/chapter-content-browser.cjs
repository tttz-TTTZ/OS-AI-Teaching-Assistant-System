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
    await t.getByRole("group", { name: /MAP-04/ }).waitFor();
    if ((await t.locator("path[stroke-dasharray]").count()) !== 3)
      throw Error("未保留待核实关系方向");
    await choices.selectOption("CH01-K009");
    await t.getByRole("group", { name: /RR时间片轮转流程/ }).waitFor();
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
    await s.getByRole("group", { name: /RR时间片轮转流程/ }).waitFor();
    await s.reload();
    await s.getByRole("group", { name: /RR时间片轮转流程/ }).waitFor();
    if (
      /SRC-|VERIFY-|来源待教师补充|等待你审核/.test(
        await s.locator("body").innerText(),
      )
    )
      throw Error("学生界面泄露编写元数据");
    const diagram = s.locator(".knowledge-diagram");
    const node = s.getByRole("button", {
      name: "查看就绪队列非空？的关系",
      exact: true,
    });
    await node.click();
    await node.focus();
    await node.press("Enter");
    if ((await node.getAttribute("aria-pressed")) !== "false")
      throw Error("键盘无法取消节点选择");
    await node.press("Space");
    if ((await node.getAttribute("aria-pressed")) !== "true")
      throw Error("节点选择没有反馈");
    await diagram
      .getByRole("button", { name: "下一条关系", exact: true })
      .click();
    await diagram
      .locator(".diagram-reading-note")
      .getByText("初始化", { exact: true })
      .waitFor();
    const graphWidth = await diagram
      .locator("svg")
      .evaluate((e) => e.getBoundingClientRect().width);
    await diagram.getByRole("button", { name: "放大", exact: true }).click();
    if (
      (await diagram
        .locator("svg")
        .evaluate((e) => e.getBoundingClientRect().width)) <= graphWidth
    )
      throw Error("图示无法放大");
    await diagram
      .getByRole("button", { name: "重置图示", exact: true })
      .click();
    if (await diagram.locator("table").isVisible())
      throw Error("关系表不应默认展开");
    await diagram.getByText("查看全部关系与分支", { exact: true }).click();
    await diagram.locator("table").waitFor();
    await diagram.getByText("查看全部关系与分支", { exact: true }).click();
    await s
      .getByRole("navigation", { name: "学习路线", exact: true })
      .getByRole("button", { name: /看个例子/ })
      .click();
    if (new URL(s.url()).searchParams.get("block") !== "case")
      throw Error("路线导航没有跳转");
    if ((await s.locator("body").innerText()).includes("本例为教学补充"))
      throw Error("例子仍混有编写说明");
    await s.getByRole("button", { name: "上一环节", exact: true }).click();
    await s.getByRole("group", { name: /RR时间片轮转流程/ }).waitFor();
    await s.getByRole("button", { name: "相关资料", exact: true }).click();
    if (
      await s
        .getByRole("heading", { name: "内容来源与页码", exact: true })
        .count()
    )
      throw Error("来源面板仍向学生展示");
    await s.getByRole("button", { name: "阅读与观察", exact: true }).click();
    await s.getByRole("group", { name: /RR时间片轮转流程/ }).waitFor();
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
