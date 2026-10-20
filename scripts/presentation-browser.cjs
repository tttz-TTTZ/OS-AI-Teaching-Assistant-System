const path = require("node:path");
const { execFileSync } = require("node:child_process");
async function verifyPresentations({ t, s, b, base, cid, suffix, apiCall }) {
  const file = path.join(
    path.dirname(process.env.TEST_ACCOUNTS_FILE),
    `演示课件-${suffix}.pptx`,
  );
  execFileSync(process.env.TEST_PYTHON, [
    path.join(__dirname, "presentation_fixture.py"),
    file,
  ]);
  await t.goto(base + "/teacher/materials");
  await t.getByLabel("公共资料文件", { exact: true }).setInputFiles(file);
  await t.getByLabel("上传所属章节", { exact: true }).selectOption(String(cid));
  const response = t.waitForResponse(
    (r) =>
      r.url().endsWith("/api/materials/upload") &&
      r.request().method() === "POST",
  );
  await t.getByRole("button", { name: "上传公共资料", exact: true }).click();
  const uploaded = await response;
  if (uploaded.status() !== 201)
    throw Error("教师PPTX上传失败：" + (await uploaded.text()));
  if (uploaded.request().resourceType() !== "xhr")
    throw Error("大文件上传应提供XHR进度");
  const material = await uploaded.json();
  await t.getByText("预览课件文字（原件可下载）", { exact: true }).click();
  await t.getByText("共 400 页 · 当前 1–10 页", { exact: true }).waitFor();
  if (
    (
      await apiCall(s, "get", base + `/api/materials/${material.id}/slides`)
    ).status() !== 404
  )
    throw Error("草稿课件对学生泄露");
  await t.getByLabel(/^发布给学生/).check();
  await t.getByRole("button", { name: "保存资料设置", exact: true }).click();
  await t.getByRole("status").filter({ hasText: "资料设置已保存" }).waitFor();
  await s.goto(base + `/student/materials?document=${material.id}`);
  await s.getByText("共 400 页 · 当前 1–10 页", { exact: true }).waitFor();
  await s.getByRole("button", { name: "后10页", exact: true }).click();
  await s
    .getByRole("heading", { name: "第11页 · 演示第11页", exact: true })
    .waitFor();
  await s.getByLabel("跳至幻灯片", { exact: true }).selectOption("390");
  await s
    .getByRole("heading", { name: "第400页 · 演示第400页", exact: true })
    .waitFor();
  const original = await apiCall(
    s,
    "get",
    base + `/api/materials/${material.id}/file`,
  );
  if (
    original.status() !== 200 ||
    !original.headers()["content-disposition"].startsWith("attachment")
  )
    throw Error("PPTX原件下载失败");
  await s.reload();
  await s.getByText("共 400 页 · 当前 1–10 页", { exact: true }).waitFor();
  if (process.env.BROWSER_SCREENSHOT_DIR) {
    await s.locator(".presentation-preview").scrollIntoViewIfNeeded();
    await s.screenshot({
      path: path.join(
        process.env.BROWSER_SCREENSHOT_DIR,
        "presentation-400-pages.png",
      ),
    });
  }
  await s.getByLabel("上传资料", { exact: true }).setInputFiles(file);
  const [personal] = await Promise.all([
    s.waitForResponse(
      (r) =>
        r.url().endsWith("/api/materials/upload") &&
        r.request().method() === "POST",
    ),
    s
      .locator("button")
      .filter({ hasText: /^上传资料$/ })
      .click(),
  ]);
  if (personal.status() !== 201) throw Error("个人PPTX上传失败");
  const privateId = (await personal.json()).id;
  if (
    (
      await apiCall(b, "get", base + `/api/materials/${privateId}/slides`)
    ).status() !== 404
  )
    throw Error("私人课件分页越权");
  console.log(
    "PASS 课件：400页PPTX真实上传、教师草稿/发布、学生翻页/跳页/刷新、原件下载、XHR进度通道、个人课件隔离",
  );
}
module.exports = { verifyPresentations };
