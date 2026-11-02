import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";
import "./style.css";
import { AuthProvider, useAuth } from "./auth";
import Home from "./pages/Home";
import Materials from "./pages/Materials";
import Login from "./pages/Login";
import TeacherDashboard from "./pages/teacher/Dashboard";
import LearningNotebook from "./pages/LearningNotebook";
import TeacherMaterials from "./pages/teacher/Materials";
import Accounts from "./pages/teacher/Accounts";
import Profile from "./pages/Profile";
import { Page, Notice } from "./components";
const student = [
  ["dashboard", "学习首页"],
  ["materials", "课程资料"],
  ["ai-chat", "智能问答"],
];
const teacher = [
  ["dashboard", "教师工作台"],
  ["materials", "公共资料"],
  ["accounts", "账号管理"],
];
function PersonalKnowledge() {
  const location = useLocation();
  return new URLSearchParams(location.search).has("job") ? (
    <Navigate to={`/student/ai-chat${location.search}`} replace />
  ) : (
    <Navigate to="/student/dashboard" replace />
  );
}
function LegacyPracticeRedirect() {
  const location = useLocation();
  return <Navigate to={`/student/ai-chat${location.search}`} replace />;
}
function Guard({ role }: { role: "student" | "teacher" }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="empty">正在恢复登录状态…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role)
    return (
      <Page title="无权访问">
        <p>此工作区需要 {role === "teacher" ? "教师" : "学生"} 角色。</p>
        <NavLink to={`/${user.role}/dashboard`}>返回我的工作区</NavLink>
      </Page>
    );
  return <Layout role={role} />;
}
function Layout({ role }: { role: "student" | "teacher" }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const notebook =
    role === "student" && location.pathname === "/student/ai-chat";
  const [error, setError] = useState("");
  return (
    <div className={`layout ${role}${notebook ? " notebook-shell" : ""}`}>
      <aside>
        <div className="brand">
          OS<span> / ASSISTANT</span>
        </div>
        <p className="caption">
          {role === "teacher" ? "教师 · 课程内容管理" : "学生 · 学习与探索"}
        </p>
        <nav>
          {(role === "teacher" ? teacher : student).map(([path, title]) => (
            <NavLink key={path} to={`/${role}/${path}`}>
              {title}
            </NavLink>
          ))}
        </nav>
        <footer>
          <strong>当前标签：{user?.username}</strong>
          <p>
            <NavLink to={`/${role}/profile`}>个人账号 / 修改密码</NavLink>
          </p>
          <p>V0.3 · 课程与 AI 学习平台</p>
          <button
            className="secondary"
            onClick={() => {
              setError("");
              logout().catch((e) => setError(e.message));
            }}
          >
            退出登录
          </button>
        </footer>
      </aside>
      <main>
        <div className="workspacebar">
          <span>操作系统</span>
          <span>{role === "teacher" ? "教师工作区" : "学生工作区"}</span>
        </div>
        <Notice error={error} />
        <Outlet />
      </main>
    </div>
  );
}
function Legacy() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p>加载中…</p>;
  if (!user) return <Navigate to="/login" replace />;
  const path = location.pathname;
  const map: Record<string, string> = {
    "/": "dashboard",
    "/materials": "materials",
    "/knowledge": "dashboard",
    "/lab": "dashboard",
    "/chat": "ai-chat",
    "/practice": "ai-chat",
  };
  return (
    <Navigate
      replace
      to={`/${user.role}/${user.role === "teacher" ? "dashboard" : map[path] || "dashboard"}${location.search}`}
    />
  );
}
function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Login register />} />
      <Route path="/student" element={<Guard role="student" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<Home />} />
        <Route path="materials" element={<Materials />} />
        <Route path="knowledge" element={<PersonalKnowledge />} />
        <Route path="course-reading" element={<Navigate to="/student/dashboard" replace />} />
        <Route path="ai-practice" element={<LegacyPracticeRedirect />} />
        <Route path="experiments/*" element={<Navigate to="/student/dashboard" replace />} />
        <Route path="experiment-runs/*" element={<Navigate to="/student/dashboard" replace />} />
        <Route path="ai-chat" element={<LearningNotebook />} />
        <Route
          path="basic-chat"
          element={<Navigate to="/student/ai-chat" replace />}
        />
        <Route path="practice" element={<LegacyPracticeRedirect />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="/teacher" element={<Guard role="teacher" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<TeacherDashboard />} />
        {["chapters/*", "sections/*", "knowledge/*", "experiments/*", "chapter-content/*", "ai-lessons", "questions", "ai-questions", "learning-feedback"].map((path) => (
          <Route key={path} path={path} element={<Navigate to="/teacher/dashboard" replace />} />
        ))}
        <Route path="materials" element={<TeacherMaterials />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      {["/", "/materials", "/knowledge", "/lab", "/chat", "/practice"].map(
        (p) => (
          <Route key={p} path={p} element={<Legacy />} />
        ),
      )}
      <Route
        path="*"
        element={
          <Page title="页面不存在">
            <NavLink to="/">返回工作区</NavLink>
          </Page>
        }
      />
    </Routes>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
