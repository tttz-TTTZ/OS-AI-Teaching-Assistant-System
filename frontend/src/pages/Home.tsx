import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Health, courseApi } from "../api";
import { Page, Notice, useChapters } from "../components";
export default function Home() {
  const { chapters, error } = useChapters();
  const [health, setHealth] = useState<Health>();
  const [failure, setFailure] = useState("");
  useEffect(() => {
    courseApi
      .health()
      .then(setHealth)
      .catch((e) => setFailure(e.message));
  }, []);
  return (
    <Page title="学习首页">
      <section className="hero">
        <span className="badge">LEARN · EXPERIMENT · REFLECT</span>
        <h2>理解操作系统，从一次探索开始。</h2>
        <p>学习核心知识，运行真实调度算法，通过章节练习巩固理解。</p>
        <Link className="button" to="/knowledge">
          开始学习 →
        </Link>
      </section>
      <Notice error={error || failure} />
      <div className="statusbar">
        {health
          ? `后端正常 · 数据库 ${health.database} · ${health.ai_configured ? "AI 已配置（可用性以调用为准）" : "尚未配置 AI 服务"}`
          : "正在检查服务…"}
        <span> 人工示例教材 · 无虚构学习统计</span>
      </div>
      <div className="grid">
        {[
          ["/materials", "课程资料", "浏览公共示例，上传个人 PDF / TXT"],
          ["/knowledge", "知识点学习", "章节、概念与关联资料"],
          ["/lab", "算法实验", "FCFS 调度与甘特时间轴"],
          ["/chat", "智能问答", "真实模型接口与明确配置提示"],
          ["/practice", "章节练习", "单选练习、判分与解析"],
        ].map(([path, title, desc]) => (
          <Link className="panel card" to={path} key={path}>
            <h2>{title}</h2>
            <p>{desc}</p>
            <span>打开模块 ↗</span>
          </Link>
        ))}
      </div>
      <section className="panel spaced">
        <h2>推荐从第一章开始</h2>
        <p>以下章节为可修改的示例结构，请以实际教材为准。</p>
        <div className="chips">
          {chapters.map((c) => (
            <Link key={c.id} to={`/knowledge?chapter=${c.id}`}>
              {c.title} →
            </Link>
          ))}
        </div>
      </section>
    </Page>
  );
}
