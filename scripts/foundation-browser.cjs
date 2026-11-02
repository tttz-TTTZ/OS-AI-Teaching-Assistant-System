const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const { chromium } = createRequire(path.resolve(__dirname, '../frontend/package.json'))('playwright');
const accounts = JSON.parse(fs.readFileSync(process.env.TEST_ACCOUNTS_FILE, 'utf8'));
const base = process.env.APP_TEST_BASE_URL;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const errors = [];
    const t = await browser.newPage();
    const s = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    for (const p of [t, s]) p.on('pageerror', e => errors.push(e.message));
    async function login(p, a) {
      await p.goto(base + '/login');
      await p.getByRole('link', { name: a.role === 'teacher' ? '教师端' : '学生端', exact: true }).click();
      await p.getByLabel('用户名', { exact: true }).fill(a.username);
      await p.getByLabel('密码', { exact: true }).fill(a.password);
      await p.getByRole('button', { name: '登录', exact: true }).click();
      await p.waitForURL(`**/${a.role}/dashboard`);
    }
    await login(t, accounts[0]);
    await login(s, accounts[1]);
    await s.getByRole('heading', { name: '操作系统AI助手', exact: true }).waitFor();
    const cards = s.getByRole('navigation', { name: '首页功能' }).getByRole('link');
    assert.deepEqual(await cards.locator('h2').allTextContents(), ['课程资料', '智能问答', '习题归纳', '学习模块']);
    await cards.evaluateAll(es => Promise.all(es.flatMap(e => e.getAnimations().map(a => a.finished))));
    const boxes = await cards.evaluateAll(es => es.map(e => ({y: e.getBoundingClientRect().y, r: getComputedStyle(e).borderRadius})));
    assert(boxes.every(b => b.y === boxes[0].y && b.r === '28px'));
    await cards.nth(1).click();
    await s.getByRole('heading', { name: '操作系统 · 智能问答', exact: true }).waitFor();
    for (const region of ['学习来源', '学习对话', '学习工具']) await s.getByRole('region', { name: region, exact: true }).waitFor();
    await s.getByRole('link', { name: '← 返回首页', exact: true }).click();
    await s.getByRole('heading', { name: '操作系统AI助手', exact: true }).waitFor();
    await s.reload();
    await s.getByRole('heading', { name: '操作系统AI助手', exact: true }).waitFor();
    for (const route of ['knowledge?chapter=1&point=1', 'course-reading?point=1', 'experiments', 'experiments/1', 'experiment-runs/1', 'learning']) {
      await s.goto(base + '/student/' + route);
      await s.getByRole('heading', { name: '学习模块 · 待开发', exact: true }).waitFor();
    }
    await s.goto(base + '/student/knowledge?job=1');
    await s.waitForURL('**/student/ai-chat?job=1');
    await s.goto(base + '/student/exercise-summary');
    await s.getByRole('heading', { name: '习题归纳 · 待开发', exact: true }).waitFor();
    for (const route of ['chapters', 'chapters/1/edit', 'sections/new', 'knowledge', 'knowledge/1/content', 'experiments', 'experiments/1/edit', 'chapter-content/chapter04', 'ai-lessons']) {
      await t.goto(base + '/teacher/' + route);
      await t.getByRole('heading', { name: '学习模块 · 待开发', exact: true }).waitFor();
    }
    await t.goto(base + '/teacher/materials');
    await t.getByLabel('公共资料文件', { exact: true }).setInputFiles({ name: 'foundation-regression.txt', mimeType: 'text/plain', buffer: Buffer.from('操作系统资料访问回归：进程与线程。') });
    await t.getByLabel('上传所属章节', { exact: true }).selectOption({ index: 1 });
    await t.getByRole('button', { name: '上传公共资料', exact: true }).click();
    const row = t.getByRole('row').filter({ hasText: 'foundation-regression.txt' });
    await row.waitFor();
    await row.getByRole('button', { name: '设置', exact: true }).click();
    await t.getByLabel('发布给学生', { exact: false }).check();
    await t.getByRole('button', { name: '保存资料设置', exact: true }).click();
    await row.getByText('已发布', { exact: true }).waitFor();
    await s.goto(base + '/student/materials');
    const resource = s.getByRole('row').filter({ hasText: 'foundation-regression.txt' });
    await resource.waitFor();
    const href = await resource.getByRole('link', { name: '下载', exact: true }).getAttribute('href');
    const response = await s.context().request.get(new URL(href, base).href);
    assert.equal(response.status(), 200);
    assert.match(await response.text(), /进程与线程/);
    await s.goto(base + '/student/ai-chat');
    await s.getByRole('checkbox', { name: '选择来源：foundation-regression.txt', exact: true }).waitFor();
    // Reuse the existing notebook regression, including deterministic AI fixtures.
    const b = await browser.newPage();
    b.on('pageerror', e => errors.push(e.message));
    await login(b, accounts[2]);
    async function apiCall(page, method, url, options = {}) {
      const context = await page.evaluate(() => sessionStorage.getItem('os:session-context'));
      return page.request[method](url, { ...options, headers: { ...options.headers, 'X-Session-Context': context } });
    }
    const chapters = await (await apiCall(s, 'get', base + '/api/chapters')).json();
    const me = await (await apiCall(t, 'get', base + '/api/auth/me')).json();
    const section = await apiCall(t, 'post', base + '/api/teacher/sections', {
      headers: { 'X-CSRF-Token': me.csrf_token },
      data: { chapter_id: chapters[0].id, title: 'Notebook regression section', published: true },
    });
    assert.equal(section.status(), 201);
    const notebookPage = await browser.newPage();
    notebookPage.on('pageerror', e => errors.push(e.message));
    await login(notebookPage, accounts[1]);
    try {
      await require('./personal-browser.cjs').verifyPersonal({ t, s: notebookPage, b, base, studentName: accounts[1].username, cid: chapters[0].id, apiCall });
    } catch (error) {
      console.error('Notebook alerts:', await notebookPage.getByRole('alert').allTextContents());
      throw error;
    }
    await notebookPage.close();
    await t.goto(base + '/teacher/accounts');
    await t.getByLabel('用户名', { exact: true }).fill('foundation-created');
    await t.getByLabel('初始密码', { exact: true }).fill('temporary-foundation-test-password');
    await t.getByRole('button', { name: '创建账号', exact: true }).click();
    await t.getByRole('row').filter({ hasText: 'foundation-created' }).waitFor();
    await t.reload();
    await t.getByRole('row').filter({ hasText: 'foundation-created' }).waitFor();
    for (const width of [390, 640]) {
      await s.setViewportSize({ width, height: 844 });
      await s.goto(base + '/student/dashboard');
      await s.getByRole('heading', { name: '操作系统AI助手', exact: true }).waitFor();
      assert(await s.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overflow at ${width}`);
    }
    await s.emulateMedia({ reducedMotion: 'reduce' });
    assert(await cards.first().evaluate(e => getComputedStyle(e).animationName === 'none' && getComputedStyle(e).transitionDuration === '0s'));
    await s.setViewportSize({ width: 1366, height: 900 });
    await s.getByRole('button', { name: '退出登录', exact: true }).click();
    await s.waitForURL('**/login');
    await s.goto(base + '/student/materials');
    await s.waitForURL('**/login');
    assert.deepEqual(errors, []);
    console.log('PASS foundation browser: login/refresh/logout, four horizontal cards, AI notebook/back home/public sources, legacy route placeholders, public material upload/publish/download, account creation/persistence, 390/640px layout, reduced motion, no JS errors');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
