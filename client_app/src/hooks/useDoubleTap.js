/**
 * @typedef {Object} DoubleTapOptions
 * @property {number} [threshold=15] Acceleration threshold (m/s^2) required to consider a tap.
 * @property {number} [window=200] Maximum time (ms) between taps to be considered a double tap.
 * @property {() => void} [onDoubleTap] Callback fired when a double tap is detected.
 */

/**
 * Sets up listeners for device motion and orientation events in order to
 * detect a "double tap" gesture on the screen. The accelerometer readings are
 * normalised using the device orientation so that the impulse perpendicular to
 * the screen can be analysed consistently regardless of how the device is
 * being held.
 *
 * @param {DoubleTapOptions} options
 * @returns {() => void} cleanup function to remove the event listeners
 */
export default function useDoubleTap(options = {}) {
  const { threshold = 15, window: tapWindow = 200, onDoubleTap } = options;

  // Keep latest orientation angles so we can remove the gravity component.
  const orientation = { beta: 0, gamma: 0 };

  const handleOrientation = (event) => {
    orientation.beta = event.beta || 0;
    orientation.gamma = event.gamma || 0;
  };

  let lastTapTime = 0;
  let tapCount = 0;

  const handleMotion = (event) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const { beta, gamma } = orientation;
    const betaRad = (beta * Math.PI) / 180;
    const gammaRad = (gamma * Math.PI) / 180;

    // Estimate the gravity vector on the device's Z axis using the current
    // orientation angles. This allows removal of the gravity component from
    // the accelerometer's reading.
    const gZ = Math.cos(betaRad) * Math.cos(gammaRad) * 9.81;
    const z = acc.z || 0;
    const linearZ = z - gZ;

    const now = Date.now();
    if (Math.abs(linearZ) > threshold) {
      if (now - lastTapTime < tapWindow) {
        tapCount += 1;
      } else {
        tapCount = 1;
      }
      lastTapTime = now;

      if (tapCount >= 2) {
        tapCount = 0;
        if (typeof onDoubleTap === 'function') {
          onDoubleTap();
        }
      }
    }
  };

  window.addEventListener('deviceorientation', handleOrientation);
  window.addEventListener('devicemotion', handleMotion);

  return () => {
    window.removeEventListener('deviceorientation', handleOrientation);
    window.removeEventListener('devicemotion', handleMotion);
  };
}

