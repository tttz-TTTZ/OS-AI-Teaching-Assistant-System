import { Link } from "react-router-dom";
import { AuthoringPage } from "./Authoring";
export default function Dashboard() {
  return (
    <AuthoringPage
      title="课程资料与教学管理"
      description="本轮职责调整：教师不再制作AI教案，负责公共资料、整套章节目录和正式练习；学生自主选择学习内容与方式。"
    >
      <div className="teacher-start">
        {[
          [
            "chapters",
            "把控课程目录",
            "维护大章、小节、编号和发布状态；小节数量不固定。",
          ],
          [
            "materials",
            "提供公共学习资料",
            "上传、替换、关联和发布授课PPT及教材资料。",
          ],
          [
            "questions",
            "维护教师正式练习",
            "人工录题或AI辅助出题，经教师审核后发布。",
          ],
        ].map(([path, title, description]) => (
          <section className="authoring-card" key={path}>
            <h2>{title}</h2>
            <p>{description}</p>
            <Link className="button" to={"/teacher/" + path}>
              进入管理 →
            </Link>
          </section>
        ))}
      </div>
      <section className="authoring-card">
        <h2>其他管理</h2>
        <div className="support-links">
          <Link to="/teacher/ai-questions">AI辅助准备正式练习</Link>
          <Link to="/teacher/experiments">维护算法实验</Link>
          <Link to="/teacher/accounts">管理学生账号</Link>
          <Link to="/teacher/knowledge">历史内容维护（兼容）</Link>
        </div>
        <p>
          学生个人生成内容和AI自测默认仅本人可见，不混入教师题库或正式成绩。已有教材及历史记录保留。
        </p>
      </section>
    </AuthoringPage>
  );
}
