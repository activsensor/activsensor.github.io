import {
  createDoubleTapTrigger,
  flightTime,
  heightFromFlightTime,
  contactTime,
  rsi,
  summarizeSeries,
} from './JumpMetrics.js';

const permBtn = document.getElementById('perm-btn');
const dot = document.getElementById('dot');
const demoArea = document.getElementById('demo-area');

let permissionGranted = false;
let capturing = false;
let motionData = [];
let orientationData = [];
let audioCtx;
let midiOutput;

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function detectJumpEvents(samples, opts = {}) {
  const alpha = opts.alpha ?? 0.2;
  const flightEpsMag = opts.flightEpsMag ?? 0.5;
  const flightEpsVert = opts.flightEpsVert ?? 0.6;
  const moveThresh = opts.moveThresh ?? 1.2;
  const minFlight = opts.minFlight ?? 0.1;
  const maxFlight = opts.maxFlight ?? 1.2;
  const minContact = opts.minContact ?? 0.08;
  if (!samples.length) return [];

  const t0 = samples[0].t;
  const calibMs = opts.calibMs ?? 500;
  const calib = samples.filter((s) => s.t - t0 <= calibMs);
  const gSum = calib.reduce(
    (s, v) => [s[0] + v.ax, s[1] + v.ay, s[2] + v.az],
    [0, 0, 0]
  );
  const gMean = gSum.map((v) => v / calib.length);
  const g0 = norm(gMean);
  const gUnit = gMean.map((v) => v / g0);

  let aVertEma = 0;
  let aTotEma = g0;
  let inFlight = false;
  let inMotion = false;
  let tContactStart = null;
  let tTakeoff = null;
  const events = [];

  for (const s of samples) {
    const t = (s.t - t0) / 1000;
    const aVec = [s.ax, s.ay, s.az];
    const aVertInc = dot(aVec, gUnit);
    const aVert = aVertInc - g0;
    const aTot = norm(aVec);

    aVertEma = alpha * aVert + (1 - alpha) * aVertEma;
    aTotEma = alpha * aTot + (1 - alpha) * aTotEma;

    const isFlight =
      Math.abs(aTotEma - g0) < flightEpsMag &&
      Math.abs(aVertEma) < flightEpsVert;
    const hasMotion = Math.abs(aVertEma) > moveThresh;

    if (!inFlight) {
      if (hasMotion && !inMotion) {
        inMotion = true;
        tContactStart = t;
      }
      if (isFlight) {
        inFlight = true;
        tTakeoff = t;
        if (tContactStart == null) {
          tContactStart = Math.max(0, t - 0.2);
        }
      }
    } else if (!isFlight) {
      inFlight = false;
      inMotion = false;
      const tLanding = t;
      const tf = tLanding - tTakeoff;
      const tc = tTakeoff - (tContactStart ?? tTakeoff);
      if (tf >= minFlight && tf <= maxFlight && tc >= minContact) {
        events.push({ tContactStart, tTakeoff, tLanding });
      }
      tContactStart = null;
      tTakeoff = null;
    }
  }

  return events;
}

function analyzeJumps() {
  const events = detectJumpEvents(motionData);
  if (!events.length) {
    console.log('No se detectaron saltos');
    return;
  }

  const items = events.map((evt) => {
    const tf = flightTime(evt);
    const h = heightFromFlightTime(tf);
    const tc = contactTime(evt);
    const r = rsi(h, tc);
    return { tf, h, tc, rsi: r, evt };
  });

  const summary = summarizeSeries(events);
  console.log('Saltos detectados:', items);
  console.log('Conteo:', summary.count, 'Cadencia (saltos/min):', summary.cadence);
}

function initAudio() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (err) {
    console.warn('Web Audio no soportado', err);
  }
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then((midi) => {
      midiOutput = [...midi.outputs.values()][0] || null;
    });
  }
}

function playBeepSequence() {
  const times = [0, 0.2, 0.4, 0.6];
  if (midiOutput) {
    const base = performance.now();
    times.forEach((t, i) => {
      const note = i === 3 ? 80 : 60;
      midiOutput.send([0x90, note, 0x7f], base + t * 1000);
      midiOutput.send([0x80, note, 0x40], base + (t + 0.15) * 1000);
    });
  } else if (audioCtx) {
    const now = audioCtx.currentTime;
    times.forEach((t, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = i === 3 ? 880 : 440;
      gain.gain.value = 0.2;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.15);
    });
  }
}

function handleMotion(ev) {
  const ax = ev.accelerationIncludingGravity?.x || 0;
  const ay = ev.accelerationIncludingGravity?.y || 0;
  const az = ev.accelerationIncludingGravity?.z || 0;
  motionData.push({ t: ev.timeStamp, ax, ay, az });

  const x = ax * 5;
  const y = ay * 5;
  dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

function handleOrientation(ev) {
  orientationData.push({
    t: ev.timeStamp,
    alpha: ev.alpha || 0,
    beta: ev.beta || 0,
    gamma: ev.gamma || 0,
  });
}

function startCapture() {
  motionData = [];
  orientationData = [];
  window.addEventListener('devicemotion', handleMotion);
  window.addEventListener('deviceorientation', handleOrientation);
  capturing = true;
}

function stopCapture() {
  window.removeEventListener('devicemotion', handleMotion);
  window.removeEventListener('deviceorientation', handleOrientation);
  capturing = false;
  console.log('Captura detenida. Muestras:', motionData.length, orientationData.length);
  analyzeJumps();
}

function onDoubleTap() {
  if (!permissionGranted) return;
  if (!capturing) {
    playBeepSequence();
    startCapture();
  } else {
    stopCapture();
  }
}

function requestPermission() {
  if (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function'
  ) {
    DeviceMotionEvent.requestPermission()
      .then((res) => {
        if (res === 'granted') permissionGranted = true;
      })
      .catch(console.error);
  } else {
    permissionGranted = true;
  }
}

permBtn.addEventListener('click', requestPermission);

initAudio();
createDoubleTapTrigger(demoArea, onDoubleTap);

