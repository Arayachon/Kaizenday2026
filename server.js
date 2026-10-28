const express=require('express'),Database=require('better-sqlite3'),XLSX=require('xlsx');
const db=new Database(process.env.DB||'kaizen.db');db.pragma('journal_mode=WAL');
db.exec(`create table if not exists p(code text primary key,name,dept,email,src,ts);
create table if not exists ci(code,sess,ts,primary key(code,sess));
create table if not exists b(id text primary key,name,pts int default 10);
create table if not exists st(code,booth,pts int,ts,primary key(code,booth));
create table if not exists rt(code,booth,r int,primary key(code,booth));
create table if not exists q(id text primary key,kind,seq int,txt,a,b,c,d,ok,pts int,secs int,tok);
create table if not exists an(code,qid,ans,ok int,pts int,ms int,primary key(code,qid));
create table if not exists live(id int primary key,qid,state,t0 int);
insert or ignore into live values(1,'','wait',0);`);
const PIN={staff:process.env.STAFF_PIN||'staff2026',admin:process.env.ADMIN_PIN||'admin2026'};
const need=r=>(q,s,n)=>{const x=q.get('x-pin');(x===PIN.admin||(r==='staff'&&x===PIN.staff))?n():s.status(401).json({error:'PIN ไม่ถูกต้อง'})};
const h=f=>(q,s)=>{try{s.json(f(q,q.body))}catch(e){const dup=String(e.code).startsWith('SQLITE_CONSTRAINT');s.status(dup?409:400).json({error:dup?'ซ้ำ: มีรายการนี้อยู่แล้ว':e.message})}};
const g=(sql,...a)=>db.prepare(sql).get(...a),all=(sql,...a)=>db.prepare(sql).all(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
const U=s=>String(s||'').trim().toUpperCase();
const pub=r=>r&&{id:r.id,kind:r.kind,txt:r.txt,a:r.a,b:r.b,c:r.c,d:r.d,secs:r.secs,pts:r.pts};
const app=express();app.use(express.json({limit:'5mb'}));app.use(express.static('public'));

app.post('/api/register',h((q,b)=>{const c=U(b.code);if(!c||!String(b.name||'').trim())throw Error('กรอกรหัสพนักงานและชื่อ');run('insert into p values(?,?,?,?,?,?)',c,b.name.trim(),b.dept||'',b.email||'','Self',Date.now());return{code:c}}));
app.post('/api/import',need('admin'),h((q,b)=>{let n=0,d=0;db.transaction(()=>b.rows.forEach(r=>{const c=U(r.EmpCode);if(!c)return;run('insert or ignore into p values(?,?,?,?,?,?)',c,r.FullName||'',r.Department||'',r.Email||'','Excel',Date.now()).changes?n++:d++}))();return{new:n,dup:d}}));
app.get('/api/me/:c',h(q=>{const c=U(q.params.c),p=g('select * from p where code=?',c);if(!p)throw Error('ไม่พบรหัสนี้ในระบบ');
 return{...p,ci:all('select sess,ts from ci where code=?',c),st:all('select st.booth,b.name,st.pts from st join b on b.id=st.booth where st.code=?',c),rt:all('select booth from rt where code=?',c).map(x=>x.booth),an:all('select qid,ok,pts from an where code=?',c),
 quiz:g('select coalesce(sum(pts),0) v from an where code=?',c).v,stamp:g('select coalesce(sum(pts),0) v from st where code=?',c).v}}));
app.post('/api/checkin',need('staff'),h((q,b)=>{const c=U(b.code),p=g('select name from p where code=?',c);if(!p)throw Error('ไม่พบผู้เข้าร่วม');if(!['M','A'].includes(b.sess))throw Error('รอบไม่ถูกต้อง');
 try{run('insert into ci values(?,?,?)',c,b.sess,Date.now())}catch(e){throw Error(p.name+' เช็กอินรอบนี้ไปแล้ว')}return{name:p.name}}));
app.get('/api/booths',h(()=>all('select * from b order by name')));
app.post('/api/booths',need('admin'),h((q,b)=>{b.rows.forEach(r=>run('insert or replace into b values(?,?,?)',String(r.id),r.name,r.pts||10));return{n:b.rows.length}}));
app.post('/api/stamp',need('staff'),h((q,b)=>{const c=U(b.code),p=g('select name from p where code=?',c),bo=g('select * from b where id=?',String(b.booth));if(!p||!bo)throw Error('ไม่พบผู้เข้าร่วมหรือบูธ');
 try{run('insert into st values(?,?,?,?)',c,bo.id,bo.pts,Date.now())}catch(e){throw Error(p.name+' ถูกประทับตราบูธนี้แล้ว')}return{name:p.name,pts:bo.pts}}));
app.post('/api/rate',h((q,b)=>{const c=U(b.code);if(!g('select 1 from st where code=? and booth=?',c,b.booth))throw Error('ต้องถูกประทับตราที่บูธนี้ก่อนจึงโหวตได้');run('insert into rt values(?,?,?)',c,b.booth,Math.min(5,Math.max(1,+b.r||1)));return{ok:1}}));

app.get('/api/questions',need('admin'),h(()=>all('select id,kind,seq,txt,tok from q order by kind,seq')));
app.post('/api/questions',need('admin'),h((q,b)=>{const s=db.prepare('insert or replace into q values(@id,@kind,@seq,@txt,@a,@b,@c,@d,@ok,@pts,@secs,@tok)');db.transaction(()=>b.rows.forEach(r=>s.run({seq:0,pts:100,secs:20,...r,id:String(r.id),ok:U(r.ok),tok:String(r.tok||'')})))();return{n:b.rows.length}}));
app.get('/api/live',h(()=>{const l=g('select * from live'),r=g('select * from q where id=?',l.qid);return{state:l.state,t0:l.t0,now:Date.now(),q:pub(r),key:l.state==='reveal'&&r?r.ok:null}}));
app.post('/api/live',need('admin'),h((q,b)=>{const l=g('select * from live');
 if(b.a==='next'){const cur=g('select seq from q where id=?',l.qid),n=g("select * from q where kind='live' and seq>? order by seq limit 1",cur?cur.seq:0);if(!n)throw Error('หมดข้อแล้ว');run("update live set qid=?,state='open',t0=? where id=1",n.id,Date.now())}
 else if(b.a==='reset')run("update live set qid='',state='wait',t0=0 where id=1");
 else if(['close','reveal'].includes(b.a))run('update live set state=? where id=1',b.a);return{ok:1}}));
app.get('/api/qr/:t',h(q=>{const r=g("select * from q where tok=? and kind='qr'",q.params.t);if(!r)throw Error('ไม่พบคำถามจาก QR นี้');return pub(r)}));
app.post('/api/answer',h((q,b)=>{const c=U(b.code);if(!g('select 1 from p where code=?',c))throw Error('ไม่พบผู้เข้าร่วม');const r=g('select * from q where id=?',b.qid);if(!r)throw Error('ไม่พบคำถาม');
 const ok=U(b.ans)===r.ok?1:0;let pts=0,ms=0;
 if(r.kind==='live'){const l=g('select * from live');ms=Date.now()-l.t0;if(l.qid!==r.id||l.state!=='open'||ms>r.secs*1000+1500)throw Error('หมดเวลาตอบข้อนี้แล้ว');pts=ok?Math.round(r.pts*(1-.5*Math.min(ms,r.secs*1000)/(r.secs*1000))):0}else pts=ok?r.pts:0;
 try{run('insert into an values(?,?,?,?,?,?)',c,r.id,U(b.ans),ok,pts,ms)}catch(e){throw Error('คุณตอบข้อนี้ไปแล้ว')}return r.kind==='qr'?{ok,pts}:{done:1}}));

app.get('/api/dash',need('admin'),h(()=>{const one=s=>g(s).v;return{reg:one('select count(*) v from p'),m:one("select count(*) v from ci where sess='M'"),a:one("select count(*) v from ci where sess='A'"),
 both:one('select count(*) v from (select code from ci group by code having count(*)>1)'),
 dept:all('select p.dept d,count(distinct ci.code) n from ci join p on p.code=ci.code group by p.dept'),
 booth:all('select b.name,count(st.code) visits,coalesce(sum(st.pts),0) pts,round((select avg(r) from rt where booth=b.id),2) avg from b left join st on st.booth=b.id group by b.id order by visits desc'),
 top:all('select p.name,coalesce((select sum(pts) from an where code=p.code),0)+coalesce((select sum(pts) from st where code=p.code),0) total from p order by total desc limit 10'),
 qs:all('select q.id,q.kind,count(an.code) n,coalesce(sum(an.ok),0) ok from q left join an on an.qid=q.id group by q.id order by q.kind,q.seq')}}));
const X={Participants:'select * from p',CheckIn:'select * from ci',Stamps:'select * from st',Ratings:'select * from rt',Answers:'select * from an',Booths:'select * from b',
 Scores:'select *,quiz+stamp total from (select p.code,p.name,p.dept,(select coalesce(sum(pts),0) from an where code=p.code) quiz,(select coalesce(sum(pts),0) from st where code=p.code) stamp from p) order by total desc'};
app.get('/api/export',(q,s)=>{if(q.query.pin!==PIN.admin)return s.status(401).send('PIN ไม่ถูกต้อง');const wb=XLSX.utils.book_new();
 for(const[n,sql]of Object.entries(X))XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(all(sql)),n);
 s.setHeader('Content-Disposition','attachment; filename=KD2026_export.xlsx');s.send(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}))});
app.listen(process.env.PORT||3000,()=>console.log('Kaizen Day 2026 running'));
