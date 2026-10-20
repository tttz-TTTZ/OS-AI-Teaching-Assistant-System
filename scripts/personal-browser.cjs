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
  await s.getByRole("button", { name: "发送学习问题", exact: true }).click();
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
  await s.getByRole("alert").filter({ hasText: "测试：DeepSeek正文不是有效JSON" }).waitFor();
  await s.getByRole("button", { name: "确认历史任务后重新生成（可能计费）", exact: true }).click();
  await s.getByRole("button", { name: "闪卡问题", exact: true }).waitFor();
  await s.getByRole("button", { name: "显示答案", exact: true }).click();
  await s
    .getByRole("button", { name: "闪卡答案", exact: true })
    .getByText("管理计算机资源，为用户和程序提供服务。", { exact: true })
    .waitFor();
  await s.getByRole("button", { name: "下一张", exact: true }).click();
  await s
    .getByRole("button", { name: "闪卡问题", exact: true })
    .getByText("线程共享什么？", { exact: true })
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
  await s.getByLabel("是", { exact: true }).check();
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
