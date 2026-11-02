const { createRequire } = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium } = createRequire(path.resolve(__dirname, "../frontend/package.json"))("playwright");
const accounts = JSON.parse(fs.readFileSync(process.env.TEST_ACCOUNTS_FILE, "utf8"));
const base = process.env.APP_TEST_BASE_URL || "http://127.0.0.1:5173";
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
  const errors = [];
  try {
    for (const role of ["student", "teacher"]) {
      const account = accounts.find((item) => item.role === role);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base + "/login");
      await page.getByRole("link", { name: role === "teacher" ? "教师端" : "学生端", exact: true }).click();
      await page.getByLabel("用户名").fill(account.username);
      await page.getByLabel("密码", { exact: true }).fill(account.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.waitForURL(`**/${role}/dashboard`);
      const routes = role === "student" ? ["dashboard", "materials", "profile", "ai-chat"] : ["dashboard", "materials", "accounts", "profile"];
      for (const route of routes) {
        await page.goto(`${base}/${role}/${route}`);
        await page.getByRole("navigation", { name: "主导航" }).waitFor();
        assert.equal(await page.locator(".layout > aside").count(), 0);
        const dimensions = await page.evaluate(() => {
          const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
          const header = rect(".app-topbar"), main = rect("main"), brand = rect(".app-brand"), account = rect(".app-account");
          return { headerBottom: header.bottom, mainWidth: main.width, brandTop: brand.top, accountTop: account.top, width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        assert(dimensions.headerBottom <= 80, JSON.stringify(dimensions));
        assert(dimensions.mainWidth >= dimensions.width - 2, JSON.stringify(dimensions));
        assert(Math.abs(dimensions.brandTop - dimensions.accountTop) < 20);
        assert.equal(dimensions.overflow, false);
      }
      if (role === "student") {
        await page.goto(base + "/student/ai-chat");
        await page.getByRole("region", { name: "学习对话", exact: true }).waitFor();
        for (const [width, height] of [[2560, 1440], [1440, 900], [1024, 600], [820, 600]]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const sizes = await page.evaluate(() => {
            const rect = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
            return { header: rect(".app-topbar"), grid: rect(".notebook-grid"), sources: rect(".notebook-sources"), conversation: rect(".notebook-conversation"), studio: rect(".notebook-studio"), bodyHeight: document.documentElement.scrollHeight, bodyWidth: document.documentElement.scrollWidth };
          });
          assert(sizes.sources.right <= sizes.conversation.x, JSON.stringify(sizes));
          assert(sizes.conversation.right <= sizes.studio.x, JSON.stringify(sizes));
          assert(sizes.grid.y - sizes.header.bottom <= 14, JSON.stringify(sizes));
          assert(sizes.grid.height >= height - 110, JSON.stringify(sizes));
          assert(sizes.studio.bottom <= height && sizes.bodyHeight <= height + 1, JSON.stringify(sizes));
          assert(sizes.bodyWidth <= width + 1, JSON.stringify(sizes));
          assert.equal(await page.getByRole("button", { name: /收起来源|展开来源|收起学习工具|展开学习工具/ }).count(), 0);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.screenshot({ path: "/tmp/os-landscape-desktop.png" });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        for (const region of ["学习来源", "学习对话", "学习工具"]) {
          assert.equal(await page.getByRole("region", { name: region, exact: true }).count(), 1);
        }
        await page.screenshot({ path: "/tmp/os-landscape-mobile.png", fullPage: true });
      }
      await page.getByRole("link", { name: /个人账户/ }).click();
      await page.waitForURL(`**/${role}/profile`);
      await page.getByRole("button", { name: "退出", exact: true }).click();
      await page.waitForURL("**/login");
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log("PASS: horizontal navigation on all student/teacher pages, full-height three panels at four landscape sizes, mobile overflow, account navigation and logout");
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
