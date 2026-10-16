import { Link } from "react-router-dom";
import { AuthoringPage } from "./Authoring";
export default function Dashboard() {
  return (
    <AuthoringPage
      title="今天准备哪一部分课程？"
      description="从目录开始，逐个补内容，检查完再发布。"
    >
      <div className="teacher-start">
        {[
          [
            "01",
            "chapters",
            "先规划课程目录",
            "建立章节、小节和知识点标题，正文可以之后再写。",
            "规划目录 →",
          ],
          [
            "02",
            "knowledge",
            "再编写知识点内容",
            "选一个知识点，整页编写目标、正文、图片和互动。",
            "选择知识点 →",
          ],
          [
            "03",
            "knowledge",
            "最后预览与发布",
            "进入知识点的“预览发布”，检查完整效果后推送学生。",
            "检查待发布内容 →",
          ],
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
          <Link to="/teacher/questions">维护练习题库 →</Link>
          <Link to="/teacher/learning-feedback">查看学习反馈 →</Link>
          <Link to="/teacher/accounts">管理学生账号 →</Link>
        </div>
      </section>
    </AuthoringPage>
  );
}
