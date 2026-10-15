import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { api, Material } from './api';
import './style.css';

const sections = [['/', '概览'], ['/materials', '课程资料'], ['/knowledge', '知识点学习'], ['/lab', '算法实验'], ['/chat', '智能问答'], ['/practice', '练习测试']];
function Page({title, children}: {title: string; children: React.ReactNode}) {
 return <><header><span>OPERATING SYSTEMS / WORKSPACE</span><h1>{title}</h1><p>操作系统课程智能助教 · 开发基础框架</p></header>{children}</>;
}
function Placeholder({title}: {title:string}) {return <Page title={title}><section className="panel"><h2>模块已就绪，等待业务扩展</h2><p>在此基础上添加页面组件、接口与领域逻辑。</p><span className="badge">预留模块</span></section></Page>}
function Overview(){return <Page title="学习工作台"><section className="hero"><span className="badge">DEVELOPMENT FOUNDATION</span><h2>从系统原理，走向实践理解。</h2><p>课程资料、算法探索与智能辅助的统一入口。</p><NavLink className="button" to="/materials">开始接口联调 →</NavLink></section><div className="grid">{sections.slice(1).map(([path,title])=><NavLink className="panel card" to={path} key={path}><h2>{title}</h2><p>{path==='/materials'?'资料 CRUD 接口示例':path==='/chat'?'模型调用与记录示例':'页面骨架 · 待开发'}</p><span>进入模块 ↗</span></NavLink>)}</div></Page>}
function Materials(){
 const [items,setItems]=useState<Material[]>([]); const [error,setError]=useState('');
 useEffect(()=>{api.materials().then(setItems).catch(e=>setError(e.message));},[]);
 return <Page title="课程资料"><section className="panel"><h2>资料接口预览</h2><p>下方列表读取后端数据库。资料编辑业务界面留待下一阶段。</p>{error&&<p role="alert">{error}</p>}{items.length?items.map(i=><article key={i.id}><h3>{i.title}</h3><p>{i.chapter || '未分章'} · #{i.id}</p></article>):<p className="empty">暂无资料，可按接口文档创建第一条数据。</p>}</section></Page>
}
function Chat(){
 const [question,setQuestion]=useState('请解释进程与线程的区别');const [answer,setAnswer]=useState('');const [busy,setBusy]=useState(false);
 async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);try{const r=await api.chat(question);setAnswer(`[${r.mode} / ${r.model}]\n${r.answer}`)}catch(e){setAnswer(e instanceof Error?e.message:'请求失败')}finally{setBusy(false)}}
 return <Page title="智能问答"><section className="panel"><h2>模型接口调用示例</h2><p>密钥由后端管理。默认使用明确标记的演示响应。</p><form onSubmit={submit}><label htmlFor="question">问题</label><textarea id="question" value={question} maxLength={8000} onChange={e=>setQuestion(e.target.value)} required/><button disabled={busy}>{busy?'请求中…':'发送测试请求'}</button></form>{answer&&<pre aria-live="polite">{answer}</pre>}</section></Page>
}
function App(){return <div className="layout"><aside><div className="brand">OS<span> / ASSISTANT</span></div><p className="caption">学习与探索工作空间</p><nav>{sections.map(([path,title])=><NavLink end={path==='/'} to={path} key={path}>{title}</NavLink>)}</nav><footer>v0.1 · 基础框架<br/>业务功能将在后续迭代</footer></aside><main><Routes><Route path="/" element={<Overview/>}/><Route path="/materials" element={<Materials/>}/><Route path="/chat" element={<Chat/>}/>{sections.slice(2).filter(([p])=>p!='/chat').map(([p,t])=><Route path={p} key={p} element={<Placeholder title={t}/>}/>)}<Route path="*" element={<Placeholder title="页面不存在"/>}/></Routes></main></div>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>);
