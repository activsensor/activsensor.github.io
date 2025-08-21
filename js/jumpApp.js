import {
  flightTime,
  heightFromFlightTime,
  contactTime,
  rsi,
  summarizeSeries,
} from './JumpMetrics.js';

const permBtn = document.getElementById('perm-btn');
const dotEl = document.getElementById('dot');
const resultsDiv = document.getElementById('results');
const countdownEl = document.getElementById('countdown');
const ledEl = document.getElementById('sensor-led');
const bodyEl = document.body;
const defaultBg = getComputedStyle(bodyEl).backgroundColor;

const isIOS = /iP(ad|hone|od)/i.test(navigator.userAgent);
const hasSensorAPI = 'LinearAccelerationSensor' in window;

let permissionGranted = false;
let capturing = false;
let motionData = [];
let orientationData = [];
let audioCtx;
let midiOutput;
let chart;
let accelSensor;
let lastTapTs = 0;
let sensorListening = false;

const TAP_THRESHOLD = 15; // m/s^2 above gravity
const TAP_WINDOW = 400; // ms between taps
const NOISE_FLOOR = 0.1; // m/s^2 filter to ignore noise on X/Z
const NOISE_FLOOR_Y = 3; // m/s^2 filter to ignore noise on Y

function dotProd(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

function detectJumpEvents(samples, opts = {}) {
  const alpha = opts.alpha ?? 0.2;
  const flightEpsMag = opts.flightEpsMag ?? 0.4;
  const flightEpsVert = opts.flightEpsVert ?? 0.5;
  const moveThresh = opts.moveThresh ?? 1.0;
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
    const aVertInc = dotProd(aVec, gUnit);
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
    resultsDiv.innerHTML =
      '<p class="text-center text-gray-500">No se detectaron saltos</p>';
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
  renderResults(items, summary);
}

function renderResults(items, summary) {
  resultsDiv.innerHTML = '';
  permBtn.classList.add('hidden');

  const cards = document.createElement('div');
  cards.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4';

  if (summary) {
    const summaryCard = document.createElement('div');
    summaryCard.className = 'bg-white p-4 rounded shadow';
    summaryCard.innerHTML = `
      <h3 class="font-semibold mb-2">Resumen</h3>
      <p><span class="font-medium">Conteo:</span> ${summary.count}</p>
      <p><span class="font-medium">Cadencia:</span> ${summary.cadence
        .toFixed(2)} saltos/min</p>
    `;
    cards.appendChild(summaryCard);
  }

  items.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'bg-white p-4 rounded shadow';
    card.innerHTML = `
      <h3 class="font-semibold mb-2">Salto ${idx + 1}</h3>
      <p><span class="font-medium">Tiempo de vuelo:</span> ${item.tf
        .toFixed(2)} s</p>
      <p><span class="font-medium">Altura:</span> ${item.h
        .toFixed(2)} m</p>
      <p><span class="font-medium">Tiempo de contacto:</span> ${item.tc
        .toFixed(2)} s</p>
      <p><span class="font-medium">RSI:</span> ${item.rsi.toFixed(2)}</p>
    `;
    cards.appendChild(card);
  });

  resultsDiv.appendChild(cards);

  const canvas = document.createElement('canvas');
  canvas.id = 'jump-chart';
  canvas.className = 'w-full h-48';
  resultsDiv.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  const t0 = motionData[0]?.t || 0;
  const labels = motionData.map((s) => ((s.t - t0) / 1000).toFixed(2));
  const data = motionData.map((s) => s.az);
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Aceleración Z (m/s²)',
          data,
          borderColor: 'rgb(59,130,246)',
          backgroundColor: 'rgba(59,130,246,0.2)',
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'Tiempo (s)' },
        },
        y: {
          title: { display: true, text: 'm/s²' },
        },
      },
    },
  });

  const resetBtn = document.createElement('button');
  resetBtn.id = 'reset-btn';
  resetBtn.className = 'bg-gray-500 text-white px-4 py-2 rounded self-center';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', resetApp);
  resultsDiv.appendChild(resetBtn);
}

function resetApp() {
  motionData = [];
  orientationData = [];
  capturing = false;
  if (chart) {
    chart.destroy();
    chart = null;
  }
  resultsDiv.innerHTML = '';
  dotEl.style.transform = 'translate(-50%, -50%)';
  if (isIOS) {
    permBtn.classList.remove('hidden');
  }
  bodyEl.style.backgroundColor = defaultBg;
  countdownEl.classList.add('hidden');
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

function setLed(on) {
  ledEl.classList.toggle('bg-green-500', on);
  ledEl.classList.toggle('bg-red-500', !on);
}

function playBeep(long = false) {
  const duration = long ? 0.3 : 0.15;
  if (midiOutput) {
    const note = long ? 80 : 60;
    const base = performance.now();
    midiOutput.send([0x90, note, 0x7f], base);
    midiOutput.send([0x80, note, 0x40], base + duration * 1000);
  } else if (audioCtx) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = long ? 880 : 440;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    osc.start(now);
    osc.stop(now + duration);
  }
}

function startCountdown(onEnd) {
  let count = 3;
  countdownEl.classList.remove('hidden');
  const tick = () => {
    countdownEl.textContent = String(count);
    playBeep(count === 0);
    if (count === 0) {
      setTimeout(() => countdownEl.classList.add('hidden'), 500);
      if (typeof onEnd === 'function') onEnd();
    } else {
      count--;
      setTimeout(tick, 1000);
    }
  };
  tick();
}

function filterNoise(ax, ay, az) {
  return {
    ax: Math.abs(ax) < NOISE_FLOOR ? 0 : ax,
    ay: Math.abs(ay) < NOISE_FLOOR_Y ? 0 : ay,
    az: Math.abs(az) < NOISE_FLOOR ? 0 : az,
  };
}

function processMotion(ev) {
  const acc = ev.accelerationIncludingGravity || ev.acceleration || {};
  const ax = acc.x || 0;
  const ay = acc.y || 0;
  const az = acc.z || 0;
  const mag = Math.hypot(ax, ay, az);
  const now = ev.timeStamp;
  if (Math.abs(mag - 9.81) > TAP_THRESHOLD) {
    if (now - lastTapTs < TAP_WINDOW) {
      lastTapTs = 0;
      onDoubleTap();
    } else {
      lastTapTs = now;
    }
  }
  const f = filterNoise(ax, ay, az);
  if (capturing && !hasSensorAPI) {
    motionData.push({ t: now, ax: f.ax, ay: f.ay, az: f.az });
  }
  if (!hasSensorAPI) {
    const x = f.ax * 5;
    const y = f.ay * 5;
    dotEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }
}

function startSensorListener() {
  if (sensorListening) return;
  window.addEventListener('devicemotion', processMotion, { passive: true });
  window.addEventListener('deviceorientation', handleOrientation);
  if (hasSensorAPI) {
    accelSensor = new LinearAccelerationSensor({ frequency: 60 });
    accelSensor.addEventListener('reading', handleSensorReading);
    accelSensor.start();
  }
  sensorListening = true;
  setLed(true);
}

function handleSensorReading() {
  const f = filterNoise(
    accelSensor?.x || 0,
    accelSensor?.y || 0,
    accelSensor?.z || 0
  );
  if (capturing) {
    motionData.push({ t: performance.now(), ax: f.ax, ay: f.ay, az: f.az });
  }

  const x = f.ax * 5;
  const y = f.ay * 5;
  dotEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

function handleOrientation(ev) {
  if (capturing) {
    orientationData.push({
      t: ev.timeStamp,
      alpha: ev.alpha || 0,
      beta: ev.beta || 0,
      gamma: ev.gamma || 0,
    });
  }
}

function startCapture() {
  motionData = [];
  orientationData = [];
  capturing = true;
}

function stopCapture() {
  capturing = false;
  console.log('Captura detenida. Muestras:', motionData.length, orientationData.length);
  analyzeJumps();
}

function onDoubleTap() {
  if (!permissionGranted) return;
  if (!capturing) {
    startCountdown(() => {
      bodyEl.style.backgroundColor = 'rgba(255,0,0,0.3)';
      startCapture();
    });
  } else {
    stopCapture();
    bodyEl.style.backgroundColor = defaultBg;
    countdownEl.classList.add('hidden');
  }
}

function requestPermission() {
  if (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function'
  ) {
    DeviceMotionEvent.requestPermission()
      .then((res) => {
        if (res === 'granted') {
          permissionGranted = true;
          permBtn.classList.add('hidden');
          startSensorListener();
        }
      })
      .catch(console.error);
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      DeviceOrientationEvent.requestPermission().catch(console.error);
    }
  } else {
    permissionGranted = true;
    permBtn.classList.add('hidden');
    startSensorListener();
  }
}

if (isIOS) {
  permBtn.addEventListener('click', requestPermission);
} else {
  permissionGranted = true;
  permBtn.classList.add('hidden');
  startSensorListener();
}

initAudio();
// Sensor-based double tap detection is active; no DOM trigger needed.

