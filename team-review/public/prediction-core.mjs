import { makePitchLine } from './pitch-lines.mjs';
export const SCHEMA = 'pitchcam.match-review.v1';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const box = a => Array.isArray(a) && a.length === 4 && a.every(finite) && a[2] > a[0] && a[3] > a[1];
export function normaliseResults(raw) {
  const source = Array.isArray(raw) ? raw : raw.frames || raw.results || raw.outputs;
  if (!Array.isArray(source) || !source.length) throw Error('No frame results found. Choose the Roboflow results JSON.');
  if (source.length > 100000) throw Error('Split this export into smaller clips first.');
  const frames = source.map((r, i) => {
    const o = r.outputs || r;
    // Export videoTimeMs is the media clock. Do not substitute the workflow clock,
    // which can start a frame later than the actual exported video.
    const time = finite(r.videoTimeMs) ? r.videoTimeMs / 1000 : o.temporal_status?.timestamp_s;
    if (!finite(time) || time < 0) throw Error(`Frame ${i + 1} has no reliable timestamp. Export video results with timestamps.`);
    const size = [o.player_candidates, o.ball_candidates, o.tracked_player_detections].map(x => x?.image).find(x => x?.width > 0 && x?.height > 0);
    if (!size) throw Error(`Frame ${i + 1} is missing image dimensions.`);
    const candidates = (o.ball_candidates?.predictions || []).filter(p => [p.x,p.y,p.width,p.height].every(finite) && p.width > 0 && p.height > 0).map((p,j) => ({id:String(p.detection_id || j), bbox:[p.x-p.width/2,p.y-p.height/2,p.x+p.width/2,p.y+p.height/2], confidence:p.confidence ?? null}));
    const tracks = o.player_tracks || [];
    const players = tracks.length ? tracks.filter(p => box(p.box_xyxy)).map((p,j) => ({id:'p'+j, track_id:p.track_id ?? null, bbox:[...p.box_xyxy], team:p.team || 'unknown', role:p.role || 'unknown'})) : (o.player_candidates?.predictions || []).map((p,j) => ({id:'p'+j,track_id:null,bbox:[p.x-p.width/2,p.y-p.height/2,p.x+p.width/2,p.y+p.height/2],team:'unknown',role:'unknown'})).filter(p => box(p.bbox));
    const landmarks = (o.pitch_landmarks || []).filter(p => Array.isArray(p.xy) && p.xy.length===2 && p.xy.every(finite)).map(p => ({label:String(p.label),xy:[...p.xy],visibility:'visible'}));
    const bs = o.ball_status || {}; let selected = bs.selected_index;
    if (!Number.isInteger(selected) && bs.selected_xy) selected = candidates.findIndex(p => Math.hypot((p.bbox[0]+p.bbox[2])/2-bs.selected_xy[0],(p.bbox[1]+p.bbox[3])/2-bs.selected_xy[1]) < 2);
    return {id:String(i), originalFrameId:r.frameId ?? o.temporal_status?.frame_number ?? null, time,width:size.width,height:size.height,candidates,players,landmarks,selected:Number.isInteger(selected)&&candidates[selected]?selected:null,events:o.pass_shot_candidates || []};
  });
  frames.sort((a,b) => a.time-b.time);
  return frames;
}
export function initialCorrection(f) {
  return {ball:{status:f.selected===null?'unsure':'visible',bbox:f.selected===null?null:[...f.candidates[f.selected].bbox],reason:null,reviewed:false},players:structuredClone(f.players),playersReviewed:false,landmarks:structuredClone(f.landmarks),lines:[],pitchReviewed:false};
}
export function reviewQueue(frames, spacing=1, focus='all') {
  let last=-Infinity;
  return frames.filter(f => {
    if (focus==='uncertain' && f.selected!==null && f.candidates.length<=1) return false;
    if (f.time-last+1e-6 < spacing) return false;
    last=f.time;return true;
  }).map(f => f.id);
}
export function trainingAnnotations(frames, corrections, trackTeams={}) {
  const ball={images:[],annotations:[],categories:[{id:1,name:'ball'}]};
  const people={images:[],annotations:[],categories:[{id:1,name:'player'},{id:2,name:'goalkeeper'},{id:3,name:'referee'}]};
  const pitch=[],pitchLines=[];let bid=1,pid=1;
  const xywh = b => [b[0],b[1],b[2]-b[0],b[3]-b[1]];
  for (const f of frames) {
    const c=corrections[f.id];if(!c)continue;
    const image={id:Number(f.id)+1,file_name:`frames/frame-${f.id.padStart(6,'0')}.jpg`,width:f.width,height:f.height,timestamp_sec:f.time};
    if(c.ball.reviewed && (['visible','partial'].includes(c.ball.status) && box(c.ball.bbox) || c.ball.status==='not_visible' && c.ball.reason==='outside_frame')) {
      ball.images.push(image);
      if(c.ball.bbox && ['visible','partial'].includes(c.ball.status)) { const b=xywh(c.ball.bbox);ball.annotations.push({id:bid++,image_id:image.id,category_id:1,bbox:b,area:b[2]*b[3],iscrowd:0,occluded:c.ball.status==='partial'}); }
    }
    if(c.playersReviewed) {
      people.images.push(image);
      for(const p of c.players.filter(p=>box(p.bbox))) {const b=xywh(p.bbox);people.annotations.push({id:pid++,image_id:image.id,category_id:p.role==='referee'?3:p.role==='goalkeeper'?2:1,bbox:b,area:b[2]*b[3],iscrowd:0,track_id:p.track_id,team:p.team_manual?p.team:(trackTeams[String(p.track_id)] || p.team)});}
    }
    if(c.pitchReviewed) {
      const visibleLandmarks=c.landmarks.filter(p=>p.visibility==='visible');
      const visibleLines=(c.lines||[]).filter(p=>p.visibility==='visible');
      if(visibleLandmarks.length)pitch.push({image,landmarks:visibleLandmarks});
      if(visibleLines.length)pitchLines.push({image,lines:visibleLines});
    }
  }
  return {ball,people,pitch,pitchLines};
}
export function validateCorrection(c,f) {
  if(!c || !['visible','partial','not_visible','unsure'].includes(c.ball?.status))throw Error('Invalid ball correction.');
  if([c.ball.reviewed,c.playersReviewed,c.pitchReviewed].some(v=>typeof v!=='boolean'))throw Error('Invalid review state.');
  if(c.ball.reason!==null && !['outside_frame','hidden','unknown'].includes(c.ball.reason))throw Error('Invalid absence reason.');
  if(c.players.some(p=>!['A','B','unknown'].includes(p.team)||!['player','goalkeeper','referee','unknown'].includes(p.role)))throw Error('Invalid player team or role.');
  const inside=b=>box(b)&&b[0]>=0&&b[1]>=0&&b[2]<=f.width&&b[3]<=f.height;
  if(c.ball.bbox && !inside(c.ball.bbox))throw Error('Box is outside the frame.');
  if(c.ball.reviewed && ['visible','partial'].includes(c.ball.status) && !inside(c.ball.bbox))throw Error('Draw a ball box before confirming.');
  if(!Array.isArray(c.players)||c.players.some(p=>!inside(p.bbox)))throw Error('Invalid player box.');
  if(!Array.isArray(c.landmarks)||c.landmarks.some(p=>!Array.isArray(p.xy)||p.xy.length!==2||!p.xy.every(finite)||p.xy[0]<0||p.xy[1]<0||p.xy[0]>f.width||p.xy[1]>f.height||!['visible','hidden','outside_frame'].includes(p.visibility)))throw Error('Invalid pitch landmark.');
  if(c.lines!==undefined) {
    if(!Array.isArray(c.lines))throw Error('Invalid pitch lines.');
    for(const line of c.lines){makePitchLine(line.start,line.end,line);for(const p of [line.start,line.end])if(p[0]<0||p[0]>f.width||p[1]<0||p[1]>f.height)throw Error('Pitch line is outside this frame.');}
  }
  return c;
}
