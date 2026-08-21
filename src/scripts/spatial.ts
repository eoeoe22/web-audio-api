/**
 * 공간 음향 실험실 — PannerNode(HRTF) + three.js 시각화.
 * 스피커/청취자를 바닥 평면에서 드래그하면 오디오 리스너·패너 좌표가 실시간으로 따라간다.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Clock,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineDashedMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferAttribute,
} from 'three';
import { el, toast } from './ui';

/* ── 팔레트 (via.css 와 동일) ───────────────────────────────────────── */
const C_BG = 0xecf0f3;
const C_PRIMARY = 0x3457cf; // 청취자
const C_WARM = 0xd1541c; // 음원
const C_INK = 0x45494f;
const C_GRID_MAJOR = 0xc9d2dc;
const C_GRID_MINOR = 0xdde3ea;

/* ═══════════════ 1. THREE 씬 ═══════════════ */
const container = el<HTMLDivElement>('scene');

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(C_BG);
scene.fog = new Fog(C_BG, 26, 60);

const camera = new PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.1, 200);

/* 커스텀 오빗(구면좌표) */
const orbit = {
  theta: Math.PI * 0.22,
  phi: Math.PI * 0.32,
  r: 15,
  target: new Vector3(0, 0.6, 0),
};
function applyCamera(): void {
  const { theta, phi, r, target } = orbit;
  camera.position.set(
    target.x + r * Math.sin(phi) * Math.sin(theta),
    target.y + r * Math.cos(phi),
    target.z + r * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(target);
}
applyCamera();

/* 조명 — 밝은 스튜디오 */
scene.add(new HemisphereLight(0xffffff, 0xc6ced8, 0.95));
const key = new DirectionalLight(0xffffff, 0.7);
key.position.set(6, 12, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -14;
key.shadow.camera.right = 14;
key.shadow.camera.top = 14;
key.shadow.camera.bottom = -14;
scene.add(key);

/* 바닥 + 그리드 */
const floor = new Mesh(new PlaneGeometry(120, 120), new ShadowMaterial({ opacity: 0.13 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new GridHelper(60, 60, C_GRID_MAJOR, C_GRID_MINOR);
grid.position.y = 0.001;
scene.add(grid);

/* ── 스피커 (음원) ── */
const speaker = new Group();
{
  const cabinet = new MeshStandardMaterial({ color: 0x3e444d, roughness: 0.6 });
  const driver = new MeshStandardMaterial({ color: C_WARM, roughness: 0.35 });

  const box = new Mesh(new BoxGeometry(0.9, 1.3, 0.8), cabinet);
  box.position.y = 0.65;
  box.castShadow = true;
  speaker.add(box);

  const cone = new Mesh(new CylinderGeometry(0.26, 0.34, 0.1, 32), driver);
  cone.rotation.x = Math.PI / 2;
  cone.position.set(0, 0.5, 0.42);
  cone.name = 'cone';
  speaker.add(cone);

  const tweeter = new Mesh(new CylinderGeometry(0.1, 0.13, 0.08, 24), driver);
  tweeter.rotation.x = Math.PI / 2;
  tweeter.position.set(0, 1.02, 0.42);
  speaker.add(tweeter);

  const ring = new Mesh(
    new RingGeometry(0.72, 0.8, 48),
    new MeshBasicMaterial({ color: C_WARM, transparent: true, opacity: 0.85, side: DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  speaker.add(ring);
}
speaker.position.set(-3.4, 0, -1.2);
scene.add(speaker);

/* ── 청취자 ── */
const head = new Group();
{
  const skin = new MeshStandardMaterial({ color: C_PRIMARY, roughness: 0.5 });

  const skull = new Mesh(new SphereGeometry(0.55, 32, 24), skin);
  skull.position.y = 1.5;
  skull.castShadow = true;
  head.add(skull);

  /* -Z 가 정면 */
  const nose = new Mesh(new ConeGeometry(0.13, 0.32, 16), skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 1.5, -0.62);
  head.add(nose);

  const earGeo = new SphereGeometry(0.14, 16, 12);
  const earL = new Mesh(earGeo, skin);
  earL.position.set(-0.55, 1.5, 0);
  head.add(earL);
  const earR = new Mesh(earGeo, skin);
  earR.position.set(0.55, 1.5, 0);
  head.add(earR);

  const neck = new Mesh(new CylinderGeometry(0.16, 0.2, 1.0, 16), skin);
  neck.position.y = 0.6;
  neck.castShadow = true;
  head.add(neck);

  const dir = new Mesh(new ConeGeometry(0.16, 0.5, 4), new MeshBasicMaterial({ color: C_PRIMARY }));
  dir.rotation.x = -Math.PI / 2;
  dir.position.set(0, 0.02, -1.15);
  head.add(dir);

  const ring = new Mesh(
    new RingGeometry(0.72, 0.8, 48),
    new MeshBasicMaterial({ color: C_PRIMARY, transparent: true, opacity: 0.85, side: DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  head.add(ring);
}
head.position.set(2.6, 0, 1.6);
scene.add(head);

/* ── 계측선 (스피커 ↔ 귀) ── */
const tether = new Line(
  new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
  new LineDashedMaterial({
    color: C_INK,
    dashSize: 0.22,
    gapSize: 0.14,
    transparent: true,
    opacity: 0.55,
  }),
);
scene.add(tether);
const tetherPos = tether.geometry.attributes.position as BufferAttribute;

/* ── 파면 링 풀 ── */
interface Wave {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  t: number;
  strength: number;
}
const wavePool: Wave[] = [];
for (let i = 0; i < 14; i++) {
  const mesh = new Mesh(
    new RingGeometry(0.96, 1, 72),
    new MeshBasicMaterial({ color: C_WARM, transparent: true, opacity: 0.5, side: DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.visible = false;
  scene.add(mesh);
  wavePool.push({ mesh, t: 1, strength: 0 });
}
let waveIdx = 0;
let lastWave = 0;
function spawnWave(strength: number): void {
  const w = wavePool[waveIdx]!;
  waveIdx = (waveIdx + 1) % wavePool.length;
  w.t = 0;
  w.strength = strength;
  w.mesh.position.set(speaker.position.x, 0.02, speaker.position.z);
  w.mesh.visible = true;
}

/* ═══════════════ 2. WEB AUDIO ═══════════════ */
const REF = 1;
const ROLLOFF = 1;

let ctx: AudioContext | null = null;
let panner: PannerNode;
let analyser: AnalyserNode;
let masterGain: GainNode;

let buffer: AudioBuffer | null = null;
let srcNode: AudioBufferSourceNode | null = null;
let toneNodes: AudioNode[] | null = null;
let playing = false;
let toneOn = false;

const amp = new Uint8Array(256);

function ensureCtx(): AudioContext {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new Ctor();

  panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = REF;
  panner.rolloffFactor = ROLLOFF;
  panner.maxDistance = 60;

  analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.9;

  panner.connect(analyser).connect(masterGain).connect(ctx.destination);
  return ctx;
}

function setParam(p: AudioParam, v: number): void {
  if (!ctx) return;
  if (p.setTargetAtTime) p.setTargetAtTime(v, ctx.currentTime, 0.02);
  else p.value = v;
}

/** 씬의 좌표를 오디오 그래프(패너 · 리스너)에 반영한다. */
function syncAudioSpace(): void {
  if (!ctx) return;

  setParam(panner.positionX, speaker.position.x);
  setParam(panner.positionY, 0.7);
  setParam(panner.positionZ, speaker.position.z);

  const listener = ctx.listener;
  const hp = head.position;
  const ry = head.rotation.y;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);

  if (listener.positionX) {
    setParam(listener.positionX, hp.x);
    setParam(listener.positionY, 1.5);
    setParam(listener.positionZ, hp.z);
    setParam(listener.forwardX, fx);
    setParam(listener.forwardY, 0);
    setParam(listener.forwardZ, fz);
    setParam(listener.upX, 0);
    setParam(listener.upY, 1);
    setParam(listener.upZ, 0);
  } else {
    listener.setPosition(hp.x, 1.5, hp.z);
    listener.setOrientation(fx, 0, fz, 0, 1, 0);
  }
}

/* ── 파일 로드 ── */
const fileInput = el<HTMLInputElement>('file');
const fileLabel = el<HTMLLabelElement>('filelabel');
const playBtn = el<HTMLButtonElement>('play');
const toneBtn = el<HTMLButtonElement>('tone');

fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  if (!f) return;

  const audio = ensureCtx();
  fileLabel.textContent = '디코딩 중…';
  try {
    buffer = await audio.decodeAudioData(await f.arrayBuffer());
    fileLabel.textContent = f.name;
    fileLabel.classList.add('is-loaded');
    playBtn.disabled = false;
    toast(`${f.name} 로드 완료`, 'success');
  } catch {
    fileLabel.textContent = '디코딩 실패 — 다른 파일을 선택하세요';
    fileLabel.classList.remove('is-loaded');
    buffer = null;
    playBtn.disabled = true;
    toast('디코딩에 실패했습니다.', 'error');
  }
});

function stopFile(): void {
  if (srcNode) {
    try {
      srcNode.stop();
    } catch {
      /* 이미 정지됨 */
    }
    srcNode.disconnect();
    srcNode = null;
  }
  playing = false;
  playBtn.innerHTML = '<i class="bi bi-play-fill"></i> 재생';
}

function stopTone(): void {
  if (toneNodes) {
    for (const n of toneNodes) {
      const src = n as OscillatorNode;
      try {
        if (typeof src.stop === 'function') src.stop();
      } catch {
        /* 이미 정지됨 */
      }
      n.disconnect();
    }
    toneNodes = null;
  }
  toneOn = false;
  toneBtn.classList.remove('btn-stop');
  toneBtn.innerHTML = '<i class="bi bi-broadcast-pin"></i> 테스트 신호';
}

playBtn.addEventListener('click', async () => {
  const audio = ensureCtx();
  await audio.resume();
  if (playing) {
    stopFile();
    return;
  }
  if (!buffer) return;
  stopTone();

  srcNode = audio.createBufferSource();
  srcNode.buffer = buffer;
  srcNode.loop = true;
  srcNode.connect(panner);
  syncAudioSpace();
  srcNode.start();

  playing = true;
  playBtn.innerHTML = '<i class="bi bi-stop-fill"></i> 정지';
});

/* 테스트 신호: 2.5Hz 펄스 비프 (정위 확인용) */
toneBtn.addEventListener('click', async () => {
  const audio = ensureCtx();
  await audio.resume();
  if (toneOn) {
    stopTone();
    return;
  }
  stopFile();

  const osc = audio.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 523.25;

  const env = audio.createGain();
  env.gain.value = 0.4; /* LFO ±0.4 → 0~0.8 펄스 */

  const lfo = audio.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 2.5;

  const lfoGain = audio.createGain();
  lfoGain.gain.value = 0.4;

  lfo.connect(lfoGain).connect(env.gain);
  osc.connect(env).connect(panner);
  syncAudioSpace();
  osc.start();
  lfo.start();

  toneNodes = [osc, lfo, env, lfoGain];
  toneOn = true;
  toneBtn.classList.add('btn-stop');
  toneBtn.innerHTML = '<i class="bi bi-stop-fill"></i> 신호 정지';
});

/* ── 머리 방향 슬라이더 ── */
const rotSlider = el<HTMLInputElement>('headrot');
const rotVal = el<HTMLSpanElement>('rotval');
rotSlider.addEventListener('input', () => {
  head.rotation.y = (-Number(rotSlider.value) * Math.PI) / 180;
  rotVal.textContent = `${rotSlider.value}°`;
});

/* ═══════════════ 3. 인터랙션 (드래그 / 오빗) ═══════════════ */
const ray = new Raycaster();
const ndc = new Vector2();
const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
const hitPoint = new Vector3();
const BOUND = 13;

let dragTarget: Group | null = null;
let orbiting = false;
let lastX = 0;
let lastY = 0;

function toNDC(e: PointerEvent): void {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickObject(e: PointerEvent): Group | null {
  toNDC(e);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects([...speaker.children, ...head.children], false);
  const first = hits[0];
  if (!first) return null;
  return speaker.children.includes(first.object) ? speaker : head;
}

container.addEventListener('pointerdown', (e) => {
  container.setPointerCapture(e.pointerId);
  const obj = pickObject(e);
  if (obj) {
    dragTarget = obj;
  } else {
    orbiting = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }
  container.classList.add('is-dragging');
});

container.addEventListener('pointermove', (e) => {
  if (dragTarget) {
    toNDC(e);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(groundPlane, hitPoint)) {
      dragTarget.position.x = MathUtils.clamp(hitPoint.x, -BOUND, BOUND);
      dragTarget.position.z = MathUtils.clamp(hitPoint.z, -BOUND, BOUND);
    }
  } else if (orbiting) {
    orbit.theta -= (e.clientX - lastX) * 0.005;
    orbit.phi = MathUtils.clamp(orbit.phi - (e.clientY - lastY) * 0.004, 0.18, Math.PI * 0.48);
    lastX = e.clientX;
    lastY = e.clientY;
    applyCamera();
  } else {
    container.style.cursor = pickObject(e) ? 'move' : 'grab';
  }
});

function endDrag(): void {
  dragTarget = null;
  orbiting = false;
  container.classList.remove('is-dragging');
}
container.addEventListener('pointerup', endDrag);
container.addEventListener('pointercancel', endDrag);

container.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    orbit.r = MathUtils.clamp(orbit.r + e.deltaY * 0.012, 6, 34);
    applyCamera();
  },
  { passive: false },
);

function resize(): void {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(container);
window.addEventListener('resize', resize);

/* ═══════════════ 4. HUD 계산 ═══════════════ */
const vDist = el<HTMLSpanElement>('v-dist');
const vGain = el<HTMLSpanElement>('v-gain');
const vAz = el<HTMLSpanElement>('v-az');

function updateHUD(): void {
  const dx = speaker.position.x - head.position.x;
  const dz = speaker.position.z - head.position.z;
  const d = Math.hypot(dx, dz);
  vDist.textContent = d.toFixed(2);

  /* inverse distance model 과 동일한 감쇠식 */
  const g = d <= REF ? 1 : REF / (REF + ROLLOFF * (d - REF));
  const db = 20 * Math.log10(g);
  vGain.textContent = (db <= -0.05 ? '−' : '') + Math.abs(db).toFixed(1);

  /* 머리 정면 기준 방위각: +우 / −좌 */
  const ry = head.rotation.y;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);
  const az = (Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz) * 180) / Math.PI;
  vAz.textContent = (az >= 0 ? 'R ' : 'L ') + Math.abs(az).toFixed(0);
  vAz.style.color = az >= 0 ? 'var(--via-warm-ink)' : 'var(--via-primary)';
}

/* ═══════════════ 5. 렌더 루프 ═══════════════ */
const clock = new Clock();
const coneMesh = speaker.getObjectByName('cone') as Mesh;

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  /* 오디오 진폭 */
  let level = 0;
  if (ctx && (playing || toneOn)) {
    analyser.getByteTimeDomainData(amp);
    let sum = 0;
    for (let i = 0; i < amp.length; i++) {
      const v = (amp[i]! - 128) / 128;
      sum += v * v;
    }
    level = Math.sqrt(sum / amp.length);
    syncAudioSpace();
  }

  /* 콘 펄스 */
  const s = 1 + level * 1.6;
  coneMesh.scale.set(s, 1, s);

  /* 파면 링 */
  const now = performance.now();
  if (level > 0.03 && now - lastWave > 240) {
    spawnWave(level);
    lastWave = now;
  }
  for (const w of wavePool) {
    if (!w.mesh.visible) continue;
    w.t += dt * 0.55;
    if (w.t >= 1) {
      w.mesh.visible = false;
      continue;
    }
    const r = 0.6 + w.t * 7;
    w.mesh.scale.set(r, r, 1);
    w.mesh.material.opacity = (1 - w.t) * 0.45 * Math.min(w.strength * 6, 1);
  }

  /* 계측선 */
  tetherPos.setXYZ(0, speaker.position.x, 0.75, speaker.position.z);
  tetherPos.setXYZ(1, head.position.x, 1.5, head.position.z);
  tetherPos.needsUpdate = true;
  tether.computeLineDistances();

  updateHUD();
  renderer.render(scene, camera);
}

resize();
animate();
