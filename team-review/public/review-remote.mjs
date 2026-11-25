import { initialCorrection } from './prediction-core.mjs';
import { ImageCache } from './image-cache.mjs';
async function api(path,body){const r=await fetch(path,{method:body?'PUT':'GET',credentials:'same-origin',keepalive:Boolean(body),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save. Please retry.');return d;}
export class RemoteReview {
  static async open(id){const r=new RemoteReview();Object.assign(r,await api('/api/review-jobs/'+encodeURIComponent(id)));r.pending=Promise.resolve();r.itemsById=new Map(r.items.map(i=>[i.id,i]));r.frames=r.items.map((item,index)=>{const f=item.frame,p=f.proposal,b=p?.bbox;return {id:item.id,originalFrameId:index+1,time:f.timestampSec,width:f.width,height:f.height,source:f.source,image:f.image,before:f.before,after:f.after,candidates:b?[{id:'proposal',bbox:[b[0],b[1],b[0]+b[2],b[1]+b[3]],confidence:p.confidence}]:[],players:[],landmarks:[],selected:b?0:null,events:[]};});r.corrections=Object.fromEntries(r.frames.map(f=>{const item=r.itemsById.get(f.id),c=initialCorrection(f),a=item.answer;if(a?.ball){const b=a.ball.bbox;c.ball={...a.ball,bbox:b?[b[0],b[1],b[0]+b[2],b[1]+b[3]]:null,reviewed:item.status==='done'};}if(r.job.kind==='pitch'){c.lines=a?.lines||[];c.landmarks=a?.landmarks||[];c.pitchReviewed=item.status==='done';}return [f.id,c];}));return r;}
  readOnly(id){return this.role!=='owner'&&this.itemsById.get(id)?.status==='done';}
  schedule(id,c){if(this.readOnly(id))return;this.enqueue(id,structuredClone(c),false).catch(e=>this.onError?.(e));}
  async flush(){clearTimeout(this.timer);if(this.draft){const d=this.draft;this.draft=null;this.enqueue(d.id,d.c,false);}return this.pending;}
  enqueue(id,c,completed){const item=this.itemsById.get(id);const b=c.ball.bbox;const answer=this.job.kind==='ball'?{ball:{...c.ball,bbox:b?[b[0],b[1],b[2]-b[0],b[3]-b[1]]:null,reason:c.ball.status==='not_visible'?(c.ball.reason||'unknown'):null}}:{lines:c.lines||[],landmarks:c.landmarks||[]};if(!completed&&this.job.kind==='ball'&&['visible','partial'].includes(answer.ball.status)&&!b)answer.ball.status='unsure';
    this.pending=this.pending.catch(()=>{}).then(async()=>{const result=await api(`/api/review-jobs/${this.job.id}/items/${id}`,{version:item.version,operationId:crypto.randomUUID(),completed,answer});item.version=result.version;item.status=result.status;item.answer=answer;this.onSaved?.(completed);return result;});return this.pending;
  }
  async confirm(id,c){clearTimeout(this.timer);this.draft=null;await this.pending.catch(()=>{});return this.enqueue(id,c,true);}
  async undoSubmission(id){await this.flush();const item=this.itemsById.get(id);const result=await api(`/api/review-jobs/${this.job.id}/items/${id}`,{version:item.version,operationId:crypto.randomUUID(),completed:false,undo:true,answer:item.answer});item.version=result.version;item.status=result.status;return result;}
  image(frame){this.cache ||= new ImageCache({limit:12});return this.cache.get(frame.image);}
  reference(frame){this.cache ||= new ImageCache({limit:12});return this.cache.get(frame.before);}
  preload(index){this.cache ||= new ImageCache({limit:12});const current=this.frames[index];if(current)this.cache.warm(current.before);for(const f of this.frames.slice(index+1,index+4))this.cache.warm(f.image);}
}
