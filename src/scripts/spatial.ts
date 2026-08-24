/**
 * 공간 음향 실험실 — PannerNode(HRTF) + three.js 시각화.
 *
 *  · 스피커/청취자를 바닥에서 드래그하면 패너·리스너 좌표가 실시간으로 따라간다.
 *  · 클릭으로 선택하면 수직 화살표(리프트 기즈모)가 나타나 높이를 조절할 수 있다.
 *  · 스테레오 모드는 음원의 좌/우 채널을 두 스피커로 갈라 보낸다.
 *  · FPV 모드는 청취자의 머리 위치·방향을 그대로 카메라에 옮긴다.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
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
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferAttribute,
  type Object3D,
} from 'three';
import { el, toast } from './ui';

/* ── 팔레트 (via.css 와 동일) ───────────────────────────────────────── */
const C_BG = 0xecf0f3;
const C_PRIMARY = 0x3457cf; // 청취자
const C_WARM = 0xd1541c; // 음원 · L 채널
const C_OK = 0x1f7a52; // R 채널
const C_LIFT = 0xb8860b; // 수직 이동 기즈모
const C_INK = 0x45494f;
const C_GRID_MAJOR = 0xc9d2dc;
const C_GRID_MINOR = 0xdde3ea;

/* ── 공간 상수 ── */
const BOUND = 13; // 수평 이동 한계
const MAX_LIFT = 6; // 수직 이동 한계 (바닥 = 0)
const DRIVER_Y = 0.75; // 스피커 원점 기준 드라이버 높이
const EAR_Y = 1.5; // 머리 원점 기준 귀 높이
const FOV = 46;

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

const camera = new PerspectiveCamera(FOV, container.clientWidth / container.clientHeight, 0.1, 200);
camera.rotation.order = 'YXZ'; /* FPV 에서 yaw→pitch 순으로 조립하기 위함 */

/* 커스텀 오빗(구면좌표) */
const ORBIT_HOME = { theta: Math.PI * 0.22, phi: Math.PI * 0.32, r: 15 };
const orbit = {
  theta: ORBIT_HOME.theta,
  phi: ORBIT_HOME.phi,
  r: ORBIT_HOME.r,
  target: new Vector3(0, 0.6, 0),
};

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

/* ── 공통 부품 ── */

/** 바닥에 남는 위치 마커(오브젝트가 떠올라도 바닥에 붙어 있다). */
function makeMarkerRing(color: number): Mesh {
  const ring = new Mesh(
    new RingGeometry(0.72, 0.8, 48),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  scene.add(ring);
  return ring;
}

/** 떠 있는 오브젝트와 바닥을 잇는 점선. */
function makeDropLine(color: number): Line {
  const line = new Line(
    new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
    new LineDashedMaterial({ color, dashSize: 0.16, gapSize: 0.12, transparent: true, opacity: 0.6 }),
  );
  scene.add(line);
  return line;
}

/** 스피커 ↔ 귀 계측선. */
function makeTether(): { line: Line; pos: BufferAttribute } {
  const line = new Line(
    new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
    new LineDashedMaterial({
      color: C_INK,
      dashSize: 0.22,
      gapSize: 0.14,
      transparent: true,
      opacity: 0.55,
    }),
  );
  scene.add(line);
  return { line, pos: line.geometry.attributes.position as BufferAttribute };
}

/** 뚜껑에 붙일 L / R 각인 텍스처. */
function makeLabelTexture(text: string, ink: string): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = '#eef1f4';
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ink;
  g.font = "bold 76px 'IBM Plex Mono', ui-monospace, monospace";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 70);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ── 스피커 리그 ── */
interface Rig {
  group: Group;
  cone: Mesh;
  label: Mesh;
  ring: Mesh;
  drop: Line;
  tether: Line;
  tetherPos: BufferAttribute;
  color: number;
  channel: 'L' | 'R';
  panner: PannerNode | null;
  analyser: AnalyserNode | null;
  amp: Uint8Array<ArrayBuffer>;
  level: number;
  lastWave: number;
}

function makeSpeaker(channel: 'L' | 'R', color: number, ink: string): Rig {
  const group = new Group();

  const cabinet = new MeshStandardMaterial({ color: 0x3e444d, roughness: 0.6 });
  const driver = new MeshStandardMaterial({ color, roughness: 0.35 });

  const box = new Mesh(new BoxGeometry(0.9, 1.3, 0.8), cabinet);
  box.position.y = 0.65;
  box.castShadow = true;
  group.add(box);

  const cone = new Mesh(new CylinderGeometry(0.26, 0.34, 0.1, 32), driver);
  cone.rotation.x = Math.PI / 2;
  cone.position.set(0, 0.5, 0.42);
  group.add(cone);

  const tweeter = new Mesh(new CylinderGeometry(0.1, 0.13, 0.08, 24), driver);
  tweeter.rotation.x = Math.PI / 2;
  tweeter.position.set(0, 1.02, 0.42);
  group.add(tweeter);

  /* 뚜껑(윗면) 각인 — 스테레오 모드에서만 보인다 */
  const label = new Mesh(
    new PlaneGeometry(0.46, 0.46),
    new MeshBasicMaterial({ map: makeLabelTexture(channel, ink), transparent: true }),
  );
  label.rotation.x = -Math.PI / 2; /* 윗면을 향하고, 글자 위쪽이 -Z(무대 안쪽) */
  label.position.set(0, 1.302, 0);
  label.visible = false;
  group.add(label);

  scene.add(group);

  const tether = makeTether();
  return {
    group,
    cone,
    label,
    ring: makeMarkerRing(color),
    drop: makeDropLine(color),
    tether: tether.line,
    tetherPos: tether.pos,
    color,
    channel,
    panner: null,
    analyser: null,
    amp: new Uint8Array(256),
    level: 0,
    lastWave: 0,
  };
}

const rigA = makeSpeaker('L', C_WARM, '#b3450f');
const rigB = makeSpeaker('R', C_OK, '#155f3f');
const rigs = [rigA, rigB];

/* ── 청취자 ── */
const head = new Group();
const crown = new Group(); /* 귀·코가 달린 부분 — pitch 는 여기에 적용 */
{
  const skin = new MeshStandardMaterial({ color: C_PRIMARY, roughness: 0.5 });

  const skull = new Mesh(new SphereGeometry(0.55, 32, 24), skin);
  skull.castShadow = true;
  crown.add(skull);

  /* -Z 가 정면 */
  const nose = new Mesh(new ConeGeometry(0.13, 0.32, 16), skin);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0, -0.62);
  crown.add(nose);

  const earGeo = new SphereGeometry(0.14, 16, 12);
  const earL = new Mesh(earGeo, skin);
  earL.position.set(-0.55, 0, 0);
  crown.add(earL);
  const earR = new Mesh(earGeo, skin);
  earR.position.set(0.55, 0, 0);
  crown.add(earR);

  crown.position.y = EAR_Y;
  head.add(crown);

  const neck = new Mesh(new CylinderGeometry(0.16, 0.2, 1.0, 16), skin);
  neck.position.y = 0.6;
  neck.castShadow = true;
  head.add(neck);

  const dir = new Mesh(new ConeGeometry(0.16, 0.5, 4), new MeshBasicMaterial({ color: C_PRIMARY }));
  dir.rotation.x = -Math.PI / 2;
  dir.position.set(0, 0.02, -1.15);
  head.add(dir);
}
scene.add(head);
const headRing = makeMarkerRing(C_PRIMARY);
const headDrop = makeDropLine(C_PRIMARY);

/** 머리 상하 시선(라디안). FPV 에서 조작되며 리스너 up/forward 에도 반영된다. */
let pitch = 0;

/* ── 수직 이동 기즈모 (양방향 화살표) ── */
const gizmo = new Group();
{
  const mat = new MeshBasicMaterial({
    color: C_LIFT,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.96,
  });

  const shaft = new Mesh(new CylinderGeometry(0.035, 0.035, 1.15, 12), mat);
  gizmo.add(shaft);

  const up = new Mesh(new ConeGeometry(0.13, 0.3, 16), mat);
  up.position.y = 0.72;
  gizmo.add(up);

  const down = new Mesh(new ConeGeometry(0.13, 0.3, 16), mat);
  down.position.y = -0.72;
  down.rotation.x = Math.PI;
  gizmo.add(down);

  /* 손가락으로도 잡히도록 넉넉한 투명 히트박스 */
  const hit = new Mesh(new CylinderGeometry(0.34, 0.34, 1.9, 8), new MeshBasicMaterial({ visible: false }));
  gizmo.add(hit);
}
gizmo.renderOrder = 999;
gizmo.visible = false;
scene.add(gizmo);

/* ── 파면 링 풀 ── */
interface Wave {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  t: number;
  strength: number;
}
const wavePool: Wave[] = [];
for (let i = 0; i < 20; i++) {
  const mesh = new Mesh(
    new RingGeometry(0.96, 1, 72),
    new MeshBasicMaterial({ color: C_WARM, transparent: true, opacity: 0.5, side: DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  scene.add(mesh);
  wavePool.push({ mesh, t: 1, strength: 0 });
}
let waveIdx = 0;
function spawnWave(rig: Rig, strength: number): void {
  const w = wavePool[waveIdx]!;
  waveIdx = (waveIdx + 1) % wavePool.length;
  w.t = 0;
  w.strength = strength;
  w.mesh.material.color.setHex(rig.color);
  w.mesh.position.set(rig.group.position.x, rig.group.position.y + DRIVER_Y, rig.group.position.z);
  w.mesh.visible = true;
}

/* ═══════════════ 2. WEB AUDIO ═══════════════ */
const REF = 1;
const ROLLOFF = 1;

let ctx: AudioContext | null = null;
let masterGain: GainNode;

let buffer: AudioBuffer | null = null;
let srcNode: AudioBufferSourceNode | null = null;
let fileChain: AudioNode[] = [];
let toneNodes: AudioNode[] | null = null;
let playing = false;
let toneOn = false;

/** 스테레오 모드 — 음원의 L/R 채널을 두 스피커로 분리 송출. */
let stereo = false;

function ensureCtx(): AudioContext {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new Ctor();

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.9;
  masterGain.connect(ctx.destination);

  for (const rig of rigs) {
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = REF;
    panner.rolloffFactor = ROLLOFF;
    panner.maxDistance = 60;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;

    panner.connect(analyser).connect(masterGain);
    rig.panner = panner;
    rig.analyser = analyser;
  }
  return ctx;
}

function setParam(p: AudioParam, v: number): void {
  if (!ctx) return;
  if (p.setTargetAtTime) p.setTargetAtTime(v, ctx.currentTime, 0.02);
  else p.value = v;
}

/** 머리의 yaw/pitch 로부터 리스너 forward·up 벡터를 만든다. */
function headBasis(): { fx: number; fy: number; fz: number; ux: number; uy: number; uz: number } {
  const ry = head.rotation.y;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    fx: -Math.sin(ry) * cp,
    fy: sp,
    fz: -Math.cos(ry) * cp,
    ux: Math.sin(ry) * sp,
    uy: cp,
    uz: Math.cos(ry) * sp,
  };
}

/** 씬의 좌표를 오디오 그래프(패너 · 리스너)에 반영한다. */
function syncAudioSpace(): void {
  if (!ctx) return;

  for (const rig of rigs) {
    if (!rig.panner) continue;
    setParam(rig.panner.positionX, rig.group.position.x);
    setParam(rig.panner.positionY, rig.group.position.y + DRIVER_Y);
    setParam(rig.panner.positionZ, rig.group.position.z);
  }

  const listener = ctx.listener;
  const hp = head.position;
  const b = headBasis();

  if (listener.positionX) {
    setParam(listener.positionX, hp.x);
    setParam(listener.positionY, hp.y + EAR_Y);
    setParam(listener.positionZ, hp.z);
    setParam(listener.forwardX, b.fx);
    setParam(listener.forwardY, b.fy);
    setParam(listener.forwardZ, b.fz);
    setParam(listener.upX, b.ux);
    setParam(listener.upY, b.uy);
    setParam(listener.upZ, b.uz);
  } else {
    listener.setPosition(hp.x, hp.y + EAR_Y, hp.z);
    listener.setOrientation(b.fx, b.fy, b.fz, b.ux, b.uy, b.uz);
  }
}

/* ── 신호 라우팅 ── */

/**
 * 소스를 현재 모드에 맞는 패너로 연결한다.
 * 스테레오에서는 ChannelSplitter 로 좌/우를 갈라 각 스피커에 보낸다.
 * (모노 음원은 스플리터 입력에서 2채널로 업믹스되어 양쪽에 동일하게 실린다.)
 */
function routeSource(node: AudioNode): AudioNode[] {
  if (stereo && rigB.panner) {
    const splitter = ctx!.createChannelSplitter(2);
    node.connect(splitter);
    splitter.connect(rigA.panner!, 0);
    splitter.connect(rigB.panner!, 1);
    return [splitter];
  }
  node.connect(rigA.panner!);
  return [];
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
    const ch = buffer.numberOfChannels;
    toast(`${f.name} 로드 완료 (${ch === 1 ? '모노' : `${ch}채널`})`, 'success');
  } catch {
    fileLabel.textContent = '디코딩 실패 — 다른 파일을 선택하세요';
    fileLabel.classList.remove('is-loaded');
    buffer = null;
    playBtn.disabled = true;
    toast('디코딩에 실패했습니다.', 'error');
  }
});

function startFile(): void {
  if (!ctx || !buffer) return;
  srcNode = ctx.createBufferSource();
  srcNode.buffer = buffer;
  srcNode.loop = true;
  fileChain = routeSource(srcNode);
  syncAudioSpace();
  srcNode.start();

  playing = true;
  playBtn.innerHTML = '<i class="bi bi-stop-fill"></i> 정지';
}

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
  for (const n of fileChain) n.disconnect();
  fileChain = [];
  playing = false;
  playBtn.innerHTML = '<i class="bi bi-play-fill"></i> 재생';
}

/** 테스트 신호: 2.5Hz 펄스 비프. 스테레오에서는 좌/우가 번갈아 울린다. */
function startTone(): void {
  const audio = ctx!;
  const nodes: AudioNode[] = [];

  const lfo = audio.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 2.5;
  nodes.push(lfo);

  const branch = (freq: number, dest: PannerNode, invert: boolean): void => {
    const osc = audio.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const env = audio.createGain();
    env.gain.value = 0.4; /* LFO ±0.4 → 0~0.8 펄스 */

    const depth = audio.createGain();
    depth.gain.value = invert ? -0.4 : 0.4;

    lfo.connect(depth).connect(env.gain);
    osc.connect(env).connect(dest);
    osc.start();
    nodes.push(osc, env, depth);
  };

  if (stereo && rigB.panner) {
    branch(523.25, rigA.panner!, false); /* L — C5 */
    branch(659.25, rigB.panner!, true); /* R — E5, 반대 위상이라 번갈아 울린다 */
  } else {
    branch(523.25, rigA.panner!, false);
  }

  syncAudioSpace();
  lfo.start();

  toneNodes = nodes;
  toneOn = true;
  toneBtn.classList.add('btn-stop');
  toneBtn.innerHTML = '<i class="bi bi-stop-fill"></i> 신호 정지';
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

/** 라우팅이 바뀌었을 때 재생 중인 신호를 새 그래프로 다시 세운다. */
function restartSignal(): void {
  if (playing) {
    stopFile();
    startFile();
  } else if (toneOn) {
    stopTone();
    startTone();
  }
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
  startFile();
});

toneBtn.addEventListener('click', async () => {
  const audio = ensureCtx();
  await audio.resume();
  if (toneOn) {
    stopTone();
    return;
  }
  stopFile();
  startTone();
});

/* ═══════════════ 3. 배치 · 모드 ═══════════════ */
const rotSlider = el<HTMLInputElement>('headrot');
const rotVal = el<HTMLSpanElement>('rotval');

/** 머리 yaw 를 도(°) 단위로 지정하고 슬라이더까지 맞춘다. */
function setHeadYawDeg(deg: number): void {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  head.rotation.y = (-d * Math.PI) / 180;
  rotSlider.value = String(Math.round(d));
  rotVal.textContent = `${Math.round(d)}°`;
}

function syncYawUI(): void {
  setHeadYawDeg((-head.rotation.y * 180) / Math.PI);
}

rotSlider.addEventListener('input', () => setHeadYawDeg(Number(rotSlider.value)));

/* ── 홈 배치 ── */
const HOME = {
  mono: { a: new Vector3(-3.4, 0, -1.2), b: new Vector3(3.4, 0, -1.2), head: new Vector3(2.6, 0, 1.6) },
  stereo: { a: new Vector3(-2.6, 0, -3.2), b: new Vector3(2.6, 0, -3.2), head: new Vector3(0, 0, 1.8) },
};

function applyHome(): void {
  const home = stereo ? HOME.stereo : HOME.mono;
  rigA.group.position.copy(home.a);
  rigB.group.position.copy(home.b);
  head.position.copy(home.head);
  pitch = 0;
  crown.rotation.x = 0;
  setHeadYawDeg(0);
  select(null);
  syncAudioSpace();
}

/* ── 스테레오 ── */
const stereoBtn = el<HTMLButtonElement>('stereo');

function setStereo(on: boolean): void {
  stereo = on;
  rigB.group.visible = on;
  rigB.ring.visible = on;
  rigB.drop.visible = on;
  rigB.tether.visible = on;
  rigA.label.visible = on;
  rigB.label.visible = on;
  if (selected === rigB.group) select(null);

  stereoBtn.classList.toggle('btn-fill', on);
  stereoBtn.classList.toggle('btn-primary', !on);
  stereoBtn.setAttribute('aria-pressed', String(on));

  applyHome();
  restartSignal();
  updateHudSource();
}

stereoBtn.addEventListener('click', () => {
  ensureCtx();
  setStereo(!stereo);
  toast(stereo ? '스테레오 모드 — 좌/우 채널을 두 스피커로 분리했습니다.' : '모노 모드로 돌아갔습니다.', 'info');
});

/* ── 배치 초기화 ── */
el<HTMLButtonElement>('reset').addEventListener('click', () => {
  applyHome();
  orbit.theta = ORBIT_HOME.theta;
  orbit.phi = ORBIT_HOME.phi;
  orbit.r = ORBIT_HOME.r;
  camera.fov = FOV;
  camera.updateProjectionMatrix();
  applyCamera();
  toast('배치를 초기화했습니다.', 'success');
});

/* ── FPV ── */
const fpvBtn = el<HTMLButtonElement>('fpv');
const crosshair = el<HTMLDivElement>('crosshair');
let fpv = false;

function setFpv(on: boolean): void {
  fpv = on;
  head.visible = !on;
  headRing.visible = !on;
  headDrop.visible = !on;
  crosshair.style.display = on ? 'block' : 'none';
  if (on) select(null);

  fpvBtn.classList.toggle('btn-fill', on);
  fpvBtn.classList.toggle('btn-primary', !on);
  fpvBtn.setAttribute('aria-pressed', String(on));

  if (!on) {
    camera.fov = FOV;
    camera.updateProjectionMatrix();
  }
  container.classList.toggle('is-fpv', on);
  applyCamera();
}

fpvBtn.addEventListener('click', () => {
  setFpv(!fpv);
  toast(fpv ? 'FPV — 드래그로 둘러보고 WASD 로 이동합니다.' : '오빗 뷰로 돌아갔습니다.', 'info');
});

/* ── 카메라 ── */
function applyCamera(): void {
  if (fpv) {
    camera.position.set(head.position.x, head.position.y + EAR_Y, head.position.z);
    camera.rotation.set(pitch, head.rotation.y, 0);
    return;
  }
  const { theta, phi, r, target } = orbit;
  camera.position.set(
    target.x + r * Math.sin(phi) * Math.sin(theta),
    target.y + r * Math.cos(phi),
    target.z + r * Math.sin(phi) * Math.cos(theta),
  );
  camera.lookAt(target);
}

/* ═══════════════ 4. 선택 · 인터랙션 ═══════════════ */
const ray = new Raycaster();
const ndc = new Vector2();
const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
const liftPlane = new Plane();
const hitPoint = new Vector3();
const tmpDir = new Vector3();
const tmpRight = new Vector3();
const tmpProj = new Vector3();

const liftBadge = el<HTMLDivElement>('lift-badge');

let selected: Group | null = null;

/** 선택 상태를 바꾼다. null 이면 해제. */
function select(g: Group | null): void {
  selected = g;
  gizmo.visible = g !== null;
  liftBadge.style.display = g !== null ? 'block' : 'none';
  updateHudSource();
}

type PointerMode = 'none' | 'move' | 'orbit' | 'lift' | 'look';
let pMode: PointerMode = 'none';
let pressTarget: Group | null = null;
let liftOffset = 0;
let movedFar = false;
let downX = 0;
let downY = 0;
let lastX = 0;
let lastY = 0;
const DRAG_SLOP = 5; /* px — 이보다 적게 움직이면 '클릭'으로 본다 */

function toNDC(e: PointerEvent): void {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

/** 현재 픽 대상이 되는(=보이는) 오브젝트 목록. */
function pickList(): { mesh: Object3D; group: Group }[] {
  const list: { mesh: Object3D; group: Group }[] = [];
  for (const rig of rigs) {
    if (!rig.group.visible) continue;
    for (const m of rig.group.children) list.push({ mesh: m, group: rig.group });
  }
  if (head.visible) {
    for (const m of head.children) list.push({ mesh: m, group: head });
    for (const m of crown.children) list.push({ mesh: m, group: head });
  }
  return list;
}

function pickObject(e: PointerEvent): Group | null {
  toNDC(e);
  ray.setFromCamera(ndc, camera);
  const entries = pickList();
  const hits = ray.intersectObjects(
    entries.map((x) => x.mesh),
    false,
  );
  const first = hits[0];
  if (!first) return null;
  return entries.find((x) => x.mesh === first.object)?.group ?? null;
}

function pickGizmo(e: PointerEvent): boolean {
  if (!gizmo.visible) return false;
  toNDC(e);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(gizmo.children, false).length > 0;
}

/** 카메라를 마주 보는 수직 평면 — 리프트 드래그의 기준면. */
function faceCameraPlane(at: Vector3): void {
  camera.getWorldDirection(tmpDir);
  tmpDir.y = 0;
  if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, 1);
  tmpDir.normalize();
  liftPlane.setFromNormalAndCoplanarPoint(tmpDir, at);
}

container.addEventListener('pointerdown', (e) => {
  container.setPointerCapture(e.pointerId);
  downX = e.clientX;
  downY = e.clientY;
  lastX = e.clientX;
  lastY = e.clientY;
  movedFar = false;
  pressTarget = null;

  if (fpv) {
    pMode = 'look';
    container.classList.add('is-dragging');
    return;
  }

  if (selected && pickGizmo(e)) {
    pMode = 'lift';
    faceCameraPlane(selected.position);
    liftOffset = ray.ray.intersectPlane(liftPlane, hitPoint) ? selected.position.y - hitPoint.y : 0;
    container.classList.add('is-dragging');
    return;
  }

  const obj = pickObject(e);
  if (obj) {
    pMode = 'move';
    pressTarget = obj;
  } else {
    pMode = 'orbit';
  }
  container.classList.add('is-dragging');
});

container.addEventListener('pointermove', (e) => {
  if (pMode === 'none') {
    if (fpv) return;
    container.style.cursor = (gizmo.visible && pickGizmo(e)) ? 'ns-resize' : pickObject(e) ? 'move' : 'grab';
    return;
  }

  if (Math.abs(e.clientX - downX) > DRAG_SLOP || Math.abs(e.clientY - downY) > DRAG_SLOP) movedFar = true;

  if (pMode === 'look') {
    setHeadYawDeg((-head.rotation.y * 180) / Math.PI + (e.clientX - lastX) * 0.22);
    pitch = MathUtils.clamp(pitch - (e.clientY - lastY) * 0.004, -1.15, 1.15);
    crown.rotation.x = pitch;
    lastX = e.clientX;
    lastY = e.clientY;
    applyCamera();
    return;
  }

  if (pMode === 'lift' && selected) {
    toNDC(e);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(liftPlane, hitPoint)) {
      selected.position.y = MathUtils.clamp(hitPoint.y + liftOffset, 0, MAX_LIFT);
    }
    return;
  }

  if (pMode === 'move' && pressTarget && movedFar) {
    toNDC(e);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(groundPlane, hitPoint)) {
      pressTarget.position.x = MathUtils.clamp(hitPoint.x, -BOUND, BOUND);
      pressTarget.position.z = MathUtils.clamp(hitPoint.z, -BOUND, BOUND);
    }
    return;
  }

  if (pMode === 'orbit') {
    orbit.theta -= (e.clientX - lastX) * 0.005;
    orbit.phi = MathUtils.clamp(orbit.phi - (e.clientY - lastY) * 0.004, 0.18, Math.PI * 0.48);
    lastX = e.clientX;
    lastY = e.clientY;
    applyCamera();
  }
});

function endPointer(): void {
  /* 움직임이 거의 없었다면 '클릭' — 선택/해제로 해석한다 */
  if (!movedFar && !fpv) {
    if (pMode === 'move' && pressTarget) select(pressTarget);
    else if (pMode === 'orbit') select(null);
  }
  pMode = 'none';
  pressTarget = null;
  container.classList.remove('is-dragging');
}
container.addEventListener('pointerup', endPointer);
container.addEventListener('pointercancel', endPointer);

container.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (fpv) {
      camera.fov = MathUtils.clamp(camera.fov + e.deltaY * 0.03, 30, 100);
      camera.updateProjectionMatrix();
      return;
    }
    orbit.r = MathUtils.clamp(orbit.r + e.deltaY * 0.012, 6, 34);
    applyCamera();
  },
  { passive: false },
);

/* ── FPV 키보드 이동 ── */
const held = new Set<string>();
const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function typingInField(): boolean {
  const a = document.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (fpv) setFpv(false);
    else select(null);
    return;
  }
  if (!fpv || typingInField() || !MOVE_KEYS.has(e.code)) return;
  held.add(e.code);
  e.preventDefault();
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function stepFpv(dt: number): void {
  if (!fpv || held.size === 0) return;
  const ry = head.rotation.y;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);
  const rx = Math.cos(ry);
  const rz = -Math.sin(ry);

  let f = 0;
  let s = 0;
  let v = 0;
  if (held.has('KeyW') || held.has('ArrowUp')) f += 1;
  if (held.has('KeyS') || held.has('ArrowDown')) f -= 1;
  if (held.has('KeyD') || held.has('ArrowRight')) s += 1;
  if (held.has('KeyA') || held.has('ArrowLeft')) s -= 1;
  if (held.has('KeyE')) v += 1;
  if (held.has('KeyQ')) v -= 1;
  if (f === 0 && s === 0 && v === 0) return;

  const speed = 4 * dt;
  head.position.x = MathUtils.clamp(head.position.x + (fx * f + rx * s) * speed, -BOUND, BOUND);
  head.position.z = MathUtils.clamp(head.position.z + (fz * f + rz * s) * speed, -BOUND, BOUND);
  head.position.y = MathUtils.clamp(head.position.y + v * speed, 0, MAX_LIFT);
}

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

/* ═══════════════ 5. HUD 계산 ═══════════════ */
const vDist = el<HTMLSpanElement>('v-dist');
const vGain = el<HTMLSpanElement>('v-gain');
const vAz = el<HTMLSpanElement>('v-az');
const vEl = el<HTMLSpanElement>('v-el');
const hudSrc = el<HTMLSpanElement>('hud-src');

/** HUD 가 가리키는 스피커 — 스피커를 선택했다면 그것, 아니면 기본(L). */
function hudRig(): Rig {
  if (selected === rigB.group && rigB.group.visible) return rigB;
  return rigA;
}

function updateHudSource(): void {
  const rig = hudRig();
  hudSrc.textContent = stereo ? ` · ${rig.channel}` : '';
  hudSrc.style.color = rig === rigB ? 'var(--via-ok)' : 'var(--via-warm-ink)';
}

function updateHUD(): void {
  const rig = hudRig();
  const dx = rig.group.position.x - head.position.x;
  const dy = rig.group.position.y + DRIVER_Y - (head.position.y + EAR_Y);
  const dz = rig.group.position.z - head.position.z;
  const flat = Math.hypot(dx, dz);
  const d = Math.hypot(flat, dy);
  vDist.textContent = d.toFixed(2);

  /* inverse distance model 과 동일한 감쇠식 */
  const g = d <= REF ? 1 : REF / (REF + ROLLOFF * (d - REF));
  const db = 20 * Math.log10(g);
  vGain.textContent = (db <= -0.05 ? '−' : '') + Math.abs(db).toFixed(1);

  /* 머리 정면 기준 방위각: +우 / −좌.
     정면 f=(fx,0,fz) 일 때 오른쪽 벡터는 cross(f, up) = (-fz, 0, fx) 이므로
     가로 성분은 dot(right, d) = fx·dz − fz·dx 다. */
  const ry = head.rotation.y;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);
  const az = (Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz) * 180) / Math.PI;
  vAz.textContent = (az >= 0 ? 'R ' : 'L ') + Math.abs(az).toFixed(0);
  vAz.style.color = az >= 0 ? 'var(--via-warm-ink)' : 'var(--via-primary)';

  /* 귀 평면 기준 고도각: +위 / −아래 */
  const elev = (Math.atan2(dy, flat) * 180) / Math.PI;
  vEl.textContent = (elev >= 0 ? '+' : '−') + Math.abs(elev).toFixed(0);
  vEl.style.color = Math.abs(elev) < 1 ? 'var(--via-heading)' : 'var(--via-amber-ink)';
}

/* ═══════════════ 6. 렌더 루프 ═══════════════ */
const clock = new Clock();

/** 떠 있는 오브젝트의 바닥 마커와 수직 점선을 갱신한다. */
function updateGroundCues(p: Vector3, ring: Mesh, drop: Line, baseVisible: boolean): void {
  ring.position.set(p.x, 0.012, p.z);
  const lifted = p.y > 0.02;
  drop.visible = baseVisible && lifted;
  if (!drop.visible) return;
  const pos = drop.geometry.attributes.position as BufferAttribute;
  pos.setXYZ(0, p.x, 0.02, p.z);
  pos.setXYZ(1, p.x, p.y, p.z);
  pos.needsUpdate = true;
  drop.computeLineDistances();
}

function updateGizmo(): void {
  if (!selected) return;
  const p = selected.position;
  const s = MathUtils.clamp(camera.position.distanceTo(p) * 0.075, 0.65, 2.4);

  camera.getWorldDirection(tmpDir);
  tmpDir.y = 0;
  if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, 1);
  tmpDir.normalize();
  tmpRight.set(-tmpDir.z, 0, tmpDir.x); /* cross(forward, up) */

  gizmo.position.set(p.x + tmpRight.x * 0.95 * s, p.y + 1.05, p.z + tmpRight.z * 0.95 * s);
  gizmo.scale.setScalar(s);

  /* 높이 배지를 화살표 위쪽에 띄운다 */
  tmpProj.copy(gizmo.position);
  tmpProj.y += 0.95 * s;
  tmpProj.project(camera);
  if (tmpProj.z > 1) {
    liftBadge.style.display = 'none';
    return;
  }
  liftBadge.style.display = 'block';
  liftBadge.style.left = `${(tmpProj.x * 0.5 + 0.5) * container.clientWidth}px`;
  liftBadge.style.top = `${(-tmpProj.y * 0.5 + 0.5) * container.clientHeight}px`;
  liftBadge.textContent = `${p.y.toFixed(2)} m`;
}

function animate(): void {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  stepFpv(dt);

  /* 오디오 진폭 (스피커별) */
  const live = ctx !== null && (playing || toneOn);
  if (live) syncAudioSpace();

  for (const rig of rigs) {
    let level = 0;
    if (live && rig.analyser && rig.group.visible) {
      rig.analyser.getByteTimeDomainData(rig.amp);
      let sum = 0;
      for (let i = 0; i < rig.amp.length; i++) {
        const v = (rig.amp[i]! - 128) / 128;
        sum += v * v;
      }
      level = Math.sqrt(sum / rig.amp.length);
    }
    rig.level = level;

    /* 콘 펄스 */
    const s = 1 + level * 1.6;
    rig.cone.scale.set(s, 1, s);

    /* 파면 링 */
    if (level > 0.03 && now - rig.lastWave > 240) {
      spawnWave(rig, level);
      rig.lastWave = now;
    }

    /* 계측선 */
    rig.tether.visible = rig.group.visible;
    if (rig.tether.visible) {
      rig.tetherPos.setXYZ(0, rig.group.position.x, rig.group.position.y + DRIVER_Y, rig.group.position.z);
      rig.tetherPos.setXYZ(1, head.position.x, head.position.y + EAR_Y, head.position.z);
      rig.tetherPos.needsUpdate = true;
      rig.tether.computeLineDistances();
    }

    rig.ring.visible = rig.group.visible;
    updateGroundCues(rig.group.position, rig.ring, rig.drop, rig.group.visible);
  }

  updateGroundCues(head.position, headRing, headDrop, head.visible);
  headRing.visible = head.visible;

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

  if (fpv) applyCamera();
  updateGizmo();
  updateHUD();
  renderer.render(scene, camera);
}

/* ═══════════════ 7. 초기화 ═══════════════ */
setStereo(false);
setFpv(false);
syncYawUI();
applyCamera();
resize();
animate();
