import { useEffect, useState } from "react";
import { studyApi } from "../../study";
import { Notice } from "../../components";
import { AuthoringPage } from "./Authoring";
export default function LearningFeedback() {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof studyApi.summary>>>();
  const [error, setError] = useState("");
  async function refresh() {
    try {
      setData(await studyApi.summary());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <AuthoringPage
      title="学习情况与主动反馈"
      description="只展示真实记录。学生私人笔记不会出现在这里。"
      back={{ to: "/teacher/dashboard", label: "返回教师工作台" }}
    >
      <Notice error={error} />
      <button className="secondary" onClick={refresh}>
        刷新反馈
      </button>
      {data && (
        <>
          <section className="authoring-card">
            <h2>学习记录</h2>
            <p>
              已记录作答 {data.attempts} 次。掌握数据为学生自评，不是考试成绩。
            </p>
            {!data.progress.length ? (
              <p>暂无已保存的学习记录。</p>
            ) : (
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>知识点</th>
                      <th>记录人数</th>
                      <th>已阅读</th>
                      <th>自评掌握</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.progress.map((p) => (
                      <tr key={p.point_id}>
                        <td>{p.title}</td>
                        <td>{p.learners}</td>
                        <td>{p.read_count}</td>
                        <td>{p.self_assessed_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="authoring-card">
            <h2>学生主动提交的反馈</h2>
            {!data.feedback.length && <p>暂无反馈。</p>}
            {data.feedback.map((f) => (
              <article className="resource" key={f.id}>
                <strong>
                  {f.title} · {f.username}
                </strong>
                <p>{f.message}</p>
                <small>{f.created_at}</small>
              </article>
            ))}
          </section>
        </>
      )}
    </AuthoringPage>
  );
}
