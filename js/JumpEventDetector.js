/**
 * JumpEventDetector.js
 * Detección de eventos de salto (contacto, despegue, aterrizaje) desde DeviceMotion.
 * Úsalo con HTTPS y tras un gesto del usuario (iOS pide permiso explícito).
 *
 * Flujo sugerido:
 *  1) await JumpEventDetector.requestMotionPermission();
 *  2) const calib = await JumpEventDetector.calibrate({ ms: 2000 });
 *  3) const det = new JumpEventDetector({ gUnit: calib.gUnit, g0: calib.g0, onJump: ... });
 *  4) det.start(); // escuchar devicemotion
 *  5) det.stop();
 */

const G_STD = 9.80665;

/** Utilidades vectoriales simples */
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function norm(a){ return Math.hypot(a[0],a[1],a[2]); }
function scale(a,k){ return [a[0]*k,a[1]*k,a[2]*k]; }
function add(a,b){ return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }

/**
 * @typedef {Object} JumpEventTimes
 * @property {number} tContactStart - Timestamp (s) del inicio de contacto previo al salto.
 * @property {number} tTakeoff - Timestamp (s) del despegue.
 * @property {number} tLanding - Timestamp (s) del aterrizaje.
 */

/**
 * @typedef {Object} JumpMetrics
 * @property {number} tf - Tiempo de vuelo (s).
 * @property {number} h  - Altura (m), por modelo balístico h = g*tf^2/8.
 * @property {number} tc - Tiempo de contacto previo al salto (s).
 * @property {number} rsi - RSI clásico (m/s) = h / tc.
 */

/**
 * Solicita permiso para acceder a sensores de movimiento (iOS).
 * Llamar tras un gesto de usuario (tap/click).
 * @returns {Promise<void>}
 */
export async function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function') {
    const p = await DeviceMotionEvent.requestPermission();
    if (p !== 'granted') throw new Error('Permiso de motion denegado.');
  }
}

/**
 * Clase principal para detección de eventos de salto.
 */
export class JumpEventDetector {
  /**
   * @param {Object} opts
   * @param {number[]} opts.gUnit - Vector unitario de gravedad (3), de la calibración.
   * @param {number}   opts.g0    - Magnitud de gravedad estimada (m/s^2), ~9.81.
   * @param {(evt: JumpEventTimes, metrics?: JumpMetrics) => void} [opts.onJump] - Callback al detectar un salto completo.
   * @param {(sample: object) => void} [opts.onSample] - Callback opcional por muestra (debug/registro).
   * @param {boolean} [opts.computeMetrics=true] - Si true, calcula {tf,h,tc,rsi} y los pasa al callback.
   * @param {Object}  [opts.thresholds] - Ajustes de detección (ver defaults).
   * @param {number}  [opts.thresholds.flightEpsMag=0.5] - Tolerancia (m/s^2) de |a_tot|-g0 para considerar vuelo.
   * @param {number}  [opts.thresholds.flightEpsVert=0.6] - Tolerancia (m/s^2) de |a_vert| en vuelo.
   * @param {number}  [opts.thresholds.moveThresh=1.2] - Umbral (m/s^2) de |a_vert| para declarar “hay movimiento en apoyo”.
   * @param {number}  [opts.thresholds.restThresh=0.4] - Por debajo de esto (|a_vert|) consideramos “casi quieto”.
   * @param {number}  [opts.thresholds.minFlight=0.10] - Vuelo mínimo válido (s).
   * @param {number}  [opts.thresholds.maxFlight=1.20] - Vuelo máximo plausible (s).
   * @param {number}  [opts.thresholds.minContact=0.08] - Contacto mínimo válido (s).
   * @param {number}  [opts.alpha=0.2] - Smoothing EMA para a_vert y a_tot (0–1).
   */
  constructor(opts) {
    const t = opts?.thresholds || {};
    this.gUnit = opts.gUnit;
    this.g0    = opts.g0;
    if (!this.gUnit || !this.g0) throw new Error('Faltan gUnit/g0. Ejecutá calibrate() primero.');
    this.onJump = typeof opts.onJump === 'function' ? opts.onJump : () => {};
    this.onSample = typeof opts.onSample === 'function' ? opts.onSample : null;
    this.computeMetrics = opts.computeMetrics !== false;

    // thresholds
    this.flightEpsMag = t.flightEpsMag ?? 0.5;
    this.flightEpsVert = t.flightEpsVert ?? 0.6;
    this.moveThresh = t.moveThresh ?? 1.2;
    this.restThresh = t.restThresh ?? 0.4;
    this.minFlight = t.minFlight ?? 0.10;
    this.maxFlight = t.maxFlight ?? 1.20;
    this.minContact = t.minContact ?? 0.08;

    this.alpha = opts.alpha ?? 0.2;

    this._handler = this._onMotion.bind(this);
    this._running = false;

    // Estado
    this._aVertEma = 0;      // a vertical filtrada (m/s^2)
    this._aTotEma  = this.g0;// magnitud total filtrada (m/s^2)
    this._lastTs   = null;   // último timestamp (ms)
    this._inFlight = false;  // estamos en vuelo
    this._inMotion = false;  // movimiento en apoyo
    this._tContactStart = null;
    this._tTakeoff = null;
    this._tLanding = null;
  }

  /**
   * Inicia la escucha de DeviceMotion y la detección.
   */
  start() {
    if (this._running) return;
    window.addEventListener('devicemotion', this._handler, { passive: true });
    this._running = true;
  }

  /**
   * Detiene la escucha de DeviceMotion.
   */
  stop() {
    if (!this._running) return;
    window.removeEventListener('devicemotion', this._handler);
    this._running = false;
  }

  /**
   * Handler de devicemotion: filtra, proyecta y evalúa estado.
   * @param {DeviceMotionEvent} e
   * @private
   */
  _onMotion(e) {
    const tMs = e.timeStamp;                 // ms desde navigationStart
    const t = tMs / 1000;                    // segundos
    const acc = e.accelerationIncludingGravity || e.acceleration;
    if (!acc) return;

    // Vector de aceleración total (incluida gravedad)
    const aVec = [acc.x || 0, acc.y || 0, acc.z || 0];

    // Proyección vertical: componente sobre el eje gUnit
    const aVertInc = dot(aVec, this.gUnit);     // incluye g
    const aVert = aVertInc - this.g0;           // le quito g -> aceleración vertical "dinámica"
    const aTot = norm(aVec);                    // magnitud total (incluye g)

    // Filtrado EMA
    const a = this.alpha;
    this._aVertEma = a * aVert + (1 - a) * this._aVertEma;
    this._aTotEma  = a * aTot  + (1 - a) * this._aTotEma;

    // Heurística de vuelo: |a_tot - g0| pequeño y |a_vert| pequeño
    const isFlight = (Math.abs(this._aTotEma - this.g0) < this.flightEpsMag) &&
                     (Math.abs(this._aVertEma) < this.flightEpsVert);

    // Movimiento en apoyo (pre-salto): |a_vert| excede moveThresh
    const hasMotion = Math.abs(this._aVertEma) > this.moveThresh;

    // Debug opcional
    if (this.onSample) {
      this.onSample({
        t, aVertRaw: aVert, aVert: this._aVertEma,
        aTotRaw: aTot, aTot: this._aTotEma, isFlight, hasMotion
      });
    }

    // Estado: detección de contacto/despegue/aterrizaje
    if (!this._inFlight) {
      // No estamos en vuelo
      if (hasMotion && !this._inMotion) {
        // Inicio de contacto previo al salto (primera activación)
        this._inMotion = true;
        this._tContactStart = t;
      }

      if (isFlight) {
        // Transición a vuelo -> DESPEGUE
        this._inFlight = true;
        this._tTakeoff = t;
        // Si no teníamos contacto marcado, marcamos una ventana mínima hacia atrás
        if (this._tContactStart == null) {
          this._tContactStart = Math.max(0, t - 0.20); // fallback 200 ms
        }
      }
    } else {
      // Estamos en vuelo
      if (!isFlight) {
        // Salimos de vuelo -> ATERRIZAJE
        this._inFlight = false;
        this._inMotion = false; // reseteamos movimiento
        this._tLanding = t;

        // Validaciones mínimas
        const tf = this._tLanding - this._tTakeoff;
        const tc = this._tTakeoff - (this._tContactStart ?? this._tTakeoff);
        const flightOk = tf >= this.minFlight && tf <= this.maxFlight;
        const contactOk = tc >= this.minContact;

        if (flightOk && contactOk) {
          const evt = {
            tContactStart: this._tContactStart,
            tTakeoff: this._tTakeoff,
            tLanding: this._tLanding,
          };
          let metrics;
          if (this.computeMetrics) {
            metrics = JumpEventDetector.computeMetrics(evt);
          }
            // Emitimos el salto completo
          this.onJump(evt, metrics);
        }

        // Reset para próximo salto
        this._tContactStart = null;
        this._tTakeoff = null;
        this._tLanding = null;
      }
    }

    this._lastTs = tMs;
  }

  /**
   * Calcula métricas básicas a partir de los timestamps del salto.
   * @param {JumpEventTimes} evt
   * @param {number} [g=G_STD]
   * @returns {JumpMetrics}
   */
  static computeMetrics(evt, g = G_STD) {
    const tf = evt.tLanding - evt.tTakeoff;
    const h  = (g * tf * tf) / 8;
    const tc = evt.tTakeoff - evt.tContactStart;
    const rsi = h / tc;
    return { tf, h, tc, rsi };
  }

  /**
   * Calibración: promedia 2s (por defecto) en quietud para estimar g0 y gUnit.
   * @param {Object} [opts]
   * @param {number} [opts.ms=2000] - Duración de calibración en milisegundos.
   * @returns {Promise<{ g0:number, gUnit:number[] }>}
   */
  static async calibrate(opts = {}) {
    const ms = opts.ms ?? 2000;
    await requestMotionPermission();

    return new Promise((resolve, reject) => {
      const samples = [];
      const t0 = performance.now();

      function onCalib(e) {
        const acc = e.accelerationIncludingGravity || e.acceleration;
        if (!acc) return;
        samples.push([acc.x || 0, acc.y || 0, acc.z || 0]);

        if (performance.now() - t0 >= ms) {
          window.removeEventListener('devicemotion', onCalib);

          if (samples.length < 10) {
            reject(new Error('Calibración insuficiente: muy pocas muestras.'));
            return;
          }
          // Media
          const sum = samples.reduce((s,v)=> add(s,v), [0,0,0]);
          const mean = scale(sum, 1 / samples.length);
          const g0 = norm(mean);
          if (g0 < 5 || g0 > 15) {
            // chequeo simple de plausibilidad
            reject(new Error('Valor de gravedad fuera de rango, repetí la calibración.'));
            return;
          }
          const gUnit = scale(mean, 1 / g0);
          resolve({ g0, gUnit });
        }
      }

      window.addEventListener('devicemotion', onCalib, { passive: true });
    });
  }
}

/* ============================= USO DE EJEMPLO ================================
import { JumpEventDetector, requestMotionPermission } from './JumpEventDetector.js';

// 1) (opcional) Pedir permiso tras un tap
await requestMotionPermission();

// 2) Calibrar 2 s estando quieto
const { g0, gUnit } = await JumpEventDetector.calibrate({ ms: 2000 });

// 3) Crear detector
const det = new JumpEventDetector({
  g0, gUnit,
  computeMetrics: true,
  onJump: (evt, metrics) => {
    console.log('SALTO:', evt, metrics);
    // { tf, h, tc, rsi } disponibles si computeMetrics = true
  },
  onSample: null, // o (s) => console.log(s) para debug
  thresholds: {
    // Ajustá si hace falta para tu device/atleta:
    // flightEpsMag: 0.5, flightEpsVert: 0.6, moveThresh: 1.2, restThresh: 0.4,
    // minFlight: 0.10, maxFlight: 1.20, minContact: 0.08
  },
  alpha: 0.2
});

// 4) Empezar a escuchar (podés atarlo al doble toque que ya tenés)
det.start();

// 5) det.stop() para detener.
============================================================================= */
