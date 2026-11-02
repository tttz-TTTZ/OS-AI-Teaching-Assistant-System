import { Link } from "react-router-dom";
import { Page } from "../components";

const entries = [
  { path: "materials", title: "课程资料", description: "查看课程资料，整理学习思路。", icon: "01" },
  { path: "ai-chat", title: "智能问答", description: "带着问题，开启一次学习对话。", icon: "02" },
  { path: "exercise-summary", title: "习题归纳", description: "待开发", icon: "03" },
  { path: "learning", title: "学习模块", description: "待开发", icon: "04" },
];

export default function Home() {
  return (
    <Page title="操作系统AI助手">
      <div className="student-home">
        <p className="home-intro">从一份资料、一个问题开始，探索操作系统。</p>
        <nav className="home-entry-grid" aria-label="首页功能">
          {entries.map(({ path, title, description, icon }) => (
            <Link className="home-entry" key={path} to={`/student/${path}`}>
              <span className="home-entry-number" aria-hidden="true">{icon}</span>
              <h2>{title}</h2>
              <p>{description}</p>
              <span className="home-entry-action">{description === "待开发" ? "敬请期待" : "进入"} <span aria-hidden="true">↗</span></span>
            </Link>
          ))}
        </nav>
      </div>
    </Page>
  );
}
