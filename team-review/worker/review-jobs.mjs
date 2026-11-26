import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { validateAnswer } from './labels.mjs';
import { makePitchLine } from '../public/pitch-lines.mjs';
const schemaReady=new WeakMap();
// Existing Sites deployments may not apply newly packaged Drizzle migrations.
// Additive, idempotent DDL keeps old labels and assignments intact.
export async function ensureReviewSchema(env){
  if(!schemaReady.has(env.DB)){
    const sql=[
      `CREATE TABLE IF NOT EXISTS review_jobs(id TEXT PRIMARY KEY NOT NULL,request_key TEXT NOT NULL,member_id TEXT NOT NULL REFERENCES members(id),kind TEXT NOT NULL,title TEXT NOT NULL,depends_on TEXT,created_at INTEGER NOT NULL)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS review_job_request ON review_jobs(request_key,kind)`,
      `CREATE TABLE IF NOT EXISTS review_items(id TEXT PRIMARY KEY NOT NULL,job_id TEXT NOT NULL REFERENCES review_jobs(id),frame_id TEXT NOT NULL REFERENCES frames(id),kind TEXT NOT NULL,position INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',answer TEXT,version INTEGER NOT NULL DEFAULT 0,last_operation TEXT,updated_at INTEGER)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS review_frame_task ON review_items(frame_id,kind)`,
      `CREATE INDEX IF NOT EXISTS review_job_items ON review_items(job_id,position)`,
      `CREATE TABLE IF NOT EXISTS review_changes(operation_id TEXT PRIMARY KEY NOT NULL,item_id TEXT NOT NULL REFERENCES review_items(id),reviewer_id TEXT REFERENCES members(id),answer TEXT NOT NULL,completed INTEGER NOT NULL,created_at INTEGER NOT NULL)`,
      `CREATE TRIGGER IF NOT EXISTS reserve_unused_ball_frame BEFORE INSERT ON review_items WHEN NEW.kind='ball' AND EXISTS(SELECT 1 FROM frames f WHERE f.id=NEW.frame_id AND (f.state!='pending' OR f.assignee IS NOT NULL)) BEGIN SELECT RAISE(ABORT,'ball frame already claimed'); END`,
    ];
    schemaReady.set(env.DB,env.DB.batch(sql.map(q=>env.DB.prepare(q))));
  }
  try{await schemaReady.get(env.DB);}catch(error){schemaReady.delete(env.DB);throw error;}
}

function balanced(frames,count) {
  const groups=new Map();for(const f of frames){if(!groups.has(f.clip_id))groups.set(f.clip_id,[]);groups.get(f.clip_id).push(f);}
  const result=[];for(let round=0;result.length<count;round++){let added=false;for(const list of groups.values())if(list[round]&&result.length<count){result.push(list[round]);added=true;}if(!added)break;}return result;
}
export async function reviewMediaAllowed(env,user,frameId,first) {
  return Boolean(await first(env,`SELECT i.id FROM review_items i JOIN review_jobs j ON j.id=i.job_id WHERE i.frame_id=? AND j.member_id=? AND NOT EXISTS(SELECT 1 FROM review_items parent WHERE parent.job_id=j.depends_on AND parent.status!='done') LIMIT 1`,frameId,user.member_id));
}
function canonicalAnswer(kind,raw,frame,completed) {
  if(kind==='ball')return {ball:validateAnswer(raw?.ball,frame)};
  if(!raw||!Array.isArray(raw.lines)||raw.lines.length>100||!Array.isArray(raw.landmarks)||raw.landmarks.length>64)throw Error('Check the pitch lines and landmarks.');
  const inside=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[0]<=frame.width&&p[1]>=0&&p[1]<=frame.height;
  const lines=raw.lines.map(l=>{const r=makePitchLine(l.start,l.end,{id:String(l.id||'line').slice(0,80),kind:l.kind,visibility:l.visibility});if(!inside(r.start)||!inside(r.end))throw Error('Keep line endpoints inside the frame.');return r;});
  const landmarks=raw.landmarks.map(p=>{if(!inside(p.xy)||!['visible','hidden','outside_frame'].includes(p.visibility))throw Error('Invalid pitch landmark.');return {label:String(p.label).slice(0,30),xy:p.xy,visibility:p.visibility};});
  return {lines,landmarks};
}
export async function reviewJobsRoute(request,env,ctx,user,h) {
  const {first,rows,stmt,now,id,fail,body,json,newCode,frameView}=h;
  const path=new URL(request.url).pathname,method=request.method;
  if(!path.startsWith('/api/review-jobs')&&!path.startsWith('/api/admin/review-'))return null;
  const summaries=async(member=null)=>rows(env,`SELECT j.*,m.name AS reviewer_name,COUNT(i.id) AS total,SUM(CASE WHEN i.status='done' THEN 1 ELSE 0 END) AS done,
    CASE WHEN EXISTS(SELECT 1 FROM review_items p WHERE p.job_id=j.depends_on AND p.status!='done') THEN 1 ELSE 0 END AS locked
    FROM review_jobs j JOIN members m ON m.id=j.member_id LEFT JOIN review_items i ON i.job_id=j.id ${member?'WHERE j.member_id=?':''} GROUP BY j.id ORDER BY j.created_at,j.kind`,...(member?[member]:[]));
  const jobAccess=async(jobId)=>{
    const j=await first(env,'SELECT * FROM review_jobs WHERE id=?',jobId);if(!j)fail(404,'Batch not found.');
    if(user.role!=='owner'&&j.member_id!==user.member_id)fail(403,'This batch belongs to another reviewer.');
    if(user.role!=='owner'&&j.depends_on&&await first(env,"SELECT id FROM review_items WHERE job_id=? AND status!='done' LIMIT 1",j.depends_on))fail(409,'Finish your ball batch before starting pitch lines.');
    return j;
  };
  if(path==='/api/admin/review-bundles'&&method==='POST') {
    const d=await body(request),count=d.count??50,task=d.task??'both';
    if(!Number.isInteger(count)||count<1||count>100||typeof d.matchGroup!=='string'||!d.matchGroup.trim()||!/^[-a-zA-Z0-9]{16,80}$/.test(d.requestId||''))fail(400,'Choose a match, a batch size from 1 to 100, and a request ID.');
    if(!['ball','pitch','both'].includes(task))fail(400,'Choose ball, pitch lines, or both.');
    const existing=await rows(env,'SELECT * FROM review_jobs WHERE request_key=?',d.requestId);if(existing.length)return json({jobs:existing,memberId:existing[0].member_id,existing:true,code:null});
    const available=await rows(env,`SELECT f.*,c.created_at FROM frames f JOIN clips c ON c.id=f.clip_id WHERE c.status='ready' AND c.match_group=? ORDER BY c.created_at,CASE WHEN f.seq=0 THEN 1 ELSE 0 END,f.seq LIMIT 20000`,d.matchGroup.trim());
    const reserved=await rows(env,'SELECT frame_id,kind FROM review_items');const taken=new Set(reserved.map(r=>r.kind+':'+r.frame_id));
    const balls=task==='pitch'?[]:balanced(available.filter(f=>f.state==='pending'&&!f.assignee&&!taken.has('ball:'+f.id)),count);
    const ballIds=new Set(balls.map(f=>f.id));
    const pitches=task==='ball'?[]:balanced(available.filter(f=>!ballIds.has(f.id)&&!taken.has('pitch:'+f.id)),count);
    const tasks=[];
    if(task!=='pitch')tasks.push({kind:'ball',title:'Ball',frames:balls});
    if(task!=='ball')tasks.push({kind:'pitch',title:'Pitch lines',frames:pitches});
    const shortage=tasks.find(t=>t.frames.length<count);
    if(shortage)fail(409,`${shortage.title}: ${shortage.frames.length} frames available for this request. Choose a smaller batch.`);
    let member,code=null;
    if(d.memberId){member=await first(env,'SELECT * FROM members WHERE id=? AND active=1',d.memberId);if(!member)fail(400,'Choose an active reviewer.');}
    else {const created=await newCode(env,null,String(d.name||'Friend reviewer').trim().slice(0,60)||'Friend reviewer');member={id:created.id};code=created.code;}
    const createdAt=now();
    const jobs=tasks.map(t=>({id:id(),kind:t.kind,title:`${t.title} · ${count} frames`,depends_on:null}));
    if(task==='both')jobs[1].depends_on=jobs[0].id;
    const inserts=jobs.map(j=>stmt(env,'INSERT INTO review_jobs(id,request_key,member_id,kind,title,depends_on,created_at) VALUES(?,?,?,?,?,?,?)',j.id,d.requestId,member.id,j.kind,j.title,j.depends_on,createdAt));
    const items=tasks.flatMap(({kind,frames},i)=>frames.map((f,position)=>({id:id(),job:jobs[i].id,frame:f.id,kind,position})));
    inserts.push(stmt(env,`INSERT INTO review_items(id,job_id,frame_id,kind,position) SELECT json_extract(value,'$.id'),json_extract(value,'$.job'),json_extract(value,'$.frame'),json_extract(value,'$.kind'),json_extract(value,'$.position') FROM json_each(?)`,JSON.stringify(items)));
    try{await env.DB.batch(inserts);}catch(e){if(code)await stmt(env,'UPDATE members SET active=0 WHERE id=?',member.id).run();fail(409,'Some frames were assigned while creating this batch. Refresh and retry.');}
    return json({memberId:member.id,code,jobs:jobs.map(j=>({...j,total:count,done:0})),url:'/?batches=1&login=1'},201);
  }
  if(path==='/api/review-jobs'&&method==='GET')return json({jobs:await summaries(user.role==='owner'?null:user.member_id)});
  if(path==='/api/admin/review-jobs'&&method==='GET')return json({jobs:await summaries()});
  const save=/^\/api\/review-jobs\/([-a-zA-Z0-9]+)\/items\/([-a-zA-Z0-9]+)$/.exec(path);
  if(save&&method==='PUT'){
    const j=await jobAccess(save[1]),item=await first(env,'SELECT i.*,f.width,f.height FROM review_items i JOIN frames f ON f.id=i.frame_id WHERE i.id=? AND i.job_id=?',save[2],j.id);if(!item)fail(404,'Frame not assigned in this batch.');
    const d=await body(request);if(!Number.isInteger(d.version)||d.version<0||typeof d.completed!=='boolean'||!/^[-a-zA-Z0-9]{16,80}$/.test(d.operationId||''))fail(400,'Invalid save operation.');
    let answer;try{answer=canonicalAnswer(j.kind,d.answer,item,d.completed);}catch(e){fail(400,e.message);}
    const serial=JSON.stringify(answer),prior=await first(env,'SELECT * FROM review_changes WHERE operation_id=?',d.operationId);
    if(prior){if(prior.item_id!==item.id||prior.answer!==serial||prior.completed!==Number(d.completed))fail(409,'This save identifier was already used.');return json({saved:true,version:item.version,status:item.status});}
    if(item.status==='done'&&user.role!=='owner'){
      if(d.undo!==true||d.completed)fail(409,'This frame is completed. Use Undo for your last submission.');
      const latest=await first(env,`SELECT rc.item_id FROM review_changes rc JOIN review_items ri ON ri.id=rc.item_id WHERE ri.job_id=? AND ri.status='done' AND rc.completed=1 ORDER BY rc.created_at DESC,rc.rowid DESC LIMIT 1`,j.id);
      if(latest?.item_id!==item.id)fail(409,'Only the most recent submission can be undone.');
      if(await first(env,`SELECT ri.id FROM review_items ri JOIN review_jobs child ON child.id=ri.job_id WHERE child.depends_on=? AND ri.status!='pending' LIMIT 1`,j.id))fail(409,'Pitch review has already started. Ask the organiser to change the earlier ball label.');
    }
    const result=await env.DB.batch([
      stmt(env,`UPDATE review_items SET answer=?,status=?,version=version+1,last_operation=?,updated_at=? WHERE id=? AND version=? AND (EXISTS(SELECT 1 FROM review_jobs j JOIN members m ON m.id=j.member_id WHERE j.id=review_items.job_id AND j.member_id=? AND m.active=1) OR ?=1)`,serial,d.completed?'done':'draft',d.operationId,now(),item.id,d.version,user.member_id,user.role==='owner'?1:0),
      stmt(env,'INSERT INTO review_changes(operation_id,item_id,reviewer_id,answer,completed,created_at) SELECT ?,id,?,?,?,? FROM review_items WHERE id=? AND last_operation=?',d.operationId,user.member_id,serial,Number(d.completed),now(),item.id,d.operationId),
    ]);
    if(!result[0].meta.changes)fail(409,'A newer answer is already saved. Reload this batch.');
    const progress=await first(env,"SELECT COUNT(*) AS total,SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done FROM review_items WHERE job_id=?",j.id);
    return json({saved:true,version:d.version+1,status:d.completed?'done':'draft',progress});
  }
  if(path==='/api/admin/review-modules/export'&&method==='GET') {
    const items=await rows(env,`SELECT i.*,f.width,f.height,f.clip_id,f.seq,f.timestamp_sec,f.proposal,c.title,c.match_group FROM review_items i JOIN frames f ON f.id=i.frame_id JOIN clips c ON c.id=f.clip_id WHERE i.status='done' ORDER BY i.kind,c.created_at,f.seq LIMIT 5000`);
    const ball={images:[],annotations:[],categories:[{id:1,name:'ball'}]},pitch=[],provenance=[];let imageId=0,annotationId=0;const media=new Map();
    for(const f of items){const a=JSON.parse(f.answer),im={id:++imageId,file_name:`images/${f.frame_id}.jpg`,width:f.width,height:f.height,match_group:f.match_group,clip:f.title,timestamp_sec:f.timestamp_sec};let usable=false;
      if(f.kind==='ball'){const b=a.ball;if(['visible','partial'].includes(b.status)){ball.images.push(im);ball.annotations.push({id:++annotationId,image_id:im.id,category_id:1,bbox:b.bbox,area:b.bbox[2]*b.bbox[3],iscrowd:0,occluded:b.status==='partial'});usable=true;}else if(b.status==='not_visible'&&b.reason==='outside_frame'){ball.images.push(im);usable=true;}}
      else {const lines=a.lines.filter(l=>l.visibility==='visible'),landmarks=a.landmarks.filter(l=>l.visibility==='visible');if(lines.length||landmarks.length){pitch.push({image:im,lines,landmarks});usable=true;}}
      provenance.push({item_id:f.id,frame_id:f.frame_id,task:f.kind,answer:a,proposal:JSON.parse(f.proposal),match_group:f.match_group});if(usable)media.set(im.file_name,`clips/${f.clip_id}/${f.seq}/image.jpg`);
    }
    const stream=new TransformStream(),writer=stream.writable.getWriter();let output=Promise.resolve();const zip=new Zip((error,chunk,final)=>{if(error){writer.abort(error);return;}output=output.then(()=>writer.write(chunk));if(final)output=output.then(()=>writer.close());});
    const add=(name,bytes)=>{const entry=new ZipPassThrough(name);zip.add(entry);entry.push(bytes,true);};
    ctx.waitUntil((async()=>{try{add('ball-coco.json',strToU8(JSON.stringify(ball)));add('pitch-lines.json',strToU8(JSON.stringify(pitch)));add('review-history.json',strToU8(JSON.stringify(provenance)));add('README.txt',strToU8('Human-completed labels only. Split by whole match. Hidden/unsure ball frames and inferred pitch lines are excluded from training labels. Full assumptions and AI proposals are retained in review-history.json. No retraining was launched.'));for(const[name,key]of media){const object=await env.BUCKET.get(key);if(!object)throw Error('A training image is missing.');add(name,new Uint8Array(await new Response(object.body).arrayBuffer()));await output;}zip.end();await output;}catch(e){await writer.abort(e).catch(()=>{});}})());
    return new Response(stream.readable,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="pitchcam-ball-pitch-modules.zip"','Cache-Control':'no-store'}});
  }
  const get=/^\/api\/review-jobs\/([-a-zA-Z0-9]+)$/.exec(path);
  if(get&&method==='GET'){
    const j=await jobAccess(get[1]),items=await rows(env,`SELECT i.id AS item_id,i.status AS item_status,i.answer AS item_answer,i.version AS item_version,f.*,c.title,c.match_group FROM review_items i JOIN frames f ON f.id=i.frame_id JOIN clips c ON c.id=f.clip_id WHERE i.job_id=? ORDER BY i.position`,j.id);
    return json({job:j,items:items.map(f=>({id:f.item_id,status:f.item_status,answer:f.item_answer?JSON.parse(f.item_answer):null,version:f.item_version,frame:frameView(f)})),role:user.role});
  }
  return null;
}
