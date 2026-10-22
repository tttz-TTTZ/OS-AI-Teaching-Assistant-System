// Uses verify_v02.py's temporary database/accounts; never runs against user data.
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = createRequire(
  path.resolve(__dirname, "../frontend/package.json"),
)("playwright");
const base = process.env.APP_TEST_BASE_URL;
const accounts = JSON.parse(
  fs.readFileSync(process.env.TEST_ACCOUNTS_FILE, "utf8"),
);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  const errors = [];
  try {
    const tc = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    });
    const sc = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    });
    const t = await tc.newPage(),
      s = await sc.newPage();
    for (const [page, a] of [
      [t, accounts[0]],
      [s, accounts[1]],
    ]) {
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/login");
      await page
        .getByRole("link", {
          name: a.role === "teacher" ? "教师端" : "学生端",
          exact: true,
        })
        .click();
      await page.getByLabel("用户名").fill(a.username);
      await page.getByLabel("密码", { exact: true }).fill(a.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.waitForURL(`**/${a.role}/dashboard`);
    }
    async function api(page, method, url, data) {
      const context = await page.evaluate(() =>
        sessionStorage.getItem("os:session-context"),
      );
      const me = await page.request.get(base + "/api/auth/me", {
        headers: { "X-Session-Context": context },
      });
      return page.request[method](base + "/api" + url, {
        headers: {
          "X-Session-Context": context,
          "X-CSRF-Token": (await me.json()).csrf_token,
        },
        ...(data ? { data } : {}),
      });
    }
    const target = await (
      await api(t, "post", "/teacher/chapters", {
        title: "第二章浏览器隔离验收",
        published: true,
      })
    ).json();
    const old = await (
      await api(t, "post", "/teacher/sections", {
        chapter_id: target.id,
        code: "2.1",
        title: "老师定制目录",
        published: true,
      })
    ).json();
    const endpoint = "/teacher/chapter-content/chapter02";
    if (
      (
        await api(s, "post", endpoint + "/import", { chapter_id: target.id })
      ).status() !== 403
    )
      throw Error("学生可写课程包");
    await t.goto(base + "/teacher/knowledge");
    await t
      .getByRole("link", { name: "第二章预填与审核", exact: true })
      .click();
    await t
      .getByRole("heading", { name: "第二章预填内容与审核", exact: true })
      .waitFor();
    const unit = t.getByLabel("预填学习单元");
    await unit.waitFor();
    if ((await unit.locator("option").count()) !== 12)
      throw Error("没有12个去重单元");
    await unit.selectOption("CH02-U001");
    await t.getByRole("group", { name: /CH02-G001/ }).waitFor();
    await unit.selectOption("CH02-U005");
    await t.getByRole("group", { name: /CH02-F004/ }).waitFor();
    await t.getByRole("button", { name: /选择目录并应用/ }).click();
    if ((await t.getByLabel("第二章目标章节").inputValue()) !== "")
      throw Error("擅自选择目标章");
    await t.getByLabel("第二章目标章节").selectOption(String(target.id));
    await t
      .getByRole("button", { name: "检查目标与目录", exact: true })
      .click();
    await t.getByText(/编号冲突：请在上方明确选择已有小节/).waitFor();
    await t
      .getByLabel("小节映射 2.1", { exact: true })
      .selectOption(String(old.id));
    await t
      .getByRole("button", { name: "检查目标与目录", exact: true })
      .click();
    await t.getByText(/复用「老师定制目录」/).waitFor();
    await t.getByRole("checkbox", { name: /我已核对目标章节与小节/ }).check();
    await t
      .getByRole("button", { name: "保存12个单元及3个实验草稿", exact: true })
      .click();
    await t
      .getByRole("status")
      .filter({ hasText: "已保存草稿，可直接发布" })
      .waitFor();
    const saved = await (
      await api(t, "get", endpoint + `/status?chapter_id=${target.id}`)
    ).json();
    const result = saved.result;
    const point = result.points.find((p) => p.code === "CH02-U005");
    if ((await api(s, "get", `/learning-content/${point.id}`)).status() !== 404)
      throw Error("学生可读草稿");
    const again = await (
      await api(t, "post", endpoint + "/import", { chapter_id: target.id })
    ).json();
    if (!again.already_imported || again.points.length !== 12)
      throw Error("重复保存未幂等");
    await t.reload();
    await t
      .getByRole("link", { name: "预览发布", exact: true })
      .first()
      .waitFor();
    // Publish existing drafts using the real one-click teacher screen.
    await t
      .getByRole("button", { name: "直接发布已有内容", exact: true })
      .click();
    await t
      .getByRole("status")
      .filter({ hasText: "第二章已直接发布" })
      .waitFor();
    if ((await api(s, "get", `/learning-content/${point.id}`)).status() !== 200)
      throw Error("直接发布后学生无法阅读");
    await s.goto(
      base + `/student/knowledge?chapter=${target.id}&point=${point.id}`,
    );
    await s
      .getByRole("heading", { name: "进程三态与队列的一致变化", exact: true })
      .waitFor();
    await s
      .getByRole("button", { name: /三态与事件：等待不等于就绪/ })
      .first()
      .click();
    await s
      .getByRole("group", { name: "三态与事件：等待不等于就绪", exact: true })
      .waitFor();
    const node = s.getByRole("button", { name: "查看等待的关系", exact: true });
    await node.focus();
    await node.press("Enter");
    if ((await node.getAttribute("aria-pressed")) !== "true")
      throw Error("键盘节点无反馈");
    await s.reload();
    await s
      .getByRole("group", { name: "三态与事件：等待不等于就绪", exact: true })
      .waitFor();
    if (/CH02-[KUV]|S2-0|V001/.test(await s.locator("body").innerText()))
      throw Error("学生显示编写证据编号");
    await s
      .getByRole("link", { name: "向AI问这个概念 →", exact: true })
      .click();
    await s.waitForURL("**/student/ai-chat?**");
    if (
      !(await s.locator("textarea").last().inputValue()).includes(
        "进程三态与队列的一致变化",
      )
    )
      throw Error("AI问题未带概念上下文");
    // Bulk publication ran the existing engines; student uses the existing RR UI.
    const rr = result.experiments.find((x) => x.algorithm === "rr");
    const related = result.points.find((p) => p.code === "CH02-U011");
    await s.goto(
      base + `/student/knowledge?chapter=${target.id}&point=${related.id}`,
    );
    await s
      .getByRole("heading", { name: "RR：时间片边界与回到队尾", exact: true })
      .waitFor();
    await s
      .getByRole("link", {
        name: /RR：到达、片到与完成的队列边界.*进入完整实验/,
      })
      .first()
      .click();
    await s.waitForURL(`**/student/experiments/${rr.id}?**`);
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "第二章：目录冲突映射、草稿保存/刷新/幂等、越权拒绝、一键发布、学生分步图示/键盘/刷新、AI上下文与真实RR入口通过",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
