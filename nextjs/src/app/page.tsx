'use client';

import { useEffect, useRef, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';

// Global variables for Chart.js plugin
let globalLastBeepTime = 0;
let globalPlayBeep: (() => void) | null = null;

// Chart.js plugin for synchronized beeping
const beepPlugin = {
  id: 'beepPlugin',
  afterDraw: (chart: any) => {
    // Check if we have new red points that need beeping
    const dataset = chart.data.datasets[0]; // RMS dataset
    if (!dataset || !dataset.data) return;

    const currentDataLength = dataset.data.length;
    if (currentDataLength > 0) {
      const lastPoint = dataset.data[currentDataLength - 1];
      if (lastPoint > THRESHOLD) {
        // Beep if cooldown allows
        if (globalPlayBeep && Date.now() - globalLastBeepTime > 2000) {
          globalLastBeepTime = Date.now();
          globalPlayBeep();
        }
      }
    }
  }
};

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, beepPlugin);

const THRESHOLD = 0.05;
const SAMPLE_RATE = 44100;
const BLOCK_SIZE = 1; // seconds

export default function AudioAlarm() {
  const [rmsData, setRmsData] = useState<{ time: number; rms: number }[]>([]);
  const [currentRms, setCurrentRms] = useState<number>(0);
  const [isAlarm, setIsAlarm] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [chartKey, setChartKey] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const rmsDisplayIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastBeepTimeRef = useRef<number>(0);
  const lastGraphUpdateRef = useRef<number>(0);

  const playBeep = () => {
    if (!audioContextRef.current) return;
    const oscillator = audioContextRef.current.createOscillator();
    const gainNode = audioContextRef.current.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContextRef.current.destination);

    oscillator.frequency.setValueAtTime(800, audioContextRef.current.currentTime);
    oscillator.type = 'square';

    gainNode.gain.setValueAtTime(1, audioContextRef.current.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContextRef.current.currentTime + 0.5);

    oscillator.start(audioContextRef.current.currentTime);
    oscillator.stop(audioContextRef.current.currentTime + 0.5);
  };

  const calculateRMS = (buffer: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    return Math.sqrt(sum / buffer.length);
  };

  const checkAlarm = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(dataArray);

    const rms = calculateRMS(dataArray);

    if (rms > THRESHOLD) {
      setIsAlarm(true);
      setTimeout(() => setIsAlarm(false), 1000);
    }

    animationFrameRef.current = requestAnimationFrame(checkAlarm);
  };

  const updateCurrentRms = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(dataArray);

    const rms = calculateRMS(dataArray);
    setCurrentRms(rms);
  };

  const updateGraph = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(dataArray);

    const rms = calculateRMS(dataArray);
    const currentTime = (Date.now() - startTimeRef.current) / 1000;

    setRmsData(prev => {
      const newData = [...prev, { time: currentTime, rms }];
      return newData.slice(-50); // Keep last 50 points for continuous session view
    });

    setChartKey(prev => prev + 1); // Force chart re-render
  };

  const startMonitoring = async () => {
    try {
      setRmsData([]); // Clear previous data
      setChartKey(0); // Reset chart key
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.8;

      microphoneRef.current = audioContextRef.current.createMediaStreamSource(stream);
      microphoneRef.current.connect(analyserRef.current);

      startTimeRef.current = Date.now();
      lastGraphUpdateRef.current = Date.now();
      setIsMonitoring(true);
      checkAlarm();
      intervalRef.current = setInterval(updateGraph, 1000);
      rmsDisplayIntervalRef.current = setInterval(updateCurrentRms, 500);
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Microphone access denied or not available.');
    }
  };

  const stopMonitoring = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    if (rmsDisplayIntervalRef.current) {
      clearInterval(rmsDisplayIntervalRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsMonitoring(false);
    setCurrentRms(0); // Reset current RMS when stopping
  };

  useEffect(() => {
    // Set global functions for Chart.js plugin
    globalPlayBeep = playBeep;
    globalLastBeepTime = lastBeepTimeRef.current;

    return () => {
      stopMonitoring();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800 dark:text-white">
          Real-time Audio RMS Monitor
        </h1>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
          <div className="flex justify-center mb-4">
            {!isMonitoring ? (
              <button
                onClick={startMonitoring}
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
              >
                Start Monitoring
              </button>
            ) : (
              <button
                onClick={stopMonitoring}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded"
              >
                Stop Monitoring
              </button>
            )}
          </div>

          {isMonitoring && (
            <div className="text-center mb-4">
              <div className="inline-block bg-gray-100 dark:bg-gray-700 rounded-lg px-6 py-3">
                <div className="text-sm text-gray-600 dark:text-gray-400">Current RMS</div>
                <div className={`text-2xl font-mono font-bold ${currentRms > THRESHOLD ? 'text-red-500' : 'text-green-500'}`}>
                  {currentRms.toFixed(5)}
                </div>
              </div>
            </div>
          )}

          <div className="h-96">
            <Line
              data={{
                labels: rmsData.map((_, index) => index),
                datasets: [
                  {
                    label: 'RMS Value',
                    data: rmsData.map(d => d.rms),
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: false,
                    pointRadius: 5,
                    pointBackgroundColor: function(context: any) {
                      return context.parsed && context.parsed.y > THRESHOLD ? 'red' : 'rgba(75, 192, 192, 1)';
                    }
                  },
                  {
                    label: 'Threshold',
                    data: rmsData.map(() => THRESHOLD),
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderDash: [5, 5],
                    fill: false,
                    pointRadius: 0
                  }
                ]
              }}
              options={{
                scales: {
                  x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                      display: true,
                      text: 'Time (s)'
                    }
                  },
                  y: {
                    title: {
                      display: true,
                      text: 'RMS'
                    }
                  }
                },
                animation: false,
                maintainAspectRatio: false
              }}
            />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-gray-800 dark:text-white">Settings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Threshold: {THRESHOLD}
              </label>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                RMS value above which alarm triggers
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Sample Rate: {SAMPLE_RATE} Hz
              </label>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Audio sampling rate
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
