/**
 * Minimal Tech Pulse - Squire Video Soundtrack
 *
 * Deep sub bass pulse, soft textural clicks, atmospheric swells.
 * Understated and professional. Earthy/warm feel.
 *
 * Run: npx tsx scripts/generate-music.ts
 * Output: public/music.wav
 */

import * as fs from 'fs';
import * as path from 'path';

const SAMPLE_RATE = 44100;
const DURATION = 100;
const BPM = 72; // Slow, deliberate
const BEAT_DURATION = 60 / BPM;
const TOTAL_SAMPLES = SAMPLE_RATE * DURATION;

const left = new Float32Array(TOTAL_SAMPLES);
const right = new Float32Array(TOTAL_SAMPLES);

// === Utilities ===

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function sine(phase: number): number {
  return Math.sin(phase * 2 * Math.PI);
}

function noise(): number {
  return Math.random() * 2 - 1;
}

// Seeded random for repeatable patterns
let seed = 42;
function seededRandom(): number {
  seed = (seed * 16807 + 0) % 2147483647;
  return (seed - 1) / 2147483646;
}

class LowPass {
  private y = 0;
  filter(x: number, cutoff: number): number {
    const rc = 1 / (2 * Math.PI * cutoff);
    const dt = 1 / SAMPLE_RATE;
    const alpha = dt / (rc + dt);
    this.y += alpha * (x - this.y);
    return this.y;
  }
}

class HighPass {
  private prevX = 0;
  private prevY = 0;
  filter(x: number, cutoff: number): number {
    const rc = 1 / (2 * Math.PI * cutoff);
    const dt = 1 / SAMPLE_RATE;
    const alpha = rc / (rc + dt);
    this.prevY = alpha * (this.prevY + x - this.prevX);
    this.prevX = x;
    return this.prevY;
  }
}

function beatToSample(beat: number): number {
  return Math.floor(beat * BEAT_DURATION * SAMPLE_RATE);
}

const totalBeats = Math.floor(DURATION / BEAT_DURATION);

console.log(`Generating ${DURATION}s minimal pulse at ${BPM} BPM (${totalBeats} beats)...`);

// === 1. Deep Sub Pulse ===
// Very low sine (35-45Hz) that pulses on beats 1 and 3
for (let beat = 0; beat < totalBeats; beat++) {
  const bar = Math.floor(beat / 4);
  const beatInBar = beat % 4;

  // Sub only on beat 1 (and occasionally beat 3)
  if (beatInBar !== 0 && !(beatInBar === 2 && bar % 2 === 0)) continue;

  // Fade in over first 8 bars, fade out over last 4 bars
  let vol = 0.45;
  if (bar < 8) vol *= bar / 8;
  if (bar > totalBeats / 4 - 4) vol *= Math.max(0, (totalBeats / 4 - bar) / 4);

  const startSample = beatToSample(beat);
  const dur = Math.floor(SAMPLE_RATE * BEAT_DURATION * 1.8); // Long tail

  for (let i = 0; i < dur && startSample + i < TOTAL_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    // Pitch: starts at 50Hz, settles to 38Hz
    const freq = 38 + 12 * Math.exp(-t * 5);
    const env = Math.exp(-t * 2.5) * (1 - Math.exp(-t * 80)); // Fast attack, slow decay
    const sample = sine(freq * t) * env * vol;
    left[startSample + i] += sample;
    right[startSample + i] += sample;
  }
}

// === 2. Soft Textural Clicks ===
// Tiny filtered noise bursts on 8th notes, panned, very quiet
const clickLP = new LowPass();
const clickHP = new HighPass();

for (let beat = 0; beat < totalBeats; beat++) {
  for (let sub = 0; sub < 2; sub++) {
    const subBeat = beat + sub * 0.5;
    const sample = beatToSample(subBeat);
    if (sample >= TOTAL_SAMPLES) continue;

    // Skip randomly for organic feel
    seed = beat * 100 + sub;
    if (seededRandom() < 0.35) continue;

    const bar = Math.floor(beat / 4);
    let vol = 0.06 + seededRandom() * 0.04;
    if (bar < 4) vol *= bar / 4;
    if (bar > totalBeats / 4 - 3) vol *= Math.max(0, (totalBeats / 4 - bar) / 3);

    // Vary pan
    const pan = seededRandom() * 0.6 - 0.3; // slight L/R variation
    const lGain = (1 - pan) * vol;
    const rGain = (1 + pan) * vol;

    const dur = Math.floor(SAMPLE_RATE * (0.003 + seededRandom() * 0.008));
    const lp = new LowPass();
    const hp = new HighPass();

    for (let i = 0; i < dur && sample + i < TOTAL_SAMPLES; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-t * 400);
      let n = noise();
      n = lp.filter(n, 4000 + seededRandom() * 3000);
      n = hp.filter(n, 800);
      left[sample + i] += n * env * lGain;
      right[sample + i] += n * env * rGain;
    }
  }
}

// === 3. Atmospheric Swell Pads ===
// Very slow sine drones with heavy filtering, breathing in and out
// One swell every 8 bars, chord tones

const swellNotes = [
  {freq: 110, freq2: 164.81}, // A2 + E3
  {freq: 87.31, freq2: 130.81}, // F2 + C3
  {freq: 130.81, freq2: 196}, // C3 + G3
  {freq: 98, freq2: 146.83}, // G2 + D3
];

let swellBeat = 0;
let swellIdx = 0;
while (swellBeat < totalBeats) {
  const chord = swellNotes[swellIdx % swellNotes.length];
  const startSample = beatToSample(swellBeat);
  const durBeats = 16; // 4 bars per swell
  const dur = Math.floor(SAMPLE_RATE * BEAT_DURATION * durBeats);

  // Volume envelope: slow swell up and down
  const bar = Math.floor(swellBeat / 4);
  let baseVol = 0.08;
  if (bar < 6) baseVol *= bar / 6;
  if (bar > totalBeats / 4 - 6) baseVol *= Math.max(0, (totalBeats / 4 - bar) / 6);

  for (let i = 0; i < dur && startSample + i < TOTAL_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    const durSec = dur / SAMPLE_RATE;
    // Swell envelope: sine-shaped rise and fall
    const env = Math.sin((t / durSec) * Math.PI) * baseVol;

    // Detuned voices for warmth
    const v1 = sine(chord.freq * t);
    const v2 = sine(chord.freq * 1.002 * t);
    const v3 = sine(chord.freq2 * t);
    const v4 = sine(chord.freq2 * 0.998 * t);

    // Slight stereo spread
    left[startSample + i] += (v1 + v3 * 0.7) * env;
    right[startSample + i] += (v2 + v4 * 0.7) * env;
  }

  swellBeat += durBeats;
  swellIdx++;
}

// === 4. Soft Resonant Ping (on scene transitions) ===
// Gentle pitched tone at key moments, like a notification chime
const pingTimes = [8, 16, 26, 35, 43, 52, 64, 73, 81, 89, 95]; // scene transition times in seconds

for (const timeSec of pingTimes) {
  const startSample = Math.floor(timeSec * SAMPLE_RATE);
  if (startSample >= TOTAL_SAMPLES) continue;

  const dur = Math.floor(SAMPLE_RATE * 1.5);
  // Use different pitches cycling through a scale
  const idx = pingTimes.indexOf(timeSec);
  const freqs = [523.25, 659.26, 783.99, 523.25, 659.26]; // C5, E5, G5 cycling
  const freq = freqs[idx % freqs.length];

  for (let i = 0; i < dur && startSample + i < TOTAL_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 3) * (1 - Math.exp(-t * 200));
    const osc = sine(freq * t) * 0.5 + sine(freq * 2.001 * t) * 0.15;
    const vol = 0.04;
    // Center with slight stereo shimmer
    const shimmer = sine(3 * t) * 0.15;
    left[startSample + i] += osc * env * vol * (1 - shimmer);
    right[startSample + i] += osc * env * vol * (1 + shimmer);
  }
}

// === 5. Vinyl-like texture (very subtle) ===
// Continuous very quiet filtered noise for warmth
{
  const texLP1 = new LowPass();
  const texLP2 = new LowPass();
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    const t = i / SAMPLE_RATE;
    // Fade in/out
    let vol = 0.012;
    if (t < 3) vol *= t / 3;
    if (t > DURATION - 4) vol *= Math.max(0, (DURATION - t) / 4);

    const n1 = texLP1.filter(noise(), 300);
    const n2 = texLP2.filter(noise(), 280);
    left[i] += n1 * vol;
    right[i] += n2 * vol;
  }
}

// === Master processing ===

function softClip(x: number): number {
  return Math.tanh(x * 1.5) * 0.667;
}

const masterGain = 1.2;
for (let i = 0; i < TOTAL_SAMPLES; i++) {
  left[i] = softClip(left[i] * masterGain);
  right[i] = softClip(right[i] * masterGain);
}

// Fade in 3s, fade out 4s
const fadeInSamples = SAMPLE_RATE * 3;
const fadeOutSamples = SAMPLE_RATE * 4;
for (let i = 0; i < fadeInSamples; i++) {
  const gain = i / fadeInSamples;
  // Ease in
  const eased = gain * gain;
  left[i] *= eased;
  right[i] *= eased;
}
for (let i = 0; i < fadeOutSamples; i++) {
  const idx = TOTAL_SAMPLES - 1 - i;
  const gain = i / fadeOutSamples;
  const eased = gain * gain;
  left[idx] *= eased;
  right[idx] *= eased;
}

// === Write WAV ===

function writeWav(filePath: string, leftCh: Float32Array, rightCh: Float32Array, sampleRate: number) {
  const numSamples = leftCh.length;
  const numChannels = 2;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, leftCh[i]));
    const r = Math.max(-1, Math.min(1, rightCh[i]));
    buffer.writeInt16LE(Math.round(l * 32767), offset); offset += 2;
    buffer.writeInt16LE(Math.round(r * 32767), offset); offset += 2;
  }

  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  fs.writeFileSync(filePath, buffer);
  console.log(`Written: ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
}

const outPath = path.join(process.cwd(), 'public', 'music.wav');
writeWav(outPath, left, right, SAMPLE_RATE);
console.log('Done!');
