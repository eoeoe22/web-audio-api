/**
 * 주파수 응답 측정 — OscillatorNode(톤/스윕) + AnalyserNode(마이크 FFT).
 * RTA(실시간 스펙트럼)와 스윕 측정 결과 곡선을 캔버스에 그린다.
 */
import { all, clamp, el, toast } from './ui';

/* ── 팔레트 ── */
const C_PRIMARY = '#3457cf';
const C_WARM = '#d1541c';
const C_AMBER = '#b08300';
const C_GRID = 'rgba(69, 73, 79, 0.12)';
const C_LABEL = 'rgba(69, 73, 79, 0.65)';
const C_SEG_OFF = 'rgba(69, 73, 79, 0.07)';

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_LOG = Math.log10(MIN_FREQ);
const MAX_LOG = Math.log10(MAX_FREQ);
const LOG_RANGE = MAX_LOG - MIN_LOG;
const FFT_SIZE = 4096;

/* ── 상태 ── */
let audioCtx: AudioContext | null = null;
let toneOsc: OscillatorNode | null = null;
let toneGain: GainNode | null = null;
let isTonePlaying = false;

let micStream: MediaStream | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let dataArray = new Float32Array(0);
let peakHoldData = new Float32Array(0);
let isMicActive = false;
let animationId = 0;
let isMeasuring = false;

/* ── DOM ── */
const inputFreq = el<HTMLInputElement>('inputFreq');
const sliderFreq = el<HTMLInputElement>('sliderFreq');
const btnTone = el<HTMLButtonElement>('btnTone');
const btnMic = el<HTMLButtonElement>('btnMic');
const micStatus = el<HTMLSpanElement>('micStatus');
const levelMeter = el<HTMLDivElement>('levelMeter');
const levelText = el<HTMLSpanElement>('levelText');
const rtaCanvas = el<HTMLCanvasElement>('rtaCanvas');
const resultCanvas = el<HTMLCanvasElement>('resultCanvas');
const btnMeasure = el<HTMLButtonElement>('btnMeasure');
const btnMeasureLabel = el<HTMLSpanElement>('btnMeasureLabel');
const measureStatus = el<HTMLSpanElement>('measureStatus');
const measureProgressContainer = el<HTMLDivElement>('measureProgressContainer');
const measureProgressBar = el<HTMLDivElement>('measureProgressBar');
const chkSmooth = el<HTMLInputElement>('chkSmooth');
const inputDuration = el<HTMLInputElement>('inputDuration');
const rtaRadios = all<HTMLInputElement>('input[name="rtaMode"]');

const rtaCtx = rtaCanvas.getContext('2d')!;
const resultCtx = resultCanvas.getContext('2d')!;

/* ── 캔버스 해상도 맞추기(DPR 대응) ── */
function fitCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): { w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

/* ── 로그 스케일 변환 ── */
const freqToSlider = (freq: number): number => ((Math.log10(freq) - MIN_LOG) / LOG_RANGE) * 1000;
const sliderToFreq = (value: number): number => Math.pow(10, MIN_LOG + (value / 1000) * LOG_RANGE);

sliderFreq.value = String(freqToSlider(1000));

function initAudio(): AudioContext {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

/* ═══════════ 1. 톤 제너레이터 ═══════════ */
function setFrequency(value: number, updateSlider = true): void {
  const freq = Math.round(clamp(Number(value) || MIN_FREQ, MIN_FREQ, MAX_FREQ));
  inputFreq.value = String(freq);
  if (updateSlider) sliderFreq.value = String(freqToSlider(freq));
  if (isTonePlaying && toneOsc && audioCtx) {
    toneOsc.frequency.exponentialRampToValueAtTime(freq, audioCtx.currentTime + 0.05);
  }
}

sliderFreq.addEventListener('input', () => setFrequency(sliderToFreq(Number(sliderFreq.value)), false));
inputFreq.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    setFrequency(Number(inputFreq.value));
    inputFreq.blur();
  }
});
inputFreq.addEventListener('blur', () => setFrequency(Number(inputFreq.value)));

btnTone.addEventListener('click', () => {
  const ctx = initAudio();
  if (!isTonePlaying) {
    toneOsc = ctx.createOscillator();
    toneGain = ctx.createGain();
    toneOsc.type = 'sine';
    toneOsc.frequency.setValueAtTime(Number(inputFreq.value), ctx.currentTime);
    toneGain.gain.setValueAtTime(0.1, ctx.currentTime);
    toneOsc.connect(toneGain).connect(ctx.destination);
    toneOsc.start();

    isTonePlaying = true;
    btnTone.classList.remove('btn-fill');
    btnTone.classList.add('btn-stop');
    btnTone.innerHTML = '<i class="bi bi-stop-fill"></i> 재생 중지';
  } else {
    toneOsc?.stop();
    toneOsc?.disconnect();
    toneGain?.disconnect();
    toneOsc = null;
    toneGain = null;

    isTonePlaying = false;
    btnTone.classList.remove('btn-stop');
    btnTone.classList.add('btn-fill');
    btnTone.innerHTML = '<i class="bi bi-play-fill"></i> 재생 시작';
  }
});

/* ═══════════ 2. 마이크 ═══════════ */
btnMic.addEventListener('click', async () => {
  const ctx = initAudio();

  if (!isMicActive) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      toast('마이크 접근 권한이 필요합니다.', 'error', 3000);
      return;
    }

    micSource = ctx.createMediaStreamSource(micStream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.6;
    micSource.connect(analyser);

    dataArray = new Float32Array(analyser.frequencyBinCount);
    peakHoldData = new Float32Array(analyser.frequencyBinCount).fill(-140);

    isMicActive = true;
    btnMic.classList.add('btn-stop');
    btnMic.innerHTML = '<i class="bi bi-mic-mute-fill"></i> 마이크 끄기';
    micStatus.innerHTML = '<i class="bi bi-record-circle-fill"></i> 작동 중 (원음 분석)';
    micStatus.style.color = 'var(--via-ok)';
    drawAnalysis();
  } else {
    cancelAnimationFrame(animationId);
    micStream?.getTracks().forEach((t) => t.stop());
    micSource?.disconnect();
    analyser?.disconnect();
    micStream = null;
    micSource = null;
    analyser = null;

    isMicActive = false;
    btnMic.classList.remove('btn-stop');
    btnMic.innerHTML = '<i class="bi bi-mic-fill"></i> 마이크 켜기';
    micStatus.innerHTML = '<i class="bi bi-circle"></i> 대기 중';
    micStatus.style.color = '';
    levelMeter.style.setProperty('--level', '0%');
    levelText.textContent = '−∞ dB';
    const { w, h } = fitCanvas(rtaCanvas, rtaCtx);
    rtaCtx.clearRect(0, 0, w, h);
  }
});

function drawAnalysis(): void {
  if (!isMicActive || !analyser) return;
  animationId = requestAnimationFrame(drawAnalysis);

  analyser.getFloatFrequencyData(dataArray);

  /* RMS 레벨 */
  let sum = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i]!;
    if (v > -100) sum += Math.pow(10, v / 10);
  }
  const rmsDb = 10 * Math.log10(Math.sqrt(sum / dataArray.length) || 1e-10);
  levelMeter.style.setProperty('--level', `${clamp((rmsDb + 60) * (100 / 60), 0, 100)}%`);
  levelText.textContent = rmsDb <= -99 ? '−∞ dB' : `${rmsDb.toFixed(1)} dB`;

  if (isMeasuring) {
    for (let i = 0; i < dataArray.length; i++) {
      if (dataArray[i]! > peakHoldData[i]!) peakHoldData[i] = dataArray[i]!;
    }
  }

  const mode = rtaRadios.find((r) => r.checked)?.value ?? 'graph';
  if (mode === 'graph') drawGraph(rtaCanvas, rtaCtx, dataArray, C_PRIMARY);
  else draw15BandBars(rtaCanvas, rtaCtx, dataArray);
}

/* 15밴드 레벨미터 */
const BANDS = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
const BAND_LABELS = ['25', '40', '63', '100', '160', '250', '400', '630', '1k', '1.6k', '2.5k', '4k', '6.3k', '10k', '16k'];

function draw15BandBars(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, data: Float32Array): void {
  if (!audioCtx) return;
  const { w: width, h: height } = fitCanvas(canvas, ctx);
  ctx.clearRect(0, 0, width, height);

  const nyquist = audioCtx.sampleRate / 2;
  const binCount = data.length;

  const padding = 16;
  const availableWidth = width - padding * 2;
  const barWidth = Math.max(4, Math.floor((availableWidth / BANDS.length) * 0.68));
  const spacing = availableWidth / BANDS.length - barWidth;
  const startX = padding + spacing / 2;

  const minDb = -90;
  const maxDb = 0;
  const textSpace = 24;

  for (let i = 0; i < BANDS.length; i++) {
    const fCenter = BANDS[i]!;
    const fLow = fCenter / Math.pow(2, 1 / 3);
    const fHigh = fCenter * Math.pow(2, 1 / 3);

    let binLow = clamp(Math.floor((fLow / nyquist) * binCount), 0, binCount - 1);
    let binHigh = clamp(Math.ceil((fHigh / nyquist) * binCount), 0, binCount - 1);
    if (binLow === binHigh && binHigh < binCount - 1) binHigh++;

    let maxVal = -Infinity;
    for (let b = binLow; b <= binHigh; b++) maxVal = Math.max(maxVal, data[b]!);
    maxVal = clamp(maxVal, minDb, maxDb);

    const x = startX + i * (barWidth + spacing);
    const barTotalHeight = height - textSpace;
    const activeHeight = ((maxVal - minDb) / (maxDb - minDb)) * barTotalHeight;

    const segmentHeight = 4;
    const gap = 2;
    const numSegments = Math.floor(barTotalHeight / (segmentHeight + gap));

    for (let s = 0; s < numSegments; s++) {
      const segY = height - textSpace - (s + 1) * (segmentHeight + gap);
      const isLit = s * (segmentHeight + gap) < activeHeight;
      if (isLit) {
        if (s > numSegments * 0.85) ctx.fillStyle = C_WARM;
        else if (s > numSegments * 0.65) ctx.fillStyle = C_AMBER;
        else ctx.fillStyle = C_PRIMARY;
      } else {
        ctx.fillStyle = C_SEG_OFF;
      }
      ctx.fillRect(x, segY, barWidth, segmentHeight);
    }

    /* 피크 라인 */
    if (activeHeight > 0) {
      ctx.fillStyle = C_LABEL;
      ctx.fillRect(x, height - textSpace - activeHeight, barWidth, 2);
    }

    ctx.fillStyle = C_LABEL;
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(BAND_LABELS[i]!, x + barWidth / 2, height - 7);
  }
}

/* 로그 스케일 라인 그래프 */
function drawGraph(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  data: Float32Array,
  color: string,
): void {
  if (!audioCtx) return;
  const { w: width, h: height } = fitCanvas(canvas, ctx);
  ctx.clearRect(0, 0, width, height);

  const minDb = -100;
  const maxDb = 0;
  const nyquist = audioCtx.sampleRate / 2;
  const binCount = data.length;

  /* 그리드 먼저 */
  ctx.strokeStyle = C_GRID;
  ctx.lineWidth = 1;
  for (const f of [100, 1000, 10000]) {
    const x = ((Math.log10(f) - MIN_LOG) / LOG_RANGE) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.fillStyle = C_LABEL;
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(f >= 1000 ? `${f / 1000}kHz` : `${f}Hz`, x + 5, height - 6);
  }
  for (let i = 1; i < 4; i++) {
    const y = (height * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.lineWidth = 2.25;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.beginPath();

  let started = false;
  for (let i = 0; i < binCount; i++) {
    const freq = (i * nyquist) / binCount;
    if (freq < MIN_FREQ) continue;
    if (freq > MAX_FREQ) break;

    const x = ((Math.log10(freq) - MIN_LOG) / LOG_RANGE) * width;
    const db = clamp(data[i]!, minDb, maxDb);
    const y = height - ((db - minDb) / (maxDb - minDb)) * height;

    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

/* ═══════════ 3. 스윕 측정 ═══════════ */
function updateMeasureButtonText(): void {
  const val = clamp(parseInt(inputDuration.value, 10) || 5, 1, 60);
  inputDuration.value = String(val);
  btnMeasureLabel.textContent = `측정 실행 (${val}초)`;
}
inputDuration.addEventListener('input', updateMeasureButtonText);
inputDuration.addEventListener('blur', updateMeasureButtonText);

btnMeasure.addEventListener('click', () => {
  if (!isMicActive || !audioCtx) {
    toast('마이크를 먼저 켜주세요.', 'warning');
    return;
  }
  if (isMeasuring) return;
  if (isTonePlaying) btnTone.click();

  const ctx = audioCtx;
  isMeasuring = true;
  btnMeasure.disabled = true;
  measureStatus.classList.remove('d-none');
  measureProgressContainer.classList.remove('d-none');
  measureProgressBar.style.width = '0%';
  peakHoldData.fill(-140);

  const duration = clamp(parseInt(inputDuration.value, 10) || 5, 1, 60);
  const sweepOsc = ctx.createOscillator();
  const sweepGain = ctx.createGain();

  sweepOsc.type = 'sine';
  sweepGain.gain.setValueAtTime(0.5, ctx.currentTime);
  sweepOsc.frequency.setValueAtTime(MIN_FREQ, ctx.currentTime);
  sweepOsc.frequency.exponentialRampToValueAtTime(MAX_FREQ, ctx.currentTime + duration);
  sweepOsc.connect(sweepGain).connect(ctx.destination);
  sweepOsc.start();
  sweepOsc.stop(ctx.currentTime + duration);

  const startTime = ctx.currentTime;
  function updateProgress(): void {
    if (!isMeasuring) return;
    const elapsed = ctx.currentTime - startTime;
    measureProgressBar.style.width = `${Math.min(100, (elapsed / duration) * 100)}%`;
    if (elapsed < duration) requestAnimationFrame(updateProgress);
  }
  updateProgress();

  window.setTimeout(
    () => {
      sweepOsc.disconnect();
      sweepGain.disconnect();
      isMeasuring = false;
      btnMeasure.disabled = false;
      measureStatus.classList.add('d-none');
      measureProgressContainer.classList.add('d-none');
      drawResult();
      toast('측정이 완료되었습니다.', 'success');
    },
    (duration + 0.2) * 1000,
  );
});

/* ═══════════ 4. 결과 ═══════════ */
function hasResult(): boolean {
  return peakHoldData.length > 10 && peakHoldData[10]! > -140;
}

function drawResult(): void {
  if (!hasResult()) return;
  let displayData = peakHoldData;

  if (chkSmooth.checked) {
    const windowSize = 25;
    const smoothed = new Float32Array(displayData.length);
    for (let i = 0; i < displayData.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = -windowSize; j <= windowSize; j++) {
        const k = i + j;
        if (k >= 0 && k < displayData.length) {
          sum += displayData[k]!;
          count++;
        }
      }
      smoothed[i] = sum / count;
    }
    displayData = smoothed;
  }
  drawGraph(resultCanvas, resultCtx, displayData, C_WARM);
}

chkSmooth.addEventListener('change', drawResult);
window.addEventListener('resize', () => {
  if (hasResult()) drawResult();
});

/* 결과 캔버스 초기 안내 */
(function primeResultCanvas(): void {
  const { w, h } = fitCanvas(resultCanvas, resultCtx);
  resultCtx.clearRect(0, 0, w, h);
  resultCtx.fillStyle = C_LABEL;
  resultCtx.font = '600 12px "IBM Plex Mono", monospace';
  resultCtx.textAlign = 'center';
  resultCtx.fillText('측정을 실행하면 응답 곡선이 표시됩니다', w / 2, h / 2);
})();

/* ═══════════ 5. 주의 안내 다이얼로그 ═══════════ */
{
  const dialog = el<HTMLDialogElement>('warnDialog');
  const ok = el<HTMLButtonElement>('warnOk');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  ok.addEventListener('click', () => dialog.close());
}

updateMeasureButtonText();
