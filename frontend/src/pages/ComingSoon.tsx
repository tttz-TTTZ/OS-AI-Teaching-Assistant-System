import { Page } from "../components";

export default function ComingSoon({ title = "学习模块" }: { title?: string }) {
  return (
    <Page title={`${title} · 待开发`}>
      <section className="panel" aria-label={`${title}开发状态`}>
        <p>功能正在规划中，敬请期待。</p>
      </section>
    </Page>
  );
}
