import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteReview } from '../public/review-remote.mjs';
const fixture=kind=>({job:{id:'job-1',kind},role:'reviewer',items:[{id:'item-1',version:0,status:'pending',answer:null,frame:{id:'frame-1',timestampSec:5,width:1280,height:720,source:'match.mp4',image:'/media/frame-1/image',proposal:{bbox:[20,20,6,6],confidence:.8}}}]});
test('code-review drafts and confirmation save to site serially without files or downloads',async()=>{
 const original=globalThis.fetch,calls=[];let version=0;
 globalThis.fetch=async(path,options={})=>{if(options.method!=='PUT')return Response.json(fixture('pitch'));const body=JSON.parse(options.body);assert.equal(body.version,version++);calls.push(body);return Response.json({saved:true,version,status:body.completed?'done':'draft'});};
 try{const remote=await RemoteReview.open('job-1');const c=remote.corrections['item-1'];c.lines.push({id:'a',start:[10,10],end:[500,90],kind:'unknown',visibility:'visible'});remote.schedule('item-1',c);c.lines[0].end=[600,120];remote.schedule('item-1',c);await remote.confirm('item-1',c);assert.equal(calls.length,3);assert.deepEqual(calls.map(c=>c.completed),[false,false,true]);assert.deepEqual(calls[0].answer.lines[0].end,[500,90]);assert.deepEqual(calls[2].answer.lines[0].end,[600,120]);assert.equal(remote.readOnly('item-1'),true);remote.schedule('item-1',c);await remote.flush();assert.equal(calls.length,3);}finally{globalThis.fetch=original;}
});
test('ball boxes retain source coordinates when sent to shared training labels',async()=>{
 const original=globalThis.fetch;let saved;
 globalThis.fetch=async(path,options={})=>{if(options.method!=='PUT')return Response.json(fixture('ball'));saved=JSON.parse(options.body);return Response.json({version:1,status:'done'});};
 try{const remote=await RemoteReview.open('job-1');assert.deepEqual(remote.corrections['item-1'].ball.bbox,[20,20,26,26]);await remote.confirm('item-1',remote.corrections['item-1']);assert.deepEqual(saved.answer.ball.bbox,[20,20,6,6]);assert.equal(saved.completed,true);}finally{globalThis.fetch=original;}
});
