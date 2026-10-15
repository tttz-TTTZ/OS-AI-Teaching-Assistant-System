import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import "./style.css";

import Home from "./pages/Home";
import Materials from "./pages/Materials";
import Knowledge from "./pages/Knowledge";
import Lab from "./pages/Lab";
import Chat from "./pages/Chat";
import Practice from "./pages/Practice";
import { Page } from "./components";
const sections = [
  ["/", "学习首页"],
  ["/materials", "课程资料"],
  ["/knowledge", "知识点学习"],
  ["/lab", "算法实验"],
  ["/chat", "智能问答"],
  ["/practice", "章节练习"],
];
function App() {
  return (
    <div className="layout">
      <aside>
        <div className="brand">
          OS<span> / ASSISTANT</span>
        </div>
        <p className="caption">学习与探索工作空间</p>
        <nav>
          {sections.map(([path, title]) => (
            <NavLink end={path === "/"} to={path} key={path}>
              {title}
            </NavLink>
          ))}
        </nav>
        <footer>
          MVP V0.1 · 本地单用户
          <br />
          人工示例内容 / 持续迭代
        </footer>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/practice" element={<Practice />} />
          <Route
            path="*"
            element={
              <Page title="页面不存在">
                <NavLink to="/">返回学习首页</NavLink>
              </Page>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
