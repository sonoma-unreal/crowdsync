
try{lucide.createIcons()}catch(e){
  document.getElementById('reset').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
}
const K=50, MAXV=255, CX=137, CY=135, WR=90, EASE=0.2; // EASE = resistance (lower = heavier)
const rad=d=>d*Math.PI/180;
const dirs=[320,200,80].map(t=>({x:Math.sin(rad(t)),y:-Math.cos(rad(t))}));
const $=id=>document.getElementById(id);
const ins=[$('r'),$('g'),$('b')], clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const DEF=230;                    // default = 255 / 255 / 255
let puck={x:0,y:0}, master=DEF;      // what you see (eased)
let tp={x:0,y:0}, tm=DEF;            // where you're pulling it to
let running=false;

const valsOf=(p,m)=>dirs.map(q=>clamp(25+m+(2*K/3)*(p.x*q.x+p.y*q.y),0,MAXV));
function sendColor(values){if(window.parent===window)return;const color="#"+values.map(value=>Math.round(clamp(value,0,MAXV)).toString(16).padStart(2,"0")).join("");window.parent.postMessage({type:"lightsync:offset:color",color},location.origin)}
function setTarget(v,notify=true){
  v=v.map(c=>clamp(c,0,MAXV));
  const mean=(v[0]+v[1]+v[2])/3; tm=clamp(mean-25,-25,MAXV-25);
  let x=0,y=0; v.forEach((c,i)=>{x+=(c-mean)*dirs[i].x;y+=(c-mean)*dirs[i].y});
  x/=K;y/=K; const l=Math.hypot(x,y); if(l>1){x/=l;y/=l}
  tp={x,y}; if(notify)sendColor(valsOf(tp,tm)); kick();
}
// ring angle <-> master (piecewise so default sits at the bottom)
const phiOf=m=>m>=0?m/(MAXV-25)*330:m/25*30;
const masterOf=p=>p>=0?p/330*(MAXV-25):p/30*25;

function render(){
  const v=valsOf(puck,master);
  ins.forEach((el,i)=>{ if(document.activeElement!==el) el.value=(v[i]*225/MAXV).toFixed(2); });
  $('puck').style.left=(90+puck.x*WR)+'px';
  $('puck').style.top=(90+puck.y*WR)+'px';
  // knob shows the outcome color: white at 255, fading to black at 0
  const c=v.map(Math.round), hi=c.map(x=>Math.round(x+(255-x)*.45));
  $('puck').style.background=`radial-gradient(circle at 35% 30%,rgb(${hi}),rgb(${c}))`;
  $('puck').style.boxShadow=`0 0 0 1px rgba(255,255,255,.85),0 0 0 2px rgba(0,0,0,.5),0 0 8px rgba(${c},.7)`;
  drawArc();
  $('ridges').style.backgroundPositionX=(master*2)+'px';
}
function drawArc(){
  const v=clamp(25+master,0,MAXV), S=v/MAXV*360;
  if(S<1){$('halo').style.background='none';$('caps').innerHTML='';return}
  const c0=360-S, mid=360-S/2, W='255,255,255';
  // one smooth conic gradient: transparent -> faded tip -> solid -> head (no segments, no seams)
  $('halo').style.background=`conic-gradient(from 180deg,rgba(${W},0) 0deg,rgba(${W},0) ${c0}deg,rgba(${W},.22) ${c0}deg,#fff ${mid}deg,#fff 360deg)`;
  const R=97, f=x=>x.toFixed(2), th=rad(180-S);
  const P=[100+R*Math.sin(th),100-R*Math.cos(th)], n=[Math.sin(th),-Math.cos(th)];
  const A=[P[0]+1.5*n[0],P[1]+1.5*n[1]], B=[P[0]-1.5*n[0],P[1]-1.5*n[1]];
  $('caps').innerHTML=`<circle cx="100" cy="197" r="1.5" fill="#fff"/><path d="M${f(A[0])} ${f(A[1])}A1.5 1.5 0 0 0 ${f(B[0])} ${f(B[1])}Z" fill="rgba(${W},.22)"/>`;
}
function tick(){
  puck.x+=(tp.x-puck.x)*EASE; puck.y+=(tp.y-puck.y)*EASE; master+=(tm-master)*EASE;
  const done=Math.abs(tp.x-puck.x)+Math.abs(tp.y-puck.y)+Math.abs(tm-master)<0.002;
  if(done){puck={...tp};master=tm;running=false}
  render(); if(!done) requestAnimationFrame(tick);
}
function kick(){ if(!running){running=true;requestAnimationFrame(tick)} }

function wheelPt(e){
  const r=$('wheel').getBoundingClientRect();
  let x=(e.clientX-r.left-r.width/2)/(r.width/2), y=(e.clientY-r.top-r.height/2)/(r.height/2);
  const l=Math.hypot(x,y); if(l>1){x/=l;y/=l;}
  tp={x,y}; sendColor(valsOf(tp,tm)); kick();
}
function ringPt(e){
  const r=$('ring').getBoundingClientRect();
  const theta=(Math.atan2(e.clientX-r.left-CX,-(e.clientY-r.top-CY))*180/Math.PI+360)%360;
  const phi=(180-theta+360)%360, cur=25+tm;
  let val=phi/360*MAXV;
  if(phi<15&&cur>MAXV*.6) val=MAXV;      // wrap to full
  if(phi>345&&cur<MAXV*.4) val=0;        // wrap to empty
  tm=clamp(val-25,-25,MAXV-25); sendColor(valsOf(tp,tm)); kick();
}
let mode=null,lastX=0;
$('wheel').addEventListener('pointerdown',e=>{mode='w';$('wheel').setPointerCapture?.(e.pointerId);wheelPt(e)});
$('ring').addEventListener('pointerdown',e=>{
  const r=$('ring').getBoundingClientRect();
  const d=Math.hypot(e.clientX-r.left-CX,e.clientY-r.top-CY);
  if(d>90&&d<104){mode='r';$('ring').setPointerCapture(e.pointerId);ringPt(e)}
});
$('slider').addEventListener('pointerdown',e=>{mode='s';lastX=e.clientX;$('slider').setPointerCapture(e.pointerId)});
addEventListener('pointermove',e=>{
  if(mode==='w')wheelPt(e);
  else if(mode==='r')ringPt(e);
  else if(mode==='s'){tm=clamp(tm+(e.clientX-lastX)*0.6,-25,MAXV-25);lastX=e.clientX;sendColor(valsOf(tp,tm));kick()}
});
addEventListener('pointerup',()=>mode=null);
function reset(){tp={x:0,y:0};tm=DEF;sendColor(valsOf(tp,tm));kick()}
$('reset').onclick=reset; $('wheel').ondblclick=reset;

// number boxes: drag left/right to scrub, click to type
ins.forEach((el,i)=>{
  let sx=0,sv=null,drag=false,active=false;
  el.addEventListener('pointerdown',e=>{
    if(document.activeElement===el) return;
    active=true;drag=false;sx=e.clientX;sv=valsOf(tp,tm).map(value=>value*225/MAXV);
    el.setPointerCapture(e.pointerId);e.preventDefault();
  });
  el.addEventListener('pointermove',e=>{
    if(!active) return;
    const dx=e.clientX-sx; if(!drag&&Math.abs(dx)>3) drag=true;
    if(drag){const v=sv.slice(); v[i]=sv[i]+dx*0.5; setTarget(v.map(value=>value*MAXV/225))}
  });
  el.addEventListener('pointerup',()=>{active=false; if(!drag){el.focus();el.select()}});
  el.addEventListener('input',()=>setTarget(ins.map(x=>(parseFloat(x.value)||0)*MAXV/225)));
  el.addEventListener('blur',()=>render());
  el.addEventListener('keydown',e=>{
    if(e.key==='Enter')el.blur();
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const v=valsOf(tp,tm).map(value=>value*225/MAXV);v[i]+=e.key==='ArrowUp'?1:-1;setTarget(v.map(value=>value*MAXV/225))}
  });
});
window.addEventListener("message",event=>{
  if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=="lightsync:offset:set-color"||!/^#[\da-f]{6}$/i.test(event.data.color||""))return;
  const bytes=[1,3,5].map(index=>parseInt(event.data.color.slice(index,index+2),16));setTarget(bytes,false);
});
render();
