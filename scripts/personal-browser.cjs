const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
async function verifyPersonal({ t, s, b, base, studentName, cid, apiCall }) {
  await s.route("**/api/student/personal/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        model: "mock-notebook-test",
        daily_limit: 20,
      }),
    }),
  );
  await s.route("**/api/student/personal/ask", async r => {
    const result = execFileSync(process.env.TEST_PYTHON, [path.join(__dirname, "personal_fixture.py"), studentName], {input: r.request().postData(), encoding: "utf8"});
    await r.fulfill({status: 200, contentType: "application/json", body: result});
  });
  await s.route("**/api/student/personal/generate", async (r) => {
    const result = execFileSync(
      process.env.TEST_PYTHON,
      [path.join(__dirname, "personal_fixture.py"), studentName],
      { input: r.request().postData(), encoding: "utf8" },
    );
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: result,
    });
  });
  await s.route("**/api/student/personal/jobs", r => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({detail: "测试：历史暂时不可用"}) }));
  await s.goto(base + `/student/ai-chat?chapter=${cid}`);
  await s
    .getByRole("heading", { name: "操作系统 · 智能问答", exact: true })
    .waitFor();
  for (const region of ["学习来源", "学习对话", "学习工具"])
    await s.getByRole("region", { name: region, exact: true }).waitFor();
  await s.getByLabel("提问或创作学习内容", {exact: true}).fill("为什么虚拟机能运行不同操作系统？");
  await s.getByRole("button", {name: "发送学习问题", exact: true}).click();
  await s.getByRole("region", {name: "直接问答记录", exact: true}).getByText(/虚拟化资源/).waitFor();
  await s.getByLabel("提问或创作学习内容", {exact: true}).fill("那它和真实计算机有什么区别？");
  await s.getByLabel("提问或创作学习内容", {exact: true}).press("Control+Enter");
  await s.getByRole("region", {name: "直接问答记录", exact: true}).getByText(/这是基于上轮内容的追问解释/).waitFor();
  const chatId = Number(new URL(s.url()).searchParams.get("job"));
  if ((await apiCall(b, "get", base + `/api/student/personal/jobs/${chatId}`)).status() !== 404) throw Error("直接问答记录越权");
  await s.reload();
  await s.getByRole("region", {name: "直接问答记录", exact: true}).getByText(/这是基于上轮内容的追问解释/).waitFor();
  await s.getByRole("button", {name: "＋ 新话题", exact: true}).click();
  await s
    .getByLabel("上传我的学习来源", { exact: true })
    .setInputFiles({
      name: "笔记本自主学习资料.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "操作系统负责管理计算机硬件和软件资源，为用户和应用程序提供服务。进程具有独立地址空间，线程共享进程资源。笔记本独立上传验收。",
      ),
    });
  await s
    .getByRole("status")
    .filter({ hasText: "资料已保存到本人账号" })
    .waitFor();
  // No typed topic: selecting sources then clicking Explain must still work.
  await s.getByLabel("提问或创作学习内容", { exact: true }).fill("");
  await s.getByRole("region", {name: "学习工具", exact: true}).getByRole("button", { name: "知识讲解", exact: true }).click();
  await s
    .getByRole("heading", { name: "explain个人学习", exact: true })
    .waitFor();
  await s.unroute("**/api/student/personal/jobs");
  const learning = Number(new URL(s.url()).searchParams.get("job"));
  if (
    (
      await apiCall(b, "get", base + `/api/student/personal/jobs/${learning}`)
    ).status() !== 404
  )
    throw Error("笔记本跨学生泄露");
  const studio = s.getByRole("region", { name: "学习工具", exact: true });
  await studio
    .getByRole("button", { name: "思维导图", exact: true })
    .click();
  await s.getByRole("button", {name: "确认开始小节提炼", exact: true}).click();
  await s
    .getByLabel("个人思维导图")
    .getByText("资源管理", { exact: true })
    .waitFor();
  const mapId = Number(new URL(s.url()).searchParams.get("job"));
  const mapRegion = s.getByRole("region", { name: "个人思维导图", exact: true });
  await mapRegion.getByRole("img").waitFor();
  for (const format of ["PNG", "SVG", "XMind"]) {
    const downloaded = s.waitForEvent("download");
    await mapRegion.getByRole(format === "XMind" ? "link" : "button", { name: "下载 " + format, exact: true }).click();
    const file = await downloaded;
    if (await file.failure()) throw Error("导图下载失败：" + format);
    const data = fs.readFileSync(await file.path());
    if (format === "PNG" && data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw Error("PNG 图片无效");
    if (format === "SVG" && (!data.toString().includes("资源管理") || !data.toString().includes("<svg"))) throw Error("SVG 未保留导图");
    if (format === "XMind" && data.subarray(0, 2).toString() !== "PK") throw Error("XMind 并非压缩包");
  }
  if ((await apiCall(b, "get", base + `/api/student/personal/jobs/${mapId}/modules/0/mindmap.xmind`)).status() !== 404) throw Error("XMind 导出越权");
  await s.reload();
  await s.getByRole("region", { name: "个人思维导图", exact: true }).getByRole("img").waitFor();
  if (process.env.BROWSER_SCREENSHOT_DIR) await s.screenshot({ path: path.join(process.env.BROWSER_SCREENSHOT_DIR, "mindmap-workspace.png"), fullPage: true });
  await studio
    .getByRole("button", { name: "代码讲解", exact: true })
    .click();
  await s.getByRole("heading", { name: "code个人学习", exact: true }).waitFor();
  if (
    !(await s.locator("pre.personal-code").innerText()).includes("\n    return")
  )
    throw Error("笔记本代码缩进丢失");
  // A persisted failed result can be returned with HTTP 200 on an idempotent replay.
  // It must show the error and offer an explicit retry, never pretend to be success.
  const savedLearning = await (await apiCall(s, "get", base + `/api/student/personal/jobs/${learning}`)).json();
  await s.route("**/api/student/personal/generate", r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...savedLearning, status: "failed", error: "测试：DeepSeek正文不是有效JSON" }) }), { times: 1 });
  await studio
    .getByRole("button", { name: "知识闪卡", exact: true })
    .click();
  await s.getByRole("button", {name: "确认开始小节提炼", exact: true}).click();
  await s.getByRole("alert").filter({ hasText: "测试：DeepSeek正文不是有效JSON" }).waitFor();
  await s.getByRole("button", { name: "确认历史任务后重新生成（可能计费）", exact: true }).click();
  await s.getByRole("button", {name: "确认开始小节提炼", exact: true}).click();
  await s.getByRole("button", { name: "闪卡问题", exact: true }).waitFor();
  await s.getByRole("button", { name: "显示答案", exact: true }).click();
  await s
    .getByRole("button", { name: "闪卡答案", exact: true })
    .getByText(/操作系统负责管理计算机硬件和软件资源/)
    .waitFor();
  await s.getByRole("button", { name: "下一张", exact: true }).click();
  await s
    .getByRole("button", { name: "闪卡问题", exact: true })
    .getByText(/如何理解/)
    .waitFor();
  const flashId = Number(new URL(s.url()).searchParams.get("job"));
  await s.reload();
  await s.getByRole("button", { name: "闪卡问题", exact: true }).waitFor();
  if (await studio.getByRole("button", { name: "算法动画", exact: true }).count()) throw Error("智能问答动画入口未移除");
  await studio.getByRole("button", { name: "复习总结", exact: true }).click();
  await s.getByRole("heading", { name: "summary个人学习", exact: true }).waitFor();
  if (process.env.BROWSER_SCREENSHOT_DIR)
    await s.screenshot({
      path: path.join(
        process.env.BROWSER_SCREENSHOT_DIR,
        "learning-notebook-desktop.png",
      ),
    });
  await s.getByRole("button", { name: "＋ 个人笔记", exact: true }).click();
  await s
    .getByLabel("笔记本个人笔记", { exact: true })
    .fill("我的笔记本资源共享笔记");
  await s.getByLabel("收藏这份学习内容", { exact: true }).check();
  await s.getByRole("button", { name: "保存笔记与收藏", exact: true }).click();
  await s
    .getByRole("status")
    .filter({ hasText: "个人笔记与收藏已保存" })
    .waitFor();
  await s.reload();
  await s
    .getByRole("heading", { name: "summary个人学习", exact: true })
    .waitFor();
  await s.getByRole("button", { name: "＋ 个人笔记", exact: true }).click();
  if (
    (await s.getByLabel("笔记本个人笔记", { exact: true }).inputValue()) !==
    "我的笔记本资源共享笔记"
  )
    throw Error("笔记本笔记刷新丢失");
  await studio.getByRole("button", { name: "测验", exact: true }).click();
  await s
    .getByRole("link", { name: "开始作答 / 查看解析", exact: true })
    .click();
  await s
    .getByRole("heading", { name: "个人薄弱点自测", exact: true })
    .waitFor();
  const option = s.locator(".quiz-option").first();
  const inputRect = await option.locator("input").boundingBox();
  const textRect = await option.locator(".quiz-option-content").boundingBox();
  if (inputRect.width > 24 || textRect.x - inputRect.x - inputRect.width > 24 || Math.abs(inputRect.y - textRect.y) > 12) throw Error("测验选项排版错位");
  await s.getByLabel("A. 是", { exact: true }).check();
  await s.getByRole("button", { name: "提交我的自测", exact: true }).click();
  await s.getByRole("status").filter({ hasText: "个人自测：1 / 1" }).waitFor();
  const quiz = Number(new URL(s.url()).searchParams.get("job"));
  if (
    (
      await apiCall(
        b,
        "get",
        base + `/api/student/personal/jobs/${quiz}/attempts`,
      )
    ).status() !== 404
  )
    throw Error("个人自测成绩泄露");
  await s.getByLabel("我还不理解的地方").fill("请再解释互斥的条件");
  await s.getByRole("button", { name: "带着疑问继续学习", exact: true }).click();
  await s.waitForURL("**/student/ai-chat?job=" + quiz);
  await s.waitForFunction(() => document.querySelector('[aria-label="提问或创作学习内容"]')?.value === "请再解释互斥的条件");
  await s.goto(base + `/student/knowledge?job=${flashId}`);
  await s.waitForURL("**/student/ai-chat?job=" + flashId);
  await s.getByRole("button", { name: "闪卡问题", exact: true }).waitFor();
  await s.setViewportSize({ width: 390, height: 844 });
  if (process.env.BROWSER_SCREENSHOT_DIR)
    await s.screenshot({
      path: path.join(
        process.env.BROWSER_SCREENSHOT_DIR,
        "learning-notebook-mobile.png",
      ),
      fullPage: true,
    });
  if (
    await s.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 2,
    )
  )
    throw Error("笔记本窄屏横向溢出");
  await s.setViewportSize({ width: 1366, height: 768 });
  await s.getByRole("button", { name: "收起来源", exact: true }).click();
  await s.getByRole("button", { name: "展开来源", exact: true }).click();
  // End-to-end pilot: two actual PPTX uploads, explicit billing/range confirmation,
  // map -> cached flashcards -> persisted evidence and downloadable report.
  const sections = await (await apiCall(s, "get", base + `/api/sections?chapter_id=${cid}`)).json();
  const selectedSection = sections.find(x => x.chapter_id === cid);
  if (!selectedSection) throw Error("验收缺少已发布小节");
  const decks = JSON.parse(execFileSync(process.env.TEST_PYTHON, [path.join(__dirname, "pilot_fixture.py"), "--four"], { encoding: "utf8" }));
  await s.goto(base + `/student/ai-chat?chapter=${cid}`);
  await s.getByLabel("笔记本课程小节", { exact: true }).selectOption(String(selectedSection.id));
  for (let i = 0; i < 4; i++) {
    const response = s.waitForResponse(r => r.url().includes("/api/materials/upload") && r.request().method() === "POST");
    await s.getByLabel("上传我的学习来源", { exact: true }).setInputFiles({name: `试点多课件${i}.pptx`, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.from(decks[i % decks.length], "base64")});
    if ((await response).status() !== 201) throw Error("试点课件上传失败");
    await s.getByRole("status").filter({hasText: "资料已保存到本人账号"}).waitFor();
  }
  await studio.getByRole("button", { name: "思维导图", exact: true }).click();
  await s.getByRole("region", { name: "小节提炼确认", exact: true }).waitFor();
  await s.getByRole("button", { name: "确认开始小节提炼", exact: true }).click();
  await s.getByRole("region", { name: "小节提炼报告", exact: true }).getByText(/6个概念/).waitFor();
  const pilotId = Number(new URL(s.url()).searchParams.get("job"));
  await s.getByText("查看6条知识依据（AI辅助，待核对）", { exact: true }).click();
  await s.getByRole("link", {name: /试点多课件0.pptx · 第7页/}).first().waitFor();
  if (process.env.BROWSER_SCREENSHOT_DIR) await s.screenshot({path: path.join(process.env.BROWSER_SCREENSHOT_DIR, "section-pilot.png"), fullPage: true});
  await studio.getByRole("button", { name: "知识闪卡", exact: true }).click();
  await s.getByRole("region", { name: "小节提炼确认", exact: true }).getByText(/预计最多1次/).waitFor();
  await s.getByRole("button", { name: "确认开始小节提炼", exact: true }).click();
  await s.getByRole("button", { name: "闪卡问题", exact: true }).waitFor();
  await s.getByRole("button", { name: "显示答案", exact: true }).click();
  await s.getByRole("button", { name: "闪卡答案", exact: true }).waitFor();
  const reportDownload = s.waitForEvent("download");
  await s.getByRole("button", { name: "下载试点报告", exact: true }).click();
  const report = JSON.parse(fs.readFileSync(await (await reportDownload).path(), "utf8"));
  if (report.metrics.concepts !== 6 || report.calls_used !== 1) throw Error("试点缓存或报告错误");
  if ((await apiCall(b, "get", base + `/api/student/personal/jobs/${pilotId}`)).status() !== 404) throw Error("试点知识泄露");
  await s.reload();
  await s.getByRole("button", { name: "闪卡问题", exact: true }).waitFor();
  await s.unroute("**/api/student/personal/ask");
  await s.unroute("**/api/student/personal/status");
  await s.unroute("**/api/student/personal/generate");
  await t.goto(base + "/teacher/dashboard");
  await t
    .getByRole("heading", { name: "今天准备哪一部分课程？", exact: true })
    .waitFor();
  console.log(
    "PASS Notebook学习工作台模拟联调：三栏来源/对话/Studio、个人上传、导图/代码/闪卡翻面、移除动画入口、笔记收藏刷新、自测作答与隔离、桌面与窄屏（未调用真实模型）",
  );
}
module.exports = { verifyPersonal };
