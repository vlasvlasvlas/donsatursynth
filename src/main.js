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
let isInAudioCallback = false;
let presets = [];
let presetsLoadPromise = null;
const cookieVoices = new Map();
const activeDroneNotes = new Map();
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
const droneBus = new Tone.Volume(-10).connect(masterCompressor);
const drumBus = new Tone.Volume(sliderDb(beatVolSlider.value)).connect(masterCompressor);

Tone.Destination.volume.value = sliderDb(masterVolSlider.value);

// Drone synth routed through its own bus
const droneSynth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "sine" },
  envelope: { attack: 2, decay: 1, sustain: 1, release: 4 }
}).connect(droneBus);

// Kept for legacy compatibility (drumBus replaces this)
const drumVol = drumBus;

const DRUM_POOL_SIZE = 8;

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

function getNoteFromIndex(index, cookieType = null) {
  const rootFreq = Tone.Frequency(rootNoteStr + "3").toMidi();
  const octaveShift = Math.floor(index / 5);
  let scaleDegree = index % 5;
  if (scaleDegree < 0) scaleDegree += 5;
  const interval = scaleIntervals[scaleDegree];
  // Negrita always plays one octave lower → clear bass vs melody separation
  const typeOffset = cookieType === 'negrito' ? -12 : 0;
  return Tone.Frequency(rootFreq + (octaveShift * 12) + interval + typeOffset, "midi").toNote();
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

function createVoiceForPreset(p) {
  let synth;
  if (p.type === 'FMSynth') synth = new Tone.FMSynth(p.options || {});
  else if (p.type === 'AMSynth') synth = new Tone.AMSynth(p.options || {});
  else if (p.type === 'MembraneSynth') synth = new Tone.MembraneSynth(p.options || {});
  else if (p.type === 'PolySynth') synth = new Tone.PolySynth(Tone.Synth, p.options || {});
  else synth = new Tone.Synth(p.options || {});

  synth.volume.value = -6;
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

  // Minimum note duration: note must last at least through the attack phase
  const attackTime = p.options?.envelope?.attack ?? 0.01;
  const minDuration = Math.max(0.05, attackTime + 0.02);

  return {
    synth,
    minDuration,
    dispose() {
      // Release with small look-ahead so the envelope fades cleanly (no click)
      const releaseAt = Tone.now() + 0.05;
      try {
        if (typeof synth.releaseAll === 'function') synth.releaseAll(releaseAt);
        else if (typeof synth.triggerRelease === 'function') synth.triggerRelease(releaseAt);
      } catch (_) {}
      // Defer actual disposal so the release tail fades before the node is removed
      window.setTimeout(() => {
        try { synth.dispose(); } catch (_) {}
        if (filter) { try { filter.dispose(); } catch (_) {} }
      }, 250);
    }
  };
}

function getPresetById(presetId) {
  return presets.find((preset) => preset.id === presetId);
}

function disposeCookieVoice(cookie) {
  const voice = cookieVoices.get(cookie);
  if (!voice) return;
  voice.dispose();
  cookieVoices.delete(cookie);
}

function disposeAllCookieVoices() {
  cookieVoices.forEach((voice) => voice.dispose());
  cookieVoices.clear();
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

function ensureCookieVoice(cookie) {
  if (!isAudioInitialized) return null;
  const presetId = cookie.dataset.preset;
  if (!presetId) return null;
  const currentVoice = cookieVoices.get(cookie);
  if (currentVoice?.presetId === presetId) return currentVoice;
  // Don't create new nodes during scheduling callbacks — causes audio glitches
  if (isInAudioCallback) return currentVoice ?? null;

  disposeCookieVoice(cookie);
  const preset = getPresetById(presetId);
  if (!preset) return null;

  const voice = createVoiceForPreset(preset);
  voice.presetId = presetId;
  cookieVoices.set(cookie, voice);
  return voice;
}

async function initAudio() {
  if (isAudioInitialized) return;
  await loadPresets();
  await Tone.start();
  // Increase lookahead for stable scheduling (less dropout risk)
  Tone.context.lookAhead = 0.3;
  await masterReverb.ready;

  isAudioInitialized = true;
  hexGrid.forEach((cookie) => ensureCookieVoice(cookie));
  console.log("Tone.js & Synths Initialized");
}

loadPresets().catch((error) => console.error("Error loading YAML", error));

function getActiveDroneDegrees() {
  return Array.from(document.querySelectorAll('.key-btn.active'))
    .map((btn) => parseInt(btn.dataset.degree, 10))
    .filter((degree) => Number.isFinite(degree));
}

function releaseDroneDegree(degree, time = Tone.now()) {
  const note = activeDroneNotes.get(degree);
  if (!note) return;
  droneSynth.triggerRelease(note, time);
  activeDroneNotes.delete(degree);
}

function releaseActiveDrones(time = Tone.now()) {
  activeDroneNotes.forEach((note) => droneSynth.triggerRelease(note, time));
  activeDroneNotes.clear();
}

function attackDroneDegree(degree, time = Tone.now()) {
  releaseDroneDegree(degree, time);
  const note = getNoteFromIndex(degree - 5);
  droneSynth.triggerAttack(note, time);
  activeDroneNotes.set(degree, note);
}

function syncActiveDrones(time = Tone.now()) {
  if (!isAudioInitialized) return;
  const activeDegrees = getActiveDroneDegrees();
  activeDroneNotes.forEach((note, degree) => {
    if (!activeDegrees.includes(degree)) releaseDroneDegree(degree, time);
  });
  activeDegrees.forEach((degree) => {
    if (!activeDroneNotes.has(degree)) attackDroneDegree(degree, time);
  });
}

function retuneActiveDrones() {
  if (!isAudioInitialized || activeDroneNotes.size === 0) return;
  const activeDegrees = getActiveDroneDegrees();
  releaseActiveDrones();
  activeDegrees.forEach((degree) => attackDroneDegree(degree));
}

function setPlayButtonState(isPlaying) {
  btnPlay.textContent = isPlaying ? '⏸' : '▶';
  btnPlay.setAttribute('aria-label', isPlaying ? 'Pausar' : 'Play');
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
const sequenceEventId = Tone.Transport.scheduleRepeat((time) => {
  isInAudioCallback = true;
  try {
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
  const transportStep = transportStepIndex(time, '8n');
  if (dir === 'LR') {
    currentStep = minQ + (transportStep % (maxQ - minQ + 1));
  } else if (dir === 'RL') {
    currentStep = maxQ - (transportStep % (maxQ - minQ + 1));
  } else if (dir === 'TB') {
    currentStep = minR + (transportStep % (maxR - minR + 1));
  } else if (dir === 'BT') {
    currentStep = maxR - (transportStep % (maxR - minR + 1));
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
      const voice = ensureCookieVoice(cookie);
      if (!voice) return;
      const note = getNoteFromIndex(r, cookie.dataset.type);
      // Clamp duration so the attack phase always completes (prevents mid-attack clicks)
      const stepDur = subdivisionSeconds("8n", time);
      const noteDur = Math.max(stepDur, voice.minDuration ?? stepDur);
      voice.synth.triggerAttackRelease(note, noteDur, time);
    }
  });
  } finally {
    isInAudioCallback = false;
  }
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
    Tone.Transport.pause();
    releaseActiveDrones();
    clearDrumPlayingIndicators();
    setPlayButtonState(false);
  } else {
    Tone.Transport.start();
    syncActiveDrones();
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
const droneVolSlider = document.getElementById('drone-vol-slider');
droneVolSlider.addEventListener('input', (e) => {
  droneBus.volume.value = sliderDb(e.target.value);
});
beatVolSlider.addEventListener('input', (e) => {
  drumBus.volume.value = sliderDb(e.target.value);
});
rootNoteSelect.addEventListener('change', (e) => {
  rootNoteStr = e.target.value;
  retuneActiveDrones();
});
directionSelect.addEventListener('change', () => { currentStep = 0; });

// Drone Keyboard Toggles
document.querySelectorAll('.key-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    try {
      if (!isAudioInitialized) await initAudio();
    } catch (error) {
      console.error("Error initializing audio", error);
      return;
    }
    btn.classList.toggle('active');
    const degree = parseInt(btn.dataset.degree);
    if (btn.classList.contains('active')) {
      attackDroneDegree(degree);
    } else {
      releaseDroneDegree(degree);
    }
  });
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

  const drumDuration = subdivisionSeconds("16n", time);
  if (drumSteps.kick[step]) getNextDrumVoice('kick').triggerAttackRelease("C1", drumDuration, time);
  if (drumSteps.snare[step]) getNextDrumVoice('snare').triggerAttackRelease(drumDuration, time);
  if (drumSteps.hihat[step]) {
    const hihat = getNextDrumVoice('hihat');
    hihat.triggerAttackRelease(hihat.frequency.value, drumDuration, time);
  }
}, "16n");

// --- AUTO GENERATOR LOGIC ---
const autogenCheckbox = document.getElementById('autogen-checkbox');
let measureCounter = 0;
let autogenRequestPending = false;
let autogenTimeoutId = null;
let deferredAutogenWhileHidden = false;

function clearAutogenRequest(defer = false) {
  if (autogenTimeoutId !== null) {
    window.clearTimeout(autogenTimeoutId);
    autogenTimeoutId = null;
  }
  autogenRequestPending = false;
  if (defer) deferredAutogenWhileHidden = true;
}

function requestGeneratedPattern() {
  if (document.hidden) {
    deferredAutogenWhileHidden = true;
    return;
  }
  if (autogenRequestPending) return;
  autogenRequestPending = true;
  autogenTimeoutId = window.setTimeout(() => {
    autogenRequestPending = false;
    autogenTimeoutId = null;
    if (document.hidden) {
      deferredAutogenWhileHidden = true;
      return;
    }
    generateRandomPattern();
  }, 16);
}

autogenCheckbox.addEventListener('change', async (e) => {
  if (e.target.checked) {
    measureCounter = 0;
    requestGeneratedPattern();
    
    // Auto-start si no estaba corriendo
    if (Tone.Transport.state !== 'started') {
      try {
        if (!isAudioInitialized) await initAudio();
        Tone.Transport.start();
        syncActiveDrones();
        setPlayButtonState(true);
      } catch (err) {
        console.error(err);
      }
    }
  }
});

const autogenEventId = Tone.Transport.scheduleRepeat((time) => {
  if (!autogenCheckbox.checked) {
    measureCounter = 0;
    return;
  }
  
  const targetMeasures = Math.max(1, parseInt(document.getElementById('autogen-bars')?.value, 10) || 4);
  measureCounter++;
  
  if (measureCounter >= targetMeasures) {
    measureCounter = 0;
    requestGeneratedPattern();
  }
}, "1m"); // every 1 measure (compás)

function generateRandomPattern() {
  // Brief master fade prevents clicks from abrupt synth disposal
  if (isAudioInitialized && Tone.Transport.state === 'started') {
    const savedVol = Tone.Destination.volume.value;
    Tone.Destination.volume.rampTo(-80, 0.06);
    window.setTimeout(() => {
      _buildPattern();
      window.setTimeout(() => Tone.Destination.volume.rampTo(savedVol, 0.08), 20);
    }, 70);
  } else {
    _buildPattern();
  }
}

function _buildPattern() {
  clearGrid();

  const dir = directionSelect.value;
  const bars = Math.max(1, parseInt(document.getElementById('autogen-bars')?.value, 10) || 4);
  const requested = Math.min(100, Math.max(1, parseInt(document.getElementById('random-count')?.value, 10) || 30));
  const types = ['negrito', 'dulce'];
  const rnd = () => Math.floor(Math.random() * types.length);

  if (dir === 'LR' || dir === 'RL') {
    // 8 steps per measure → exact column count makes the loop land perfectly
    const cols = 8 * bars;
    const density = Math.max(1, Math.round(requested / cols));
    for (let q = 0; q < cols; q++) {
      const n = Math.max(0, density + (Math.random() > 0.4 ? 1 : 0) - (Math.random() > 0.6 ? 1 : 0));
      const usedRows = new Set();
      for (let i = 0; i < n; i++) {
        let r, tries = 0;
        do { r = Math.floor(Math.random() * 7) - 3; tries++; } while (usedRows.has(r) && tries < 12);
        if (!usedRows.has(r)) { usedRows.add(r); addCookieToCanvas(types[rnd()], q, r); }
      }
    }
  } else if (dir === 'TB' || dir === 'BT') {
    const rows = 8 * bars;
    const density = Math.max(1, Math.round(requested / rows));
    for (let r = 0; r < rows; r++) {
      const n = Math.max(0, density + (Math.random() > 0.4 ? 1 : 0) - (Math.random() > 0.6 ? 1 : 0));
      const usedCols = new Set();
      for (let i = 0; i < n; i++) {
        let q, tries = 0;
        do { q = Math.floor(Math.random() * 7) - 3; tries++; } while (usedCols.has(q) && tries < 12);
        if (!usedCols.has(q)) { usedCols.add(q); addCookieToCanvas(types[rnd()], q, r); }
      }
    }
  } else {
    // RND: organic adjacent growth
    addCookieToCanvas(types[rnd()], 0, 0);
    for (let i = 1; i < requested; i++) {
      const { q, r } = getRandomAdjacentHex();
      addCookieToCanvas(types[rnd()], q, r);
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

function getCanvasCenter() {
  const rect = canvasContainer.getBoundingClientRect();
  return { x: rect.width / 2, y: rect.height / 2 };
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
  
  if (type === 'negrito') newCookie.dataset.preset = 'minimoog';
  if (type === 'dulce') newCookie.dataset.preset = 'vangelis';
  
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
  ensureCookieVoice(newCookie);
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
  const newPreset = newType === 'negrito' ? 'minimoog' : 'vangelis';

  cookie.classList.remove(currentType);
  cookie.classList.add(newType);
  cookie.dataset.type = newType;
  cookie.dataset.preset = newPreset;

  cookie.classList.add('flipping');
  cookie.addEventListener('animationend', () => cookie.classList.remove('flipping'), { once: true });

  disposeCookieVoice(cookie);
  ensureCookieVoice(cookie);

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
  disposeCookieVoice(selectedCookie);
  ensureCookieVoice(selectedCookie);
});

document.getElementById('btn-remove-cookie').addEventListener('click', () => {
  if (selectedCookie) {
    disposeCookieVoice(selectedCookie);
    hexGrid.delete(`${selectedCookie.dataset.q},${selectedCookie.dataset.r}`);
    selectedCookie.remove();
    selectCookie(null);
  }
});

function clearGrid({ resetAutogen = false } = {}) {
  currentStep = 0;
  if (resetAutogen) measureCounter = 0;
  clearDrumPlayingIndicators();
  disposeAllCookieVoices();
  hexGrid.clear();
  gridLayer.querySelectorAll('.cookie-draggable:not(.nav-cookie)').forEach(c => c.remove());
  selectCookie(null);
}

document.getElementById('btn-clear').addEventListener('click', () => clearGrid({ resetAutogen: true }));

document.getElementById('btn-generate-manual').addEventListener('click', async () => {
  try {
    if (!isAudioInitialized) await initAudio();
    if (Tone.Transport.state !== 'started') {
      Tone.Transport.start();
      syncActiveDrones();
      setPlayButtonState(true);
    }
  } catch (err) {
    console.error(err);
  }
  generateRandomPattern();
});

window.addEventListener('resize', updateAllCookiesPositions);

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    const hadPendingAutogen = autogenRequestPending || autogenTimeoutId !== null;
    clearPendingVisuals();
    clearAutogenRequest(hadPendingAutogen);
    return;
  }

  clearPendingVisuals();
  if (Tone.Transport.state === 'started') {
    try {
      await Tone.start();
      syncActiveDrones();
    } catch (error) {
      console.error("Error resuming audio", error);
    }
  }

  if (deferredAutogenWhileHidden && autogenCheckbox.checked) {
    deferredAutogenWhileHidden = false;
    requestGeneratedPattern();
  } else {
    deferredAutogenWhileHidden = false;
  }
});

window.addEventListener('pagehide', () => {
  clearPendingVisuals();
  clearAutogenRequest(false);
  releaseActiveDrones();
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearPendingVisuals();
    clearAutogenRequest(false);
    Tone.Transport.clear(sequenceEventId);
    Tone.Transport.clear(drumEventId);
    Tone.Transport.clear(autogenEventId);
    releaseActiveDrones();
    disposeAllCookieVoices();
    droneSynth.dispose();
    disposeAllDrumVoices();
    cookieBus.dispose();
    droneBus.dispose();
    drumBus.dispose();
    masterCompressor.dispose();
    masterReverb.dispose();
    masterLimiter.dispose();
  });
}

if (import.meta.env.DEV) {
  window.__DON_SATUR_SYNTH_DEBUG__ = {
    get autogenPending() { return autogenRequestPending; },
    get cookieCount() { return hexGrid.size; },
    get cookieVoiceCount() { return cookieVoices.size; },
    get deferredAutogenWhileHidden() { return deferredAutogenWhileHidden; },
    get transportTicks() { return Tone.Transport.ticks; },
    get visualTimeoutCount() { return visualTimeoutIds.size; },
  };
}

console.log('Don Satur Synth Ready!');
