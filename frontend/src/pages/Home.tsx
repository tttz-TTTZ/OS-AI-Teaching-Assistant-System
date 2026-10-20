import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Health, courseApi, api, Material, courses, Course } from "../api";
import { Page, Notice, useChapters } from "../components";
import { useAuth } from "../auth";
import { digitalApi } from "../digital";
export default function Home() {
  const { chapters, error } = useChapters();
  const { user } = useAuth();
  const [health, setHealth] = useState<Health>();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [course, setCourse] = useState<Course>();
  const [failure, setFailure] = useState("");
  const [resume, setResume] =
    useState<Awaited<ReturnType<typeof digitalApi.resume>>>();
  useEffect(() => {
    let active = true;
    digitalApi
      .resume()
      .then((data) => {
        if (active) setResume(data);
      })
      .catch((e) => {
        if (active) setFailure(e.message);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);
  let last: { chapter: number; point: number; title: string } | undefined;
  try {
    last =
      JSON.parse(sessionStorage.getItem(`os:last:${user?.id}`) || "null") ||
      undefined;
  } catch {
    /*无有效本地访问记录*/
  }
  if (resume) last = resume;
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
      <section className="coursebrief">
        <div>
          <span className="badge">
            {course?.is_demo ? "DEMO COURSE" : "COURSE"}
          </span>
          <h2>{course?.title || "课程概览"}</h2>
          <p>{course?.description || "正在加载课程…"}</p>
        </div>
        <Link
          className="button"
          to={
            last
              ? `/student/knowledge?chapter=${last.chapter}&point=${last.point}`
              : "/student/knowledge"
          }
        >
          {last ? `继续：${last.title}` : "从章节开始 →"}
        </Link>
      </section>
      <Notice error={error || failure} />
      <div className="statusbar">
        {health
          ? `后端正常 · 数据库 ${health.database} · ${health.ai_configured ? "AI 已配置（可用性以调用为准）" : "尚未配置 AI 服务"}`
          : "正在检查服务…"}
        <span>
          {" "}
          {resume
            ? "继续学习来自账号已保存的学习位置。"
            : "尚无账号学习记录时，继续学习使用本标签实际访问记录。"}
        </span>
      </div>
      <div className="grid">
        <section className="panel">
          <h2>章节导航</h2>
          <div className="chapterlist">
            {chapters.map((c, i) => (
              <Link key={c.id} to={`/student/knowledge?chapter=${c.id}`}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{c.title}</strong>
                  <small>{c.description}</small>
                </div>
                <b>→</b>
              </Link>
            ))}
          </div>
          {!chapters.length && <p>暂无已发布章节</p>}
        </section>
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
            <Link className="panel card" to="/student/experiments">
              <h2>算法实验库</h2>
              <p>选择教师发布的 FCFS、SJF 或 RR 实验，运行并记录观察。</p>
              <span>动手运行 →</span>
            </Link>
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
