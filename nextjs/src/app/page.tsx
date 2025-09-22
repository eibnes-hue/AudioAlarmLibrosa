'use client';

import { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const THRESHOLD = 0.05;
const SAMPLE_RATE = 44100;
const BLOCK_SIZE = 1; // seconds

export default function AudioAlarm() {
  const [rmsData, setRmsData] = useState<{ time: number; rms: number }[]>([]);
  const [isAlarm, setIsAlarm] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [chartKey, setChartKey] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastBeepTimeRef = useRef<number>(0);

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

  const monitorAudio = () => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    analyserRef.current.getFloatTimeDomainData(dataArray);

    const rms = calculateRMS(dataArray);
    const currentTime = (Date.now() - startTimeRef.current) / 1000;

    setRmsData(prev => {
      const newData = [...prev, { time: currentTime, rms }];
      return newData.slice(-50); // Keep last 50 points
    });
    setChartKey(prev => prev + 1);

    if (rms > THRESHOLD) {
      setIsAlarm(true);
      if (Date.now() - lastBeepTimeRef.current > 2000) {
        lastBeepTimeRef.current = Date.now();
        playBeep();
      }
      setTimeout(() => setIsAlarm(false), 1000);
    }

    animationFrameRef.current = requestAnimationFrame(monitorAudio);
  };

  const startMonitoring = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.8;

      microphoneRef.current = audioContextRef.current.createMediaStreamSource(stream);
      microphoneRef.current.connect(analyserRef.current);

      startTimeRef.current = Date.now();
      setIsMonitoring(true);
      monitorAudio();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('Microphone access denied or not available.');
    }
  };

  const stopMonitoring = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsMonitoring(false);
  };

  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      {isAlarm && (
        <div className="fixed top-4 right-4 bg-red-500 text-white px-6 py-3 rounded-lg text-lg font-bold animate-pulse shadow-lg z-50">
          ⚠️ ALARM: Loud sound detected!
        </div>
      )}
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

          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={chartKey} data={rmsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  label={{ value: 'Time (s)', position: 'insideBottom', offset: -5 }}
                />
                <YAxis
                  label={{ value: 'RMS', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip />
                <ReferenceLine y={THRESHOLD} stroke="red" strokeDasharray="5 5" />
                <Line
                  type="monotone"
                  dataKey="rms"
                  stroke="#8884d8"
                  dot={false}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
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
