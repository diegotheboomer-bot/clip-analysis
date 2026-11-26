import test from 'node:test';
import assert from 'node:assert/strict';
import { ImageCache, fittedSize } from '../public/image-cache.mjs';
import { RemoteReview } from '../public/review-remote.mjs';
test('image preloading and display share one request and cache stays bounded',async()=>{
 const calls=[];const cache=new ImageCache({limit:2,load:async url=>{calls.push(url);return {url};}});cache.warm('one');const first=await cache.get('one');assert.equal(first.url,'one');assert.deepEqual(calls,['one']);await cache.get('two');await cache.get('three');assert.equal(cache.entries.size,2);await cache.get('one');assert.equal(calls.filter(x=>x==='one').length,2);
});
test('failed preloads can be retried rather than leaving a permanently broken frame',async()=>{
 let attempts=0;const cache=new ImageCache({load:async()=>{if(!attempts++)throw Error('temporary failure');return 'decoded';}});await assert.rejects(cache.get('image'));assert.equal(await cache.get('image'),'decoded');
});
test('viewer fits portrait and landscape screens without crop or letterbox padding',()=>{
 for(const [w,h] of [[360,550],[1400,600],[700,200]]){const size=fittedSize(1920,1080,w,h);assert.ok(size.width<=w&&size.height<=h);assert.ok(Math.abs(size.width/size.height-1920/1080)<1e-9);assert.ok(Math.abs(size.width-w)<1e-9||Math.abs(size.height-h)<1e-9);}
});
test('motion context uses this frame reference and preloads the next three review images',()=>{
 const r=new RemoteReview(),urls=[];r.cache={warm:u=>urls.push(u)};r.frames=Array.from({length:5},(_,i)=>({image:'main-'+i,before:'earlier-'+i}));r.preload(1);assert.deepEqual(urls,['earlier-1','main-2','main-3','main-4']);
});
test('stale pan offsets cannot push the fitted image out of its viewport',async()=>{
 const {imageTransform}=await import('../public/image-cache.mjs');const t=imageTransform(1920,1080,1824,1026,1,[-166,394]);assert.equal(t.x,0);assert.equal(t.y,0);assert.deepEqual(t.pan,[0,0]);
});
test('zoomed images stay over every edge even after extreme dragging',async()=>{
 const {imageTransform}=await import('../public/image-cache.mjs');for(const pan of [[9999,9999],[-9999,-9999],[NaN,Infinity]]){const t=imageTransform(1920,1080,960,540,3,pan);assert.ok(t.x<=0&&t.y<=0);assert.ok(t.x+1920*t.s>=960&&t.y+1080*t.s>=540);}
});
