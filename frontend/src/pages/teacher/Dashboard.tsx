import { Link } from "react-router-dom";
import { AuthoringPage } from "./Authoring";
export default function Dashboard() {
  return (
    <AuthoringPage
      title="教师工作台"
      description="管理公共资料和学生账号。"
    >
      <div className="teacher-start">
        {[
          ["01", "materials", "公共课程资料", "上传、整理和发布公共资料。", "管理资料 →"],
          ["02", "accounts", "学生账号", "管理学生账号与访问权限。", "管理账号 →"],
        ].map(([number, path, title, description, action]) => (
          <section className="authoring-card start-task" key={number}>
            <span className="task-number">{number}</span>
            <h2>{title}</h2>
            <p>{description}</p>
            <Link className="button" to={"/teacher/" + path}>
              {action}
            </Link>
          </section>
        ))}
      </div>
      <section className="authoring-card">
        <h2>其他常用工作</h2>
        <div className="support-links">
          <Link to="/teacher/materials">上传公共资料 →</Link>
          <Link to="/teacher/accounts">管理学生账号 →</Link>
        </div>
      </section>
    </AuthoringPage>
  );
}
