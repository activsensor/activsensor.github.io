class SensorController {
  constructor() {
    this.sensorMap = {
      Accelerometer: window.Accelerometer,
      GravitySensor: window.GravitySensor,
      Gyroscope: window.Gyroscope,
      LinearAccelerationSensor: window.LinearAccelerationSensor,
      OrientationSensor: window.OrientationSensor,
      RelativeOrientationSensor: window.RelativeOrientationSensor
    };
    this.sensor = null;
    // Maintain a fixed length history for chart data
    this.maxPoints = 100;
    this.dataBuffers = { x: [], y: [], z: [] };
    this.labelBuffer = [];

    // Element for displaying messages
    this.messageEl = document.createElement('div');
    this.messageEl.id = 'message';
    document.body.appendChild(this.messageEl);

    this.createCharts();
    this.init3DScene();

    const selector = document.getElementById('sensorSelector');
    selector.addEventListener('change', e => this.startSensor(e.target.value));

    // start with currently selected sensor
    this.startSensor(selector.value);
  }

  createCharts() {
    const colors = { x: 'red', y: 'green', z: 'blue' };
    this.charts = {};
    ['x', 'y', 'z'].forEach(axis => {
      const ctx = document.getElementById(`chart-${axis}`);
      this.charts[axis] = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: axis.toUpperCase(),
              data: [],
              borderColor: colors[axis],
              fill: false,
              tension: 0.1
            }
          ]
        },
        options: {
          animation: false,
          responsive: true,
          scales: {
            x: { display: false },
            y: { suggestedMin: -10, suggestedMax: 10 }
          }
        }
      });
    });
  }

  init3DScene() {
    const canvas = document.getElementById('chart-3d');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.position.z = 5;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth || 300, canvas.clientHeight || 300);
    const geometry = new THREE.BoxGeometry(1, 2, 0.1);
    const material = new THREE.MeshNormalMaterial();
    this.cube = new THREE.Mesh(geometry, material);
    this.scene.add(this.cube);
    this.animate();
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  update3D(sensor) {
    if (!this.cube) return;
    if (sensor.quaternion) {
      this.cube.quaternion.set(
        sensor.quaternion[0],
        sensor.quaternion[1],
        sensor.quaternion[2],
        sensor.quaternion[3]
      );
    } else if ('x' in sensor && 'y' in sensor && 'z' in sensor) {
      this.cube.rotation.set(sensor.x || 0, sensor.y || 0, sensor.z || 0);
    }
  }

  log(message) {
    this.messageEl.textContent = message;
  }

  stopSensor() {
    if (this.sensor) {
      this.sensor.stop();
      this.sensor.onreading = null;
      this.sensor.onerror = null;
      this.sensor = null;
    }
  }

  startSensor(type) {
    this.stopSensor();
    const Constructor = this.sensorMap[type];
    if (typeof Constructor !== 'function') {
      this.log(`${type} is not supported on this device.`);
      return;
    }

    try {
      const sensor = new Constructor({ frequency: 60 });
      sensor.onreading = () => {
        const x = sensor.x ?? sensor.quaternion?.[0] ?? 0;
        const y = sensor.y ?? sensor.quaternion?.[1] ?? 0;
        const z = sensor.z ?? sensor.quaternion?.[2] ?? 0;
        this.pushData(x, y, z);
        this.update3D(sensor);
      };
      sensor.onerror = event => {
        if (event.error?.name === 'NotAllowedError') {
          this.log('Permission to access sensor was denied.');
        } else {
          this.log(`Sensor error: ${event.error?.name || event.error}`);
        }
      };
      sensor.start();
      this.sensor = sensor;
      this.log('');
    } catch (err) {
      if (err.name === 'SecurityError' || err.name === 'NotAllowedError') {
        this.log('Permission to access sensor was denied.');
      } else {
        this.log(`Sensor start failed: ${err.message}`);
      }
    }
  }

  pushData(x, y, z) {
    const timestamp = Date.now();
    this.labelBuffer.push(timestamp);
    if (this.labelBuffer.length > this.maxPoints) {
      this.labelBuffer.shift();
    }

    const axes = { x, y, z };
    Object.keys(axes).forEach(axis => {
      const buffer = this.dataBuffers[axis];
      buffer.push(axes[axis]);
      if (buffer.length > this.maxPoints) {
        buffer.shift();
      }
      const chart = this.charts[axis];
      chart.data.labels = this.labelBuffer;
      chart.data.datasets[0].data = buffer;
      chart.update('none');
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SensorController();
});
