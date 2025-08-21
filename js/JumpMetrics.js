/**
 * JumpMetrics.js
 * Utilidades para métricas de salto usando datos de un smartphone (IMU/DeviceMotion).
 * Métricas cubiertas:
 *  1) Tiempo de vuelo
 *  2) Altura (por tiempo de vuelo)
 *  3) Tiempo de contacto
 *  4) RSI clásico (altura / tiempo de contacto)
 *
 * NOTA: Estas funciones asumen que ya detectaste los timestamps de despegue y aterrizaje,
 * y el inicio de contacto previo al despegue. La detección de eventos puede hacerse con
 * heurísticas sobre aceleración vertical y |a|≈g durante el vuelo.
 */

const G0 = 9.80665; // m/s^2, gravedad estándar

/**
 * @typedef {Object} JumpEventTimes
 * @property {number} tContactStart - Timestamp (en segundos) del inicio de contacto que precede al despegue.
 * @property {number} tTakeoff      - Timestamp (en segundos) del despegue (pierde contacto con el suelo).
 * @property {number} tLanding      - Timestamp (en segundos) del aterrizaje (retoma contacto).
 */

/**
 * Calcula el tiempo de vuelo de un salto.
 * Definido como: t_vuelo = tLanding - tTakeoff
 *
 * @param {JumpEventTimes} evt - Tiempos del salto.
 * @returns {number} Tiempo de vuelo en segundos.
 * @throws {Error} Si los tiempos no son válidos o no están en orden.
 */
export function flightTime(evt) {
  if (!evt || typeof evt.tTakeoff !== 'number' || typeof evt.tLanding !== 'number') {
    throw new Error('flightTime: faltan tTakeoff y/o tLanding.');
  }
  const tf = evt.tLanding - evt.tTakeoff;
  if (!(tf > 0)) throw new Error('flightTime: tLanding debe ser > tTakeoff.');
  return tf;
}

/**
 * Calcula la altura estimada a partir del tiempo de vuelo usando
 * h = g * t^2 / 8 (modelo balístico, despegue/aterrizaje con las mismas alturas).
 *
 * @param {number} tFlight - Tiempo de vuelo en segundos.
 * @param {number} [g=9.80665] - Gravedad a usar (m/s^2).
 * @returns {number} Altura en metros.
 * @throws {Error} Si tFlight no es positivo.
 */
export function heightFromFlightTime(tFlight, g = G0) {
  if (!(tFlight > 0)) throw new Error('heightFromFlightTime: tFlight debe ser > 0.');
  return (g * tFlight * tFlight) / 8;
}

/**
 * Calcula el tiempo de contacto previo al despegue.
 * Definido como: t_contacto = tTakeoff - tContactStart
 *
 * @param {JumpEventTimes} evt - Tiempos del salto.
 * @returns {number} Tiempo de contacto en segundos.
 * @throws {Error} Si los tiempos no son válidos o no están en orden.
 */
export function contactTime(evt) {
  if (!evt || typeof evt.tContactStart !== 'number' || typeof evt.tTakeoff !== 'number') {
    throw new Error('contactTime: faltan tContactStart y/o tTakeoff.');
  }
  const tc = evt.tTakeoff - evt.tContactStart;
  if (!(tc > 0)) throw new Error('contactTime: tTakeoff debe ser > tContactStart.');
  return tc;
}

/**
 * Calcula el RSI clásico (Reactive Strength Index) como:
 * RSI = altura / tiempo_de_contacto
 *
 * @param {number} heightMeters - Altura del salto en metros.
 * @param {number} tContact - Tiempo de contacto en segundos.
 * @returns {number} RSI en m/s (si height está en metros).
 * @throws {Error} Si los parámetros no son válidos.
 */
export function rsi(heightMeters, tContact) {
  if (!(heightMeters >= 0)) throw new Error('rsi: heightMeters debe ser >= 0.');
  if (!(tContact > 0)) throw new Error('rsi: tContact debe ser > 0.');
  return heightMeters / tContact;
}

/**
 * (Opcional) Métrica de apoyo: dado un arreglo de saltos, devuelve métricas derivadas.
 * Útil si procesas múltiples repeticiones (CMJ en serie, DJ, etc).
 *
 * @param {JumpEventTimes[]} events - Lista de eventos de salto.
 * @param {number} [g=9.80665] - Gravedad a usar (m/s^2).
 * @returns {{
 *   items: Array<{ tf:number, h:number, tc:number, rsi:number, evt:JumpEventTimes }>,
 *   count: number,
 *   duration: number,
 *   cadence: number
 * }}
 *  - items: lista de métricas por salto
 *  - count: cantidad de saltos detectados
 *  - duration: ventana temporal total (s) desde el primer contacto al último aterrizaje
 *  - cadence: saltos por minuto (count / (duration/60))
 */
export function summarizeSeries(events, g = G0) {
  const items = [];
  for (const evt of events) {
    const tf = flightTime(evt);
    const h = heightFromFlightTime(tf, g);
    const tc = contactTime(evt);
    const r = rsi(h, tc);
    items.push({ tf, h, tc, rsi: r, evt });
  }
  const count = items.length;
  let duration = 0;
  if (count > 0) {
    const start = Math.min(...events.map(e => e.tContactStart));
    const end = Math.max(...events.map(e => e.tLanding));
    duration = Math.max(0, end - start);
  }
  const cadence = duration > 0 ? (count / (duration / 60)) : 0;
  return { items, count, duration, cadence };
}

/* ──────────────────────────────────────────────────────────────────────────── */
/* Gatillo por doble toque                                                     */
/* ──────────────────────────────────────────────────────────────────────────── */

/**
 * Crea un gatillo de "doble toque" en un elemento para iniciar captura.
 * Por ahora, al detectar doble toque, hace console.log (puedes reemplazar el callback).
 *
 * Implementa soporte para Pointer Events y fallback a Touch Events (iOS).
 *
 * @param {Element|string} target - Elemento DOM o selector CSS.
 * @param {Function} [onDoubleTap] - Callback opcional al detectar doble toque.
 * @param {number} [thresholdMs=400] - Máxima separación entre toques (ms).
 * @returns {Function} Función para desuscribir (remover listeners).
 *
 * @example
 * const off = createDoubleTapTrigger('#panel', () => {
 *   console.log('⏺️ Iniciar captura de datos');
 * });
 * // ... luego:
 * off(); // para remover los listeners
 */
export function createDoubleTapTrigger(target, onDoubleTap = () => {
  console.log('⏺️ Doble toque detectado: iniciar captura');
}, thresholdMs = 400) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) throw new Error('createDoubleTapTrigger: no se encontró el elemento objetivo.');

  let lastTapTs = 0;

  const handlerPointer = (ev) => {
    // Preferimos toques; si es mouse, puedes permitir o ignorar
    if (ev.pointerType && ev.pointerType !== 'touch') return;
    const now = ev.timeStamp;
    if (now - lastTapTs <= thresholdMs) {
      lastTapTs = 0;
      onDoubleTap();
    } else {
      lastTapTs = now;
    }
  };

  const handlerTouch = (ev) => {
    const now = ev.timeStamp;
    if (now - lastTapTs <= thresholdMs) {
      lastTapTs = 0;
      onDoubleTap();
    } else {
      lastTapTs = now;
    }
  };

  const supportsPointer = 'onpointerup' in window;
  if (supportsPointer) {
    el.addEventListener('pointerup', handlerPointer, { passive: true });
  } else {
    el.addEventListener('touchend', handlerTouch, { passive: true });
  }

  // Devuelve función para limpiar
  return () => {
    if (supportsPointer) {
      el.removeEventListener('pointerup', handlerPointer);
    } else {
      el.removeEventListener('touchend', handlerTouch);
    }
  };
}
