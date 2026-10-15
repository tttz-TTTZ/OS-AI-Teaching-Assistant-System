const { createRequire } = require("node:module");
const path = require("node:path");
const { chromium } = createRequire(
  path.resolve(__dirname, "../frontend/package.json"),
)("playwright");
(async () => {
  const browser = await chromium.launch({
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 768 },
  });
  const filename = `browser-test-${Date.now()}.txt`;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("heading", { name: "学习首页", exact: true }).waitFor();
  await page.getByText("操作系统概述 →", { exact: true }).waitFor();
  await page.getByRole("link", { name: "知识点学习", exact: true }).click();
  await page
    .getByRole("heading", { name: "操作系统的目标", exact: true })
    .waitFor();
  await page.getByLabel("选择章节").selectOption("3");
  await page
    .getByRole("heading", { name: "先来先服务 FCFS", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "进入 FCFS 实验 →" }).click();
  await page.getByRole("button", { name: "示例 2（含空闲）" }).click();
  await page.getByRole("button", { name: "运行 FCFS", exact: true }).click();
  await page.getByText("平均等待 0.00", { exact: true }).waitFor();
  if ((await page.getByText("CPU 空闲", { exact: true }).count()) !== 2)
    throw Error("idle timeline wrong");
  await page.getByRole("link", { name: "课程资料", exact: true }).click();
  await page
    .getByLabel("上传资料")
    .setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: Buffer.from("浏览器上传测试"),
    });
  await page
    .locator("button")
    .filter({ hasText: /^上传资料$/ })
    .click();
  const row = page.getByRole("row").filter({ hasText: filename });
  await row.waitFor();
  await row.getByRole("button", { name: "详情", exact: true }).click();
  await page.getByText("浏览器上传测试", { exact: true }).waitFor();
  const file = await row
    .getByRole("link", { name: "下载", exact: true })
    .getAttribute("href");
  const res = await page.request.get(new URL(file, page.url()).href);
  if ((await res.text()) !== "浏览器上传测试") throw Error("download content");
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "删除", exact: true }).click();
  await row.waitFor({ state: "detached" });
  await page.getByRole("link", { name: "章节练习", exact: true }).click();
  await page.getByLabel("A. 管理系统资源", { exact: true }).check();
  await page.getByRole("button", { name: "提交练习", exact: true }).click();
  await page.getByText("本次得分：1 / 1", { exact: true }).waitFor();
  await page.getByRole("link", { name: "智能问答", exact: true }).click();
  await page.getByLabel("输入问题").fill("解释进程");
  await page.getByRole("button", { name: "发送问题", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "尚未配置 AI 服务" })
    .waitFor();
  await page.getByRole("button", { name: "清空当前对话", exact: true }).click();
  await page
    .getByText("试试提问：进程与线程有什么区别？", { exact: true })
    .waitFor();
  await page.route("**/api/chapters", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ detail: "测试后端异常" }),
    }),
  );
  await page.getByRole("link", { name: "学习首页", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "测试后端异常" }).waitFor();
  await page.unroute("**/api/chapters");
  await page.setViewportSize({ width: 640, height: 800 });
  await page.reload();
  await page.getByRole("heading", { name: "学习首页", exact: true }).waitFor();

  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS browser: six pages, chapters, FCFS idle timeline, upload/download/delete, practice grading, missing AI, backend error, narrow viewport; no JS runtime errors",
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
