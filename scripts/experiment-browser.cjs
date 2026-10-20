const path = require("node:path");
async function verifyExperiments({ t, s, b, base, cid, kid, suffix, apiCall }) {
  const ids = [];
  const runs = [];
  const screenshot = async (page, name) => {
    if (process.env.BROWSER_SCREENSHOT_DIR)
      await page.screenshot({
        path: path.join(process.env.BROWSER_SCREENSHOT_DIR, name),
      });
  };
  for (const algorithm of ["fcfs", "sjf", "rr"]) {
    const title = `验收${algorithm.toUpperCase()}实验-${suffix}`;
    await t.goto(base + `/teacher/experiments/new?knowledge=${kid}`);
    await t.getByLabel("算法模板", { exact: true }).selectOption(algorithm);
    await t.getByLabel("实验标题", { exact: true }).fill(title);
    await t.getByLabel("所属章节", { exact: true }).selectOption(String(cid));
    await t
      .getByRole("button", { name: "建立实验草稿 →", exact: true })
      .click();
    await t.waitForURL("**/teacher/experiments/*/teaching");
    const id = Number(new URL(t.url()).pathname.split("/")[3]);
    ids.push(id);
    if (
      (await apiCall(s, "get", base + `/api/experiments/${id}`)).status() !==
      404
    )
      throw Error("草稿实验不得对学生可见");
    await t
      .getByLabel("观察任务", { exact: true })
      .fill("解释本次调度顺序，比较等待时间与首次响应。");
    const nav = t.getByRole("navigation", { name: "实验编写步骤" });
    await nav.getByRole("button", { name: /示例输入/ }).click();
    if (algorithm === "fcfs")
      await t
        .getByRole("button", { name: "示例 2（含空闲）", exact: true })
        .click();
    if (algorithm === "rr")
      await t.getByLabel("时间片", { exact: true }).fill("2");
    await nav.getByRole("button", { name: /试运行与发布/ }).click();
    if (
      !(await t
        .getByRole("button", { name: "发布教学实验", exact: true })
        .isDisabled())
    )
      throw Error("未经试运行不得发布");
    await t
      .getByRole("button", { name: "试运行当前草稿", exact: true })
      .click();
    await t.getByRole("heading", { name: "调度结果", exact: true }).waitFor();
    await t.getByRole("button", { name: "发布教学实验", exact: true }).click();
    await t.getByRole("status").filter({ hasText: "实验已发布" }).waitFor();
    if (algorithm === "rr")
      await screenshot(t, "experiment-teacher-preview.png");
    await s.goto(base + "/student/experiments");
    await s.getByLabel("筛选算法", { exact: true }).selectOption(algorithm);
    const card = s
      .locator(".experiment-card")
      .filter({ has: s.getByRole("heading", { name: title, exact: true }) });
    await card.getByRole("link", { name: "进入实验 →", exact: true }).click();
    await s.getByRole("heading", { name: "观察任务", exact: true }).waitFor();
    if (await s.getByLabel("进程1ID", { exact: true }).isVisible())
      throw Error("任务说明页不应显示输入表格");
    await s
      .getByRole("button", { name: "读完任务，开始实验 →", exact: true })
      .click();
    await s
      .getByRole("button", {
        name: "运行 " + algorithm.toUpperCase(),
        exact: true,
      })
      .click();
    await s.getByRole("status").filter({ hasText: "运行已保存" }).waitFor();
    await s.getByRole("heading", { name: "调度结果", exact: true }).waitFor();
    if (algorithm === "fcfs") {
      await s.getByText("平均等待 0.00", { exact: true }).waitFor();
      if ((await s.locator('[aria-label="甘特图"] button').count()) !== 4)
        throw Error("FCFS空闲段未保留");
    }
    await s.getByRole("button", { name: "下一步", exact: true }).click();
    if (algorithm === "rr")
      await screenshot(s, "experiment-student-running.png");
    await s
      .getByRole("button", { name: "分析结果，记录观察 →", exact: true })
      .click();
    await s
      .getByLabel("我的实验观察", { exact: true })
      .fill("浏览器验证 " + algorithm + " 的等待与响应。");
    await s.getByRole("button", { name: "保存实验观察", exact: true }).click();
    await s.getByRole("status").filter({ hasText: "实验观察已保存" }).waitFor();
    await s
      .getByRole("button", { name: /运行 #.*已保存观察/ })
      .first()
      .click();
    await s.waitForURL("**/student/experiment-runs/*");
    const rid = Number(new URL(s.url()).pathname.split("/")[3]);
    runs.push(rid);
    await s.reload();
    if (
      (await s.getByLabel("我的实验观察", { exact: true }).inputValue()) !==
      "浏览器验证 " + algorithm + " 的等待与响应。"
    )
      throw Error("运行观察刷新后丢失");
    if (
      (
        await apiCall(b, "get", base + `/api/my/experiment-runs/${rid}`)
      ).status() !== 404
    )
      throw Error("其他学生读取到实验记录");
  }
  await s.goto(
    base + `/student/knowledge?chapter=${cid}&point=${kid}&block=overview`,
  );
  await s
    .getByRole("link", {
      name: `验收FCFS实验-${suffix} · 进入完整实验 →`,
      exact: true,
    })
    .click();
  await s.getByRole("button", { name: "返回原知识点 →", exact: true }).click();
  await s.getByRole("heading", { name: "学习目标", exact: true }).waitFor();
  if (new URL(s.url()).searchParams.get("block") !== "overview")
    throw Error("实验返回未保留知识点位置");
  await t.goto(base + `/teacher/experiments/${ids[0]}/template`);
  await t.getByLabel("实验标题", { exact: true }).fill("未发布的新实验标题");
  await t.getByRole("button", { name: "保存实验草稿", exact: true }).click();
  await t.getByRole("status").filter({ hasText: "实验草稿已保存" }).waitFor();
  if (
    (
      await (
        await apiCall(s, "get", base + `/api/experiments/${ids[0]}`)
      ).json()
    ).title !== `验收FCFS实验-${suffix}`
  )
    throw Error("教师改草稿影响了发布版");
  await t
    .getByRole("navigation", { name: "实验编写步骤" })
    .getByRole("button", { name: /试运行与发布/ })
    .click();
  t.once("dialog", (d) => d.accept());
  await t.getByRole("button", { name: "撤回教学实验", exact: true }).click();
  await t.getByRole("status").filter({ hasText: "实验已撤回" }).waitFor();
  if (
    (await apiCall(s, "get", base + `/api/experiments/${ids[0]}`)).status() !==
    404
  )
    throw Error("撤回实验仍可读取");
  await s.goto(base + `/student/experiment-runs/${runs[0]}`);
  await s
    .getByRole("heading", { name: `验收FCFS实验-${suffix}`, exact: true })
    .waitFor();
  console.log(
    "PASS 实验平台：三算法教师配置/试运行/发布、学生分步运行/事件回放/观察与历史、知识点往返、草稿隔离、撤回后快照保留、其他学生不可读",
  );
}
module.exports = { verifyExperiments };
