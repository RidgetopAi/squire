#!/usr/bin/env node

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const [chunkCountArg, chunkSizeArg] = args;
const chunkCount = Number.parseInt(chunkCountArg ?? '240', 10);
const chunkSize = Number.parseInt(chunkSizeArg ?? '24', 10);

if (!Number.isFinite(chunkCount) || chunkCount < 1 || !Number.isFinite(chunkSize) || chunkSize < 1) {
  console.error('Usage: node scripts/stream-render-benchmark.mjs [chunkCount] [chunkSize]');
  process.exit(1);
}

const words = [
  'streaming',
  'response',
  'renders',
  'markdown',
  'content',
  'while',
  'tokens',
  'arrive',
  'through',
  'socket',
  'updates',
  'state',
];

function makeChunk(index) {
  if (index > 0 && index % 53 === 0) {
    return `\n\n| Step | Signal | Status |\n| --- | --- | --- |\n| ${index} | chunk | measured |\n\n`;
  }

  if (index > 0 && index % 37 === 0) {
    return `\n\n- checkpoint ${index}\n- render path still active\n\n`;
  }

  let chunk = '';
  while (chunk.length < chunkSize) {
    chunk += `${words[(index + chunk.length) % words.length]} `;
  }
  return chunk.slice(0, chunkSize);
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

function summarize(label, samples, totalChars) {
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  const maxMs = Math.max(...samples);
  console.log(`${label}:`);
  console.log(`  chunks=${samples.length} finalChars=${totalChars}`);
  console.log(`  totalRenderMs=${totalMs.toFixed(2)}`);
  console.log(`  avgMs=${(totalMs / samples.length).toFixed(2)} p95Ms=${percentile(samples, 0.95).toFixed(2)} maxMs=${maxMs.toFixed(2)}`);
}

let content = '';
const markdownSamples = [];
const plainSamples = [];

for (let i = 0; i < chunkCount; i += 1) {
  content += makeChunk(i);

  const plainStart = performance.now();
  renderToStaticMarkup(React.createElement('div', null, content));
  plainSamples.push(performance.now() - plainStart);

  const markdownStart = performance.now();
  renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, content)
  );
  markdownSamples.push(performance.now() - markdownStart);
}

summarize('plain full-content render per chunk', plainSamples, content.length);
summarize('markdown full-content render per chunk', markdownSamples, content.length);
