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
3. When prompted by the browser, grant motion and orientation permissions. Some platforms (e.g. iOS/Safari) may require enabling **Motion & Orientation Access** in settings.

## Libraries and compatibility

- Plots are rendered with [Chart.js](https://www.chartjs.org/) (MIT License).
- 3D visualization uses [Three.js](https://threejs.org/) (MIT License).
- Sensor APIs generally require HTTPS or `localhost` and are primarily supported on modern mobile browsers such as Chrome for Android.

