# Device Sensor Visualizer

A simple web app that displays real-time data from device motion sensors and renders a 3D orientation cube. It demonstrates the [Generic Sensor API](https://developer.mozilla.org/docs/Web/API/Generic_Sensor_API) in modern browsers.

## Supported sensors

- **Accelerometer**
- **GravitySensor**
- **Gyroscope**
- **LinearAccelerationSensor**
- **OrientationSensor**
- **RelativeOrientationSensor**

## Run locally

1. Install and start a static server:
   ```bash
   npx http-server
   ```
   The site will be available on `http://localhost:8080` by default.
2. Alternatively, visit the hosted version at [https://activsensor.github.io](https://activsensor.github.io).
3. When prompted by the browser, grant motion and orientation permissions. On iOS/Safari you may need to enable **Motion & Orientation Access** in settings and tap the **Enable Motion** button to start the sensors.

## Libraries and compatibility

- Plots are rendered with [Chart.js](https://www.chartjs.org/) (MIT License).
- 3D visualization uses [Three.js](https://threejs.org/) (MIT License).
- Sensor APIs generally require HTTPS or `localhost` and are primarily supported on modern mobile browsers such as Chrome for Android.

## Running on iPhone/Safari

Safari on iOS uses the legacy `DeviceMotionEvent` and `DeviceOrientationEvent` APIs instead of the [Generic Sensor API](https://developer.mozilla.org/docs/Web/API/Generic_Sensor_API). After loading the page, you must tap **Enable Motion** to request access to motion and orientation data. You may also need to turn on **Motion & Orientation Access** in iOS Settings.

Limitations:

- Fixed event frequency that cannot be configured.
- The Generic Sensor API is not available, so only `devicemotion` and `deviceorientation` events are used.

