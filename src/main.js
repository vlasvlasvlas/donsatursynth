import './style.css';
import * as Tone from 'tone';
import * as yaml from 'js-yaml';

// --- UI Elements ---
const btnSettings = document.getElementById('btn-settings');
const sidebar = document.getElementById('sidebar');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');

const btnHelp = document.getElementById('btn-help');
const helpModal = document.getElementById('help-modal');
const btnCloseHelp = document.getElementById('btn-close-help');

const bpmSlider = document.getElementById('bpm-slider');
const bpmVal = document.getElementById('bpm-val');
const presetSelect = document.getElementById('preset-select');
const rootNoteSelect = document.getElementById('root-note-select');
const masterVolSlider = document.getElementById('master-vol-slider');
const cookieVolSlider = document.getElementById('cookie-vol-slider');
const beatVolSlider = document.getElementById('beat-vol-slider');
const btnPlay = document.getElementById('btn-play');
const directionSelect = document.getElementById('direction-select');
const randomCountInput = document.getElementById('random-count');

// Sidebar Toggles
btnSettings.addEventListener('click', () => sidebar.classList.toggle('open'));
btnCloseSidebar.addEventListener('click', () => sidebar.classList.remove('open'));

// Modal Toggles
btnHelp.addEventListener('click', () => helpModal.classList.add('open'));
btnCloseHelp.addEventListener('click', () => helpModal.classList.remove('open'));
helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) helpModal.classList.remove('open');
});

// --- AUDIO & SEQUENCER STATE ---
let isAudioInitialized = false;
let presets = [];
let presetsLoadPromise = null;
let selectedCookie = null;

// Helper: slider dB value → audio param (-80 or lower = true silence)
function sliderDb(rawValue) {
  const v = parseFloat(rawValue);
  return v <= -79 ? -Infinity : v;
}

// Master FX chain: independent buses → Compressor → Reverb → Limiter → Destination
const masterLimiter = new Tone.Limiter(-3).toDestination();
const masterReverb = new Tone.Reverb({ decay: 2.0, wet: 0.18 }).connect(masterLimiter);
const masterCompressor = new Tone.Compressor(-24, 4).connect(masterReverb);

// Independent volume buses — adjusting one never affects the others
const cookieBus = new Tone.Volume(sliderDb(cookieVolSlider.value)).connect(masterCompressor);
const drumBus = new Tone.Volume(sliderDb(beatVolSlider.value)).connect(masterCompressor);

Tone.Destination.volume.value = sliderDb(masterVolSlider.value);

const DRUM_POOL_SIZE = 1;

function createDrumVoice(track) {
  if (track === 'kick') return new Tone.MembraneSynth().connect(drumBus);
  if (track === 'snare') return new Tone.NoiseSynth().connect(drumBus);
  return new Tone.MetalSynth().connect(drumBus);
}

const drumVoices = {
  kick: Array.from({ length: DRUM_POOL_SIZE }, () => createDrumVoice('kick')),
  snare: Array.from({ length: DRUM_POOL_SIZE }, () => createDrumVoice('snare')),
  hihat: Array.from({ length: DRUM_POOL_SIZE }, () => createDrumVoice('hihat')),
};
const drumVoiceCursor = { kick: 0, snare: 0, hihat: 0 };

const drumKits = {
  '808': {
    kick: { pitchDecay: 0.05, octaves: 10, oscillator: { type: 'sine' }, envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 } },
    snare: { noise: { type: 'pink' }, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } },
    hihat: { frequency: 200, envelope: { attack: 0.001, decay: 0.1, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }
  },
  '8bit': {
    kick: { pitchDecay: 0.01, octaves: 4, oscillator: { type: 'square' }, envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 } },
    snare: { noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.1, sustain: 0 } },
    hihat: { frequency: 800, envelope: { attack: 0.001, decay: 0.02, release: 0.01 }, harmonicity: 1, modulationIndex: 10, resonance: 1000, octaves: 1 }
  },
  'electro': {
    kick: { pitchDecay: 0.1, octaves: 6, oscillator: { type: 'triangle' }, envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 } },
    snare: { noise: { type: 'white' }, envelope: { attack: 0.005, decay: 0.05, sustain: 0 } },
    hihat: { frequency: 300, envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 4, modulationIndex: 20, resonance: 3000, octaves: 1.5 }
  }
};

function setDrumKit(kitName) {
  const kit = drumKits[kitName] || drumKits['808'];
  drumVoices.kick.forEach((voice) => voice.set(kit.kick));
  drumVoices.snare.forEach((voice) => voice.set(kit.snare));
  drumVoices.hihat.forEach((voice) => voice.set(kit.hihat));
}
setDrumKit('808');

document.getElementById('drum-kit-select').addEventListener('change', (e) => setDrumKit(e.target.value));

Tone.Transport.bpm.value = parseInt(bpmSlider.value, 10);

// Root Note Logic
let rootNoteStr = "C";
const scaleIntervals = [0, 3, 5, 7, 10]; // C Minor Pentatonic intervals

function getNoteFromIndex(index) {
  const rootFreq = Tone.Frequency(rootNoteStr + "3").toMidi();
  const octaveShift = Math.floor(index / 5);
  let scaleDegree = index % 5;
  if (scaleDegree < 0) scaleDegree += 5;
  const interval = scaleIntervals[scaleDegree];
  return Tone.Frequency(rootFreq + (octaveShift * 12) + interval, "midi").toNote();
}

function populatePresetSelect() {
  const selectedPreset = selectedCookie?.dataset.preset || presetSelect.value;
  presetSelect.innerHTML = '';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    presetSelect.appendChild(opt);
  });
  if (selectedPreset) presetSelect.value = selectedPreset;

  // Also populate the per-type sound selectors
  ['negrito-sound-select', 'dulce-sound-select'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    presets.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  });
  syncTypeSoundDropdowns();
}

async function loadPresets() {
  if (presets.length > 0) return presets;
  if (!presetsLoadPromise) {
    presetsLoadPromise = fetch(`${import.meta.env.BASE_URL}presets.yaml`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((yamlText) => {
        const data = yaml.load(yamlText);
        presets = Array.isArray(data?.presets) ? data.presets : [];
        if (presets.length === 0) throw new Error('presets.yaml no contiene presets');
        populatePresetSelect();
        return presets;
      })
      .catch((error) => {
        presetsLoadPromise = null;
        presetSelect.innerHTML = '<option value="">Error cargando presets</option>';
        throw error;
      });
  }
  return presetsLoadPromise;
}

// Shared voice per preset — all cookies of the same preset share one PolySynth.
// This means adding/removing cookies or regenerating patterns NEVER creates
// or disposes audio nodes. No CPU spikes, no clicks from disconnect().
const sharedVoices = new Map();

function createSharedVoiceForPreset(p) {
  let synth;
  const opts = p.options || {};
  if (p.type === 'FMSynth') synth = new Tone.PolySynth(Tone.FMSynth, opts);
  else if (p.type === 'AMSynth') synth = new Tone.PolySynth(Tone.AMSynth, opts);
  else if (p.type === 'MembraneSynth') synth = new Tone.PolySynth(Tone.MembraneSynth, opts);
  else synth = new Tone.PolySynth(Tone.Synth, opts);

  synth.volume.value = -6;
  synth.maxPolyphony = 32;

  let filter = null;
  if (p.filter) {
    filter = new Tone.Filter(p.filter.frequency || 1000, p.filter.type || "lowpass");
    if (p.filter.Q) filter.Q.value = p.filter.Q;
    if (p.filter.rolloff) filter.rolloff = p.filter.rolloff;
    synth.connect(filter);
    filter.connect(cookieBus);
  } else {
    synth.connect(cookieBus);
  }

  const attackTime = opts?.envelope?.attack ?? 0.01;
  const minDuration = Math.max(0.05, attackTime + 0.02);

  return { synth, minDuration, filter };
}

function getPresetById(presetId) {
  return presets.find((preset) => preset.id === presetId);
}

function getSharedVoice(presetId) {
  if (!isAudioInitialized) return null;
  if (sharedVoices.has(presetId)) return sharedVoices.get(presetId);
  const preset = getPresetById(presetId) ?? presets[0];
  if (!preset) return null;
  const voice = createSharedVoiceForPreset(preset);
  sharedVoices.set(presetId, voice);
  return voice;
}

function disposeAllSharedVoices() {
  sharedVoices.forEach(({ synth, filter }) => {
    try { synth.dispose(); } catch (_) {}
    if (filter) { try { filter.dispose(); } catch (_) {} }
  });
  sharedVoices.clear();
}

function getNextDrumVoice(track) {
  const voices = drumVoices[track];
  const voice = voices[drumVoiceCursor[track] % voices.length];
  drumVoiceCursor[track] = (drumVoiceCursor[track] + 1) % voices.length;
  return voice;
}

function disposeAllDrumVoices() {
  Object.values(drumVoices).flat().forEach((voice) => voice.dispose());
}

function clearDrumPlayingIndicators() {
  document.querySelectorAll('.step-btn.playing').forEach((button) => button.classList.remove('playing'));
}

async function initAudio() {
  if (isAudioInitialized) return;
  await loadPresets();
  await Tone.start();
  Tone.context.lookAhead = 0.3;
  await masterReverb.ready;

  isAudioInitialized = true;
  // Pre-create the shared voices for the default type sounds so first hits don't allocate
  getSharedVoice(typeSounds.negrito);
  getSharedVoice(typeSounds.dulce);
  console.log("Tone.js & Synths Initialized");
}

loadPresets().catch((error) => console.error("Error loading YAML", error));

function setPlayButtonState(isPlaying) {
  btnPlay.textContent = isPlaying ? '⏹' : '▶';
  btnPlay.setAttribute('aria-label', isPlaying ? 'Stop' : 'Play');
  btnPlay.classList.toggle('is-playing', isPlaying);
}

const visualTimeoutIds = new Set();
const VISUAL_PULSE_MS = 150;

function scheduleVisualTimeout(callback, delay) {
  const timeoutId = window.setTimeout(() => {
    visualTimeoutIds.delete(timeoutId);
    if (!document.hidden) callback();
  }, delay);
  visualTimeoutIds.add(timeoutId);
  return timeoutId;
}

function clearPendingVisuals() {
  visualTimeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
  visualTimeoutIds.clear();
  clearDrumPlayingIndicators();
  document.querySelectorAll('.cookie-draggable.playing').forEach((cookie) => {
    cookie.classList.remove('playing');
  });
}

function audioNow() {
  return Tone.getContext?.().rawContext?.currentTime ?? Tone.now();
}

function scheduleVisualAtAudioTime(time, callback) {
  if (document.hidden) return;
  const delay = Math.max(0, (time - audioNow()) * 1000);
  scheduleVisualTimeout(callback, delay);
}

function bpmAtTime(time) {
  if (typeof Tone.Transport.bpm.getValueAtTime === 'function') {
    return Tone.Transport.bpm.getValueAtTime(time);
  }
  return Tone.Transport.bpm.value;
}

function subdivisionSeconds(subdivision, time) {
  const quarterNoteSeconds = 60 / bpmAtTime(time);
  if (subdivision === '8n') return quarterNoteSeconds / 2;
  if (subdivision === '16n') return quarterNoteSeconds / 4;
  return quarterNoteSeconds;
}

function transportStepIndex(time, subdivision) {
  const ppq = Tone.Transport.PPQ;
  const ticksPerStep = subdivision === '16n' ? ppq / 4 : ppq / 2;
  const ticks = Tone.Transport.getTicksAtTime(time);
  return Math.floor((ticks + 0.0001) / ticksPerStep);
}

let currentStep = 0;
let patternStepOffset = 0;

const sequenceEventId = Tone.Transport.scheduleRepeat((time) => {
  const transportStep = transportStepIndex(time, '8n');

  // Autogen: regenerate synchronously at start of every N-th measure.
  // MUST happen BEFORE the play-notes logic so this callback picks up the
  // new hexGrid immediately — otherwise the boundary 8n plays the old
  // pattern's step-0 (a phantom note) and the new pattern is late by 250ms.
  if (autogenCheckbox?.checked && transportStep > 0 && !document.hidden) {
    const targetMeasures = Math.max(1, parseInt(document.getElementById('autogen-bars')?.value, 10) || 4);
    if (transportStep % (8 * targetMeasures) === 0) {
      generateRandomPattern();
      patternStepOffset = transportStep; // Reset local step so new pattern starts at minQ
    }
  }

  const dir = directionSelect.value;

  if (hexGrid.size === 0) return;

  // 2. Calculate Boundaries for Auto-Loop
  let minQ = Infinity, maxQ = -Infinity;
  let minR = Infinity, maxR = -Infinity;
  const occupiedCoords = [];

  hexGrid.forEach((cookie, key) => {
    const [q, r] = key.split(',').map(Number);
    if (q < minQ) minQ = q;
    if (q > maxQ) maxQ = q;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    occupiedCoords.push({q, r, cookie});
  });

  // 3. Step position from the Transport clock so drums and sequence stay locked.
  const localStep = Math.max(0, transportStep - patternStepOffset);
  if (dir === 'LR') {
    currentStep = minQ + (localStep % (maxQ - minQ + 1));
  } else if (dir === 'RL') {
    currentStep = maxQ - (localStep % (maxQ - minQ + 1));
  } else if (dir === 'TB') {
    currentStep = minR + (localStep % (maxR - minR + 1));
  } else if (dir === 'BT') {
    currentStep = maxR - (localStep % (maxR - minR + 1));
  }

  // 4. Find nodes to play
  const nodesToPlay = [];
  if (dir === 'RND') {
    const randomIdx = Math.floor(Math.random() * occupiedCoords.length);
    nodesToPlay.push(occupiedCoords[randomIdx]);
  } else {
    occupiedCoords.forEach(node => {
      if ((dir === 'LR' || dir === 'RL') && node.q === currentStep) nodesToPlay.push(node);
      if ((dir === 'TB' || dir === 'BT') && node.r === currentStep) nodesToPlay.push(node);
    });
  }

  // 5. Trigger Audio & Visuals
  nodesToPlay.forEach(({cookie, r}) => {
    scheduleVisualAtAudioTime(time, () => {
      cookie.classList.add('playing');
      scheduleVisualTimeout(() => cookie.classList.remove('playing'), VISUAL_PULSE_MS);
    });

    const presetId = cookie.dataset.preset;
    if (presetId) {
      const voice = getSharedVoice(presetId);
      if (!voice) return;
      const note = getNoteFromIndex(r);
      const stepDur = subdivisionSeconds("8n", time);
      const noteDur = Math.max(stepDur, voice.minDuration ?? stepDur);
      voice.synth.triggerAttackRelease(note, noteDur, time);
    }
  });
}, "8n");

// --- MASTER CONTROLS ---
btnPlay.addEventListener('click', async () => {
  try {
    if (!isAudioInitialized) await initAudio();
  } catch (error) {
    console.error("Error initializing audio", error);
    setPlayButtonState(false);
    return;
  }

  if (Tone.Transport.state === 'started') {
    Tone.Transport.stop();
    clearPendingVisuals();
    currentStep = 0;
    patternStepOffset = 0;
    setPlayButtonState(false);
  } else {
    Tone.Transport.start('+0.05');
    setPlayButtonState(true);
  }
});

bpmSlider.addEventListener('input', (e) => {
  const bpm = parseInt(e.target.value);
  bpmVal.textContent = bpm;
  Tone.Transport.bpm.value = bpm;
});
masterVolSlider.addEventListener('input', (e) => {
  Tone.Destination.volume.value = sliderDb(e.target.value);
});
cookieVolSlider.addEventListener('input', (e) => {
  cookieBus.volume.value = sliderDb(e.target.value);
});
beatVolSlider.addEventListener('input', (e) => {
  drumBus.volume.value = sliderDb(e.target.value);
});
rootNoteSelect.addEventListener('change', (e) => {
  rootNoteStr = e.target.value;
});
directionSelect.addEventListener('change', () => { currentStep = 0; });

// Cookie count step = bars count, so total is always a multiple of bars
function updateCookieCountStep() {
  const barsInput = document.getElementById('autogen-bars');
  const countInput = document.getElementById('random-count');
  if (!barsInput || !countInput) return;
  const bars = Math.max(1, parseInt(barsInput.value, 10) || 4);
  countInput.step = bars;
  countInput.min = bars;
  countInput.max = bars * 16;
  // Snap current value to nearest multiple of bars
  const current = parseInt(countInput.value, 10) || bars * 4;
  countInput.value = Math.max(bars, Math.round(current / bars) * bars);
}
document.getElementById('autogen-bars').addEventListener('input', updateCookieCountStep);
updateCookieCountStep(); // initialise on load

// Type sound selectors — update existing cookies of that type immediately
function applyTypeSoundToExisting(type, newPreset) {
  hexGrid.forEach((cookie) => {
    if (cookie.dataset.type !== type) return;
    cookie.dataset.preset = newPreset;
    if (selectedCookie === cookie) presetSelect.value = newPreset;
  });
  // Ensure the shared voice exists so first hit doesn't allocate
  getSharedVoice(newPreset);
}

// Play a short preview note so the user hears the new sound immediately
function previewPreset(presetId) {
  const voice = getSharedVoice(presetId);
  if (!voice) return;
  voice.synth.triggerAttackRelease('C4', '8n', Tone.now() + 0.05);
}

document.getElementById('negrito-sound-select')?.addEventListener('change', (e) => {
  typeSounds.negrito = e.target.value;
  applyTypeSoundToExisting('negrito', e.target.value);
  previewPreset(e.target.value);
});
document.getElementById('dulce-sound-select')?.addEventListener('change', (e) => {
  typeSounds.dulce = e.target.value;
  applyTypeSoundToExisting('dulce', e.target.value);
  previewPreset(e.target.value);
});


// --- DRUM MACHINE LOGIC ---
const drumSteps = { kick: Array(16).fill(false), snare: Array(16).fill(false), hihat: Array(16).fill(false) };
document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!isAudioInitialized) await initAudio();
    const track = btn.closest('.drum-track').dataset.track;
    const step = parseInt(btn.dataset.step, 10);
    drumSteps[track][step] = !drumSteps[track][step];
    btn.classList.toggle('active', drumSteps[track][step]);
  });
});

const drumEventId = Tone.Transport.scheduleRepeat((time) => {
  const step = transportStepIndex(time, '16n') % 16;
  
  scheduleVisualAtAudioTime(time, () => {
    clearDrumPlayingIndicators();
    document.querySelectorAll(`.step-btn[data-step="${step}"]`).forEach(b => b.classList.add('playing'));
  });

  if (drumSteps.kick[step]) getNextDrumVoice('kick').triggerAttack("C1", time);
  if (drumSteps.snare[step]) getNextDrumVoice('snare').triggerAttack(time);
  if (drumSteps.hihat[step]) {
    const hihat = getNextDrumVoice('hihat');
    hihat.triggerAttack(hihat.frequency.value, time);
  }
}, "16n");

// --- TYPE SOUNDS: preset per cookie type ---
// When a cookie is created or flipped, it gets the preset assigned to its type here
const typeSounds = {
  negrito: 'minimoog',
  dulce: 'vangelis',
  // Helper: given a random index 0|1, return the type string
  nextType(idx) { return idx === 0 ? 'negrito' : 'dulce'; },
  presetFor(type) { return type === 'negrito' ? this.negrito : this.dulce; }
};

// Sync the dropdowns if they exist (populated after presets load)
function syncTypeSoundDropdowns() {
  const negSel = document.getElementById('negrito-sound-select');
  const dulSel = document.getElementById('dulce-sound-select');
  if (negSel) negSel.value = typeSounds.negrito;
  if (dulSel) dulSel.value = typeSounds.dulce;
}

// --- AUTO GENERATOR LOGIC ---
// Regeneration itself is triggered from within the sequencer callback
// (see the transportStep % (8 * targetMeasures) check). Nothing to schedule here.
const autogenCheckbox = document.getElementById('autogen-checkbox');

autogenCheckbox.addEventListener('change', async (e) => {
  if (!e.target.checked) return;
  try {
    if (!isAudioInitialized) await initAudio();
  } catch (err) {
    console.error(err);
    return;
  }
  generateRandomPattern();
  if (Tone.Transport.state !== 'started') {
    Tone.Transport.start('+0.05');
    setPlayButtonState(true);
  }
});

function generateRandomPattern() {
  _buildPattern();
}

// Biased adjacent hex: organic growth that prefers extending in the sweep direction
function getAdjacentHexBiased(dirAxis, maxCoord) {
  if (hexGrid.size === 0) return { q: 0, r: 0 };
  const directions = [{q:1,r:0},{q:1,r:-1},{q:0,r:-1},{q:-1,r:0},{q:-1,r:1},{q:0,r:1}];
  const occupied = Array.from(hexGrid.keys()).map(k => {
    const [q, r] = k.split(',').map(Number);
    return { q, r };
  });
  const currentMax = dirAxis === 'q'
    ? Math.max(...occupied.map(h => h.q))
    : Math.max(...occupied.map(h => h.r));

  const candidates = [];
  for (const hex of occupied) {
    for (const d of directions) {
      const nq = hex.q + d.q;
      const nr = hex.r + d.r;
      if (hexGrid.has(`${nq},${nr}`)) continue;
      const coord = dirAxis === 'q' ? nq : nr;
      if (coord < 0 || coord > maxCoord) continue;
      // Weight 4× toward advancing the sweep front, 1× otherwise
      const w = coord > currentMax ? 4 : 1;
      for (let i = 0; i < w; i++) candidates.push({ q: nq, r: nr });
    }
  }
  if (candidates.length === 0) return getRandomAdjacentHex();
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function _buildPattern() {
  clearGrid();

  const dir = directionSelect.value;
  const bars = Math.max(1, parseInt(document.getElementById('autogen-bars')?.value, 10) || 4);
  const rawCount = parseInt(document.getElementById('random-count')?.value, 10) || bars * 4;
  // Snap to nearest multiple of bars (the musical relationship)
  const total = Math.max(bars, Math.round(rawCount / bars) * bars);
  const rnd = () => Math.floor(Math.random() * 2);

  if (dir === 'LR' || dir === 'RL') {
    const maxQ = 8 * bars - 1;
    addCookieToCanvas(typeSounds.nextType(rnd()), 0, 0);
    let tries = 0;
    while (hexGrid.size < total && tries < total * 20) {
      tries++;
      addCookieToCanvas(typeSounds.nextType(rnd()), ...Object.values(getAdjacentHexBiased('q', maxQ)));
    }
  } else if (dir === 'TB' || dir === 'BT') {
    const maxR = 8 * bars - 1;
    addCookieToCanvas(typeSounds.nextType(rnd()), 0, 0);
    let tries = 0;
    while (hexGrid.size < total && tries < total * 20) {
      tries++;
      addCookieToCanvas(typeSounds.nextType(rnd()), ...Object.values(getAdjacentHexBiased('r', maxR)));
    }
  } else {
    // RND: pure organic growth, no bounds
    addCookieToCanvas(typeSounds.nextType(rnd()), 0, 0);
    for (let i = 1; i < total; i++) {
      const { q, r } = getRandomAdjacentHex();
      addCookieToCanvas(typeSounds.nextType(rnd()), q, r);
    }
  }
}


// --- DRAG, DROP, PAN & HEX GRID LOGIC ---
const canvasContainer = document.getElementById('canvas-container');
const gridLayer = document.getElementById('grid-layer');
const navCookies = document.querySelectorAll('.nav-cookie');
const globalConfig = document.getElementById('global-config');
const cookieConfig = document.getElementById('cookie-config');
const configCookieType = document.getElementById('config-cookie-type');

// Hex Math Constants
const HEX_SIZE = 46.19; 
const HEX_WIDTH = 80;
const HEX_HEIGHT = 92.38;
const hexGrid = new Map();

// Panning State
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

canvasContainer.addEventListener('mousedown', (e) => {
  if (e.target !== canvasContainer && e.target !== gridLayer) return;
  isPanning = true;
  startPanX = e.clientX - panX;
  startPanY = e.clientY - panY;
});
window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = e.clientX - startPanX;
  panY = e.clientY - startPanY;
  gridLayer.style.transform = `translate(${panX}px, ${panY}px)`;
});
window.addEventListener('mouseup', () => { isPanning = false; });

let cachedCanvasCenter = null;
function getCanvasCenter() {
  if (cachedCanvasCenter) return cachedCanvasCenter;
  const rect = canvasContainer.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return { x: 0, y: 0 };
  cachedCanvasCenter = { x: rect.width / 2, y: rect.height / 2 };
  return cachedCanvasCenter;
}

function pixelToHex(x, y) {
  const center = getCanvasCenter();
  const px = x - center.x - panX;
  const py = y - center.y - panY;
  const q = (Math.sqrt(3)/3 * px - 1/3 * py) / HEX_SIZE;
  const r = (2/3 * py) / HEX_SIZE;
  return cubeToAxial(cubeRound({q, r, s: -q-r}));
}

function hexToPixel(q, r) {
  const center = getCanvasCenter();
  const x = HEX_SIZE * Math.sqrt(3) * (q + r/2);
  const y = HEX_SIZE * 3/2 * r;
  return { x: x + center.x, y: y + center.y };
}

function updateAllCookiesPositions() {
  hexGrid.forEach((cookie, key) => {
    const [q, r] = key.split(',').map(Number);
    const pos = hexToPixel(q, r);
    cookie.style.left = `${pos.x - HEX_WIDTH/2}px`;
    cookie.style.top = `${pos.y - HEX_HEIGHT/2}px`;
  });
}

function cubeRound(cube) {
  let rx = Math.round(cube.q);
  let ry = Math.round(cube.r);
  let rz = Math.round(cube.s);
  const x_diff = Math.abs(rx - cube.q);
  const y_diff = Math.abs(ry - cube.r);
  const z_diff = Math.abs(rz - cube.s);
  if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz;
  else if (y_diff > z_diff) ry = -rx - rz;
  else rz = -rx - ry;
  return { q: rx, r: ry, s: rz };
}

function cubeToAxial(cube) {
  return { q: cube.q, r: cube.r };
}

function addCookieToCanvas(type, q, r) {
  const key = `${q},${r}`;
  if (hexGrid.has(key)) return null; 

  const newCookie = document.createElement('div');
  newCookie.classList.add('cookie-draggable', type);
  // Permitir dragear las galletas del lienzo
  newCookie.setAttribute('draggable', 'true');
  newCookie.dataset.q = q;
  newCookie.dataset.r = r;
  newCookie.dataset.type = type;
  
  newCookie.dataset.preset = typeSounds.presetFor(type);
  
  newCookie.style.position = 'absolute';
  const { x: baseX, y: baseY } = hexToPixel(q, r);
  
  newCookie.style.left = `${baseX - HEX_WIDTH/2}px`;
  newCookie.style.top = `${baseY - HEX_HEIGHT/2}px`;

  let _mdTime = 0;
  let _dragged = false;

  newCookie.addEventListener('mousedown', () => {
    _mdTime = Date.now();
    _dragged = false;
  });

  newCookie.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_dragged) return;
    const elapsed = Date.now() - _mdTime;
    if (elapsed < 280) {
      flipCookie(newCookie);
    } else {
      selectCookie(newCookie);
    }
  });

  // Drag de galletas ya ubicadas
  newCookie.addEventListener('dragstart', (e) => {
    _dragged = true;
    e.dataTransfer.setData('cookie-type', newCookie.dataset.type);
    e.dataTransfer.setData('cookie-q', newCookie.dataset.q);
    e.dataTransfer.setData('cookie-r', newCookie.dataset.r);
    e.dataTransfer.setData('is-move', 'true');
    setTimeout(() => { newCookie.style.opacity = '0.5'; }, 0);
  });

  newCookie.addEventListener('dragend', () => {
    newCookie.style.opacity = '1';
  });

  gridLayer.appendChild(newCookie);
  hexGrid.set(key, newCookie);
  return newCookie;
}

function getRandomAdjacentHex() {
  if (hexGrid.size === 0) return { q: 0, r: 0 };
  const directions = [{q:1,r:0}, {q:1,r:-1}, {q:0,r:-1}, {q:-1,r:0}, {q:-1,r:1}, {q:0,r:1}];
  const occupied = Array.from(hexGrid.keys()).map(k => {
    const [q, r] = k.split(',').map(Number);
    return {q, r};
  });
  const candidates = [];
  for (const hex of occupied) {
    for (const dir of directions) {
      const nq = hex.q + dir.q;
      const nr = hex.r + dir.r;
      if (!hexGrid.has(`${nq},${nr}`)) candidates.push({q: nq, r: nr});
    }
  }
  if (candidates.length === 0) return { q: 0, r: 0 };
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Nav Cookie Logic
navCookies.forEach(navCookie => {
  navCookie.addEventListener('click', () => {
    const type = navCookie.dataset.type;
    const { q, r } = getRandomAdjacentHex();
    addCookieToCanvas(type, q, r);
  });
  
  navCookie.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('cookie-type', e.target.dataset.type);
    e.dataTransfer.setData('is-move', 'false');
    e.target.style.opacity = '0.5';
  });
  navCookie.addEventListener('dragend', (e) => {
    e.target.style.opacity = '1';
  });
});

const trashZone = document.getElementById('trash-zone');
if (trashZone) {
  trashZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    trashZone.classList.add('drag-over');
  });
  trashZone.addEventListener('dragleave', () => {
    trashZone.classList.remove('drag-over');
  });
  trashZone.addEventListener('drop', (e) => {
    e.preventDefault();
    trashZone.classList.remove('drag-over');
    
    const isMove = e.dataTransfer.getData('is-move') === 'true';
    if (isMove) {
      const oldQ = e.dataTransfer.getData('cookie-q');
      const oldR = e.dataTransfer.getData('cookie-r');
      const oldKey = `${oldQ},${oldR}`;
      if (hexGrid.has(oldKey)) {
        const oldNode = hexGrid.get(oldKey);
        hexGrid.delete(oldKey);
        oldNode.remove();
        if (selectedCookie === oldNode) {
          selectCookie(null);
        }
      }
    }
  });
}

canvasContainer.addEventListener('dragover', (e) => e.preventDefault());
canvasContainer.addEventListener('drop', (e) => {
  e.preventDefault();
  const type = e.dataTransfer.getData('cookie-type');
  const isMove = e.dataTransfer.getData('is-move') === 'true';
  if (!type) return;
  
  const rect = canvasContainer.getBoundingClientRect();
  const { q, r } = pixelToHex(e.clientX - rect.left, e.clientY - rect.top);
  
  if (isMove) {
    // Si estamos moviendo, borramos la galleta anterior de la vieja posición
    const oldQ = e.dataTransfer.getData('cookie-q');
    const oldR = e.dataTransfer.getData('cookie-r');
    const oldKey = `${oldQ},${oldR}`;
    if (hexGrid.has(oldKey)) {
      const oldNode = hexGrid.get(oldKey);
      // Solo mover si la nueva celda está libre
      if (!hexGrid.has(`${q},${r}`)) {
        hexGrid.delete(oldKey);
        
        // Actualizar el DOM y datos
        oldNode.dataset.q = q;
        oldNode.dataset.r = r;
        
        const center = getCanvasCenter();
        const baseX = HEX_SIZE * Math.sqrt(3) * (q + r/2) + center.x;
        const baseY = HEX_SIZE * 3/2 * r + center.y;
        
        oldNode.style.left = `${baseX - HEX_WIDTH/2}px`;
        oldNode.style.top = `${baseY - HEX_HEIGHT/2}px`;
        
        hexGrid.set(`${q},${r}`, oldNode);
      }
    }
  } else {
    // Es una nueva galleta desde el navbar
    addCookieToCanvas(type, q, r);
  }
});

canvasContainer.addEventListener('click', () => selectCookie(null));

function flipCookie(cookie) {
  const currentType = cookie.dataset.type;
  const newType = currentType === 'negrito' ? 'dulce' : 'negrito';
  const newPreset = typeSounds.presetFor(newType);

  cookie.classList.remove(currentType);
  cookie.classList.add(newType);
  cookie.dataset.type = newType;
  cookie.dataset.preset = newPreset;

  cookie.classList.add('flipping');
  cookie.addEventListener('animationend', () => cookie.classList.remove('flipping'), { once: true });

  getSharedVoice(newPreset);

  if (selectedCookie === cookie) {
    configCookieType.textContent = newType === 'negrito' ? 'Negrito (Bajo)' : 'Dulce (Melodía)';
    presetSelect.value = newPreset;
  }
}

function selectCookie(cookieNode) {
  if (selectedCookie) selectedCookie.classList.remove('selected');
  selectedCookie = cookieNode;
  
  if (selectedCookie) {
    selectedCookie.classList.add('selected');
    sidebar.classList.add('open');
    globalConfig.classList.add('hidden');
    cookieConfig.classList.remove('hidden');
    
    configCookieType.textContent = selectedCookie.dataset.type === 'negrito' ? 'Negrito (Bajo)' : 'Dulce (Melodía)';
    presetSelect.value = selectedCookie.dataset.preset || '';
  } else {
    globalConfig.classList.remove('hidden');
    cookieConfig.classList.add('hidden');
  }
}

presetSelect.addEventListener('change', (e) => {
  if (!selectedCookie) return;
  selectedCookie.dataset.preset = e.target.value;
  getSharedVoice(e.target.value);
});

document.getElementById('btn-remove-cookie').addEventListener('click', () => {
  if (selectedCookie) {
    hexGrid.delete(`${selectedCookie.dataset.q},${selectedCookie.dataset.r}`);
    selectedCookie.remove();
    selectCookie(null);
  }
});

function clearGrid() {
  currentStep = 0;
  clearDrumPlayingIndicators();
  hexGrid.clear();
  gridLayer.querySelectorAll('.cookie-draggable:not(.nav-cookie)').forEach(c => c.remove());
  selectCookie(null);
}

document.getElementById('btn-clear').addEventListener('click', () => clearGrid());

document.getElementById('btn-generate-manual').addEventListener('click', async () => {
  try {
    if (!isAudioInitialized) await initAudio();
    if (Tone.Transport.state !== 'started') {
      Tone.Transport.start('+0.05');
      setPlayButtonState(true);
    }
  } catch (err) {
    console.error(err);
  }
  generateRandomPattern();
  patternStepOffset = transportStepIndex(audioNow(), '8n');
});

window.addEventListener('resize', () => {
  cachedCanvasCenter = null;
  updateAllCookiesPositions();
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    clearPendingVisuals();
    return;
  }
  clearPendingVisuals();
  if (Tone.Transport.state === 'started') {
    try { await Tone.start(); } catch (error) { console.error("Error resuming audio", error); }
  }
});

window.addEventListener('pagehide', clearPendingVisuals);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearPendingVisuals();
    Tone.Transport.clear(sequenceEventId);
    Tone.Transport.clear(drumEventId);
    disposeAllSharedVoices();
    disposeAllDrumVoices();
    cookieBus.dispose();
    drumBus.dispose();
    masterCompressor.dispose();
    masterReverb.dispose();
    masterLimiter.dispose();
  });
}

if (import.meta.env.DEV) {
  window.__DON_SATUR_SYNTH_DEBUG__ = {
    get cookieCount() { return hexGrid.size; },
    get cookieVoiceCount() { return sharedVoices.size; },
    get transportTicks() { return Tone.Transport.ticks; },
    get visualTimeoutCount() { return visualTimeoutIds.size; },
  };
}

console.log('Don Satur Synth Ready!');
