const path = require("node:path");
const { execFileSync } = require("node:child_process");
async function verifyAIQuestions({ t, s, base, teacherName, apiCall, cid }) {
  await t.goto(base + "/teacher/ai-questions");
  await t.getByText(/尚未配置DeepSeek密钥/).waitFor();
  await t.route("**/api/teacher/ai-questions/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        model: "mock-browser-test",
        max_count: 10,
        max_characters: 24000,
      }),
    }),
  );
  await t.route("**/api/teacher/ai-questions/generate", async (r) => {
    const result = execFileSync(
      process.env.TEST_PYTHON,
      [path.join(__dirname, "ai_question_fixture.py"), teacherName],
      { input: r.request().postData(), encoding: "utf8" },
    );
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: result,
    });
  });
  await t.reload();
  await t.getByLabel("上传出题专用资料", { exact: true }).setInputFiles({
    name: "AI出题专用.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "操作系统负责管理计算机硬件和软件资源，为用户和应用程序提供服务。进程调度需要根据算法选择就绪进程。",
    ),
  });
  await t
    .getByRole("button", { name: "保存出题专用资料", exact: true })
    .click();
  await t
    .getByRole("status")
    .filter({ hasText: "已保存为你的出题专用资料" })
    .waitFor();
  await t.getByRole("button", { name: "预览出题摘录", exact: true }).click();
  await t.getByRole("heading", { name: /将发送给DeepSeek的文字/ }).waitFor();
  await t
    .getByRole("button", { name: "核对完摘录，设置出题要求 →", exact: true })
    .click();
  await t.getByLabel("出题所属章节", { exact: true }).selectOption(String(cid));
  await t.getByLabel("生成题目数量", { exact: true }).fill("1");
  await t
    .getByRole("button", { name: "调用DeepSeek生成候选题", exact: true })
    .click();
  await t
    .getByRole("heading", {
      name: "AI验收候选：操作系统的主要职责是什么？",
      exact: true,
    })
    .waitFor();
  const job = Number(new URL(t.url()).searchParams.get("job"));
  await t.reload();
  await t
    .getByRole("heading", {
      name: "AI验收候选：操作系统的主要职责是什么？",
      exact: true,
    })
    .waitFor();
  await t
    .getByRole("link", { name: "自动填写，进入审核 →", exact: true })
    .click();
  await t.getByRole("heading", { name: /AI候选题审核/ }).waitFor();
  const input = t.getByLabel("题干", { exact: true });
  if ((await input.inputValue()) !== "AI验收候选：操作系统的主要职责是什么？")
    throw Error("AI候选没有自动填写题干");
  if (
    !(await t
      .getByRole("button", { name: "审核通过，存为题库草稿", exact: true })
      .isDisabled())
  )
    throw Error("未经审核不应入库");
  await input.fill("教师审核后：操作系统的主要职责是什么？");
  await t.getByRole("button", { name: "保存候选修改", exact: true }).click();
  await t.getByRole("status").filter({ hasText: "候选修改已保存" }).waitFor();
  await t.reload();
  await t.getByRole("heading", { name: /AI候选题审核/ }).waitFor();
  if ((await input.inputValue()) !== "教师审核后：操作系统的主要职责是什么？")
    throw Error("候选修改刷新后丢失");
  if (process.env.BROWSER_SCREENSHOT_DIR)
    await t.screenshot({
      path: path.join(
        process.env.BROWSER_SCREENSHOT_DIR,
        "ai-question-review.png",
      ),
    });
  await t
    .getByLabel("我已核对题干、选项、答案、解析和资料依据", { exact: true })
    .check();
  await t
    .getByRole("button", { name: "审核通过，存为题库草稿", exact: true })
    .click();
  await t
    .getByRole("status")
    .filter({ hasText: "已审核并存入题库草稿" })
    .waitFor();
  const data = await (
    await apiCall(t, "get", base + `/api/teacher/ai-questions/jobs/${job}`)
  ).json();
  const qid = data.drafts[0].question_id;
  if (
    (
      await (
        await apiCall(
          s,
          "get",
          base + `/api/study/questions?chapter_id=${data.config.chapter_id}`,
        )
      ).json()
    ).some((q) => q.id === qid)
  )
    throw Error("审核入库草稿泄露给学生");
  await t.getByLabel("发布给学生", { exact: true }).check();
  await t.getByRole("button", { name: "保存题目", exact: true }).click();
  await t.getByRole("status").filter({ hasText: "练习题已保存" }).waitFor();
  if (
    !(
      await (
        await apiCall(
          s,
          "get",
          base + `/api/study/questions?chapter_id=${data.config.chapter_id}`,
        )
      ).json()
    ).some((q) => q.id === qid)
  )
    throw Error("教师发布后学生仍不可见");
  await t.unroute("**/api/teacher/ai-questions/status");
  await t.unroute("**/api/teacher/ai-questions/generate");
  console.log(
    "PASS AI出题模拟联调（未调用真实DeepSeek）：专用资料上传、摘录预览、候选持久保存、自动填写、修改刷新、审核入库草稿、显式发布后学生可见",
  );
}
module.exports = { verifyAIQuestions };
