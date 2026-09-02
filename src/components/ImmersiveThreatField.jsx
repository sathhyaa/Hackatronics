import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export default function ImmersiveThreatField({ scenario, liveMode, onClose }) {
  const mount = useRef(null);

  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#15140f");
    scene.fog = new THREE.Fog("#15140f", 42, 175);

    const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .1, 500);
    camera.position.set(30, 23, 35);
    const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
    renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(innerWidth,innerHeight);
    mount.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true; controls.dampingFactor=.055; controls.target.set(0,4,0);
    controls.minDistance=18; controls.maxDistance=100;

    scene.add(new THREE.AmbientLight("#fff1d7",1.35));
    const key=new THREE.DirectionalLight("#ffd09b",3.2);key.position.set(18,30,12);scene.add(key);
    const rim=new THREE.PointLight("#e35f2b",10,42,2);rim.position.set(0,5,0);scene.add(rim);

    const grid=new THREE.GridHelper(180,60,"#4b473c","#2a2822"); scene.add(grid);

    // Blast source
    const sourceGroup=new THREE.Group(); scene.add(sourceGroup);
    const tankMat=new THREE.MeshStandardMaterial({color:"#d8d3ca",metalness:.62,roughness:.28});
    const tank=new THREE.Mesh(new THREE.CylinderGeometry(3.1,3.5,8.2,48),tankMat);tank.position.y=4.1;sourceGroup.add(tank);
    const cap=new THREE.Mesh(new THREE.SphereGeometry(3.12,48,20,0,Math.PI*2,0,Math.PI/2),new THREE.MeshStandardMaterial({color:"#ece7dc",metalness:.45,roughness:.25}));cap.position.y=8.15;sourceGroup.add(cap);
    const core=new THREE.Mesh(new THREE.SphereGeometry(.62,24,24),new THREE.MeshBasicMaterial({color:"#ffd18d"}));core.position.y=8.7;sourceGroup.add(core);

    // Pulsing source rings
    const rings=[];
    for(let i=0;i<3;i++){
      const ring=new THREE.Mesh(new THREE.TorusGeometry(3.9+i*1.1,.035,8,72),new THREE.MeshBasicMaterial({color:i===0?"#c73b2d":"#df7a34",transparent:true,opacity:.65-i*.12}));
      ring.rotation.x=Math.PI/2; ring.position.y=.12; scene.add(ring); rings.push(ring);
    }

    // Nested danger volumes with animated breathing and downwind lean.
    const zoneGroup=new THREE.Group();scene.add(zoneGroup);
    const downRad=(scenario.windDirection+180)*Math.PI/180;
    const zoneSpecs=[
      {r:Math.max(6,scenario.zones.moderate/18),c:"#e2b84f",o:.08,stretch:1.9},
      {r:Math.max(5,scenario.zones.high/18),c:"#df7a34",o:.11,stretch:1.55},
      {r:Math.max(4,scenario.zones.critical/18),c:"#c73b2d",o:.18,stretch:1.28}
    ];
    const zoneMeshes=[];
    zoneSpecs.forEach((z,index)=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(z.r,64,40),new THREE.MeshBasicMaterial({color:z.c,transparent:true,opacity:z.o,side:THREE.DoubleSide,depthWrite:false}));
      mesh.scale.set(z.stretch,.7,1.08); mesh.position.set(Math.sin(downRad)*z.r*.28,2.7,Math.cos(downRad)*z.r*.28); zoneGroup.add(mesh);zoneMeshes.push(mesh);
      const wire=new THREE.Mesh(new THREE.SphereGeometry(z.r*1.002,32,20),new THREE.MeshBasicMaterial({color:z.c,wireframe:true,transparent:true,opacity:.13,depthWrite:false}));wire.scale.copy(mesh.scale);wire.position.copy(mesh.position);zoneGroup.add(wire);zoneMeshes.push(wire);
    });

    // Animated ember field: scattered particles are deliberately kept in 3D, not on the map.
    const emberCount=520, emberPos=new Float32Array(emberCount*3), emberCol=new Float32Array(emberCount*3);
    const emberSeed=[]; const warm=new THREE.Color("#ffb15a"), hot=new THREE.Color("#ffd28a"), deep=new THREE.Color("#d9472d");
    for(let i=0;i<emberCount;i++){
      const angle=Math.random()*Math.PI*2, radius=Math.pow(Math.random(),.7)*9;
      const x=Math.cos(angle)*radius, z=Math.sin(angle)*radius;
      emberSeed.push({x,z,y:2+Math.random()*9,drift:.15+Math.random()*.65,life:Math.random()*1,phase:Math.random()*Math.PI*2});
      emberPos[i*3]=x;emberPos[i*3+1]=2;emberPos[i*3+2]=z;
      const c=Math.random()<.15?deep:(Math.random()<.5?warm:hot);emberCol[i*3]=c.r;emberCol[i*3+1]=c.g;emberCol[i*3+2]=c.b;
    }
    const emberGeo=new THREE.BufferGeometry();emberGeo.setAttribute("position",new THREE.BufferAttribute(emberPos,3));emberGeo.setAttribute("color",new THREE.BufferAttribute(emberCol,3));
    const embers=new THREE.Points(emberGeo,new THREE.PointsMaterial({size:.28,vertexColors:true,transparent:true,opacity:.88,depthWrite:false,sizeAttenuation:true}));scene.add(embers);

    // Larger sparks for an occasional cinematic flicker.
    const sparkGroup=new THREE.Group();scene.add(sparkGroup); const sparks=[];
    for(let i=0;i<42;i++){const m=new THREE.Mesh(new THREE.SphereGeometry(.06+Math.random()*.09,8,8),new THREE.MeshBasicMaterial({color:Math.random()>.5?"#ffb15a":"#fff0c9",transparent:true,opacity:.9}));sparkGroup.add(m);sparks.push({m,angle:Math.random()*6.28,r:1+Math.random()*3,y:4+Math.random()*7,speed:.02+Math.random()*.035});}

    // Smoke-like translucent cloud that drifts downwind and gently breathes.
    const smokeGroup=new THREE.Group();scene.add(smokeGroup); const smoke=[];
    for(let i=0;i<18;i++){
      const mat=new THREE.MeshBasicMaterial({color:i%2?"#76523a":"#5c4638",transparent:true,opacity:.08,depthWrite:false});
      const m=new THREE.Mesh(new THREE.SphereGeometry(2.4+Math.random()*2.5,24,18),mat);
      m.position.set((Math.random()-.5)*8,6+Math.random()*9,(Math.random()-.5)*8);m.scale.y=.7;smokeGroup.add(m);smoke.push({m,offset:Math.random()*20,drift:.03+Math.random()*.04});
    }

    // Wind ribbons in 3D: subtle moving curves, separate from ember particles.
    const ribbonGroup=new THREE.Group();scene.add(ribbonGroup); const ribbons=[];
    for(let lane=-3;lane<=3;lane++){
      const geo=new THREE.BufferGeometry();const pts=[];
      for(let i=0;i<44;i++)pts.push(new THREE.Vector3());geo.setFromPoints(pts);
      const line=new THREE.Line(geo,new THREE.LineBasicMaterial({color:"#6eb7b9",transparent:true,opacity:.32}));ribbonGroup.add(line);ribbons.push({line,lane});
    }

    // Live-mode safe points and rescue path.
    const responseGroup=new THREE.Group();scene.add(responseGroup);
    if(liveMode){
      const safePositions=[new THREE.Vector3(-13,.45,9),new THREE.Vector3(13,.45,7),new THREE.Vector3(6,.45,-14)];
      safePositions.forEach((p,i)=>{
        const beacon=new THREE.Mesh(new THREE.CylinderGeometry(.65,.65,.08,32),new THREE.MeshBasicMaterial({color:"#4f8a68",transparent:true,opacity:.9}));beacon.position.copy(p);responseGroup.add(beacon);
        const glow=new THREE.Mesh(new THREE.RingGeometry(.8,1.4,32),new THREE.MeshBasicMaterial({color:"#8fc5a3",transparent:true,opacity:.5,side:THREE.DoubleSide}));glow.rotation.x=-Math.PI/2;glow.position.copy(p).add(new THREE.Vector3(0,.05,0));responseGroup.add(glow);glow.userData.phase=i*1.7;
      });
      const rescueStart=new THREE.Vector3(-26,.35,-20), target=safePositions[0];
      const curve=new THREE.CatmullRomCurve3([rescueStart,new THREE.Vector3(-18,.45,-8),new THREE.Vector3(-7,.45,1),target]);
      const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,100,.13,8,false),new THREE.MeshBasicMaterial({color:"#f5f1e8",transparent:true,opacity:.85}));responseGroup.add(tube);
      const rescue=new THREE.Mesh(new THREE.SphereGeometry(.62,20,20),new THREE.MeshStandardMaterial({color:"#f4f0e8",emissive:"#ffffff",emissiveIntensity:.35}));responseGroup.add(rescue);
      rescue.userData.curve=curve;
    }

    const clock=new THREE.Clock();let raf;
    const animate=()=>{
      raf=requestAnimationFrame(animate);const t=clock.getElapsedTime();
      const flow=new THREE.Vector3(Math.sin(downRad),0,Math.cos(downRad));
      // Ember particles rise, swirl and drift downwind; each loops back into the source.
      for(let i=0;i<emberCount;i++){
        const s=emberSeed[i];s.life+=.006*s.drift*(1+scenario.windSpeed/18);if(s.life>1)s.life=0;
        const distance=3+s.life*42;emberPos[i*3]=s.x+flow.x*distance+Math.sin(t*1.7+s.phase)*.7;emberPos[i*3+1]=1.5+s.y*(1-s.life*.55)+Math.sin(t*2+s.phase)*.6;emberPos[i*3+2]=s.z+flow.z*distance+Math.cos(t*1.35+s.phase)*.7;
      }
      emberGeo.attributes.position.needsUpdate=true;
      sparks.forEach(s=>{s.angle+=s.speed;s.r+=.01;s.m.position.set(Math.cos(s.angle)*s.r+flow.x*t*1.5,s.y+Math.sin(t+s.angle)*.8,Math.sin(s.angle)*s.r+flow.z*t*1.5);if(s.r>18){s.r=1;s.y=3+Math.random()*8;}});
      smoke.forEach((s,i)=>{s.m.position.x+=flow.x*s.drift;s.m.position.z+=flow.z*s.drift;s.m.scale.setScalar(1+Math.sin(t*.35+i)*.08);if(Math.abs(s.m.position.x)>45||Math.abs(s.m.position.z)>45){s.m.position.x=(Math.random()-.5)*8;s.m.position.z=(Math.random()-.5)*8;}});
      ribbons.forEach(({line,lane},r)=>{const pts=[];for(let i=0;i<44;i++){const d=(i*1.65+(t*(3+scenario.windSpeed*.18)+r*9)%28);const cross=lane*2.7+Math.sin(i*.5+t*1.5+r)*.75;pts.push(new THREE.Vector3(flow.x*d+Math.cos(downRad)*cross,5+Math.sin(i*.45+t+r)*.7,flow.z*d-Math.sin(downRad)*cross));}line.geometry.setFromPoints(pts);});
      zoneGroup.rotation.y=Math.sin(t*.22)*.025;
      zoneMeshes.forEach((m,i)=>{const pulse=1+Math.sin(t*(.8+i*.08)+i)*.018;m.scale.multiplyScalar?null:null; m.material.opacity = i%2===0 ? Math.max(.035,m.material.opacity) : m.material.opacity;});
      rings.forEach((ring,i)=>{const scale=1+((t*.45+i*.33)%1)*.32;ring.scale.set(scale,scale,scale);ring.material.opacity=.58*(1-((t*.45+i*.33)%1));});
      responseGroup.children.forEach(o=>{if(o.geometry?.type==="RingGeometry")o.scale.setScalar(1+Math.sin(t*2+o.userData.phase)*.14);if(o.userData.curve)o.position.copy(o.userData.curve.getPoint((t*.045)%1)).add(new THREE.Vector3(0,.72,0));});
      core.scale.setScalar(1+Math.sin(t*4)*.12);rim.intensity=8+Math.sin(t*5)*3;controls.update();renderer.render(scene,camera);
    };animate();

    const onResize=()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};addEventListener("resize",onResize);
    return()=>{cancelAnimationFrame(raf);removeEventListener("resize",onResize);controls.dispose();emberGeo.dispose();renderer.dispose();mount.current?.replaceChildren();};
  },[scenario,liveMode]);

  return <div className="immersive"><div className="hud"><b>AEGIS / IMMERSIVE THREAT FIELD</b><span>DRAG TO ORBIT · SCROLL TO ZOOM · EMBER + WIND FLOW ACTIVE</span></div><div className="threeLegend"><span><i className="red"/> CRITICAL</span><span><i className="orange"/> HIGH</span><span><i className="yellow"/> MODERATE</span>{liveMode&&<span><i className="green"/> SAFE / ROUTE</span>}</div><button className="close3d" onClick={onClose}>× EXIT IMMERSIVE</button><div ref={mount}/></div>;
}
