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
    async function login(page, account, navigate = true) {
      if (navigate) await page.goto(base + "/login");
      await page
        .getByRole("link", {
          name: account.role === "teacher" ? "教师端" : "学生端",
          exact: true,
        })
        .click();
      await page
        .getByRole("heading", {
          name: account.role === "teacher" ? "教师登录" : "学生登录",
          exact: true,
        })
        .waitFor();
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
    await t.getByRole("link", { name: "课程目录", exact: true }).click();
    await t.getByRole("link", { name: "＋ 新建章节", exact: true }).click();
    await t.getByLabel("章节标题").fill(chapterTitle);
    await t.getByLabel("章节说明").fill("浏览器真实提交的演示章节");
    await t.getByRole("button", { name: "保存章节", exact: true }).click();
    await t.waitForURL("**/teacher/chapters?chapter=*");
    await t.getByRole("heading", { name: chapterTitle, exact: true }).waitFor();
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
    await t.getByRole("link", { name: "＋ 添加小节", exact: true }).click();
    await t.getByLabel("小节标题", { exact: true }).fill("先规划的小节");
    await t.getByLabel("小节编号", { exact: true }).fill("待校对");
    await t.getByLabel("发布小节", { exact: true }).check();
    await t.getByRole("button", { name: "保存小节", exact: true }).click();
    await t.waitForURL("**/teacher/chapters?chapter=*");
    await t.goto(base + `/teacher/knowledge?chapter=${cid}`);
    await t.getByRole("link", { name: "＋ 添加本节标题", exact: true }).click();
    await t
      .getByLabel("知识点标题", { exact: true })
      .fill("预先规划的标题一\n预先规划的标题二");
    await t
      .getByRole("button", { name: "保存标题，建立目录", exact: true })
      .click();
    await t.waitForURL("**/teacher/chapters?chapter=*");
    await t.goto(base + `/teacher/knowledge?chapter=${cid}`);
    await t.getByText("预先规划的标题一", { exact: true }).waitFor();
    await t.getByText("预先规划的标题二", { exact: true }).waitFor();
    if (await t.locator("textarea:visible").count())
      throw Error("目录规划页不应展示正文编辑表单");
    if (process.env.BROWSER_SCREENSHOT_DIR)
      await t.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "teacher-flow-outline.png",
        ),
      });
    await t.getByRole("link", { name: "知识点内容", exact: true }).click();
    await t
      .getByRole("heading", { name: "选择知识点，开始编写", exact: true })
      .waitFor();
    await t
      .getByRole("link", { name: "＋ 添加知识点标题", exact: true })
      .click();
    await t.getByLabel("所属章节", { exact: true }).selectOption(String(cid));
    await t.getByLabel("知识点标题", { exact: true }).fill(pointTitle);
    await t
      .getByRole("button", { name: "保存标题，建立目录", exact: true })
      .click();
    await t.waitForURL("**/teacher/knowledge/*/settings");
    const kid = Number(new URL(t.url()).pathname.split("/")[3]);
    const steps = t.getByRole("navigation", { name: "知识点编写步骤" });
    await t.getByLabel("教学编号", { exact: true }).fill("1.1.待校对");
    await steps.getByRole("button", { name: /编写内容/ }).click();
    await t.getByLabel("学习目标", { exact: true }).fill("理解测试原理");
    for (const [kind, label] of [
      ["intro", "问题导入"],
      ["concept", "核心概念"],
      ["case", "典型案例"],
      ["mistake", "易错点"],
      ["summary", "总结"],
    ]) {
      await t.getByLabel("正在编写的模块", { exact: true }).selectOption(kind);
      await t
        .getByLabel(label + "正文", { exact: true })
        .fill("教学演示：" + label);
    }
    await t
      .getByLabel("正在编写的模块", { exact: true })
      .selectOption("explanation");
    await t
      .getByLabel("正文（支持基础 Markdown）")
      .fill(
        '# 测试概念\n- 真实课程内容\n\n```python\nprint("FCFS")\n```\n\n|指标|公式|\n|---|---|\n|等待|开始减到达|',
      );
    const textWidth = await t
      .getByLabel("正文（支持基础 Markdown）")
      .boundingBox();
    if (textWidth.width < 650) throw Error("内容编辑区不够宽");
    if ((await t.locator("textarea:visible").count()) !== 1)
      throw Error("同页不应同时铺开其他模块正文");
    await t.getByRole("button", { name: "＋ 交互演示", exact: true }).click();
    await t
      .getByLabel("交互演示正文", { exact: true })
      .fill("观察不同内存分配后的剩余空间");
    await t.getByLabel("C 分配 MB", { exact: true }).fill("128");
    if (process.env.BROWSER_SCREENSHOT_DIR) {
      await t.evaluate(() => window.scrollTo(0, 0));
      await t.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "teacher-flow-content.png",
        ),
      });
    }
    await steps.getByRole("button", { name: /资料与关联/ }).click();
    await t.getByLabel("关联 FCFS 实验").check();
    await steps.getByRole("button", { name: /基本信息/ }).click();
    await t
      .getByLabel("知识点标题", { exact: true })
      .fill(pointTitle + " 草稿修改");
    await t.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/teacher/learning-content/${kid}`) &&
        r.request().method() === "PUT" &&
        r.status() === 200,
    );
    await t.getByLabel("知识点标题", { exact: true }).fill(pointTitle);
    await t.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/teacher/learning-content/${kid}`) &&
        r.request().method() === "PUT" &&
        r.status() === 200,
    );
    await t.getByLabel("停笔后自动保存草稿", { exact: true }).uncheck();
    await t
      .getByLabel("知识点标题", { exact: true })
      .fill(pointTitle + " 未完成标题");
    await t.waitForFunction(() =>
      Object.keys(sessionStorage).some(
        (key) =>
          key.startsWith("os:authoring:") &&
          JSON.parse(sessionStorage.getItem(key)).title.endsWith("未完成标题"),
      ),
    );
    t.once("dialog", (dialog) => dialog.accept());
    await t.reload();
    await t
      .getByRole("status")
      .filter({ hasText: "已恢复本标签未保存的编辑" })
      .waitFor();
    if (
      (await t.getByLabel("知识点标题", { exact: true }).inputValue()) !==
      pointTitle + " 未完成标题"
    )
      throw Error("未保存草稿没有恢复");
    await t.getByLabel("知识点标题", { exact: true }).fill(pointTitle);
    await t.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/teacher/learning-content/${kid}`) &&
        r.request().method() === "PUT" &&
        r.status() === 200,
    );
    if (process.env.BROWSER_SCREENSHOT_DIR) {
      await t.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "teacher-flow-settings.png",
        ),
      });
    }
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
    await t.getByRole("link", { name: "课程目录", exact: true }).click();
    const row = t.locator(".outline-chapter").filter({
      has: t.getByRole("heading", { name: chapterTitle, exact: true }),
    });
    await row.getByRole("link", { name: "编辑章节", exact: true }).click();
    await t.getByLabel(/^发布给学生/).check();
    await t.getByRole("button", { name: "保存章节", exact: true }).click();
    await t.waitForURL("**/teacher/chapters?chapter=*");
    await t.goto(base + `/teacher/knowledge/${kid}/preview`);
    await t.getByRole("button", { name: "发布当前草稿", exact: true }).click();
    await t.getByRole("status").filter({ hasText: "知识点已发布" }).waitFor();
    await t.reload();
    await t.getByRole("button", { name: "撤回发布", exact: true }).waitFor();
    if (process.env.BROWSER_SCREENSHOT_DIR) {
      await t.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "teacher-flow-preview.png",
        ),
      });
    }
    await s.goto(base + `/student/knowledge?chapter=${cid}`);
    await s
      .getByRole("heading", { name: "选择今天要学的知识点", exact: true })
      .waitFor();
    await s
      .getByLabel("搜索本章知识点", { exact: true })
      .fill("本章不存在的检索词");
    await s
      .getByText("没有找到匹配的知识点，请换个关键词。", { exact: true })
      .waitFor();
    await s.getByLabel("搜索本章知识点", { exact: true }).fill("");
    const studentRow = s.locator(".study-point-row").filter({
      has: s.getByRole("heading", { name: pointTitle, exact: true }),
    });
    if (await s.locator("textarea:visible,.interactive:visible").count())
      throw Error("目录不应混入正文或笔记");
    if (process.env.BROWSER_SCREENSHOT_DIR)
      await s.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "student-flow-catalog.png",
        ),
      });
    await studentRow
      .getByRole("button", { name: "开始学习 →", exact: true })
      .click();
    await s.getByRole("heading", { name: pointTitle, exact: true }).waitFor();
    const tasks = s.getByRole("navigation", { name: "知识点学习任务" });
    await s.getByRole("heading", { name: "学习目标", exact: true }).waitFor();
    if (await s.locator(".content-block:visible,textarea:visible").count())
      throw Error("学习概览不应铺开所有模块");
    await s.getByRole("button", { name: "下一环节 →", exact: true }).click();
    await s.getByRole("heading", { name: "问题导入", exact: true }).waitFor();
    await s
      .getByLabel("本知识点学习导航", { exact: true })
      .selectOption("explanation");
    await s.getByRole("heading", { name: "测试概念", exact: true }).waitFor();
    await s.getByRole("table").waitFor();
    if ((await s.locator("pre code").innerText()) !== 'print("FCFS")')
      throw Error("code rendering");
    const readerBox = await s
      .getByRole("region", { name: "当前学习内容", exact: true })
      .boundingBox();
    if (
      readerBox.width < 700 ||
      (await s.locator(".content-block:visible").count()) !== 1
    )
      throw Error("学生阅读应全宽、一次一个模块");
    if (process.env.BROWSER_SCREENSHOT_DIR)
      await s.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "student-flow-reading.png",
        ),
      });
    await s
      .getByLabel("本知识点学习导航", { exact: true })
      .selectOption({ label: "7. 交互演示 · 交互动画" });
    const interactionBlock = new URL(s.url()).searchParams.get("block");
    await s.getByRole("button", { name: "生成教学事件", exact: true }).click();
    await s.getByRole("heading", { name: "空闲内存", exact: true }).waitFor();
    for (let step = 0; step < 3; step++)
      await s.getByRole("button", { name: "下一步", exact: true }).click();
    await s
      .getByRole("button", { name: "记录本次观察完成", exact: true })
      .click();
    await s
      .getByRole("button", { name: "已记录观察完成", exact: true })
      .waitFor();
    if (process.env.BROWSER_SCREENSHOT_DIR) {
      await s.locator(".interactive").scrollIntoViewIfNeeded();
      await s.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "digital-student.png",
        ),
      });
    }
    await tasks
      .getByRole("button", { name: "笔记与反馈", exact: true })
      .click();
    await tasks
      .getByRole("button", { name: "阅读与观察", exact: true })
      .click();
    await s
      .getByRole("button", { name: "已记录观察完成", exact: true })
      .waitFor();
    await tasks
      .getByRole("button", { name: "笔记与反馈", exact: true })
      .click();
    await s.getByText("互动：1 项已完成观察", { exact: true }).waitFor();
    if (await s.locator(".content-block:visible,.interactive:visible").count())
      throw Error("笔记页不应混入正文与动画");
    await s.getByLabel("标记已阅读", { exact: true }).check();
    await s
      .getByLabel("私人学习笔记", { exact: true })
      .fill("浏览器保存的私人笔记");
    await s.getByRole("button", { name: "保存学习记录", exact: true }).click();
    await s.getByRole("status").filter({ hasText: "学习记录已保存" }).waitFor();
    await s.reload();
    if (
      (await s.getByLabel("私人学习笔记", { exact: true }).inputValue()) !==
      "浏览器保存的私人笔记"
    )
      throw Error("学习笔记刷新丢失");
    if (process.env.BROWSER_SCREENSHOT_DIR)
      await s.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "student-flow-notes.png",
        ),
      });
    // A failed database write must keep the student's text and block navigation away.
    await s
      .getByLabel("私人学习笔记", { exact: true })
      .fill("断网后仍然保留的私人笔记");
    await s.route("**/api/learning-content/*/progress", (r) =>
      r.request().method() === "PUT"
        ? r.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ detail: "验收模拟保存失败" }),
          })
        : r.continue(),
    );
    await s.getByRole("link", { name: "练习本知识点 →", exact: true }).click();
    await s
      .getByRole("alert")
      .filter({ hasText: "验收模拟保存失败" })
      .waitFor();
    if (
      !s.url().includes("/student/knowledge") ||
      (await s.getByLabel("私人学习笔记", { exact: true }).inputValue()) !==
        "断网后仍然保留的私人笔记"
    )
      throw Error("保存失败不得离开或清空笔记");
    await s.unroute("**/api/learning-content/*/progress");
    s.once("dialog", (dialog) => dialog.accept());
    await s.reload();
    await s
      .getByRole("status")
      .filter({ hasText: "已恢复本标签未保存的学习记录" })
      .waitFor();
    if (
      (await s.getByLabel("私人学习笔记", { exact: true }).inputValue()) !==
      "断网后仍然保留的私人笔记"
    )
      throw Error("未保存笔记刷新恢复失败");
    await s.getByRole("button", { name: "保存学习记录", exact: true }).click();
    await s.getByRole("status").filter({ hasText: "学习记录已保存" }).waitFor();
    await tasks
      .getByRole("button", { name: "阅读与观察", exact: true })
      .click();
    if (
      (await s.getByLabel("本知识点学习导航", { exact: true }).inputValue()) !==
      interactionBlock
    )
      throw Error("切换任务应保留阅读位置");
    await tasks.getByRole("button", { name: "相关资料", exact: true }).click();
    await s
      .getByRole("heading", { name: "本知识点相关资料", exact: true })
      .waitFor();
    if (await s.locator("textarea:visible,.interactive:visible").count())
      throw Error("资料页不应混入笔记和动画");
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
    await require("./experiment-browser.cjs").verifyExperiments({
      t,
      s,
      b,
      base,
      cid,
      kid,
      suffix,
      apiCall,
    });
    await require("./presentation-browser.cjs").verifyPresentations({
      t,
      s,
      b,
      base,
      cid,
      suffix,
      apiCall,
    });
    await require("./ai-question-browser.cjs").verifyAIQuestions({
      t,
      s,
      base,
      teacherName: accounts[0].username,
      apiCall,
      cid,
    });
    await require("./personal-browser.cjs").verifyPersonal({ t, s, b, base, studentName: accounts[1].username, cid, apiCall });
    await s.getByRole("link", { name: "返回首页", exact: false }).click();
    await s.getByRole("link", { name: "章节练习", exact: true }).click();
    await s.getByLabel("选择章节").selectOption("1");
    await s.getByLabel("A. 管理系统资源", { exact: true }).check();
    await s.getByRole("button", { name: "提交练习", exact: true }).click();
    await s.getByText("本次得分：1 / 1", { exact: true }).waitFor();
    await s.getByRole("link", { name: "智能问答", exact: true }).click();
    await s.getByRole("heading", { name: "操作系统 · 智能问答", exact: true }).waitFor();
    if (await s.getByRole("link", { name: "基础问答（兼容）", exact: true }).count()) throw Error("旧基础问答入口未移除");
    if (await s.getByRole("navigation", { name: "笔记本导航" }).count()) throw Error("顶部栏目未移除");
    await s.goto(base + "/student/basic-chat");
    await s.waitForURL("**/student/ai-chat");
    await s.getByRole("heading", { name: "操作系统 · 智能问答", exact: true }).waitFor();
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
    await t
      .getByLabel("关联知识点（可多选）", { exact: true })
      .selectOption(String(kid));
    await t.getByLabel(/^发布给学生/).check();
    await t.getByRole("button", { name: "保存题目" }).click();
    await t.getByRole("status").filter({ hasText: "练习题已保存" }).waitFor();
    await s.goto(base + `/student/knowledge?chapter=${cid}&point=${kid}`);
    const returnModule = await s
      .getByLabel("本知识点学习导航", { exact: true })
      .inputValue();
    await s.getByRole("link", { name: "练习本知识点 →", exact: true }).click();
    await s.getByLabel("A. 正确选项", { exact: true }).check();
    await s.getByRole("button", { name: "提交练习", exact: true }).click();
    await s.getByText("本次得分：1 / 1", { exact: true }).waitFor();
    await s.getByRole("link", { name: "返回原知识点 →", exact: true }).click();
    if (
      (await s.getByLabel("本知识点学习导航", { exact: true }).inputValue()) !==
      returnModule
    )
      throw Error("练习返回应保持原阅读模块");
    await s
      .getByRole("navigation", { name: "知识点学习任务" })
      .getByRole("button", { name: "笔记与反馈", exact: true })
      .click();
    await s.getByText("练习：已完成作答", { exact: true }).waitFor();
    await s.getByText("给教师反馈本知识点", { exact: true }).click();
    await s
      .getByLabel("主动提交的学习反馈", { exact: true })
      .fill("请补充这个案例的解释");
    await s.getByRole("button", { name: "发送学习反馈", exact: true }).click();
    await s
      .getByRole("status")
      .filter({ hasText: "反馈已发送给教师" })
      .waitFor();
    await t.goto(base + "/teacher/learning-feedback");
    await t.getByText("请补充这个案例的解释", { exact: true }).waitFor();

    await t.route("**/api/teacher/chapters", (r) =>
      r.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "验收模拟后端错误" }),
      }),
    );
    await t.getByRole("link", { name: "课程目录", exact: true }).click();
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
    await b.goto(base + `/student/knowledge?point=${kid}&block=explanation`);
    await b.getByRole("heading", { name: "测试概念", exact: true }).waitFor();
    if (new URL(b.url()).searchParams.get("chapter") !== String(cid))
      throw Error("仅有知识点ID的链接应补齐章节");
    if (
      await b.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      )
    )
      throw Error("窄屏知识点阅读横向溢出");
    if (process.env.BROWSER_SCREENSHOT_DIR)
      await b.screenshot({
        path: path.join(
          process.env.BROWSER_SCREENSHOT_DIR,
          "student-flow-narrow.png",
        ),
      });
    await b
      .getByRole("navigation", { name: "知识点学习任务" })
      .getByRole("button", { name: "笔记与反馈", exact: true })
      .click();
    if (await b.getByLabel("私人学习笔记", { exact: true }).inputValue())
      throw Error("其他学生不能读到私人笔记");
    await b.goto(base + `/student/knowledge?chapter=${cid}&point=999999`);
    await b
      .getByRole("heading", { name: "暂时无法打开这个知识点", exact: true })
      .waitFor();
    await b.getByRole("button", { name: "返回课程目录", exact: true }).click();
    await b
      .getByRole("heading", { name: "选择今天要学的知识点", exact: true })
      .waitFor();
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
    // window.open 复制 opener 的 sessionStorage，模拟“复制标签页”。
    const popupPromise = t.waitForEvent("popup");
    await t.evaluate(() => window.open("/login", "_blank"));
    const copied = await popupPromise;
    copied.on("pageerror", (e) => errors.push(e.message));
    await copied.getByRole("button", { name: "登录", exact: true }).waitFor();
    const teacherContext = await t.evaluate(() =>
      sessionStorage.getItem("os:session-context"),
    );
    const copiedContext = await copied.evaluate(() =>
      sessionStorage.getItem("os:session-context"),
    );
    if (teacherContext === copiedContext) throw Error("复制标签未分离上下文");
    await login(copied, accounts[1]);
    await copied.reload();
    await copied
      .getByRole("heading", { name: "学习首页", exact: true })
      .waitFor();
    await t.reload();
    await t.getByRole("heading", { name: "账号管理", exact: true }).waitFor();
    // 挂起旧身份请求，重新登录后再返回。401 不得清空新登录；200 不得交付旧数据。
    for (const status of [401, 200]) {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      let started;
      const seen = new Promise((resolve) => {
        started = resolve;
      });
      await copied.route("**/api/session-race-test", async (route) => {
        started();
        await gate;
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(
            status === 401
              ? { detail: "旧会话已过期" }
              : { private: "旧账号数据" },
          ),
        });
      });
      await copied.evaluate(() => {
        window.raceResult = "pending";
        import("/src/api.ts")
          .then(({ request }) => request("/session-race-test"))
          .then(() => {
            window.raceResult = "unexpected success";
          })
          .catch((e) => {
            window.raceResult = e.name;
          });
      });
      await seen;
      await copied
        .getByRole("button", { name: "退出登录", exact: true })
        .click();
      await copied.waitForURL("**/login");
      await login(copied, status === 401 ? accounts[2] : accounts[1], false);
      release();
      await copied.waitForFunction(() => window.raceResult === "AbortError");
      await copied
        .getByRole("heading", { name: "学习首页", exact: true })
        .waitFor();
      await copied.unroute("**/api/session-race-test");
    }
    // 当前会话真正过期时应退出；重新登录后恢复，其他教师标签不受影响。
    await copied.route("**/api/session-expiry-test", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"detail":"登录已过期，请重新登录"}',
      }),
    );
    await copied.evaluate(async () => {
      const { request } = await import("/src/api.ts");
      await request("/session-expiry-test").catch(() => {});
    });
    await copied.waitForURL("**/login");
    await login(copied, accounts[1], false);
    await copied.getByRole("button", { name: "退出登录", exact: true }).click();
    await copied.waitForURL("**/login");
    await t.reload();
    await t.getByRole("heading", { name: "账号管理", exact: true }).waitFor();
    await copied.close();
    console.log(
      "PASS 登录回归：复制标签独立、刷新、交叉登录退出、旧401/200响应隔离、当前401重新登录",
    );
    const signup = await contexts[0].newPage();
    signup.on("pageerror", (e) => errors.push(e.message));
    await signup.goto(base + "/login");
    await signup.getByRole("link", { name: "教师端", exact: true }).click();
    await signup
      .getByRole("heading", { name: "教师登录", exact: true })
      .waitFor();
    if (
      await signup.getByRole("link", { name: "没有账号？注册学生账号" }).count()
    )
      throw Error("教师端不应展示注册入口");
    await signup.getByRole("link", { name: "学生端", exact: true }).click();
    await signup.getByRole("link", { name: "没有账号？注册学生账号" }).click();
    const registeredName = "self-registered-" + suffix;
    const registeredPassword = "browser-registration-" + suffix;
    await signup.getByLabel("用户名", { exact: true }).fill(registeredName);
    await signup.getByLabel("密码", { exact: true }).fill(registeredPassword);
    await signup
      .getByLabel("确认密码", { exact: true })
      .fill(registeredPassword + "x");
    await signup
      .getByRole("button", { name: "注册学生账号", exact: true })
      .click();
    await signup
      .getByRole("alert")
      .filter({ hasText: "两次输入的密码不一致" })
      .waitFor();
    await signup
      .getByLabel("确认密码", { exact: true })
      .fill(registeredPassword);
    await signup
      .getByRole("button", { name: "注册学生账号", exact: true })
      .click();
    await signup.getByRole("status").filter({ hasText: "注册成功" }).waitFor();
    await login(
      signup,
      {
        username: registeredName,
        password: registeredPassword,
        role: "student",
      },
      false,
    );
    await signup.reload();
    await signup
      .getByRole("heading", { name: "学习首页", exact: true })
      .waitFor();
    if (
      (
        await apiCall(signup, "get", base + "/api/teacher/accounts")
      ).status() !== 403
    )
      throw Error("自注册学生越权");
    const registeredAccounts = await (
      await apiCall(t, "get", base + "/api/teacher/accounts")
    ).json();
    if (
      !registeredAccounts.some(
        (account) =>
          account.username === registeredName && account.role === "student",
      )
    )
      throw Error("自注册学生未保存到统一账号库");
    await signup.close();
    console.log(
      "PASS 学生注册：入口区分、确认密码、真实注册登录刷新、教师可管理、后端拒绝越权",
    );
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "PASS browser 学生学习流程：独立目录、单模块全宽阅读、教学动画、分离资料与笔记、保存失败保护与刷新草稿恢复、练习往返；教师分步流程：独立章节/小节表单、批量标题规划、全宽单模块编辑、跨步骤保存、刷新草稿恢复、整页预览发布；数字教材与V0.2回归：灵活编号、草稿自动保存、知识点发布、内存事件运行/回放/完成记录、私人笔记刷新保持、知识点练习往返、主动反馈； 两角色登录/刷新/路由，教师章节知识点编辑与发布，公共资料关联/撤回，私人文件越权与AI引用，FCFS/练习，教师题目，错误提示，退出撤销，窄屏；同浏览器双标签独立登录/刷新/退出、账号创建；无JS异常",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
