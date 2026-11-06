import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEffectGraph } from '../public/effect-graph.js';

const base = { effect: 'pulse', rate: 1, color: '#808080' };

test('serial graph nodes pass the latest room look to output', () => {
  const graph = {
    nodes: [
      { id: 'source', type: 'source' },
      { id: 'serial', type: 'serial', effect: 'comet', rate: 1.2, color: '#25c3e8' },
      { id: 'output', type: 'output' },
    ],
    edges: [['source', 'serial'], ['serial', 'output']],
  };
  assert.deepEqual(evaluateEffectGraph(graph, base), { effect: 'comet', rate: 1.2, color: '#25c3e8' });
});

test('parallel branches combine color at equal weight and use a branch effect', () => {
  const graph = {
    nodes: [
      { id: 'source', type: 'source' },
      { id: 'serial', type: 'serial', effect: 'pulse', rate: 1, color: '#808080' },
      { id: 'branch', type: 'parallel', effect: 'sparkle', rate: 0.8, color: '#ff0000' },
      { id: 'mixer', type: 'parallelMixer' },
      { id: 'output', type: 'output' },
    ],
    edges: [['source', 'serial'], ['serial', 'branch'], ['serial', 'mixer'], ['branch', 'mixer'], ['mixer', 'output']],
  };
  assert.deepEqual(evaluateEffectGraph(graph, base), { effect: 'sparkle', rate: 0.8, color: '#c04040' });
});

test('layer mixer composites the top layer color with its selected blend mode', () => {
  const graph = {
    nodes: [
      { id: 'source', type: 'source' },
      { id: 'base', type: 'serial', effect: 'pulse', rate: 1, color: '#808080' },
      { id: 'layer', type: 'layer', effect: 'comet', color: '#ff0000', opacity: 1 },
      { id: 'mixer', type: 'layerMixer', blend: 'Screen' },
      { id: 'output', type: 'output' },
    ],
    edges: [['source', 'base'], ['base', 'layer'], ['base', 'mixer'], ['layer', 'mixer'], ['mixer', 'output']],
  };
  assert.deepEqual(evaluateEffectGraph(graph, base), { effect: 'comet', rate: 1, color: '#ff8080' });
});
