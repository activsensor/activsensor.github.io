import {
  createDoubleTapTrigger,
  flightTime,
  heightFromFlightTime,
  contactTime,
  rsi,
  summarizeSeries,
} from './JumpMetrics.js';

const permBtn = document.getElementById('perm-btn');
const dotEl = document.getElementById('dot');
const demoArea = document.getElementById('demo-area');
const resultsDiv = document.getElementById('results');
const countdownEl = document.getElementById('countdown');
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

function startCountdown() {
  const numbers = ['3', '2', '1'];
  countdownEl.classList.remove('hidden');
  numbers.forEach((num, i) => {
    setTimeout(() => {
      countdownEl.textContent = num;
      if (i === numbers.length - 1) {
        setTimeout(() => countdownEl.classList.add('hidden'), 200);
      }
    }, i * 200);
  });
}

function handleMotion(ev) {
  const ax = ev.accelerationIncludingGravity?.x || 0;
  const ay = ev.accelerationIncludingGravity?.y || 0;
  const az = ev.accelerationIncludingGravity?.z || 0;
  motionData.push({ t: ev.timeStamp, ax, ay, az });

  const x = ax * 5;
  const y = ay * 5;
  dotEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

function handleSensorReading() {
  const ax = accelSensor?.x || 0;
  const ay = accelSensor?.y || 0;
  const az = accelSensor?.z || 0;
  motionData.push({ t: performance.now(), ax, ay, az });

  const x = ax * 5;
  const y = ay * 5;
  dotEl.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
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

  if (hasSensorAPI) {
    accelSensor = new LinearAccelerationSensor({ frequency: 60 });
    accelSensor.addEventListener('reading', handleSensorReading);
    accelSensor.start();
  } else {
    window.addEventListener('devicemotion', handleMotion);
  }
  window.addEventListener('deviceorientation', handleOrientation);
  capturing = true;
}

function stopCapture() {
  if (hasSensorAPI) {
    if (accelSensor) {
      accelSensor.removeEventListener('reading', handleSensorReading);
      accelSensor.stop();
      accelSensor = null;
    }
  } else {
    window.removeEventListener('devicemotion', handleMotion);
  }
  window.removeEventListener('deviceorientation', handleOrientation);
  capturing = false;
  console.log('Captura detenida. Muestras:', motionData.length, orientationData.length);
  analyzeJumps();
}

function onDoubleTap() {
  if (!permissionGranted) return;
  if (!capturing) {
    playBeepSequence();
    startCountdown();
    bodyEl.style.backgroundColor = 'rgba(255,0,0,0.3)';
    startCapture();
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
  }
}

if (isIOS) {
  permBtn.addEventListener('click', requestPermission);
} else {
  permissionGranted = true;
  permBtn.classList.add('hidden');
}

initAudio();
createDoubleTapTrigger(demoArea, onDoubleTap);

