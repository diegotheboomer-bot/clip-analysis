export class ImageCache {
  constructor({limit=10,load}={}){this.limit=limit;this.entries=new Map();this.load=load||((url)=>new Promise((resolve,reject)=>{const image=new Image();image.decoding='async';image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Image could not load. Please retry.'));image.src=url;}));}
  get(url){if(!url)return Promise.reject(Error('This reference image is unavailable.'));if(this.entries.has(url)){const p=this.entries.get(url);this.entries.delete(url);this.entries.set(url,p);return p;}
    const promise=Promise.resolve().then(()=>this.load(url)).catch(error=>{if(this.entries.get(url)===promise)this.entries.delete(url);throw error;});this.entries.set(url,promise);while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value);return promise;
  }
  warm(url){if(url)this.get(url).catch(()=>{});}
}
export function fittedSize(width,height,maxWidth,maxHeight){const scale=Math.min(maxWidth/width,maxHeight/height);return {width:Math.max(1,width*scale),height:Math.max(1,height*scale)};}
export function imageTransform(imageWidth,imageHeight,viewWidth,viewHeight,zoom=1,pan=[0,0]){
  zoom=Math.max(1,Math.min(12,Number.isFinite(zoom)?zoom:1));
  const scale=Math.min(viewWidth/imageWidth,viewHeight/imageHeight)*zoom;
  const extraX=Math.max(0,imageWidth*scale-viewWidth)/2,extraY=Math.max(0,imageHeight*scale-viewHeight)/2;
  const px=extraX?Math.max(-extraX,Math.min(extraX,Number.isFinite(pan[0])?pan[0]:0)):0;
  const py=extraY?Math.max(-extraY,Math.min(extraY,Number.isFinite(pan[1])?pan[1]:0)):0;
  return {s:scale,x:(viewWidth-imageWidth*scale)/2+px,y:(viewHeight-imageHeight*scale)/2+py,zoom,pan:[px,py]};
}
