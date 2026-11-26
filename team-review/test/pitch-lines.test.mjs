import test from 'node:test';
import assert from 'node:assert/strict';
import { makePitchLine, lineHit, movePitchLine, editableLines, snapPitchPoint } from '../public/pitch-lines.mjs';
import { initialCorrection, trainingAnnotations, validateCorrection } from '../public/prediction-core.mjs';
const f={id:'0',width:1920,height:1080,time:0,selected:null,candidates:[],players:[],landmarks:[]};
test('taps near the actual image edge snap, while taps in padding are ignored',()=>{
 const start=snapPitchPoint([240,415],f,32);
 const end=snapPitchPoint([1901,982],f,32);
 assert.deepEqual(makePitchLine(start,end).end,[1920,982]);
 assert.deepEqual(snapPitchPoint([-4,1073],f,16),[0,1080]);
 assert.equal(snapPitchPoint([240,1145],f,32),null);
 assert.deepEqual(snapPitchPoint([1200,714],f,4),[1200,714]);
});
test('drawing from a shared corner never selects or mutates a previous line',()=>{
 const corner=[20,30],a=makePitchLine(corner,[500,30],{id:'a'}),b=makePitchLine(corner,[20,600],{id:'b'});
 assert.deepEqual(editableLines('line',[a,b],'a'),[]);const moved=movePitchLine(b,'start',[45,60],corner,f);assert.deepEqual(a.start,[20,30]);assert.deepEqual(b.start,[20,30]);assert.deepEqual(moved.start,[45,60]);assert.equal(editableLines('select',[a,b],'a')[0],a);
});
test('straight lines retain diagonal perspective and reject zero-length or invalid input',()=>{
 const l=makePitchLine([20,30],[500,125],{id:'a',kind:'touchline'});assert.deepEqual(l.end,[500,125]);assert.throws(()=>makePitchLine([20,20],[20,20]));assert.throws(()=>makePitchLine([NaN,0],[20,20]));
});
test('large touch targets choose the nearest endpoint, with separate body selection',()=>{
 const l=makePitchLine([20,30],[35,30]);assert.equal(lineHit([34,30],l,18),'end');assert.equal(lineHit([21,30],l,18),'start');
 const long=makePitchLine([0,0],[500,0]);assert.equal(lineHit([250,8],long,18),'body');assert.equal(lineHit([250,30],long,18),null);
});
test('moving a line preserves its direction and stays inside image bounds',()=>{
 const l=makePitchLine([100,100],[600,400]);const moved=movePitchLine(l,'body',[3000,3000],[100,100],f);assert.equal(moved.end[0]-moved.start[0],500);assert.equal(moved.end[1]-moved.start[1],300);assert.ok(moved.end[0]<=1920&&moved.end[1]<=1080);
 const endpoint=movePitchLine(l,'start',[-50,200],[100,100],f);assert.deepEqual(endpoint.start,[0,200]);assert.deepEqual(endpoint.end,l.end);
});
test('assumed lines survive correction backup but never enter visible training labels',()=>{
 const c=initialCorrection(f);c.lines=[makePitchLine([20,20],[500,20],{id:'visible'}),makePitchLine([20,40],[500,40],{id:'assumed',visibility:'inferred'})];
 assert.equal(trainingAnnotations([f],{'0':c}).pitchLines.length,0);c.pitchReviewed=true;validateCorrection(c,f);const data=trainingAnnotations([f],{'0':c});assert.equal(data.pitchLines.length,1);assert.deepEqual(data.pitchLines[0].lines.map(l=>l.id),['visible']);assert.equal(c.lines.length,2);
 c.lines=c.lines.filter(l=>l.visibility==='inferred');assert.equal(trainingAnnotations([f],{'0':c}).pitchLines.length,0);
});
test('old correction backups without lines remain valid and off-image lines are rejected',()=>{
 const c=initialCorrection(f);delete c.lines;assert.equal(validateCorrection(c,f),c);c.lines=[makePitchLine([-5,5],[100,5])];assert.throws(()=>validateCorrection(c,f),/outside/);
});
