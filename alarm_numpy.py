import numpy as np
import socket
import sounddevice as sd
from flask import Flask, render_template_string
from flask_socketio import SocketIO
import time
import queue
import colorama
from colorama import Fore, Style
import threading
colorama.init()

# Settings
DEVICE_INDEX = None   # Set to your microphone index or None for default
SR = 44100         # Sample rate
BLOCK_SECONDS = 1  # Block size (seconds)
THRESHOLD = 0.05   # RMS threshold for alarm
beep_playing = False  # Flag to prevent overlapping beeps
last_beep_time = 0  # Timestamp of last beep to implement cooldown

def play_beep():
    """Play a clear, piercing beep sound three times"""
    global beep_playing
    if beep_playing:
        return  # Don't play if already playing
    beep_playing = True
    duration = 0.5  # seconds (longer for more volume)
    frequency = 800  # Hz (higher frequency for clarity)
    t = np.linspace(0, duration, int(SR * duration), False)
    beep = 1.0 * np.sign(np.sin(frequency * 2 * np.pi * t))  # Full volume square wave
    try:
        # Play beep three times with short pause
        for _ in range(3):
            sd.play(beep, samplerate=SR)
            sd.wait()
            time.sleep(0.1)
    except Exception as e:
        print(f"Error playing beep: {e}")
    finally:
        beep_playing = False

app = Flask(__name__)
socketio = SocketIO(app, async_mode='threading')
data_queue = queue.Queue()

@app.route('/')
def index():
    html = f"""
<html>
<head>
    <title>Audio Alarm Monitor</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.socket.io/4.0.0/socket.io.min.js"></script>
</head>
<body>
    <h1>Real-time Audio RMS Monitor</h1>
    <div id="alarmMessage" style="color: red; font-size: 24px; font-weight: bold; margin: 10px 0;"></div>
    <canvas id="rmsChart" width="800" height="400"></canvas>
    <script>
        var threshold = {THRESHOLD};
        var ctx = document.getElementById('rmsChart').getContext('2d');
        var rmsChart = new Chart(ctx, {{
            type: 'line',
            data: {{
                labels: [],
                datasets: [{{
                    label: 'RMS Value',
                    data: [],
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: false,
                    pointRadius: 5,
                    pointBackgroundColor: function(context) {{
                        return context.parsed && context.parsed.y > threshold ? 'red' : 'rgba(75, 192, 192, 1)';
                    }}
                }}, {{
                    label: 'Threshold',
                    data: [],
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                }}, {{
                    label: 'Alarm Points',
                    data: [],
                    borderColor: 'red',
                    backgroundColor: 'red',
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    showLine: false,
                    type: 'scatter'
                }}]
            }},
            options: {{
                scales: {{
                    x: {{
                        type: 'linear',
                        position: 'bottom',
                        title: {{
                            display: true,
                            text: 'Time (s)'
                        }}
                    }},
                    y: {{
                        title: {{
                            display: true,
                            text: 'RMS'
                        }}
                    }}
                }},
                animation: false
            }}
        }});
        var socket = io();
        var startTime = Date.now() / 1000;
        socket.on('rms_update', function(data) {{
            var currentTime = (Date.now() / 1000) - startTime;
            rmsChart.data.labels.push(currentTime);
            rmsChart.data.datasets[0].data.push(data.rms);
            rmsChart.data.datasets[1].data.push(threshold);  // Use dynamic threshold
            if (rmsChart.data.labels.length > 50) {{
                var minLabel = rmsChart.data.labels[0];
                rmsChart.data.datasets[2].data = rmsChart.data.datasets[2].data.filter(point => point.x >= minLabel);
                rmsChart.data.labels.shift();
                rmsChart.data.datasets[0].data.shift();
                rmsChart.data.datasets[1].data.shift();
            }}
            rmsChart.update();
        }});
        socket.on('alarm', function(data) {{
            document.getElementById('alarmMessage').innerText = 'ALARM: Loud sound detected! RMS: ' + data.rms;
            var currentTime = (Date.now() / 1000) - startTime;
            rmsChart.data.datasets[2].data.push({{x: currentTime, y: data.rms}});
            setTimeout(function() {{
                document.getElementById('alarmMessage').innerText = '';
            }}, 1000);
        }});
    </script>
</body>
</html>
    """
    return render_template_string(html)

def callback(indata, frames, callback_time, status):
    global last_beep_time
    if status:
        print(f"Status: {status}")
    try:
        rms = np.sqrt(np.mean(indata**2))
        print(f"RMS: {rms:.5f}")
        data_queue.put({'rms': rms, 'alarm': rms > THRESHOLD})
        if rms > THRESHOLD:
            print(Fore.RED + f"⚠️ ALARM: Loud sound detected! RMS: {rms:.5f}" + Style.RESET_ALL)
            # Play beep in background thread with cooldown
            if time.time() - last_beep_time > 2:
                last_beep_time = time.time()
                threading.Thread(target=play_beep, daemon=True).start()
    except Exception as e:
        print(f"Error in audio callback: {e}")

def emit_data():
    while True:
        try:
            data = data_queue.get(timeout=1)
            with app.app_context():
                socketio.emit('rms_update', {'rms': float(data['rms']), 'timestamp': time.time()})
                if data['alarm']:
                    socketio.emit('alarm', {'rms': float(data['rms'])})
        except queue.Empty:
            pass
        except Exception as e:
            print(f"Error emitting data: {e}")

# Device selection and validation
def select_device():
    devices = sd.query_devices()
    if DEVICE_INDEX is not None:
        if DEVICE_INDEX < len(devices) and devices[DEVICE_INDEX]['max_input_channels'] > 0:
            return DEVICE_INDEX
        else:
            print(f"Warning: Device {DEVICE_INDEX} not available or has no input channels. Using default.")
    # Find default input device
    default_input = sd.default.device[0]
    if devices[default_input]['max_input_channels'] > 0:
        return default_input
    # Find any device with input channels
    for i, dev in enumerate(devices):
        if dev['max_input_channels'] > 0:
            return i
    raise ValueError("No input devices found")

def find_free_port(start_port=5000):
    port = start_port
    while port < start_port + 100:  # Try up to 100 ports
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('0.0.0.0', port))
                return port
            except OSError:
                port += 1
    raise OSError("No free ports found")

try:
    selected_device = select_device()
    print(f"Using device {selected_device}: {sd.query_devices()[selected_device]['name']}")
    stream = sd.InputStream(device=selected_device,
                            channels=1,
                            samplerate=SR,
                            callback=callback,
                            blocksize=int(SR * BLOCK_SECONDS))
    stream.start()
    socketio.start_background_task(emit_data)
    port = find_free_port(5000)
    print(f"🎤 Listening on device {selected_device}... Block size: {BLOCK_SECONDS}s, threshold: {THRESHOLD}")
    print(f"Open http://localhost:{port} in your browser")
    print("Press Ctrl+C to stop.\n")
    socketio.run(app, host='0.0.0.0', port=port)
except KeyboardInterrupt:
    print("Stopping...")
except Exception as e:
    print(f"Error starting audio stream: {e}")
finally:
    if 'stream' in locals():
        stream.stop()
        stream.close()
