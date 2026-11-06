const colorBytes = value => /^#[\da-f]{6}$/i.test(value || '')
  ? [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16))
  : [37, 195, 232];
const hex = rgb => `#${rgb.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')).join('')}`;
const validRate = value => Number.isFinite(Number(value)) ? Math.max(.25, Math.min(1.5, Number(value))) : 1.2;

function blendColor(bottom, top, mode, opacity = 1) {
  const a = colorBytes(bottom), b = colorBytes(top);
  const result = a.map((left, index) => {
    const right = b[index]; let mixed = right;
    if (mode === 'Screen') mixed = 255 - ((255 - left) * (255 - right) / 255);
    if (mode === 'Add') mixed = Math.min(255, left + right);
    if (mode === 'Multiply') mixed = left * right / 255;
    if (mode === 'Overlay') mixed = left < 128 ? 2 * left * right / 255 : 255 - 2 * (255 - left) * (255 - right) / 255;
    return left + (mixed - left) * opacity;
  });
  return hex(result);
}

/** Resolve the reachable room-look graph into the single safe look format the room protocol supports. */
export function evaluateEffectGraph(graph, baseLook = {}) {
  const nodes = new Map((graph?.nodes || []).filter(node => node && typeof node.id === 'string').map(node => [node.id, node]));
  const incoming = new Map([...nodes.keys()].map(id => [id, []]));
  for (const edge of graph?.edges || []) if (Array.isArray(edge) && edge.length === 2 && incoming.has(edge[1]) && nodes.has(edge[0])) incoming.get(edge[1]).push(edge[0]);
  const base = { effect: baseLook.effect || 'pulse', rate: validRate(baseLook.rate), color: /^#[\da-f]{6}$/i.test(baseLook.color || '') ? baseLook.color : '#25c3e8', changed: false };
  const resolve = (id, path = new Set()) => {
    const node = nodes.get(id); if (!node || path.has(id)) return { ...base };
    if (node.type === 'source') return { ...base };
    const nextPath = new Set(path); nextPath.add(id);
    const inputs = (incoming.get(id) || []).map(source => resolve(source, nextPath));
    const inherited = inputs[0] || { ...base };
    if (node.type === 'output') return inherited;
    if (node.type === 'serial' || node.type === 'parallel' || node.type === 'layer') {
      return { ...inherited, effect: node.effect || inherited.effect, rate: validRate(node.rate ?? inherited.rate), color: node.color || inherited.color, opacity: Math.max(0, Math.min(1, Number(node.opacity ?? 1))), changed: true };
    }
    if (node.type === 'parallelMixer') {
      if (inputs.length < 2) return inherited;
      const rgb = inputs.map(item => colorBytes(item.color)).reduce((sum, current) => sum.map((value, i) => value + current[i]), [0, 0, 0]).map(value => value / inputs.length);
      const active = inputs.filter(item => item.changed).at(-1) || inputs.at(-1);
      return { ...active, color: hex(rgb), changed: inputs.some(item => item.changed) };
    }
    if (node.type === 'layerMixer') {
      if (inputs.length < 2) return inherited;
      let result = inputs[0];
      for (const layer of inputs.slice(1)) {
        const opacity = Math.max(0, Math.min(1, Number(layer.opacity ?? 1)));
        result = { ...(opacity >= .5 && layer.changed ? layer : result), color: blendColor(result.color, layer.color, node.blend || 'Normal', opacity), changed: result.changed || layer.changed };
      }
      return result;
    }
    // Outside, splitter/combiner, and key-mixer nodes preserve the light signal until
    // a corresponding mask or channel node is present in the graph.
    return inherited;
  };
  const output = resolve('output');
  return { effect: output.effect, rate: validRate(output.rate), color: /^#[\da-f]{6}$/i.test(output.color || '') ? output.color : base.color };
}
