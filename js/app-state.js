// ── AppState ── Single source of truth ──
// Created in Phase 2. Alias to old globals will be removed in Phase 3.

window.AppState = {
  models: {
    classifier: {
      instance: null,
      status: 'idle', // idle | loading | ready | error
      error: null,
      loadTimeMs: null
    },
    detector: {
      instance: null,
      status: 'idle',
      error: null,
      loadTimeMs: null
    }
  },

  image: {
    originalFile: null,
    originalUrl: null,
    displaySource: null,
    inferenceSource: null,
    width: 0,
    height: 0
  },

  analysis: {
    isRunning: false,
    lastResult: null,
    startedAt: null,
    completedAt: null,
    totalTimeMs: null,
    // Per-step timing
    classificationTimeMs: null,
    detectionTimeMs: null
  },

  camera: {
    stream: null,
    rafId: null,
    isRunning: false,
    isPaused: false
  },

  ui: {
    activeMode: 'upload',
    confidenceThreshold: 0.5
  }
};

// ── Helper to reset image state ──
AppState.resetImage = function () {
  // Revoke old URL if any
  if (this.image.originalUrl && this.image.originalUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(this.image.originalUrl); } catch (_) { /* safe */ }
  }
  this.image.originalFile = null;
  this.image.originalUrl = null;
  this.image.displaySource = null;
  this.image.inferenceSource = null;
  this.image.width = 0;
  this.image.height = 0;
};

AppState.resetAnalysis = function () {
  this.analysis.isRunning = false;
  this.analysis.lastResult = null;
  this.analysis.startedAt = null;
  this.analysis.completedAt = null;
  this.analysis.totalTimeMs = null;
  this.analysis.classificationTimeMs = null;
  this.analysis.detectionTimeMs = null;
};

AppState.resetCamera = function () {
  this.camera.stream = null;
  this.camera.rafId = null;
  this.camera.isRunning = false;
  this.camera.isPaused = false;
};

// ── Convenience getters (used by adapter layer) ──
AppState.isModelReady = function (type) {
  const m = this.models[type];
  return m && m.status === 'ready' && m.instance !== null;
};

AppState.anyModelReady = function () {
  return this.isModelReady('classifier') || this.isModelReady('detector');
};

// ── Old global aliases (TEMPORARY, will remove in Phase 3) ──
// These sync window globals that scripts still reference.
// Changes propagate: AppState → global aliases
// TODO(PHASE3): Remove these aliases, update all references to AppState.
(function () {
  function syncAliases() {
    var st = window.AppState;

    // Classifier model
    window.classifierModel = st.models.classifier.instance;

    // Detector model
    window.detectorModel = st.models.detector.instance;

    // modelsReady = both ready
    var bothReady = st.isModelReady('classifier') && st.isModelReady('detector');
    window.modelsReady = bothReady;
    // Also update features.js local modelsReady via setModelsReady
    if (typeof window.setModelsReady === 'function') {
      window.setModelsReady(bothReady);
    }

    // Camera state
    window.webcamRunning = st.camera.isRunning;
    window.webcamStream = st.camera.stream;
  }

  // Intercept AppState writes via MutationObserver-inspired proxy
  // Simple: expose a manual sync
  window.__syncAppStateAliases = syncAliases;

  // Auto-sync on a tick (coarse but safe for Phase 2)
  var _origSet = function (obj, prop, value) {
    obj[prop] = value;
  };

  // Hook model changes
  var _models = st.models;
  ['classifier', 'detector'].forEach(function (type) {
    var m = _models[type];
    var orig = {};
    Object.keys(m).forEach(function (k) {
      orig[k] = m[k];
    });
    Object.defineProperty(m, 'instance', {
      get: function () { return orig.instance; },
      set: function (v) { orig.instance = v; syncAliases(); }
    });
    Object.defineProperty(m, 'status', {
      get: function () { return orig.status; },
      set: function (v) { orig.status = v; syncAliases(); }
    });
  });

  // Camera hooks
  (function () {
    var cam = st.camera;
    var _stream = cam.stream, _running = cam.isRunning;
    Object.defineProperty(cam, 'stream', {
      get: function () { return _stream; },
      set: function (v) { _stream = v; window.webcamStream = v; syncAliases(); }
    });
    Object.defineProperty(cam, 'isRunning', {
      get: function () { return _running; },
      set: function (v) { _running = v; window.webcamRunning = v; syncAliases(); }
    });
  })();
})();