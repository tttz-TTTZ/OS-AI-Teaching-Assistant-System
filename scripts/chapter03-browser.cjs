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
    const target = await (
      await api(t, "post", "/teacher/chapters", {
        title: "第三章隔离验收：存储管理",
        published: true,
      })
    ).json();
    const old = await (
      await api(t, "post", "/teacher/sections", {
        chapter_id: target.id,
        code: "3.1",
        title: "教师定制基础节",
        published: true,
      })
    ).json();
    if (target.id === 3) throw Error("夹具不能假定章号等于ID");
    if (
      (
        await api(s, "post", endpoint + "/import", { chapter_id: target.id })
      ).status() !== 403
    )
      throw Error("学生可导入教师内容");
    await t.goto(base + "/teacher/knowledge");
    await t
      .getByRole("link", { name: "第三章预填与审核", exact: true })
      .click();
    await t
      .getByRole("heading", { name: "第三章预填内容与审核", exact: true })
      .waitFor();
    const select = t.getByLabel("预填学习单元");
    await select.waitFor();
    if ((await select.locator("option").count()) !== 12)
      throw Error("没有12个单元");
    await t.getByRole("group", { name: /CH03-G001/ }).waitFor();
    await select.selectOption("CH03-U006");
    await t.getByRole("group", { name: /CH03-F004/ }).waitFor();
    if (await t.getByRole("button", { name: /直接.*发布/ }).count())
      throw Error("第三章存在直接发布按钮");
    await t.getByRole("button", { name: /选择目录，保存草稿/ }).click();
    if ((await t.getByLabel("第三章目标章节").inputValue()) !== "")
      throw Error("自动选择了目标");
    await t.getByLabel("第三章目标章节").selectOption(String(target.id));
    await t
      .getByRole("button", { name: "检查目标与目录", exact: true })
      .click();
    await t.getByText(/编号冲突：请在上方明确映射/).waitFor();
    await t
      .getByLabel("小节映射 3.1", { exact: true })
      .selectOption(String(old.id));
    await t
      .getByRole("button", { name: "检查目标与目录", exact: true })
      .click();
    await t.getByText(/复用「教师定制基础节」/).waitFor();
    await t.getByRole("checkbox", { name: /我已核对目标章节与小节/ }).check();
    await t
      .getByRole("button", { name: "保存12个单元草稿", exact: true })
      .click();
    await t.getByRole("status").filter({ hasText: "导入登记已保存" }).waitFor();
    const result = (
      await (
        await api(t, "get", endpoint + `/status?chapter_id=${target.id}`)
      ).json()
    ).result;
    const point = result.points.find((p) => p.code === "CH03-U006");
    if ((await api(s, "get", `/learning-content/${point.id}`)).status() !== 404)
      throw Error("学生可读草稿");
    const again = await (
      await api(t, "post", endpoint + "/import", { chapter_id: target.id })
    ).json();
    if (
      !again.already_imported ||
      again.points.length !== 12 ||
      again.experiments.length
    )
      throw Error("重导未幂等或制造假实验");
    await t.reload();
    await t
      .getByRole("link", { name: "预览发布", exact: true })
      .first()
      .waitFor();
    // Directory publication remains an explicit teacher action, using existing endpoints.
    const sections = await (
      await api(t, "get", `/sections?chapter_id=${target.id}`)
    ).json();
    for (const section of sections) {
      const { id, ...body } = section;
      if (
        !(
          await api(t, "put", `/teacher/sections/${id}`, {
            ...body,
            published: true,
          })
        ).ok()
      )
        throw Error("目录发布失败");
    }
    await t.goto(base + `/teacher/knowledge/${point.id}/preview`);
    await t.getByRole("button", { name: "发布当前草稿", exact: true }).click();
    await t
      .getByText("知识点已发布，学生现在可以阅读", { exact: true })
      .waitFor();
    await s.goto(
      base + `/student/knowledge?chapter=${target.id}&point=${point.id}`,
    );
    await s
      .getByRole("heading", { name: "TLB路径与访问时间", exact: true })
      .waitFor();
    await s
      .getByRole("button", { name: /TLB与页表路径/ })
      .first()
      .click();
    await s
      .getByRole("group", { name: "TLB与页表路径", exact: true })
      .waitFor();
    const node = s.getByRole("button", {
      name: "查看检查缓存权限的关系",
      exact: true,
    });
    await node.focus();
    await node.press("Enter");
    if ((await node.getAttribute("aria-pressed")) !== "true")
      throw Error("图示键盘无反馈");
    if (process.env.CH03_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.CH03_ARTIFACT_DIR, { recursive: true });
      await s.screenshot({
        path: path.join(process.env.CH03_ARTIFACT_DIR, "student-diagram.png"),
      });
    }
    await s.reload();
    await s
      .getByRole("group", { name: "TLB与页表路径", exact: true })
      .waitFor();
    if (/CH03-[KUV]|S3-0/.test(await s.locator("body").innerText()))
      throw Error("学生显示编写证据");
    await s.getByRole("button", { name: "相关资料", exact: true }).click();
    await s.getByText("教师尚未关联补充资料。", { exact: true }).waitFor();
    await s.getByRole("button", { name: "笔记与反馈", exact: true }).click();
    await s
      .getByLabel("私人学习笔记")
      .fill("TLB未命中不等于缺页；先看权限与驻留。");
    await s.getByRole("button", { name: "保存学习记录", exact: true }).click();
    await s.getByText("当前无待保存修改", { exact: false }).waitFor();
    await s.reload();
    await s.getByLabel("私人学习笔记").waitFor();
    if (!(await s.getByLabel("私人学习笔记").inputValue()).includes("先看权限"))
      throw Error("笔记刷新丢失");
    if (
      (
        await (
          await api(s, "get", `/experiments?knowledge_id=${point.id}`)
        ).json()
      ).length
    )
      throw Error("出现虚假存储实验");
    await s
      .getByRole("link", { name: "向AI问这个概念 →", exact: true })
      .click();
    await s.waitForURL("**/student/ai-chat?**");
    if (
      !(await s.locator("textarea").last().inputValue()).includes(
        "TLB路径与访问时间",
      )
    )
      throw Error("没有AI上下文");
    // On a narrow screen the teacher still has a full-page reading/selection flow.
    await t.setViewportSize({ width: 390, height: 844 });
    await t.goto(base + "/teacher/chapter-content/chapter03");
    await t.getByLabel("预填学习单元").waitFor();
    await t.getByRole("button", { name: /选择目录，保存草稿/ }).click();
    await t.getByLabel("第三章目标章节").waitFor();
    if (process.env.CH03_ARTIFACT_DIR)
      await t.screenshot({
        path: path.join(process.env.CH03_ARTIFACT_DIR, "teacher-mobile.png"),
      });
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "第三章：12单元、显式目录/冲突映射、幂等草稿、学生越权/未发布拒绝、教师审核发布、图示键盘/刷新、资料空态、私人笔记、AI上下文和窄屏操作通过；无新算法/动画。",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
