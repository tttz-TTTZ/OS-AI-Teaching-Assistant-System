import React, { useState } from "react";
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
  ["dashboard", "首页"],
  ["materials", "课程资料"],
  ["ai-chat", "智慧学习"],
];
const teacher = [
  ["dashboard", "首页"],
  ["materials", "公共资料"],
  ["accounts", "账号管理"],
];
function SavedQuizLink() {
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
      <header className="app-topbar">
        <NavLink className="app-brand" to={`/${role}/dashboard`} aria-label="操作系统首页">
          <span className="app-brand-mark" aria-hidden="true">OS</span>
          <strong>操作系统</strong>
        </NavLink>
        <nav className="app-nav" aria-label="主导航">
          {(role === "teacher" ? teacher : student).map(([path, title]) => (
            <NavLink key={path} to={`/${role}/${path}`}>
              {title}
            </NavLink>
          ))}
        </nav>
        <div className="app-account">
          <NavLink className="app-account-link" to={`/${role}/profile`}>
            <span>个人账户</span>
            <small>{user?.username}</small>
          </NavLink>
          <button
            className="app-logout"
            onClick={() => {
              setError("");
              logout().catch((e) => setError(e.message));
            }}
          >
            退出
          </button>
        </div>
      </header>
      <main>
        <Notice error={error} />
        <Outlet />
      </main>
    </div>
  );
}
function Landing() {
  const { user, loading } = useAuth();
  if (loading) return <p>加载中…</p>;
  return <Navigate to={user ? `/${user.role}/dashboard` : "/login"} replace />;
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
        <Route path="ai-practice" element={<SavedQuizLink />} />
        <Route path="ai-chat" element={<LearningNotebook />} />
        <Route path="practice" element={<SavedQuizLink />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="/teacher" element={<Guard role="teacher" />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<TeacherDashboard />} />
        <Route path="materials" element={<TeacherMaterials />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="/" element={<Landing />} />
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
