import { Link } from "react-router-dom";
import { Page } from "../../components";
export default function Dashboard() {
  return (
    <Page title="教师工作台">
      <section className="panel">
        <h2>维护课程的三个步骤</h2>
        <ol>
          <li>先建立并排序章节，编写知识点。</li>
          <li>上传公共资料并关联章节与知识点。</li>
          <li>检查内容后发布；草稿不会出现在学生端。</li>
        </ol>
        <p>
          当前管理统一的“操作系统（演示课程）”。这里不展示无数据支撑的学习统计。
        </p>
      </section>
      <div className="grid spaced">
        {[
          ["chapters", "章节管理", "编排课程结构、调整顺序与发布状态"],
          ["knowledge", "知识点管理", "编辑正文、关联章节与 FCFS 实验"],
          ["materials", "公共资料", "PDF / TXT 上传、知识点关联与发布"],
          ["questions", "练习题管理", "人工单选题、答案解析与发布"],
        ].map(([p, t, d]) => (
          <Link className="panel card" key={p} to={`/teacher/${p}`}>
            <h2>{t}</h2>
            <p>{d}</p>
            <span>开始管理 →</span>
          </Link>
        ))}
      </div>
    </Page>
  );
}
