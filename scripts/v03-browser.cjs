// Run against an isolated server with TEST_ACCOUNTS_FILE containing teacher/student accounts.
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = createRequire(path.resolve(__dirname, "../frontend/package.json"))("playwright");
const accounts = JSON.parse(fs.readFileSync(process.env.TEST_ACCOUNTS_FILE, "utf8"));
const base = process.env.APP_TEST_BASE_URL || "http://127.0.0.1:5173";
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE, args: ["--no-sandbox"] });
  const errors = [];
  let checks = 0;
  try {
    for (const account of accounts) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("response", (response) => {
        if (response.url().includes("/api/") && response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
      });
      const teacher = account.role === "teacher";
      await page.goto(base + "/login");
      await page.getByRole("link", { name: teacher ? "教师端" : "学生端", exact: true }).click();
      await page.getByLabel("用户名").fill(account.username);
      await page.getByLabel("密码", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.waitForURL(`**/${account.role}/dashboard`);
      const removed = teacher ? ["课程目录", "知识点内容", "算法实验管理"] : ["知识点学习", "算法实验"];
      for (const name of removed) {
        assert.equal(await page.getByRole("link", { name, exact: true }).count(), 0);
        checks++;
      }
      const retained = teacher
        ? [["materials", "公共资料"], ["questions", "练习题管理"], ["accounts", "账号管理"]]
        : [["materials", "课程资料"], ["ai-chat", "智能问答"], ["practice", "章节练习"]];
      for (const [, name] of retained) {
        assert.equal(await page.locator("aside").getByRole("link", { name, exact: true }).count(), 1);
      }
      for (const [route, name] of retained) {
        await page.goto(`${base}/${account.role}/${route}`);
        await page.waitForURL(`**/${account.role}/${route}`);
        await page.locator("main h1").first().waitFor();
        assert.equal(await page.getByText("页面不存在", { exact: true }).count(), 0);
        checks++;
      }
      for (const route of teacher
        ? ["chapters", "chapters/1/edit", "sections/new", "knowledge", "knowledge/1/content", "experiments", "experiments/1/edit", "chapter-content/chapter02", "ai-lessons"]
        : ["knowledge", "course-reading", "experiments", "experiments/1", "experiment-runs/1"]) {
        await page.goto(`${base}/${account.role}/${route}`);
        await page.waitForURL(`**/${account.role}/dashboard`);
        checks++;
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(`V0.3 browser checks passed: ${checks}; no runtime or server errors`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
