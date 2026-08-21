/**
 * R2R 래더 DAC 시뮬레이터 — 비트 토글 · 사인파 생성 · 오실로스코프(계단 현상).
 */
import { all, clamp, el, toast } from './ui';

const C_PRIMARY = '#3457cf';
const C_GRID = 'rgba(69, 73, 79, 0.10)';

/* ── 상태 ── */
let currentBits = 4;
let maxVal = 15;
let currentValue = 0;

let isSineWaveActive = false;
let sineFrameId = 0;
let lastTime = 0;
let currentPhase = 0;

let oscSpeed = 1.0;
let oscAccumulator = 0;

/* ── DOM ── */
const resistorContainer = el<HTMLDivElement>('resistor-container');
const numInput = el<HTMLInputElement>('num-input');
const sliderInput = el<HTMLInputElement>('slider-input');
const sineBtn = el<HTMLButtonElement>('sine-btn');
const speedInput = el<HTMLInputElement>('speed-input');
const speedLabel = el<HTMLSpanElement>('speed-label');
const oscSpeedInput = el<HTMLInputElement>('osc-speed-input');
const oscSpeedLabel = el<HTMLSpanElement>('osc-speed-label');
const modeRadios = all<HTMLInputElement>('input[name="bitmode"]');

const canvas = el<HTMLCanvasElement>('oscilloscope');
const ctx = canvas.getContext('2d')!;

/* 오실로스코프 히스토리(가로 픽셀 1칸 = 샘플 1개) */
let historyData: number[] = [];
let viewW = 0;
let viewH = 0;

function fitCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;

  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cols = Math.max(1, Math.round(w));
  if (cols !== historyData.length) {
    const next = new Array<number>(cols).fill(0);
    /* 기존 파형을 오른쪽 정렬로 유지 */
    const keep = Math.min(cols, historyData.length);
    for (let i = 0; i < keep; i++) next[cols - keep + i] = historyData[historyData.length - keep + i]!;
    historyData = next;
  }
  viewW = w;
  viewH = h;
}

/* ── 속도 슬라이더 ── */
speedInput.addEventListener('input', () => {
  speedLabel.textContent = `${parseFloat(speedInput.value).toFixed(1)} x`;
});
oscSpeedInput.addEventListener('input', () => {
  oscSpeed = parseFloat(oscSpeedInput.value);
  oscSpeedLabel.textContent = `${oscSpeed.toFixed(1)} x`;
});

/* ── 1. 모드 변경 ── */
function setMode(bits: number): void {
  if (isSineWaveActive) toggleSineWave();

  currentBits = bits;
  maxVal = Math.pow(2, bits) - 1;

  el<HTMLHeadingElement>('mode-title').textContent = `${bits}비트 R2R 래더 DAC 시뮬레이터`;
  el<HTMLHeadingElement>('card-header-text').textContent = `${bits}개의 켜고 끌 수 있는 저항기`;
  el<HTMLLabelElement>('num-label').textContent = `출력 값 (0 ~ ${maxVal})`;

  numInput.max = String(maxVal);
  sliderInput.max = String(maxVal);

  initResistors();
  updateUI(0);
  historyData.fill(0);

  toast(`${bits}비트 모드로 변경되었습니다.`, 'info', 1600);
}

for (const radio of modeRadios) {
  radio.addEventListener('change', () => {
    if (radio.checked) setMode(Number(radio.value));
  });
}

/* ── 2. 저항기 UI 생성 ── */
function initResistors(): void {
  resistorContainer.replaceChildren();

  for (let i = currentBits - 1; i >= 0; i--) {
    const box = document.createElement('div');
    box.id = `res-${i}`;
    box.className = 'via-resistor';
    box.setAttribute('role', 'switch');
    box.setAttribute('aria-checked', 'false');
    box.setAttribute('aria-label', `Bit ${i}`);
    box.tabIndex = 0;

    const bit = document.createElement('span');
    bit.className = 'via-resistor__bit';
    bit.textContent = `Bit ${i}`;

    const state = document.createElement('span');
    state.className = 'via-resistor__state';
    state.id = `state-${i}`;
    state.textContent = 'OFF';

    const val = document.createElement('span');
    val.className = 'via-resistor__val';
    val.textContent = String(Math.pow(2, i));

    box.append(bit, state, val);
    box.addEventListener('click', () => toggleBit(i));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleBit(i);
      }
    });

    resistorContainer.appendChild(box);
  }
}

/* ── 3. 값 동기화 ── */
type Source = 'input' | 'slider' | 'click' | 'animation' | '';

function updateUI(newVal: number, source: Source = ''): void {
  currentValue = clamp(Math.floor(newVal), 0, maxVal);

  if (source !== 'input') numInput.value = String(currentValue);
  if (source !== 'slider') sliderInput.value = String(currentValue);

  for (let i = currentBits - 1; i >= 0; i--) {
    const on = (currentValue >> i) & 1;
    const box = document.getElementById(`res-${i}`);
    const state = document.getElementById(`state-${i}`);
    if (!box || !state) continue;
    box.classList.toggle('is-on', on === 1);
    box.setAttribute('aria-checked', on === 1 ? 'true' : 'false');
    state.textContent = on === 1 ? 'ON' : 'OFF';
  }
}

function toggleBit(bitIndex: number): void {
  if (isSineWaveActive) return;
  const bitValue = Math.pow(2, bitIndex);
  const on = (currentValue >> bitIndex) & 1;
  updateUI(on === 1 ? currentValue - bitValue : currentValue + bitValue, 'click');
}

numInput.addEventListener('change', () => {
  const val = parseInt(numInput.value, 10);
  if (Number.isNaN(val) || val < 0 || val > maxVal) numInput.value = String(currentValue);
  else updateUI(val, 'input');
});

sliderInput.addEventListener('input', () => updateUI(parseInt(sliderInput.value, 10), 'slider'));

/* ── 4. 사인파 ── */
function toggleSineWave(): void {
  isSineWaveActive = !isSineWaveActive;

  if (isSineWaveActive) {
    sineBtn.classList.remove('btn-fill');
    sineBtn.classList.add('btn-stop');
    sineBtn.innerHTML = '<i class="bi bi-stop-circle"></i> 사인파 중지';
    numInput.disabled = true;
    sliderInput.disabled = true;
    modeRadios.forEach((r) => (r.disabled = true));
    all<HTMLElement>('.via-resistor').forEach((b) => b.classList.add('is-locked'));

    lastTime = performance.now();
    currentPhase = 0;
    animateSineWave();
  } else {
    sineBtn.classList.remove('btn-stop');
    sineBtn.classList.add('btn-fill');
    sineBtn.innerHTML = '<i class="bi bi-activity"></i> 사인파 보기';
    numInput.disabled = false;
    sliderInput.disabled = false;
    modeRadios.forEach((r) => (r.disabled = false));
    all<HTMLElement>('.via-resistor').forEach((b) => b.classList.remove('is-locked'));

    cancelAnimationFrame(sineFrameId);
  }
}
sineBtn.addEventListener('click', toggleSineWave);

function animateSineWave(): void {
  if (!isSineWaveActive) return;

  const now = performance.now();
  const deltaTime = now - lastTime;
  lastTime = now;

  const baseSpeed = (Math.PI * 2) / 5000;
  currentPhase += baseSpeed * parseFloat(speedInput.value) * deltaTime;
  if (currentPhase > Math.PI * 2) currentPhase -= Math.PI * 2;

  const sineValue = Math.round(((Math.sin(currentPhase - Math.PI / 2) + 1) / 2) * maxVal);
  updateUI(sineValue, 'animation');

  sineFrameId = requestAnimationFrame(animateSineWave);
}

/* ── 5. 오실로스코프 ── */
function drawOscilloscope(): void {
  fitCanvas();

  const normalized = currentValue / maxVal;
  oscAccumulator += oscSpeed;
  while (oscAccumulator >= 1) {
    historyData.push(normalized);
    if (historyData.length > viewW) historyData.shift();
    oscAccumulator -= 1;
  }

  ctx.clearRect(0, 0, viewW, viewH);

  /* 그리드 */
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const y = (viewH * i) / 4;
    ctx.moveTo(0, y);
    ctx.lineTo(viewW, y);
  }
  ctx.stroke();

  /* 파형 */
  ctx.strokeStyle = C_PRIMARY;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const pad = 8;
  for (let i = 0; i < historyData.length; i++) {
    const y = viewH - pad - historyData[i]! * (viewH - pad * 2);
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();

  requestAnimationFrame(drawOscilloscope);
}

/* ── 초기화 ── */
fitCanvas();
initResistors();
updateUI(0);
drawOscilloscope();
