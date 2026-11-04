import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Health, getHealth, documentApi, Material } from "../api";
import { Page, Notice } from "../components";
export default function Home() {
  const [health, setHealth] = useState<Health>();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    Promise.all([getHealth(), documentApi.list(false, { category: "public" })])
      .then(([h, m]) => {
        setHealth(h);
        setMaterials(m.slice(0, 5));
      })
      .catch((e) => setFailure(e.message));
  }, []);
  return (
    <Page title="学习首页">
      <p className="badge">课程学习与 AI 工作台</p>
      <section className="authoring-card">
        <h2>按自己的需求学习</h2>
        <p>
          教师发布公共课程资料；在智慧学习中，你选择讲解、导图、代码或复习，也可描述薄弱点生成个人练习。
        </p>
        <div className="row-actions">
          <Link className="button" to="/student/ai-chat">
            进入智慧学习
          </Link>
        </div>
      </section>
      <section className="coursebrief">
        <div>
          <h2>操作系统课程资料</h2>
          <p>选择公共课件，或上传个人资料开始学习。</p>
        </div>
        <Link className="button" to="/student/materials">查看课程资料 →</Link>
      </section>
      <Notice error={failure} />
      <div className="statusbar">
        {health
          ? `后端正常 · 数据库 ${health.database} · 智慧学习 / AI自测：${health.personal_ai_configured ? "已配置DeepSeek" : "尚未配置DeepSeek"}`
          : "正在检查服务…"}
      </div>
      <p className="caption">
        不同AI功能独立配置；如提示未配置，请联系平台管理员。“已配置”不代表服务已连接成功，可用性以实际调用为准。
      </p>
      <div className="home-resources">
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
                  课程资料 ·{" "}
                  {m.file_type?.toUpperCase() || "文本"}
                </small>
              </p>
            ))}
            {!materials.length && <p>暂无已发布公共资料</p>}
          </section>
      </div>
    </Page>
  );
}
