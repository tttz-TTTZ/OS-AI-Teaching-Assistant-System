import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Health, courseApi, api, Material, courses, Course } from "../api";
import { Page, Notice } from "../components";
export default function Home() {
  const [health, setHealth] = useState<Health>();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [course, setCourse] = useState<Course>();
  const [failure, setFailure] = useState("");
  useEffect(() => {
    Promise.all([courseApi.health(), api.materials(0, "public"), courses()])
      .then(([h, m, c]) => {
        setHealth(h);
        setMaterials(m.slice(0, 5));
        setCourse(c[0]);
      })
      .catch((e) => setFailure(e.message));
  }, []);
  return (
    <Page title="学习首页">
      <p className="badge">课程学习与 AI 工作台</p>
      <section className="authoring-card">
        <h2>按自己的需求学习</h2>
        <p>
          教师发布公共课程资料；在智能问答中，你选择讲解、导图、代码或复习，也可描述薄弱点生成个人练习。
        </p>
        <div className="row-actions">
          <Link className="button" to="/student/ai-chat">
            进入智能问答工作台
          </Link>
          <Link className="button secondary" to="/student/ai-practice">
            生成我的薄弱点练习
          </Link>
        </div>
      </section>
      <section className="coursebrief">
        <div>
          <span className="badge">
            {course?.is_demo ? "DEMO COURSE" : "COURSE"}
          </span>
          <h2>{course?.title || "课程概览"}</h2>
          <p>{course?.description || "正在加载课程…"}</p>
        </div>
        <Link className="button" to="/student/materials">查看课程资料 →</Link>
      </section>
      <Notice error={failure} />
      <div className="statusbar">
        {health
          ? `后端正常 · 数据库 ${health.database} · ${health.personal_ai_configured === undefined ? "后端版本较旧，请更新并重启后端以启用自主学习" : `智能问答工作台 / AI自测：${health.personal_ai_configured ? "已配置DeepSeek" : "尚未配置DeepSeek"}`}`
          : "正在检查服务…"}
      </div>
      <p className="caption">
        不同AI功能独立配置；如提示未配置，请联系平台管理员。“已配置”不代表服务已连接成功，可用性以实际调用为准。
      </p>
      <div className="grid">
        <div>
          <section className="panel">
            <div className="toolbar">
              <h2>公共课程资料</h2>
              <Link className="textlink" to="/student/materials">
                全部 →
              </Link>
            </div>
            {materials.map((m) => (
              <p className="resource" key={m.id}>
                <Link to={`/student/materials?document=${m.id}`}>
                  {m.title}
                </Link>
                <small>
                  {m.chapter || "课程资料"} ·{" "}
                  {m.file_type?.toUpperCase() || "文本"}
                </small>
              </p>
            ))}
            {!materials.length && <p>暂无已发布公共资料</p>}
          </section>
          <div className="grid spaced">
            <Link className="panel card" to="/student/practice">
              <h2>章节练习</h2>
              <p>人工选择题，提交后查看答案与解析。</p>
              <span>巩固知识 →</span>
            </Link>
          </div>
        </div>
      </div>
    </Page>
  );
}
