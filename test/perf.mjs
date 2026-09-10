import { chromium } from 'playwright';
import http from 'node:http';
import { createReadStream, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const root='/home/claude/solar';
const serveDir=join(root,'.testserve');
writeFileSync(join(serveDir,'index.html'), readFileSync(join(root,'index.html'),'utf8')
  .replace('https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.min.js','/vendor/astronomy.browser.min.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js','/vendor/three-build/three.module.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/','/vendor/three-addons/'));
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const server=http.createServer((q,r)=>{const u=decodeURIComponent(q.url.split('?')[0]);const p=join(serveDir,u==='/'?'index.html':u);
 try{if(!statSync(p).isFile())throw 0;r.writeHead(200,{'content-type':MIME[extname(p)]||'application/octet-stream'});createReadStream(p).pipe(r);}catch{r.writeHead(404);r.end('x');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1280,height:800}});
await p.addInitScript(()=>{try{localStorage.setItem('sonyachna-systema.v1',JSON.stringify({seen:true}));}catch{}});
await p.goto(`${base}/index.html`,{waitUntil:'load'});
await p.waitForTimeout(2500);
const S_PRE=0;
const measure = async (label, setup) => {
  await p.evaluate(`(()=>{const S=window.SonyachnaSystema; (${setup.toString()})();})()`);
  await p.waitForTimeout(600);
  const fps = await p.evaluate(()=>new Promise(res=>{let f=0;const t0=performance.now();
    const t=()=>{f++; if(performance.now()-t0<2500) requestAnimationFrame(t); else res(Math.round(f*1000/(performance.now()-t0)));};requestAnimationFrame(t);}));
  console.log(`  ${label.padEnd(30)} ${fps} fps`);
  return fps;
};
await measure('усе увімкнено', ()=>{});
await measure('без поясів', ()=>{ S.World.belts.forEach(x=>x.visible=false); });
await measure('без поясів і зір', ()=>{ S.World.stars.visible=false; });
await measure('без ореолів', ()=>{ for(const r of S.World.bodies.values()) if(r.halo) r.halo.visible=false; S.World.sunGlow.visible=false; });
await measure('без комети', ()=>{ S.World.comet.head.visible=false; S.World.comet.tail.visible=false; S.World.comet.orbit.visible=false; });
await measure('без планет', ()=>{ for(const r of S.World.bodies.values()){ if(r.mesh) r.mesh.visible=false; if(r.orbit) r.orbit.visible=false; } });
await measure('фон вимкнено', ()=>{ S.World.scene.background=null; });
await b.close(); server.close();
