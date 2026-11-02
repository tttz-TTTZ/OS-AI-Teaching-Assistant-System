import { Link } from "react-router-dom";
import { AuthoringPage } from "./Authoring";
export default function Dashboard() {
  return (
    <AuthoringPage
      title="今天准备哪一部分课程？"
      description="管理课程资料与账号，安排日常教学工作。"
    >
      <section className="authoring-card">
        <h2>学习模块 · 待开发</h2>
        <p>功能正在规划中，敬请期待。</p>
        <Link className="button" to="/teacher/learning">查看开发状态 →</Link>
      </section>
      <section className="authoring-card">
        <h2>其他常用工作</h2>
        <div className="support-links">
          <Link to="/teacher/materials">上传公共资料 →</Link>
          <Link to="/teacher/ai-questions">用AI准备候选题 →</Link>
          <Link to="/teacher/questions">维护练习题库 →</Link>
          <Link to="/teacher/learning-feedback">查看学习反馈 →</Link>
          <Link to="/teacher/accounts">管理学生账号 →</Link>
        </div>
      </section>
    </AuthoringPage>
  );
}
