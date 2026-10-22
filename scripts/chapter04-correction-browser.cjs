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
    const endpoint = "/teacher/chapter-content/chapter03";
    const source = await (
      await api(t, "post", "/teacher/chapters", {
        title: "同步、通信与死锁",
        published: true,
      })
    ).json();
    const chapters = await (await api(t, "get", "/teacher/chapters")).json();
    const target = chapters.find((c) => c.title === "内存管理");
    const published = await api(t, "post", endpoint + "/publish", {
      chapter_id: source.id,
    });
    if (!published.ok()) throw Error(await published.text());
    const original = await published.json();
    const point = original.points.find((p) => p.code === "CH03-U011");
    const content = await (
      await api(s, "get", `/learning-content/${point.id}`)
    ).json();
    if (
      !(
        await api(s, "put", `/learning-content/${point.id}/progress`, {
          revision_id: content.revision_id,
          note: "迁移前的笔记",
          position: "concept",
          bookmarked: true,
        })
      ).ok()
    )
      throw Error("笔记夹具失败");
    const legacy = await (
      await api(t, "post", "/teacher/knowledge", {
        chapter_id: source.id,
        title: "死锁的必要条件",
        content:
          "互斥、请求并保持、不可剥夺、循环等待是死锁的四个必要条件。破坏任一条件可防止死锁。",
        published: true,
      })
    ).json();
    await t.goto(base + "/teacher/chapter-content/chapter04?stage=target");
    await t.getByLabel("第四章目标章节").selectOption(String(target.id));
    await t
      .getByRole("button", { name: "检查目标与目录", exact: true })
      .click();
    await t
      .getByRole("button", { name: "迁移到此章并修正第四章目录", exact: true })
      .click();
    await t
      .getByRole("status")
      .filter({ hasText: "第四章目录已修正" })
      .waitFor();
    await t.goto(base + `/teacher/knowledge?chapter=${target.id}`);
    await t
      .getByRole("heading", { name: "4.3.5 反置页表", exact: true })
      .waitFor();
    await t
      .getByRole("heading", { name: "4.3.6 多级页表", exact: true })
      .waitFor();
    const iptSection = t
      .locator(".outline-section")
      .filter({
        has: t.getByRole("heading", { name: "4.3.5 反置页表", exact: true }),
      });
    const multiSection = t
      .locator(".outline-section")
      .filter({
        has: t.getByRole("heading", { name: "4.3.6 多级页表", exact: true }),
      });
    if (!(await iptSection.innerText()).includes("反置页表与哈希查找"))
      throw Error("反置页表仍为空");
    if (!(await multiSection.innerText()).includes("多级页表的规模与查找"))
      throw Error("多级页表归属错误");
    if ((await multiSection.innerText()).includes("反置页表与哈希查找"))
      throw Error("两个单元仍堆在多级页表下");
    await s.goto(
      base + `/student/knowledge?chapter=${target.id}&point=${point.id}`,
    );
    await s
      .getByRole("heading", { name: "多级页表的规模与查找", exact: true })
      .waitFor();
    await s.getByRole("button", { name: "笔记与反馈", exact: true }).click();
    await s.getByLabel("私人学习笔记").waitFor();
    if ((await s.getByLabel("私人学习笔记").inputValue()) !== "迁移前的笔记")
      throw Error("迁移后笔记丢失");
    await s.reload();
    await s.getByLabel("私人学习笔记").waitFor();
    if (
      (await api(s, "get", `/learning-content/${legacy.id}`)).status() !== 404
    )
      throw Error("旧死锁示例未移除");
    if (
      !(
        await api(t, "post", endpoint + "/correct-location", {
          chapter_id: target.id,
        })
      ).ok()
    )
      throw Error("重复修正失败");
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "第四章迁移浏览器通过：指定目标、4.*目录、4.3.5/4.3.6独立单元、旧示例归档、私人笔记与刷新、重复保护。",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
