export const LINE_KINDS = ['unknown','touchline','goal_line','halfway','penalty_area','goal_area'];
export function editableLines(mode,lines,activeId){
  if(mode!=='select')return [];
  const active=lines.find(l=>l.id===activeId);
  return [...(active?[active]:[]),...lines.filter(l=>l!==active).reverse()];
}
export function validPoint(p) { return Array.isArray(p) && p.length===2 && p.every(n=>typeof n==='number' && Number.isFinite(n)); }
export function makePitchLine(start,end,{kind='unknown',visibility='visible',id='line'}={}) {
  if(!validPoint(start)||!validPoint(end)||Math.hypot(end[0]-start[0],end[1]-start[1])<2)throw Error('Drag a longer line.');
  if(!LINE_KINDS.includes(kind)||!['visible','inferred'].includes(visibility))throw Error('Choose a valid line type and visibility.');
  return {id,start:[...start],end:[...end],kind,visibility};
}
export function lineHit(p,line,tolerance) {
  const endpoints=['start','end'].map(endpoint=>({endpoint,distance:Math.hypot(p[0]-line[endpoint][0],p[1]-line[endpoint][1])})).sort((a,b)=>a.distance-b.distance);
  if(endpoints[0].distance<=tolerance)return endpoints[0].endpoint;
  const a=line.start,b=line.end,dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;
  const t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<=tolerance?'body':null;
}
export function movePitchLine(line,part,point,origin,frame) {
  const cap=p=>[Math.max(0,Math.min(frame.width,p[0])),Math.max(0,Math.min(frame.height,p[1]))];
  if(part==='start'||part==='end')return {...line,[part]:cap(point)};
  let dx=point[0]-origin[0],dy=point[1]-origin[1];
  dx=Math.max(-Math.min(line.start[0],line.end[0]),Math.min(frame.width-Math.max(line.start[0],line.end[0]),dx));
  dy=Math.max(-Math.min(line.start[1],line.end[1]),Math.min(frame.height-Math.max(line.start[1],line.end[1]),dy));
  return {...line,start:[line.start[0]+dx,line.start[1]+dy],end:[line.end[0]+dx,line.end[1]+dy]};
}
