const path = require("node:path");
const { execFileSync } = require("node:child_process");
async function verifyAILessons({ t, s, base, teacherName, cid, apiCall }) {
  const helper = path.join(__dirname, "ai_lesson_fixture.py");
  await t.route("**/api/teacher/ai-questions/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ configured: true, model: "mock-browser-test" }),
    }),
  );
  await t.route("**/api/teacher/ai-lessons/generate", async (r) => {
    const value = execFileSync(process.env.TEST_PYTHON, [helper, teacherName], {
      input: r.request().postData(),
      encoding: "utf8",
    });
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: value,
    });
  });
  await t.goto(base + "/teacher/knowledge");
  await t
    .getByRole("link", { name: "从课件智能准备目录与教案", exact: true })
    .click();
  await t.getByText("上传新文件 / 粘贴课件文字", { exact: true }).click();
  await t
    .getByLabel("备课文件", { exact: true })
    .setInputFiles({
      name: "AI备课旧课件.ppt",
      mimeType: "application/vnd.ms-powerpoint",
      buffer: execFileSync(process.env.TEST_PYTHON, [helper, "--ppt"]),
    });
  await t.getByRole("button", { name: "上传并选择", exact: true }).click();
  await t.getByLabel("结束页", { exact: true }).fill("2");
  await t
    .getByRole("button", { name: "提取并预览实际文字", exact: true })
    .click();
  await t.getByRole("heading", { name: /核对将发送的文字/ }).waitFor();
  await t
    .getByRole("button", { name: "摘录已核对，设置教案要求 →", exact: true })
    .click();
  await t.getByLabel("所属大章", { exact: true }).selectOption(String(cid));
  await t
    .getByLabel("教案要求或已有教案样式", { exact: true })
    .fill("按本校课程教案组织，不固定小节数，保留动画待办与练习入口。");
  await t
    .getByRole("button", { name: "生成目录与教案候选", exact: true })
    .click();
  await t
    .getByRole("heading", { name: "先审核目录，再逐个核对教案", exact: true })
    .waitFor();
  const jobId = Number(new URL(t.url()).searchParams.get("job"));
  await t.getByLabel("小节标题", { exact: true }).fill("教师修订后的课件小节");
  await t.getByRole("button", { name: "整页审核教案", exact: true }).click();
  await t.getByLabel("知识点标题", { exact: true }).fill("教师核对的AI教案");
  await t.getByRole("button", { name: "保存候选修改", exact: true }).click();
  await t.getByRole("status").filter({ hasText: "候选修改已保存" }).waitFor();
  await t.reload();
  await t
    .getByRole("heading", { name: "先审核目录，再逐个核对教案", exact: true })
    .waitFor();
  if (
    (await t.getByLabel("小节标题", { exact: true }).inputValue()) !==
    "教师修订后的课件小节"
  )
    throw Error("AI备课目录修改刷新丢失");
  await t.getByRole("button", { name: "整页审核教案", exact: true }).click();
  if (
    (await t.getByLabel("知识点标题", { exact: true }).inputValue()) !==
    "教师核对的AI教案"
  )
    throw Error("AI教案修改刷新丢失");
  if (process.env.BROWSER_SCREENSHOT_DIR)
    await t.screenshot({
      path: path.join(
        process.env.BROWSER_SCREENSHOT_DIR,
        "ai-lesson-review.png",
      ),
    });
  await t
    .getByLabel("我已核对目录、正文与引用，确认可以把这些内容存为课程草稿", {
      exact: true,
    })
    .check();
  await t
    .getByRole("button", { name: "审核通过，批量存为草稿", exact: true })
    .click();
  await t
    .getByRole("heading", { name: "已入库为知识点草稿", exact: true })
    .waitFor();
  const job = await (
    await apiCall(t, "get", base + `/api/teacher/ai-lessons/jobs/${jobId}`)
  ).json();
  const id = job.imported[0].id;
  if (
    (await apiCall(s, "get", base + `/api/learning-content/${id}`)).status() !==
    404
  )
    throw Error("AI教案未发布草稿泄露");
  await t.getByRole("link", { name: /教师核对的AI教案：继续编写/ }).click();
  await t.getByRole("heading", { name: "整篇内容导航", exact: true }).waitFor();
  await t.unroute("**/api/teacher/ai-questions/status");
  await t.unroute("**/api/teacher/ai-lessons/generate");
  console.log(
    "PASS AI备课模拟联调（未调用真实DeepSeek）：旧PPT真实上传/摘录、范围、目录与整页教案审核、编辑刷新恢复、批量草稿入库、学生隔离、进入正式编辑器",
  );
}
module.exports = { verifyAILessons };
