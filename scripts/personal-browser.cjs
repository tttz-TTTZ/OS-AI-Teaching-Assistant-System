const path = require("node:path");
const { execFileSync } = require("node:child_process");
async function verifyPersonal({ t, s, b, base, studentName, cid, apiCall }) {
  const status = {
    configured: true,
    model: "mock-personal-test",
    daily_limit: 20,
  };
  await s.route("**/api/student/personal/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status),
    }),
  );
  await s.route("**/api/student/personal/generate", async (r) => {
    const value = execFileSync(
      process.env.TEST_PYTHON,
      [path.join(__dirname, "personal_fixture.py"), studentName],
      { input: r.request().postData(), encoding: "utf8" },
    );
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: value,
    });
  });
  const me = await (await apiCall(s, "get", base + "/api/auth/me")).json();
  const upload = await apiCall(s, "post", base + "/api/materials/upload", {
    headers: { "X-CSRF-Token": me.csrf_token },
    multipart: {
      file: {
        name: "自主学习浏览器资料.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "操作系统负责管理计算机硬件和软件资源，为用户和应用程序提供服务。进程具有独立地址空间，线程共享进程资源。个人学习浏览器验收。",
        ),
      },
    },
  });
  if (upload.status() !== 201) throw Error(await upload.text());
  const doc = await upload.json();
  await s.getByRole("link", { name: "知识点学习", exact: true }).click();
  await s.getByRole("heading", { name: "我的自主学习", exact: true }).waitFor();
  await s.getByLabel("课程大章", { exact: true }).selectOption(String(cid));
  await s.getByRole("button", { name: "我的个人资料", exact: true }).click();
  await s.getByLabel(new RegExp(doc.title)).check();
  await s.getByLabel("学习主题", { exact: true }).fill("进程与线程的资源管理");
  await s
    .getByLabel("我的薄弱点或追问", { exact: true })
    .fill("我分不清资源共享，请多种方式帮助我理解。");
  await s
    .getByRole("button", { name: "选择全部学习方式", exact: true })
    .click();
  await s
    .getByRole("button", { name: "开始生成我的内容", exact: true })
    .click();
  await s
    .getByRole("heading", { name: "我的个人学习内容", exact: true })
    .waitFor();
  const learning = Number(new URL(s.url()).searchParams.get("job"));
  if (
    (
      await apiCall(b, "get", base + `/api/student/personal/jobs/${learning}`)
    ).status() !== 404
  )
    throw Error("个人内容跨学生泄露");
  await s
    .getByRole("navigation", { name: "我的学习方式" })
    .getByRole("button", { name: "思维导图", exact: true })
    .click();
  await s
    .getByLabel("个人思维导图")
    .getByText("资源管理", { exact: true })
    .waitFor();
  await s
    .getByRole("navigation", { name: "我的学习方式" })
    .getByRole("button", { name: "代码讲解", exact: true })
    .click();
  if (
    !(await s.locator("pre.personal-code").innerText()).includes("\n    return")
  )
    throw Error("代码缩进丢失");
  await s
    .getByRole("navigation", { name: "我的学习方式" })
    .getByRole("button", { name: "动画理解", exact: true })
    .click();
  await s.getByRole("button", { name: "下一步", exact: true }).click();
  await s.getByRole("heading", { name: "获得资源", exact: true }).waitFor();
  if (process.env.BROWSER_SCREENSHOT_DIR)
    await s.screenshot({
      path: path.join(
        process.env.BROWSER_SCREENSHOT_DIR,
        "personal-animation.png",
      ),
    });
  await s
    .getByLabel("个人笔记", { exact: true })
    .fill("只属于我的资源共享笔记");
  await s.getByLabel("收藏本次学习内容", { exact: true }).check();
  await s.getByRole("button", { name: "保存个人笔记", exact: true }).click();
  await s
    .getByRole("status")
    .filter({ hasText: "个人笔记与收藏已保存" })
    .waitFor();
  await s.reload();
  await s
    .getByRole("heading", { name: "我的个人学习内容", exact: true })
    .waitFor();
  if (
    (await s.getByLabel("个人笔记", { exact: true }).inputValue()) !==
    "只属于我的资源共享笔记"
  )
    throw Error("个人笔记刷新丢失");
  await s
    .getByLabel("我还不理解的地方", { exact: true })
    .fill("针对线程共享资源给我出题");
  await s
    .getByRole("button", { name: "针对薄弱点再生成自测", exact: true })
    .click();
  await s
    .getByRole("button", { name: "开始生成我的内容", exact: true })
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
  await s
    .getByRole("button", { name: "针对薄弱点再生成自测", exact: true })
    .waitFor();
  await s.unroute("**/api/student/personal/status");
  await s.unroute("**/api/student/personal/generate");
  await t.goto(base + "/teacher/dashboard");
  await t
    .getByRole("heading", { name: "课程资料与教学管理", exact: true })
    .waitFor();
  if (await t.getByRole("link", { name: "从课件备课 →", exact: true }).count())
    throw Error("教师仍有备课入口");
  console.log(
    "PASS 学生自主学习模拟联调：六方式生成、导图、代码缩进、概念动画回放、私人笔记收藏刷新、薄弱点自测作答与成绩隔离、教师职责调整（模型为模拟，未调用真实DeepSeek）",
  );
}
module.exports = { verifyPersonal };
