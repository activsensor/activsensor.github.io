import { createDoubleTapTrigger } from './JumpMetrics.js';

const permBtn = document.getElementById('perm-btn');
const dot = document.getElementById('dot');
const demoArea = document.getElementById('demo-area');

let permissionGranted = false;
let capturing = false;
let motionData = [];
let orientationData = [];
let audioCtx;
let midiOutput;

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
  // Aquí iría la fase de cálculo con los datos capturados
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

