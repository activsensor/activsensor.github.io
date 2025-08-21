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
    this.maxPoints = 100;

    // Element for displaying messages
    this.messageEl = document.createElement('div');
    this.messageEl.id = 'message';
    document.body.appendChild(this.messageEl);

    this.createCharts();

    const selector = document.getElementById('sensorSelector');
    selector.addEventListener('change', e => this.startSensor(e.target.value));

    // start with currently selected sensor
    this.startSensor(selector.value);
  }

  createCharts() {
    const chartOptions = axis => ({
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: axis.toUpperCase(),
            data: [],
            borderColor: axis === 'x' ? 'red' : axis === 'y' ? 'green' : 'blue',
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

    this.charts = {
      x: new Chart(document.getElementById('chart-x'), chartOptions('x')),
      y: new Chart(document.getElementById('chart-y'), chartOptions('y')),
      z: new Chart(document.getElementById('chart-z'), chartOptions('z'))
    };
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
    ['x', 'y', 'z'].forEach(axis => {
      this.charts[axis].data.labels.push(timestamp);
      if (this.charts[axis].data.labels.length > this.maxPoints) {
        this.charts[axis].data.labels.shift();
      }
    });

    const axes = { x, y, z };
    Object.keys(axes).forEach(axis => {
      const chart = this.charts[axis];
      chart.data.datasets[0].data.push(axes[axis]);
      if (chart.data.datasets[0].data.length > this.maxPoints) {
        chart.data.datasets[0].data.shift();
      }
      chart.update('none');
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SensorController();
});
