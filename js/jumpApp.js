import { flightTime } from './JumpMetrics.js';

const permBtn = document.getElementById('perm-btn');
const dot = document.getElementById('dot');

let active = false;

function handleMotion(ev) {
  const ax = ev.accelerationIncludingGravity?.x || 0;
  const ay = ev.accelerationIncludingGravity?.y || 0;
  // Escala simple para mover el punto dentro del área (px)
  const x = ax * 5;
  const y = ay * 5;
  dot.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

function startSensors() {
  if (active) return;
  window.addEventListener('devicemotion', handleMotion);
  active = true;
}

function requestPermission() {
  if (
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function'
  ) {
    DeviceMotionEvent.requestPermission()
      .then((res) => {
        if (res === 'granted') startSensors();
      })
      .catch(console.error);
  } else {
    startSensors();
  }
}

permBtn.addEventListener('click', requestPermission);

// Ejemplo de uso de Web Audio y WebMIDI (inicializaciones básicas)
try {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  console.log('AudioContext listo', audioCtx);
} catch (err) {
  console.warn('Web Audio no soportado', err);
}

if (navigator.requestMIDIAccess) {
  navigator.requestMIDIAccess().then(() => console.log('WebMIDI listo'));
}
