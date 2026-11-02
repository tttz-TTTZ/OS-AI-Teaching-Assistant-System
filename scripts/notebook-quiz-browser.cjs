// Isolated UI regression: real login, synthetic private quiz and grading responses.
const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = createRequire(path.resolve(__dirname, "../frontend/package.json"))("playwright");
const account = JSON.parse(fs.readFileSync(process.env.TEST_ACCOUNTS_FILE, "utf8")).find((a) => a.role === "student");
const base = process.env.APP_TEST_BASE_URL || "http://127.0.0.1:5173";
const questions = [
  { kind: "single", prompt: "操作系统管理资源吗？", options: ["是", "否"], items: [] },
  { kind: "multiple", prompt: "选择执行实体", options: ["进程", "线程", "磁盘"], items: [] },
  { kind: "boolean", prompt: "文件可以存放在磁盘上", options: ["正确", "错误"], items: [] },
  { kind: "short", prompt: "描述操作系统职责", options: [], items: [] },
  { kind: "matching", prompt: "匹配资源", options: ["CPU", "磁盘"], items: ["进程", "文件"] },
];
const job = {
  id: 999999, kind: "practice", status: "ready", error: "", model: "test-only",
  created_at: "2026-11-03", note: "", bookmarked: false, version: 0,
  body: { title: "界面验收测验", questions, requested_count: questions.length },
  sources: { warnings: [], chunks: [], fingerprint: "", method: "test-only" },
  config: { topic: "界面验收测验", sources: [], modes: [], parent_id: null, kind: "practice" },
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/login");
    await page.getByRole("link", { name: "学生端", exact: true }).click();
    await page.getByLabel("用户名").fill(account.username);
    await page.getByLabel("密码", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL("**/student/dashboard");
    assert.equal(await page.locator('a[href*="ai-practice"]').count(), 0);
    let attempt;
    const reply = (route, data) => route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    await page.route(`**/api/student/personal/jobs/${job.id}`, (route) => reply(route, job));
    await page.route(`**/api/student/personal/jobs/${job.id}/attempts`, (route) => reply(route, attempt ? [attempt] : []));
    await page.route(`**/api/student/personal/jobs/${job.id}/submit`, (route) => {
      const { answers } = route.request().postDataJSON();
      assert.deepEqual(answers, { 0: 0, 1: [0, 1], 2: 0, 3: "管理资源", 4: [0, 1] });
      attempt = { id: 1, score: 4, total: 4, ungraded: 1, results: questions.map((q, i) => ({ index: i, prompt: q.prompt, selected: answers[i], answer: answers[i], correct: i === 3 ? null : true, explanation: "验收解析" })) };
      return reply(route, attempt);
    });
    await page.goto(`${base}/student/ai-practice?job=${job.id}`);
    await page.waitForURL(`**/student/ai-chat?job=${job.id}`);
    const quiz = page.locator(".personal-quiz");
    await quiz.getByRole("heading", { name: "测验", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "我的 AI 练习", exact: true }).count(), 0);
    const fields = quiz.locator("fieldset");
    await fields.nth(0).getByRole("radio").nth(0).check();
    await fields.nth(1).getByRole("checkbox").nth(0).check();
    await fields.nth(1).getByRole("checkbox").nth(1).check();
    await fields.nth(2).getByRole("radio").nth(0).check();
    await fields.nth(3).getByRole("textbox").fill("管理资源");
    await fields.nth(4).getByRole("combobox").nth(0).selectOption("0");
    await fields.nth(4).getByRole("combobox").nth(1).selectOption("1");
    await page.reload();
    await quiz.getByRole("heading", { name: "测验", exact: true }).waitFor();
    assert.equal(await fields.nth(0).getByRole("radio").nth(0).isChecked(), true);
    assert.equal(await fields.nth(3).getByRole("textbox").inputValue(), "管理资源");
    await quiz.getByRole("button", { name: "提交我的自测", exact: true }).click();
    await quiz.getByRole("status").filter({ hasText: "4 / 4" }).waitFor();
    await page.reload();
    await quiz.locator("summary").click();
    await quiz.getByRole("button", { name: "查看本次解析", exact: true }).click();
    await quiz.getByRole("status").filter({ hasText: "4 / 4" }).waitFor();
    assert.equal(await page.locator('a[href*="ai-practice"]').count(), 0);
    await page.goto(base + "/student/ai-practice");
    await page.waitForURL("**/student/ai-chat");
    assert.deepEqual(errors, []);
    console.log("PASS: legacy routes redirect; five question types, draft reload, submit and saved answers work inside notebook; no standalone practice links or runtime errors");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
