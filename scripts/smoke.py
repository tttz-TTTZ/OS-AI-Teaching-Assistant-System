"""对正在运行的前端开发代理进行集成验证。"""
import httpx

with httpx.Client(base_url='http://127.0.0.1:5173', timeout=60) as c:
    assert c.get('/').status_code == 200
    assert c.get('/api/health').json()['database'] == 'ok'
    r=c.post('/api/materials',json={'title':'集成验证临时资料','content':'进程是资源分配单位','chapter':'进程管理'})
    r.raise_for_status()
    mid=r.json()['id']
    try:
        assert c.get(f'/api/materials/{mid}').json()['title']=='集成验证临时资料'
        c.put(f'/api/materials/{mid}',json={'title':'更新后的测试资料','content':'进程是资源分配单位'}).raise_for_status()
        r=c.post('/api/chat',json={'question':'依据资料解释进程','material_id':mid})
        r.raise_for_status()
        result=r.json()
        assert result['answer']
        rows=c.get('/api/conversations').json()
        assert any(row['id']==result['id'] and row['answer']==result['answer'] for row in rows)
        print(f"PASS: 前端代理 → 后端 → SQLite → 模型适配 → 问答持久化；模型模式={result['mode']}")
    finally:
        c.delete(f'/api/materials/{mid}').raise_for_status()
    assert c.get(f'/api/materials/{mid}').status_code==404
