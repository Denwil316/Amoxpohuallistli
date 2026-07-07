class PythonBridge {
  constructor() { this.handlers = {}; }
  send(type, data = {}) {
    if (window.pywebview) {
      pywebview.api.handle_message(JSON.stringify({ type, data }));
    }
  }
  on(type, handler) { this.handlers[type] = handler; }
  receive(msg) {
    const h = this.handlers[msg.type];
    if (h) h(msg.data);
  }
}

class RSVPEngine {
  constructor() {
    this.words = [];
    this.idx = 0;
    this.speed = 300;
    this.playing = false;
    this.timer = null;
    this.pauseTimer = null;
    this._t0 = 0;
    this.hlStart = 0;
    this.hlLen = 1;
    this.boldOption = 'orp';
    this.onWord = null;
    this.onProgress = null;
    this.onFinish = null;
    this.onPauseState = null;

    this.orpEnabled = true;
    this.pauseOnPunctuation = true;
    this.punctuationPauseMultiplier = 2;
    this.wordLengthWPMMultiplier = 5;
    this.pauseAfterWords = 0;
    this.pauseDuration = 500;
    this.fadeEnabled = true;
    this.fadeDuration = 150;
    this.frameWordCount = 1;
    this.wordOpacity = 1;
    this.isRtl = false;
    this._pausedForComprehension = false;
    this._accDelay = 0;
    this._baseDelay = 0;
  }

  getAccumulatedMs() { return this._accDelay; }
  getBaseAccumulatedMs() { return this._baseDelay; }
  resetAccumulatedMs() { this._accDelay = 0; this._baseDelay = 0; }

  load(words) {
    this.words = words;
    this.idx = 0;
    this._accDelay = 0;
    this.stop();
  }

  getORPIndex(word) {
    if (!word) return 0;
    const len = word.replace(/[^\p{L}]/gu, '').length;
    if (len <= 1) return 0;
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 12) return 3;
    return Math.floor(Math.log2(len - 1)) + 1;
  }

  getActualORPIndex(word) {
    if (!word) return 0;
    const orpIdx = this.getORPIndex(word);
    let letterCount = 0;
    for (let i = 0; i < word.length; i++) {
      if (/^\p{L}$/u.test(word[i])) {
        if (letterCount === orpIdx) return i;
        letterCount++;
      }
    }
    return Math.min(orpIdx, word.length - 1);
  }

  getWordDelay(word) {
    if (!word) return 60000 / this.speed;
    let baseDelay = 60000 / this.speed;

    if (this.wordLengthWPMMultiplier > 0 && word.length >= 12) {
      baseDelay *= 1 + ((this.wordLengthWPMMultiplier / 100) * (word.length - 12));
    }

    if (this.pauseOnPunctuation) {
      if (/[.!?;:]$/.test(word)) {
        return baseDelay * this.punctuationPauseMultiplier;
      }
      if (/[,]$/.test(word)) {
        return baseDelay * 1.5;
      }
    }

    return baseDelay;
  }

  shouldPauseAtWord(idx) {
    if (this.pauseAfterWords <= 0) return false;
    if (idx <= 0) return false;
    return idx % this.pauseAfterWords === 0;
  }

  format(word) {
    if (!word) return '';
    if (this.orpEnabled) return this._formatORP(word);
    return this._formatLegacy(word);
  }

  _formatORP(word) {
    const orpIdx = this.getActualORPIndex(word);
    if (orpIdx >= word.length) return this.esc(word);
    const before = this.esc(word.slice(0, orpIdx));
    const bold = this.esc(word[orpIdx]);
    const after = this.esc(word.slice(orpIdx + 1));
    return `${before}<b>${bold}</b>${after}`;
  }

  _formatLegacy(word) {
    if (word.length <= 1) return this.esc(word);
    const chars = word.split('').map(c => this.esc(c));
    const len = chars.length;
    switch (this.boldOption) {
      case 'beginning': chars[0] = `<b>${chars[0]}</b>`; break;
      case 'end': chars[len - 1] = `<b>${chars[len - 1]}</b>`; break;
      case 'middle': {
        const mi = Math.floor(len / 2);
        chars[mi] = `<b>${chars[mi]}</b>`;
        return chars.join('');
      }
      case 'random': {
        const ri = Math.floor(Math.random() * (len - 2)) + 1;
        chars[ri] = `<b>${chars[ri]}</b>`;
        return chars.join('');
      }
      default: {
        const s = Math.min(this.hlStart, Math.max(0, word.length - 1));
        const l = Math.min(this.hlLen, Math.max(1, word.length - s));
        if (s >= word.length || l <= 0) return this.esc(word);
        const before = this.esc(word.slice(0, s));
        const bold = this.esc(word.slice(s, s + l));
        const after = this.esc(word.slice(s + l));
        return `${before}<b>${bold}</b>${after}`;
      }
    }
  }

  buildWordFrame(idx) {
    const frameSize = this.frameWordCount || 1;
    if (frameSize <= 1 || idx >= this.words.length) {
      return { center: this.words[idx] || '', before: [], after: [] };
    }
    const radius = Math.floor(frameSize / 2);
    const left = Math.max(0, idx - radius);
    const right = Math.min(this.words.length, idx + radius + 1);
    return {
      center: this.words[idx] || '',
      before: this.words.slice(left, idx),
      after: this.words.slice(idx + 1, right),
    };
  }

  esc(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  tick() {
    if (!this.playing) return;
    if (this.idx >= this.words.length) {
      if (this.loading) {
        this.timer = setTimeout(() => this.tick(), 200);
        return;
      }
      this.playing = false;
      if (this.onFinish) this.onFinish();
      return;
    }

    const w = this.words[this.idx];
    const html = this.format(w);
    const frame = this.buildWordFrame(this.idx);
    this.isRtl = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(w);

    if (this.fadeEnabled && this.idx > 0) {
      this.wordOpacity = 0;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.wordOpacity = 1;
        });
      });
    }

    const delay = this.getWordDelay(w);
    this._accDelay += delay;
    this._baseDelay += 60000 / this.speed;

    if (this.onWord) this.onWord(w, this.idx, html, frame);
    if (this.onProgress) this.onProgress(this.idx, this.words.length);
    this.idx++;

    if (this.shouldPauseAtWord(this.idx)) {
      this._pausedForComprehension = true;
      if (this.onPauseState) this.onPauseState(true);
      this._accDelay += this.pauseDuration;
      this._baseDelay += this.pauseDuration;
      this.pauseTimer = setTimeout(() => {
        this._pausedForComprehension = false;
        if (this.onPauseState) this.onPauseState(false);
        if (this.playing) {
          this._t0 = performance.now();
          this.timer = setTimeout(() => this.tick(), this.getWordDelay(w));
        }
      }, this.pauseDuration);
      return;
    }

    this._t0 += delay;
    const adjusted = Math.max(0, this._t0 - performance.now());
    this.timer = setTimeout(() => this.tick(), adjusted);
  }

  play() {
    if (this.playing || !this.words.length) return;
    if (this.idx >= this.words.length) this.idx = 0;
    this.playing = true;
    this._pausedForComprehension = false;
    this._t0 = performance.now();
    this.tick();
  }

  pause() {
    this.playing = false;
    if (this.pauseTimer) { clearTimeout(this.pauseTimer); this.pauseTimer = null; }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this._pausedForComprehension = false;
    if (this.onPauseState) this.onPauseState(false);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  stop() {
    this.pause();
    this._pausedForComprehension = false;
    this.wordOpacity = 1;
    this.isRtl = false;
    this.loading = false;
    this._t0 = 0;
  }

  seek(i) {
    this.idx = Math.max(0, Math.min(i, this.words.length - 1));
    const wasPlaying = this.playing;
    this.pause();
    this._t0 = 0;
    const w = this.words[this.idx];
    const frame = this.buildWordFrame(this.idx);
    if (this.onWord) this.onWord(w, this.idx, this.format(w), frame);
    if (this.onProgress) this.onProgress(this.idx, this.words.length);
    if (wasPlaying) this.play();
  }

  setSpeed(v) {
    this.speed = Math.max(50, Math.min(2000, v));
    if (this.playing) { this.pause(); this.play(); }
  }

  setHighlight(s, l) {
    this.hlStart = s;
    this.hlLen = l;
    if (!this.playing && this.words.length) {
      const w = this.words[this.idx] || '';
      if (this.onWord) this.onWord(w, this.idx, this.format(w));
    }
  }
}

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.enabled = true;
    this.volume = 0.5;
    this.tickId = '';
    this.startId = '';
    this.endId = '';
  }

  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  ensure() { if (!this.ctx) this.init(); }

  async loadFromBase64(id, b64, mime) {
    this.ensure();
    try {
      const resp = await fetch(`data:${mime};base64,${b64}`);
      const arr = await resp.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this.buffers[id] = buf;
      return true;
    } catch (e) { console.warn('Audio load error:', e); return false; }
  }

  play(id) {
    if (!this.enabled || !this.ctx) return;
    const buf = this.buffers[id];
    if (!buf) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = this.volume;
    src.buffer = buf;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(0);
  }

  playTick() { if (this.tickId) this.play(this.tickId); }
  playStart() { if (this.startId) this.play(this.startId); }
  playEnd() { if (this.endId) this.play(this.endId); }

  setEnabled(v) { this.enabled = v; }
  setVolume(v) { this.volume = v; }
}

class ShortcutManager {
  constructor() { this.map = {}; this.listeners = {}; this.bound = null; }

  setMap(m) {
    this.map = {};
    for (const [action, key] of Object.entries(m)) {
      this.map[this.normalize(key)] = action;
    }
  }

  normalize(key) {
    return key.replace('Arrow', '').toLowerCase().split('+').map(s => s.trim().toLowerCase()).sort().join('+');
  }

  on(action, fn) { this.listeners[action] = fn; }

  attach() {
    if (this.bound) return;
    this.bound = (e) => {
      const parts = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      if (e.metaKey) parts.push('meta');
      const key = e.key === ' ' ? 'space' : e.key.toLowerCase();
      if (!['control', 'alt', 'shift', 'meta'].includes(key)) parts.push(key);
      const combo = parts.sort().join('+');
      const action = this.map[combo];
      if (action && this.listeners[action]) {
        e.preventDefault();
        this.listeners[action](e);
      }
    };
    document.addEventListener('keydown', this.bound);
  }

  detach() {
    if (this.bound) {
      document.removeEventListener('keydown', this.bound);
      this.bound = null;
    }
  }
}

class App {
  constructor() {
    this.bridge = new PythonBridge();
    this.rsvp = new RSVPEngine();
    this.audio = new AudioEngine();
    this.shortcuts = new ShortcutManager();
    this.settings = {};
    this.audioFiles = {};
    this.editShortcutAction = null;

    this.sessionWords = 0;
    this.sessionStartTime = null;
    this.timerInterval = null;
    this._activeTime = 0;
    this._playSegmentStart = 0;

    this.audioTrack = null;
    this.audioTrackLoaded = false;
    this.audioTrackFirstPlay = true;

    this.fullText = '';
    this.wordOffsets = [];
    this.rangeStart = -1;
    this.rangeEnd = -1;

    this._currentFilename = '';
    this._currentPath = '';
    this._wordCount = 0;
    this._loadingChunks = false;

    this.history = [];

    this.compactView = false;
    this.startMarker = -1;
    this._startMarkerConsumed = false;
    this._loadingCount = 0;
    this.page_starts = null;
    this._pageView = false;
    this._pageThumbnails = {};
    this._thumbQueue = [];
    this._thumbLoading = false;

    this.cache = {};
    this.cacheEl = (id) => this.cache[id] || (this.cache[id] = document.getElementById(id));
    this.debouncedSave = this._debounce(() => this.collectSettings(), 400);

    this.initBridge();
    this.initUI();
    this.initRSVP();
    this.initShortcuts();
    this.initAudioTrack();
    this.loadSettings();
  }

  $(id) { return this.cacheEl(id); }

  _debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  initBridge() {
    window.__bridge_cb = (msg) => this.bridge.receive(msg);
    this.bridge.on('file_loaded', (d) => this.onFileLoaded(d));
    this.bridge.on('file_start', (d) => this.onFileStart(d));
    this.bridge.on('file_chunk', (d) => this.onFileChunk(d));
    this.bridge.on('settings_loaded', (d) => this.onSettingsLoaded(d));
    this.bridge.on('settings_saved', (d) => this.onSettingsLoaded(d));
    this.bridge.on('audio_file_loaded', (d) => this.onAudioFileLoaded(d));
    this.bridge.on('error', (d) => this.onError(d));
    this.bridge.on('state', (d) => this.onFileLoaded(d));
    this.bridge.on('history_list', (d) => this.history = d || []);
    this.bridge.on('full_text_loaded', (d) => {
      this.fullText = d.full_text || '';
      this.wordOffsets = d.word_offsets || [];
      this.page_starts = d.page_starts || null;
      this.renderDocumentViewer();
      this.updateDocViewerHighlight(this.rsvp.idx);
      this.updateRangeInfo();
      this.setupPageNavigator();
      this.updatePageViewToggle();
    });
    this.bridge.on('page_image', (d) => this.onPageImage(d));
  }

  initUI() {
    this.$('btnOpen').addEventListener('click', () => this.bridge.send('open_file'));

    this.$('btnSettings').addEventListener('click', () => this.toggleSettings());
    this.$('btnReset').addEventListener('click', () => this.resetPosition());
    this.$('btnCloseSettings').addEventListener('click', () => this.toggleSettings());
    this.$('settingsOverlay').addEventListener('click', (e) => {
      if (e.target === this.$('settingsOverlay')) this.toggleSettings();
    });
    this.$('btnDocViewer').addEventListener('click', () => this.toggleDocViewer());
    this.$('btnCloseDocViewer').addEventListener('click', () => this.closeDocViewer());
    this.$('docViewerOverlay').addEventListener('click', (e) => {
      if (e.target === this.$('docViewerOverlay')) this.closeDocViewer();
    });
    this.$('btnReadRange').addEventListener('click', () => this.readSelectedRange());
    this.$('btnReadAll').addEventListener('click', () => this.clearReadRange());
    this.$('btnCompactToggle').addEventListener('click', () => this.toggleCompactView());
    this.$('dvPageSlider').addEventListener('input', (e) => this.onPageSliderInput(e));
    this.$('dvPageSlider').addEventListener('change', (e) => this.onPageSliderChange(e));
    this.$('btnStartMarker').addEventListener('click', () => this.setStartMarker());
    this.$('btnClearMarker').addEventListener('click', () => this.clearStartMarker());
    this.$('btnPageViewToggle').addEventListener('click', () => this.togglePageView());
    this.$('btnHistory').addEventListener('click', () => this.toggleHistory());
    this.$('btnClearHistory').addEventListener('click', () => this.clearHistory());
    this.$('btnCloseHistory').addEventListener('click', () => this.closeHistory());
    this.$('historyOverlay').addEventListener('click', (e) => {
      if (e.target === this.$('historyOverlay')) this.closeHistory();
    });

    this.$('settingsPanel').addEventListener('input', (e) => {
      if (e.target.closest('#paletteEditor')) return;
      this.debouncedSave();
    });
    this.$('settingsPanel').addEventListener('change', (e) => {
      if (e.target.closest('#paletteEditor')) return;
      this.debouncedSave();
    });

    this.$('btnPlay').addEventListener('click', () => this.togglePlay());
    this.$('btnPrev').addEventListener('click', () => this.seekRel(-1));
    this.$('btnNext').addEventListener('click', () => this.seekRel(1));
    this.$('btnSkipBack').addEventListener('click', () => this.seekRel(-10));
    this.$('btnSkipFwd').addEventListener('click', () => this.seekRel(10));

    const updateSpeed = (v) => { this.rsvp.setSpeed(v); this.updateSpeedUI(v); };
    this.$('btnSpeedDown').addEventListener('click', () => updateSpeed(this.rsvp.speed - 10));
    this.$('btnSpeedUp').addEventListener('click', () => updateSpeed(this.rsvp.speed + 10));
    this.$('speedSlider').addEventListener('input', (e) => updateSpeed(parseInt(e.target.value)));
    this.$('progressBar').addEventListener('click', (e) => {
      if (this.rsvp.playing || !this.rsvp.words.length) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      const idx = Math.floor(pct * this.rsvp.words.length);
      this.rsvp.seek(idx);
    });

    this.$('hlStart').addEventListener('input', (e) => this.updateHighlight());
    this.$('hlLength').addEventListener('input', (e) => this.updateHighlight());
    this.$('boldOption').addEventListener('change', (e) => {
      this.rsvp.boldOption = e.target.value;
      this.renderWordDisplay();
    });
    this.$('orpEnabled').addEventListener('change', (e) => {
      this.rsvp.orpEnabled = e.target.checked;
      this.toggleHighlightMode(e.target.checked);
      this.renderWordDisplay();
    });
    this.$('pauseOnPunctuation').addEventListener('change', (e) => {
      this.rsvp.pauseOnPunctuation = e.target.checked;
    });
    this.$('punctuationPauseMultiplier').addEventListener('input', (e) => {
      this.rsvp.punctuationPauseMultiplier = parseFloat(e.target.value);
      this.$('punctuationPauseMultiplierVal').textContent = e.target.value + 'x';
    });
    this.$('wordLengthWPMMultiplier').addEventListener('input', (e) => {
      this.rsvp.wordLengthWPMMultiplier = parseInt(e.target.value);
      this.$('wordLengthWPMMultiplierVal').textContent = e.target.value + '%';
    });
    this.$('pauseAfterWords').addEventListener('input', (e) => {
      this.rsvp.pauseAfterWords = parseInt(e.target.value);
      this.$('pauseAfterWordsVal').textContent = parseInt(e.target.value) || 'Off';
    });
    this.$('pauseDurationSetting').addEventListener('input', (e) => {
      this.rsvp.pauseDuration = parseInt(e.target.value);
      this.$('pauseDurationSettingVal').textContent = e.target.value + 'ms';
    });
    this.$('fadeEnabled').addEventListener('change', (e) => {
      this.rsvp.fadeEnabled = e.target.checked;
    });
    this.$('fadeDurationSetting').addEventListener('input', (e) => {
      this.rsvp.fadeDuration = parseInt(e.target.value);
      this.$('fadeDurationSettingVal').textContent = e.target.value + 'ms';
      this.$('wordText').style.transition = e.target.checked ? `opacity ${e.target.value}ms ease-in-out` : 'none';
    });
    this.$('frameWordCount').addEventListener('input', (e) => {
      const v = parseInt(e.target.value);
      this.rsvp.frameWordCount = v;
      this.$('frameWordCountVal').textContent = v;
      this.renderWordDisplay();
    });
    this.$('speedSetting').addEventListener('input', (e) => {
      const v = parseInt(e.target.value);
      this.$('speedSettingVal').textContent = v;
      this.rsvp.setSpeed(v);
      this.updateSpeedUI(v);
    });
    this.$('fontFamily').addEventListener('change', (e) => this.applyFont());
    this.$('fontSize').addEventListener('input', (e) => {
      const v = e.target.value;
      this.$('fontSizeVal').textContent = v + 'px';
      this.applyFont();
    });
    this.$('textColor').addEventListener('input', (e) => {
      document.documentElement.style.setProperty('--txt', e.target.value);
    });
    this.$('bgColor').addEventListener('input', (e) => {
      document.documentElement.style.setProperty('--bg', e.target.value);
      document.querySelector('#app').style.background = e.target.value;
    });
    this.$('accentColor').addEventListener('input', (e) => {
      document.documentElement.style.setProperty('--acc', e.target.value);
    });
    this.$('orpToggle').addEventListener('change', (e) => {
      this.$('orpIndicator').classList.toggle('visible', e.target.checked);
    });
    this.$('paletteSelect').addEventListener('change', (e) => {
      this.loadPaletteEditor(e.target.value);
      this.applyPalette(e.target.value);
    });
    this.$('btnAddPalette').addEventListener('click', () => this.addPalette());
    this.$('btnDeletePalette').addEventListener('click', () => this.deletePalette());
    this.$('btnSavePalette').addEventListener('click', () => this.savePalette());
    this.$('soundEnabled').addEventListener('change', (e) => this.audio.setEnabled(e.target.checked));
    this.$('soundVolume').addEventListener('input', (e) => {
      const v = parseInt(e.target.value) / 100;
      this.$('soundVolumeVal').textContent = e.target.value + '%';
      this.audio.setVolume(v);
    });

    document.querySelectorAll('.btn-upload').forEach(btn => {
      btn.addEventListener('click', () => {
        this.pendingAudioTarget = btn.dataset.target;
        this.bridge.send('pick_audio_file');
      });
    });
    document.querySelectorAll('.btn-preview').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const val = this.$(target).value;
        if (val) this.audio.play(val);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('app').classList.contains('focus-mode')) {
        this.rsvp.pause();
        this.$('btnPlay').innerHTML = '<i data-lucide="play" class="size-6"></i>';
        this.$('btnPlay').classList.remove('playing');
        document.getElementById('app').classList.remove('focus-mode');
        lucide.createIcons();
      }
    });

    this.$('btnResetSession').addEventListener('click', () => this.resetSession());
    this.$('btnCloseShortcut').addEventListener('click', () => this.closeShortcutEditor());
    this.$('btnSaveShortcut').addEventListener('click', () => this.saveShortcut());
    this.$('btnClearShortcut').addEventListener('click', () => this.clearShortcut());
    document.addEventListener('keydown', (e) => {
      if (!this.$('shortcutEditor').classList.contains('hidden')) {
        e.preventDefault();
        this.captureShortcut(e);
      }
    });
  }

  initRSVP() {
    this.rsvp.onWord = (word, idx, html, frame) => {
      const el = this.$('wordText');

      if (frame && frame.before && frame.before.length > 0 && this.rsvp.frameWordCount > 1) {
        const rtl = this.rsvp.isRtl;
        const ctxBefore = frame.before.map(w => `<span class="ctx-word">${this.escHtml(w)}</span>`).join(' ');
        const ctxAfter = frame.after.map(w => `<span class="ctx-word">${this.escHtml(w)}</span>`).join(' ');
        if (rtl) {
          el.innerHTML = `${ctxAfter ? ctxAfter + ' ' : ''}${html}${ctxBefore ? ' ' + ctxBefore : ''}`;
          el.style.direction = 'rtl';
        } else {
          el.innerHTML = `${ctxBefore ? ctxBefore + ' ' : ''}${html}${ctxAfter ? ' ' + ctxAfter : ''}`;
          el.style.direction = 'ltr';
        }
      } else {
        el.innerHTML = html;
      }

      if (this.rsvp.fadeEnabled && idx > 0) {
        el.style.transition = `opacity ${Math.min(this.rsvp.fadeDuration, 60)}ms ease`;
        el.style.opacity = 0.85;
        requestAnimationFrame(() => { el.style.opacity = 1; });
      }

      const total = this._wordCount || this.rsvp.words.length;
      const pct = total ? Math.round(((idx + 1) / total) * 100) : 0;
      this.$('progressFill').style.width = pct + '%';
      this.$('progress-text').textContent = pct + '%';
      this.$('progress-total').textContent = `${idx + 1} / ${total}`;
      this.$('wordCounter').textContent = `${idx + 1} / ${total}`;

      this.sessionWords++;
      this.$('current-word-count').textContent = this.sessionWords;
      this.$('session-words').textContent = this.sessionWords;
      this.updateAvgSpeed();

      const remaining = total - idx - 1;
      this.$('time-remaining').textContent = this.formatTimeRemaining(remaining, this.rsvp.speed);

      if (this.rangeEnd > 0 && idx >= this.rangeEnd) {
        this.rsvp.pause();
        this.$('btnPlay').innerHTML = '<i data-lucide="play" class="size-6"></i>';
        this.$('btnPlay').classList.remove('playing');
        lucide.createIcons();
        return;
      }

      if (idx > 0) this.audio.playTick();
      this.updateDocViewerHighlight(idx);
    };
    this.rsvp.onProgress = (idx, total) => {
      const pct = total ? Math.round((idx / total) * 100) : 0;
      this.$('progressFill').style.width = pct + '%';
      this.$('progress-text').textContent = pct + '%';
    };
    this.rsvp.onFinish = () => {
      this.$('btnPlay').innerHTML = '<i data-lucide="play" class="size-6"></i>';
      this.$('btnPlay').classList.remove('playing');
      this.audio.playEnd();
      this.stopSessionTimer();
      this.saveHistory();
      lucide.createIcons();
    };
    this.rsvp.onPauseState = (paused) => {
      if (paused) {
        this.$('wordText').innerHTML = '<span class="pause-overlay">&#9208;</span>';
      } else {
        if (this.rsvp.words.length) this.renderWordDisplay();
      }
    };
  }

  renderWordDisplay() {
    const w = this.rsvp.words[this.rsvp.idx] || '';
    const frame = this.rsvp.buildWordFrame(this.rsvp.idx);
    if (frame && frame.before.length > 0 && this.rsvp.frameWordCount > 1) {
      const rtl = this.rsvp.isRtl;
      const html = this.rsvp.format(w);
      const ctxBefore = frame.before.map(w => `<span class="ctx-word">${this.escHtml(w)}</span>`).join(' ');
      const ctxAfter = frame.after.map(w => `<span class="ctx-word">${this.escHtml(w)}</span>`).join(' ');
      if (rtl) {
        this.$('wordText').innerHTML = `${ctxAfter ? ctxAfter + ' ' : ''}${html}${ctxBefore ? ' ' + ctxBefore : ''}`;
        this.$('wordText').style.direction = 'rtl';
      } else {
        this.$('wordText').innerHTML = `${ctxBefore ? ctxBefore + ' ' : ''}${html}${ctxAfter ? ' ' + ctxAfter : ''}`;
        this.$('wordText').style.direction = 'ltr';
      }
    } else {
      this.$('wordText').innerHTML = this.rsvp.format(w);
    }
  }

  initAudioTrack() {
    this.audioTrack = new Audio();

    this.$('btnUploadAudio').addEventListener('click', () => {
      this.$('audioTrackInput').click();
    });

    this.$('audioTrackInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      this.audioTrack.src = url;
      this.audioTrack.load();
      this.audioTrackLoaded = true;
      this.audioTrackFirstPlay = true;
      this.$('audioTrackBar').classList.remove('hidden');
      this.$('audioTrackName').textContent = file.name;
      this.updateAudioTrackTime();
      this.showAudioPlayBtn();
    });

    this.audioTrack.addEventListener('timeupdate', () => this.updateAudioTrackTime());
    this.audioTrack.addEventListener('loadedmetadata', () => this.updateAudioTrackTime());
    this.audioTrack.addEventListener('ended', () => {
      this.showAudioPlayBtn();
    });

    this.$('btnAudioPlay').addEventListener('click', () => this.toggleAudioTrack());
    this.$('btnAudioStop').addEventListener('click', () => this.stopAudioTrack());
    this.$('btnAudioRewind').addEventListener('click', () => this.seekAudioTrack(-10));
    this.$('btnAudioForward').addEventListener('click', () => this.seekAudioTrack(10));

    this.$('audioTrackVolume').addEventListener('input', (e) => {
      this.audioTrack.volume = parseInt(e.target.value) / 100;
    });
  }

  showAudioPlayBtn() {
    this.$('btnAudioPlay').innerHTML = '<i data-lucide="play" class="size-4"></i>';
    lucide.createIcons();
  }

  toggleAudioTrack() {
    if (!this.audioTrackLoaded || !this.audioTrack.src) return;
    if (this.audioTrack.paused) {
      this.audioTrack.play().catch(() => {});
      this.$('btnAudioPlay').innerHTML = '<i data-lucide="pause" class="size-4"></i>';
    } else {
      this.audioTrack.pause();
      this.$('btnAudioPlay').innerHTML = '<i data-lucide="play" class="size-4"></i>';
    }
    lucide.createIcons();
  }

  stopAudioTrack() {
    if (!this.audioTrackLoaded) return;
    this.audioTrack.pause();
    this.audioTrack.currentTime = 0;
    this.showAudioPlayBtn();
  }

  seekAudioTrack(sec) {
    if (!this.audioTrackLoaded || !this.audioTrack.duration) return;
    this.audioTrack.currentTime = Math.max(0, Math.min(this.audioTrack.duration, this.audioTrack.currentTime + sec));
  }

  updateAudioTrackTime() {
    if (!this.audioTrackLoaded || !this.audioTrack.duration) {
      this.$('audioTrackTime').textContent = '00:00 / 00:00';
      return;
    }
    const fmt = (s) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };
    this.$('audioTrackTime').textContent = `${fmt(this.audioTrack.currentTime)} / ${fmt(this.audioTrack.duration)}`;
  }

  initShortcuts() {
    this.shortcuts.on('play_pause', () => this.togglePlay());
    this.shortcuts.on('speed_up', () => {
      const v = this.rsvp.speed + 10;
      this.rsvp.setSpeed(v);
      this.updateSpeedUI(v);
    });
    this.shortcuts.on('speed_down', () => {
      const v = this.rsvp.speed - 10;
      this.rsvp.setSpeed(v);
      this.updateSpeedUI(v);
    });
    this.shortcuts.on('seek_forward', () => this.seekRel(1));
    this.shortcuts.on('seek_backward', () => this.seekRel(-1));
    this.shortcuts.on('seek_forward_fast', () => this.seekRel(10));
    this.shortcuts.on('seek_backward_fast', () => this.seekRel(-10));
    this.shortcuts.on('open_file', () => this.bridge.send('open_file'));
    this.shortcuts.on('toggle_settings', () => this.toggleSettings());
    this.shortcuts.on('toggle_docviewer', () => this.toggleDocViewer());
    this.shortcuts.on('reset_position', () => this.resetPosition());
  }

  loadSettings() {
    this.bridge.send('load_settings');
  }

  onSettingsLoaded(d) {
    this.settings = d;
    this.applySettings(d);
  }

  applySettings(s) {
    const orpEn = s.orp_enabled !== false;
    this.rsvp.orpEnabled = orpEn;
    this.$('orpEnabled').checked = orpEn;
    this.toggleHighlightMode(orpEn);

    const hlS = s.highlight_start || 0;
    const hlL = s.highlight_length || 1;
    this.$('hlStart').value = hlS;
    this.$('hlStartVal').textContent = hlS;
    this.$('hlLength').value = hlL;
    this.$('hlLengthVal').textContent = hlL;
    this.rsvp.setHighlight(hlS, hlL);

    if (s.bold_option) {
      this.rsvp.boldOption = s.bold_option;
      this.$('boldOption').value = s.bold_option;
    }

    const sp = s.speed || 300;
    this.$('speedSetting').value = sp;
    this.$('speedSettingVal').textContent = sp;
    this.rsvp.setSpeed(sp);
    this.updateSpeedUI(sp);

    if (s.font_family) {
      this.$('fontFamily').value = s.font_family;
      document.documentElement.style.setProperty('--font', s.font_family);
    }
    if (s.font_size) {
      this.$('fontSize').value = s.font_size;
      this.$('fontSizeVal').textContent = s.font_size + 'px';
      document.documentElement.style.setProperty('--fs', s.font_size + 'px');
    }
    if (s.text_color) {
      this.$('textColor').value = s.text_color;
      document.documentElement.style.setProperty('--txt', s.text_color);
    }
    if (s.background_color) {
      this.$('bgColor').value = s.background_color;
      document.documentElement.style.setProperty('--bg', s.background_color);
      document.querySelector('#app').style.background = s.background_color;
    }
    if (s.accent_color) {
      this.$('accentColor').value = s.accent_color;
      document.documentElement.style.setProperty('--acc', s.accent_color);
    }

    const curPal = (s.color_palettes || {})[s.current_palette || 'Default'];
    if (curPal) {
      if (curPal.statBg) document.documentElement.style.setProperty('--stat-bg', curPal.statBg);
      if (curPal.statText) document.documentElement.style.setProperty('--stat-text', curPal.statText);
      if (curPal.statLabel) document.documentElement.style.setProperty('--stat-label', curPal.statLabel);
    }

    this.$('orpIndicator').classList.toggle('visible', s.orp_indicator !== false);
    this.$('orpToggle').checked = s.orp_indicator !== false;

    this.updatePaletteUI(s);
    this.loadPaletteEditor(s.current_palette || 'Default');

    this.audio.setEnabled(s.sound_enabled !== false);
    this.$('soundEnabled').checked = s.sound_enabled !== false;
    this.audio.setVolume((s.sound_volume || 0.5));
    this.$('soundVolume').value = Math.round((s.sound_volume || 0.5) * 100);
    this.$('soundVolumeVal').textContent = Math.round((s.sound_volume || 0.5) * 100) + '%';

    if (s.sound_tick) { this.audio.tickId = s.sound_tick; this.setAudioSelect('soundTick', s.sound_tick); }
    if (s.sound_start) { this.audio.startId = s.sound_start; this.setAudioSelect('soundStart', s.sound_start); }
    if (s.sound_end) { this.audio.endId = s.sound_end; this.setAudioSelect('soundEnd', s.sound_end); }

    if (s.keyboard_shortcuts) {
      this.shortcuts.setMap(s.keyboard_shortcuts);
      this.shortcuts.attach();
      this.renderShortcuts(s.keyboard_shortcuts);
    }

    this.rsvp.pauseOnPunctuation = s.pause_on_punctuation !== false;
    this.rsvp.punctuationPauseMultiplier = s.punctuation_pause_multiplier || 2;
    this.rsvp.wordLengthWPMMultiplier = s.word_length_wpm_multiplier || 5;
    this.rsvp.pauseAfterWords = s.pause_after_words || 0;
    this.rsvp.pauseDuration = s.pause_duration || 500;
    this.rsvp.fadeEnabled = s.fade_enabled !== false;
    this.rsvp.fadeDuration = s.fade_duration || 150;
    this.rsvp.frameWordCount = s.frame_word_count || 1;

    this.$('orpEnabled').checked = s.orp_enabled !== false;
    this.$('pauseOnPunctuation').checked = s.pause_on_punctuation !== false;
    const ppm = s.punctuation_pause_multiplier || 2;
    this.$('punctuationPauseMultiplier').value = ppm;
    this.$('punctuationPauseMultiplierVal').textContent = ppm + 'x';
    const wpm = s.word_length_wpm_multiplier || 5;
    this.$('wordLengthWPMMultiplier').value = wpm;
    this.$('wordLengthWPMMultiplierVal').textContent = wpm + '%';
    const paw = s.pause_after_words || 0;
    this.$('pauseAfterWords').value = paw;
    this.$('pauseAfterWordsVal').textContent = paw || 'Off';
    const pd = s.pause_duration || 500;
    this.$('pauseDurationSetting').value = pd;
    this.$('pauseDurationSettingVal').textContent = pd + 'ms';
    this.$('fadeEnabled').checked = s.fade_enabled !== false;
    const fd = s.fade_duration || 150;
    this.$('fadeDurationSetting').value = fd;
    this.$('fadeDurationSettingVal').textContent = fd + 'ms';
    const fwc = s.frame_word_count || 1;
    this.$('frameWordCount').value = fwc;
    this.$('frameWordCountVal').textContent = fwc;
  }

  toggleHighlightMode(orpOn) {
    document.querySelectorAll('.hl-manual').forEach(el => el.style.display = orpOn ? 'none' : 'flex');
    document.querySelectorAll('.hl-orp').forEach(el => el.style.display = orpOn ? 'flex' : 'none');
  }

  updateSpeedUI(v) {
    this.$('speedValue').textContent = v;
    this.$('speedSlider').value = v;
    if (!this.rsvp.playing) {
      const total = this._wordCount || this.rsvp.words.length;
      const remaining = Math.max(0, total - this.rsvp.idx);
      this.$('time-remaining').textContent = this.formatTimeRemaining(remaining, v);
    }
  }

  formatTimeRemaining(remainingWords, wpm) {
    if (remainingWords <= 0 || !wpm || wpm <= 0) return '0:00';
    const seconds = Math.ceil((remainingWords / wpm) * 60);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
    return `0:${String(s).padStart(2, '0')}`;
  }

  togglePlay() {
    if (!this.rsvp.playing && this.startMarker >= 0 && this.rangeStart < 0 && !this._startMarkerConsumed) {
      this.rsvp.seek(this.startMarker);
      this._startMarkerConsumed = true;
    }
    this.rsvp.toggle();
    const playing = this.rsvp.playing;
    this.$('btnPlay').innerHTML = playing ? '<i data-lucide="pause" class="size-6"></i>' : '<i data-lucide="play" class="size-6"></i>';
    this.$('btnPlay').classList.toggle('playing', playing);

    document.getElementById('app').classList.toggle('focus-mode', playing);

    if (playing) {
      this.audio.ensure();
      if (!this.sessionStartTime) {
        this.sessionWords = 0;
        this.sessionStartTime = Date.now();
        this.rsvp.resetAccumulatedMs();
      }
      this.startSessionTimer();
      if (this.audioTrackFirstPlay && this.audioTrackLoaded && this.audioTrack.src && this.audioTrack.paused) {
        this.audioTrack.play().catch(() => {});
        this.$('btnAudioPlay').innerHTML = '<i data-lucide="pause" class="size-4"></i>';
        this.audioTrackFirstPlay = false;
        lucide.createIcons();
      }
    } else {
      this.stopSessionTimer();
      this.saveHistory();
    }
    lucide.createIcons();
  }

  saveHistory() {
    if (!this._currentPath || !this._wordCount) return;
    const wordsRead = this.rsvp.idx;
    const percentRead = this._wordCount > 0 ? (wordsRead / this._wordCount) * 100 : 0;
    const totalMs = this.rsvp.getBaseAccumulatedMs();
    const elapsedMin = totalMs / 60000;
    const avgSpeed = elapsedMin > 0 ? Math.round(this.sessionWords / elapsedMin) : this.rsvp.speed;
    this.bridge.send('update_history', {
      name: this._currentFilename,
      path: this._currentPath,
      total_words: this._wordCount,
      words_read: wordsRead,
      avg_speed: avgSpeed,
      percent_read: percentRead,
    });
  }

  startSessionTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this._playSegmentStart = Date.now();
    this.timerInterval = setInterval(() => this.updateTimeElapsed(), 1000);
  }

  stopSessionTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this._playSegmentStart) {
      this._activeTime += Date.now() - this._playSegmentStart;
      this._playSegmentStart = 0;
    }
  }

  updateTimeElapsed() {
    let totalMs = this._activeTime;
    if (this._playSegmentStart) totalMs += Date.now() - this._playSegmentStart;
    if (!totalMs) return;
    const elapsed = Math.floor(totalMs / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    if (h > 0) this.$('time-elapsed').textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    else this.$('time-elapsed').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  updateAvgSpeed() {
    const totalMs = this.rsvp.getBaseAccumulatedMs();
    if (!totalMs) return;
    const elapsedMin = totalMs / 60000;
    if (elapsedMin > 0) {
      this.$('average-speed').textContent = Math.round(this.sessionWords / elapsedMin);
    }
  }

  seekRel(n) {
    const i = this.rsvp.idx + n;
    this.rsvp.seek(i);
    if (!this.rsvp.playing) {
      this.renderWordDisplay();
      this.$('wordCounter').textContent = `${this.rsvp.idx + 1} / ${this.rsvp.words.length}`;
      this.$('progressFill').style.width = this.rsvp.words.length
        ? `${Math.round(((this.rsvp.idx + 1) / this.rsvp.words.length) * 100)}%` : '0%';
      this.$('progress-text').textContent = this.rsvp.words.length
        ? `${Math.round(((this.rsvp.idx + 1) / this.rsvp.words.length) * 100)}%` : '0%';
      this.$('progress-total').textContent = `${this.rsvp.idx + 1} / ${this.rsvp.words.length}`;
      const remaining = this.rsvp.words.length - this.rsvp.idx - 1;
      this.$('time-remaining').textContent = this.formatTimeRemaining(remaining, this.rsvp.speed);
    }
    this.updateDocViewerHighlight(this.rsvp.idx);
  }

  resetPosition() {
    this.rsvp.seek(0);
    this.$('btnPlay').innerHTML = '<i data-lucide="play" class="size-6"></i>';
    this.$('btnPlay').classList.remove('playing');
    document.getElementById('app').classList.remove('focus-mode');
    this.stopSessionTimer();
    this.sessionStartTime = null;
    this.sessionWords = 0;
    this._activeTime = 0;
    this._playSegmentStart = 0;
    this.$('time-elapsed').textContent = '00:00';
    const total = this._wordCount || this.rsvp.words.length;
    this.$('time-remaining').textContent = this.formatTimeRemaining(total, this.rsvp.speed);
    this.$('average-speed').textContent = '0';
    this.$('session-words').textContent = '0';
    this.audioTrackFirstPlay = true;
    this.rsvp.resetAccumulatedMs();
    lucide.createIcons();
  }

  resetSession() {
    if (this.rsvp.playing) {
      this.rsvp.pause();
      this.$('btnPlay').innerHTML = '<i data-lucide="play" class="size-6"></i>';
      this.$('btnPlay').classList.remove('playing');
      document.getElementById('app').classList.remove('focus-mode');
      lucide.createIcons();
    }
    this.sessionWords = 0;
    this.sessionStartTime = null;
    this._activeTime = 0;
    this._playSegmentStart = 0;
    this.stopSessionTimer();
    this.$('current-word-count').textContent = '0';
    this.$('session-words').textContent = '0';
    this.$('average-speed').textContent = '0';
    this.$('time-elapsed').textContent = '00:00';
    this.rsvp.resetAccumulatedMs();
  }

  toggleSettings() {
    const ov = this.$('settingsOverlay');
    const opening = ov.classList.contains('hidden');
    if (!opening) this.collectSettings();
    ov.classList.toggle('hidden');
    if (opening) this.bridge.send('get_state');
  }

  collectSettings() {
    const s = this.settings;
    s.highlight_start = parseInt(this.$('hlStart').value);
    s.highlight_length = parseInt(this.$('hlLength').value);
    s.bold_option = this.$('boldOption').value;
    s.speed = parseInt(this.$('speedSetting').value);
    s.font_family = this.$('fontFamily').value;
    s.font_size = parseInt(this.$('fontSize').value);
    s.text_color = this.$('textColor').value;
    s.background_color = this.$('bgColor').value;
    s.accent_color = this.$('accentColor').value;
    s.orp_indicator = this.$('orpToggle').checked;
    s.sound_enabled = this.$('soundEnabled').checked;
    s.sound_volume = parseInt(this.$('soundVolume').value) / 100;
    s.sound_tick = this.$('soundTick').value;
    s.sound_start = this.$('soundStart').value;
    s.sound_end = this.$('soundEnd').value;
    s.orp_enabled = this.$('orpEnabled').checked;
    s.pause_on_punctuation = this.$('pauseOnPunctuation').checked;
    s.punctuation_pause_multiplier = parseFloat(this.$('punctuationPauseMultiplier').value);
    s.word_length_wpm_multiplier = parseInt(this.$('wordLengthWPMMultiplier').value);
    s.pause_after_words = parseInt(this.$('pauseAfterWords').value);
    s.pause_duration = parseInt(this.$('pauseDurationSetting').value);
    s.fade_enabled = this.$('fadeEnabled').checked;
    s.fade_duration = parseInt(this.$('fadeDurationSetting').value);
    s.frame_word_count = parseInt(this.$('frameWordCount').value);
    this.bridge.send('save_settings', s);
  }

  onFileStart(d) {
    this._wordCount = d.word_count || 0;
    this._loadingChunks = true;
    this.rsvp.loading = true;
    this._currentFilename = d.filename || '';
    this._currentPath = d.path || '';
    this.rsvp.words = [];
    this.rsvp.load([]);
    this.$('fileInfo').textContent = d.filename || 'Unknown file';
    this.$('wordCounter').textContent = `0 / ${d.word_count}`;
    document.getElementById('app').classList.remove('focus-mode');
    this.$('progressFill').style.width = '0%';
    this.$('progress-text').textContent = '0%';
    this.$('progress-total').textContent = `0 / ${d.word_count}`;
    this.$('btnPlay').innerHTML = '<i data-lucide="play" class="size-6"></i>';
    this.$('btnPlay').classList.remove('playing');
    this.$('current-word-count').textContent = '0';
    this.$('session-words').textContent = '0';
    this.$('average-speed').textContent = '0';
    this.$('time-elapsed').textContent = '00:00';
    this.$('time-remaining').textContent = this.formatTimeRemaining(d.word_count || 0, this.rsvp.speed);
    this.stopSessionTimer();
    this.sessionStartTime = null;
    this.sessionWords = 0;
    this._activeTime = 0;
    this._playSegmentStart = 0;
    this.fullText = '';
    this.wordOffsets = [];
    this.rangeStart = -1;
    this.rangeEnd = -1;
    this.startMarker = -1;
    this._startMarkerConsumed = false;
    this.page_starts = null;
    this._pageView = false;
    this._pageThumbnails = {};
    this.$('btnStartMarker').classList.remove('hidden');
    this.$('btnClearMarker').classList.add('hidden');
    this.rsvp.resetAccumulatedMs();
    this.$('wordText').innerHTML = '<div class="loading-spinner"></div><div class="loading-text">Loading document...</div>';
    this.showLoading();
    if (this.rsvp.words.length) this.audio.playStart();
    lucide.createIcons();
  }

  onFileChunk(d) {
    const chunk = d.chunk || [];
    this.rsvp.words.push(...chunk);
    this.$('fileInfo').textContent = `${this._currentFilename} (loading ${Math.min(this.rsvp.words.length, this._wordCount)}/${this._wordCount})`;
    if (d.index === 0 && chunk.length > 0) {
      this.rsvp.load(this.rsvp.words);
      this.renderWordDisplay();
      lucide.createIcons();
    }
  }

  onFileLoaded(d) {
    this._loadingChunks = false;
    this.rsvp.loading = false;
    this._wordCount = d.word_count || this.rsvp.words.length;
    this.fullText = d.full_text || this.fullText || '';
    this.wordOffsets = d.word_offsets || this.wordOffsets || [];
    this.page_starts = d.page_starts || null;
    this.rangeStart = -1;
    this.rangeEnd = -1;
    this.startMarker = -1;
    this._startMarkerConsumed = false;
    this.$('btnStartMarker').classList.remove('hidden');
    this.$('btnClearMarker').classList.add('hidden');

    if (d.words && d.words.length) {
      this.rsvp.words = d.words;
      this.rsvp.load(this.rsvp.words);
    }
    this._currentFilename = d.filename || this._currentFilename;
    this._currentPath = d.path || this._currentPath;
    const total = this._wordCount || this.rsvp.words.length;
    this.$('fileInfo').textContent = this._currentFilename || 'Unknown file';
    this.$('wordCounter').textContent = `0 / ${total}`;
    document.getElementById('app').classList.remove('focus-mode');
    this.renderWordDisplay();
    this.$('progressFill').style.width = '0%';
    this.$('progress-text').textContent = '0%';
    this.$('progress-total').textContent = `0 / ${total}`;
    this.$('btnPlay').innerHTML = '<i data-lucide="play" class="size-6"></i>';
    this.$('btnPlay').classList.remove('playing');
    this.$('current-word-count').textContent = '0';
    this.$('session-words').textContent = '0';
    this.$('average-speed').textContent = '0';
    this.$('time-elapsed').textContent = '00:00';
    this.$('time-remaining').textContent = this.formatTimeRemaining(total, this.rsvp.speed);
    this.stopSessionTimer();
    this.sessionStartTime = null;
    this.sessionWords = 0;
    this._activeTime = 0;
    this._playSegmentStart = 0;
    this.rsvp.resetAccumulatedMs();

    if (this.rsvp.words.length) this.audio.playStart();
    this.hideLoading();
    this.bridge.send('get_history');
    lucide.createIcons();
    this.updatePageViewToggle();
  }

  updateHighlight() {
    const s = parseInt(this.$('hlStart').value);
    const l = parseInt(this.$('hlLength').value);
    this.$('hlStartVal').textContent = s;
    this.$('hlLengthVal').textContent = l;
    this.rsvp.setHighlight(s, l);
  }

  applyFont() {
    const family = this.$('fontFamily').value;
    const size = this.$('fontSize').value;
    document.documentElement.style.setProperty('--font', family);
    document.documentElement.style.setProperty('--fs', size + 'px');
  }

  updatePaletteUI(s) {
    const palettes = s.color_palettes || {};
    const sel = this.$('paletteSelect');
    const current = s.current_palette || 'Default';
    const keys = Object.keys(palettes);
    sel.innerHTML = keys.map(name =>
      `<option value="${this.escHtml(name)}" ${name === current ? 'selected' : ''}>${this.escHtml(name)}</option>`
    ).join('');
    this.renderPalettePreview(palettes, current);
    this.$('btnAddPalette').disabled = keys.length >= 3;
    this.$('btnAddPalette').style.opacity = keys.length >= 3 ? '0.4' : '1';
    const canDelete = keys.length > 1 && current !== 'Default';
    this.$('btnDeletePalette').disabled = !canDelete;
    this.$('btnDeletePalette').style.opacity = canDelete ? '1' : '0.4';
  }

  renderPalettePreview(palettes, current) {
    const p = palettes[current];
    if (!p) return;
    const preview = this.$('palettePreview');
    preview.innerHTML = '';
    const keys = ['background', 'secondary', 'primary', 'accent', 'statBg', 'statText', 'statLabel'];
    keys.filter(k => p[k]).forEach(k => {
      const div = document.createElement('div');
      div.className = 'palette-swatch';
      div.title = k;
      div.style.background = p[k];
      preview.appendChild(div);
    });
  }

  renderPalettePreview(palettes, current) {
    const p = palettes[current];
    if (!p) return;
    const preview = this.$('palettePreview');
    const keys = ['background', 'secondary', 'primary', 'accent', 'statBg', 'statText', 'statLabel'];
    preview.innerHTML = keys.filter(k => p[k]).map(k =>
      `<div class="palette-swatch" title="${k}" style="background:${p[k]}"></div>`
    ).join('');
  }

  applyPalette(name) {
    const palettes = this.settings.color_palettes || {};
    const p = palettes[name];
    if (!p) return;
    this.renderPalettePreview(palettes, name);

    const bg = p.background || this.settings.background_color;
    const acc = p.accent || this.settings.accent_color;
    const pri = p.primary || this.settings.primary_color;
    const sec = p.secondary || this.settings.secondary_color;
    const sBg = p.statBg || '#FFFFFF';
    const sText = p.statText || '#2563EB';
    const sLabel = p.statLabel || '#6B7280';

    document.documentElement.style.setProperty('--bg', bg);
    document.documentElement.style.setProperty('--acc', acc);
    document.documentElement.style.setProperty('--pri', pri);
    document.documentElement.style.setProperty('--sec', sec);
    document.documentElement.style.setProperty('--stat-bg', sBg);
    document.documentElement.style.setProperty('--stat-text', sText);
    document.documentElement.style.setProperty('--stat-label', sLabel);
    document.querySelector('#app').style.background = bg;

    this.$('bgColor').value = bg;
    this.$('accentColor').value = acc;

    this.settings.background_color = bg;
    this.settings.accent_color = acc;
    this.settings.current_palette = name;
    this.bridge.send('save_settings', this.settings);
  }

  loadPaletteEditor(name) {
    const palettes = this.settings.color_palettes || {};
    const p = palettes[name];
    if (!p) return;
    this.$('editPalBg').value = p.background || '#ECF4E8';
    this.$('editPalSecondary').value = p.secondary || '#CBF3BB';
    this.$('editPalPrimary').value = p.primary || '#ABE7B2';
    this.$('editPalAccent').value = p.accent || '#93BFC7';
    this.$('editPalStatBg').value = p.statBg || '#FFFFFF';
    this.$('editPalStatText').value = p.statText || '#2563EB';
    this.$('editPalStatLabel').value = p.statLabel || '#6B7280';
  }

  addPalette() {
    const palettes = this.settings.color_palettes || {};
    const keys = Object.keys(palettes);
    if (keys.length >= 3) return;
    const name = prompt('New palette name:');
    if (!name || name.trim() === '') return;
    if (palettes[name]) { alert('Palette name already exists'); return; }
    palettes[name] = {
      background: '#ECF4E8',
      secondary: '#CBF3BB',
      primary: '#ABE7B2',
      accent: '#93BFC7',
      statBg: '#FFFFFF',
      statText: '#2563EB',
      statLabel: '#6B7280',
    };
    this.settings.color_palettes = palettes;
    this.settings.current_palette = name;
    this.updatePaletteUI(this.settings);
    this.loadPaletteEditor(name);
    this.applyPalette(name);
    this.bridge.send('save_settings', { ...this.settings });
  }

  deletePalette() {
    const palettes = this.settings.color_palettes || {};
    const current = this.settings.current_palette || 'Default';
    const keys = Object.keys(palettes);
    if (keys.length <= 1 || current === 'Default') return;
    delete palettes[current];
    this.settings.color_palettes = palettes;
    const next = Object.keys(palettes)[0];
    this.settings.current_palette = next;
    this.updatePaletteUI(this.settings);
    this.loadPaletteEditor(next);
    this.applyPalette(next);
    this.bridge.send('save_settings', { ...this.settings });
  }

  savePalette() {
    const palettes = this.settings.color_palettes || {};
    const current = this.settings.current_palette || 'Default';
    if (!palettes[current]) return;
    palettes[current] = {
      background: this.$('editPalBg').value,
      secondary: this.$('editPalSecondary').value,
      primary: this.$('editPalPrimary').value,
      accent: this.$('editPalAccent').value,
      statBg: this.$('editPalStatBg').value,
      statText: this.$('editPalStatText').value,
      statLabel: this.$('editPalStatLabel').value,
    };
    this.settings.color_palettes = palettes;
    this.updatePaletteUI(this.settings);
    this.applyPalette(current);
    this.bridge.send('save_settings', { ...this.settings });
  }

  onAudioFileLoaded(d) {
    const id = 'audio_' + Date.now();
    this.audio.loadFromBase64(id, d.content, d.mime);
    this.audioFiles[id] = d.name;

    ['soundTick', 'soundStart', 'soundEnd'].forEach(sid => {
      const sel = this.$(sid);
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = d.name;
      sel.appendChild(opt);
    });

    if (this.pendingAudioTarget) {
      this.$(this.pendingAudioTarget).value = id;
      this.pendingAudioTarget = null;
    }
  }

  setAudioSelect(id, val) {
    const sel = this.$(id);
    for (const opt of sel.options) {
      if (opt.value === val) { sel.value = val; break; }
    }
  }

  renderShortcuts(map) {
    const list = this.$('shortcutsList');
    const labels = {
      play_pause: 'Play / Pause', speed_up: 'Speed Up', speed_down: 'Speed Down',
      seek_forward: 'Seek Forward', seek_backward: 'Seek Backward',
      seek_forward_fast: 'Seek Forward +10', seek_backward_fast: 'Seek Backward -10',
      open_file: 'Open File', toggle_settings: 'Toggle Settings',
      toggle_docviewer: 'Toggle Document',
      reset_position: 'Reset Position',
    };
    list.innerHTML = Object.entries(map).map(([action, key]) => `
      <div class="shortcut-row">
        <span class="sc-action">${this.escHtml(labels[action] || action)}</span>
        <span class="sc-key" data-action="${this.escHtml(action)}">${this.escHtml(this.formatKey(key))}</span>
      </div>
    `).join('');
    list.querySelectorAll('.sc-key').forEach(el => {
      el.addEventListener('click', () => this.openShortcutEditor(el.dataset.action));
    });
  }

  formatKey(key) {
    return key.replace('Arrow', '').replace(/(^|[+])(.)/g, (_, p, c) => p + c.toUpperCase());
  }

  openShortcutEditor(action) {
    this.editShortcutAction = action;
    const current = this.settings.keyboard_shortcuts[action] || '';
    this.$('shortcutActionName').textContent =
      document.querySelector(`.sc-key[data-action="${action}"]`).closest('.shortcut-row')
        .querySelector('.sc-action').textContent;
    this.$('shortcutInput').textContent = this.formatKey(current);
    this.shortcutCaptured = null;
    this.$('shortcutEditor').classList.remove('hidden');
  }

  closeShortcutEditor() {
    this.$('shortcutEditor').classList.add('hidden');
    this.editShortcutAction = null;
    this.shortcutCaptured = null;
  }

  captureShortcut(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    const key = e.key === ' ' ? 'Space' : e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) parts.push(key);
    const display = parts.join('+');
    this.$('shortcutInput').textContent = display;

    const nparts = [];
    if (e.ctrlKey) nparts.push('ctrl');
    if (e.altKey) nparts.push('alt');
    if (e.shiftKey) nparts.push('shift');
    if (e.metaKey) nparts.push('meta');
    const k = e.key === ' ' ? 'space' : e.key;
    if (!['control', 'alt', 'shift', 'meta'].includes(k.toLowerCase())) nparts.push(k);
    this.shortcutCaptured = nparts.sort().join('+');
  }

  saveShortcut() {
    if (!this.editShortcutAction || !this.shortcutCaptured) return;
    this.settings.keyboard_shortcuts[this.editShortcutAction] = this.shortcutCaptured;
    this.shortcuts.setMap(this.settings.keyboard_shortcuts);
    this.renderShortcuts(this.settings.keyboard_shortcuts);
    this.bridge.send('save_settings', this.settings);
    this.closeShortcutEditor();
  }

  clearShortcut() {
    if (!this.editShortcutAction) return;
    this.$('shortcutInput').textContent = '(none)';
    this.shortcutCaptured = '';
  }

  onError(d) {
    console.error('Amoxpohualistli error:', d.message);
    this.$('wordText').textContent = 'Error: ' + d.message;
  }

  escHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  toggleHistory() {
    const ov = this.$('historyOverlay');
    ov.classList.toggle('hidden');
    if (!ov.classList.contains('hidden')) {
      this.bridge.send('get_history');
      this.renderHistory();
    }
  }

  closeHistory() {
    this.$('historyOverlay').classList.add('hidden');
  }

  clearHistory() {
    if (confirm('Delete all reading history?')) {
      this.bridge.send('clear_history');
      this.history = [];
      this.renderHistory();
    }
  }

  renderHistory() {
    const list = this.$('historyList');
    if (!this.history || !this.history.length) {
      list.innerHTML = '<p style="opacity:0.5;font-size:13px;margin-top:12px;">No reading history yet.</p>';
      return;
    }
    list.innerHTML = this.history.map(e => `
      <div class="history-item" data-path="${this.escHtml(e.path || '')}">
        <div class="history-info">
          <div class="history-name">${this.escHtml(e.name || 'Unknown')}</div>
          <div class="history-meta">
            ${e.total_words || 0} words &middot;
            ${e.words_read || 0} read &middot;
            ${e.avg_speed || 0} wpm avg &middot;
            ${e.percent_read || 0}%
          </div>
          <div class="history-date">${e.last_date || ''}</div>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', () => {
        const path = el.dataset.path;
        if (path) {
          this.closeHistory();
          this.bridge.send('parse_path', { path });
        }
      });
    });
  }

  toggleDocViewer() {
    const ov = this.$('docViewerOverlay');
    ov.classList.toggle('hidden');
    if (ov.classList.contains('hidden')) return;
    const container = this.$('docViewerContent');

    if (!this.fullText && this._currentPath) {
      container.innerHTML = '<div style="padding:40px 16px;text-align:center"><div class="loading-spinner"></div><div class="loading-text">Loading document text...</div></div>';
      this.bridge.send('get_full_text', { path: this._currentPath });
      return;
    }

    if (!this.fullText) {
      container.innerHTML = '<p style="padding:16px;color:#9ca3af">No document loaded.</p>';
      return;
    }

    container.innerHTML = '<div style="padding:40px 16px;text-align:center"><div class="loading-spinner"></div><div class="loading-text">Rendering document...</div></div>';
    setTimeout(() => {
      this.renderDocumentViewer();
      this.updateDocViewerHighlight(this.rsvp.idx);
      this.updateRangeInfo();
      this.setupPageNavigator();
    }, 30);
  }

  closeDocViewer() {
    this.$('docViewerOverlay').classList.add('hidden');
  }

  renderDocumentViewer() {
    const container = this.$('docViewerContent');
    if (!this.fullText) {
      container.innerHTML = '<p style="padding:16px;color:#9ca3af">No document loaded.</p>';
      return;
    }

    const paragraphs = this.fullText.split('\n\n');
    let charOffset = 0;
    let html = '';

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) {
        charOffset += para.length + 2;
        continue;
      }
      const escaped = this.escHtml(trimmed);
      const isHeading = trimmed.length < 80 && /^[A-ZÁÉÍÓÚÜÑ\s\d]{3,}$/.test(trimmed);
      const tag = isHeading ? 'h3' : 'p';
      html += `<${tag} class="dv-p" data-offset="${charOffset}">${escaped}</${tag}>\n`;
      charOffset += para.length + 2;
    }

    container.innerHTML = html;
    this._setupDocViewerClick(container);
  }

  _findWordAtOffset(charOffset) {
    const offsets = this.wordOffsets;
    let lo = 0, hi = offsets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = offsets[mid][0];
      if (charOffset < start) hi = mid - 1;
      else if (charOffset >= offsets[mid][1]) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  _setupDocViewerClick(container) {
    if (container._delegated) return;
    container._delegated = true;
    container.addEventListener('click', (e) => {
      const block = e.target.closest('.dv-p');
      if (!block) return;
      const pOffset = parseInt(block.dataset.offset);
      if (isNaN(pOffset)) return;

      let clickOffset = 0;
      const _caretOffset = (startContainer, startOffset) => {
        let offset = startOffset;
        let node = startContainer;
        while (node && node !== block) {
          if (node.previousSibling) offset += node.previousSibling.textContent.length;
          node = node.parentNode;
        }
        return offset;
      };
      if (document.caretRangeFromPoint) {
        const range = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (range && block.contains(range.startContainer))
          clickOffset = _caretOffset(range.startContainer, range.startOffset);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos && block.contains(pos.offsetNode))
          clickOffset = _caretOffset(pos.offsetNode, pos.offset);
      }

      const absOffset = pOffset + clickOffset;
      const wi = this._findWordAtOffset(absOffset);
      if (wi < 0) return;

      if (e.shiftKey) {
        if (this.rangeStart < 0) {
          this.rangeStart = wi;
          this.rangeEnd = -1;
        } else {
          this.rangeEnd = wi;
          if (this.rangeStart > this.rangeEnd) [this.rangeStart, this.rangeEnd] = [this.rangeEnd, this.rangeStart];
        }
        this.updateDocViewerHighlight(this.rsvp.idx);
        this.updateRangeInfo();
      } else {
        this.rsvp.seek(wi);
        this.updateDocViewerHighlight(wi);
      }
    });
  }

  updateDocViewerHighlight(idx) {
    const container = this.$('docViewerContent');
    container.querySelectorAll('.dv-p.active').forEach(el => el.classList.remove('active'));

    if (idx < 0 || idx >= this.wordOffsets.length) return;
    const [wStart] = this.wordOffsets[idx];

    const blocks = container.querySelectorAll('.dv-p');
    for (const block of blocks) {
      const pStart = parseInt(block.dataset.offset);
      const pLen = (block.textContent || '').length;
      const pEnd = pStart + pLen;
      if (wStart >= pStart && wStart < pEnd) {
        block.classList.add('active');
        block.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        break;
      }
    }

    this._updateMarkerHighlight(container);
    this._updatePageThumbActive(idx);
  }

  _updatePageThumbActive(idx) {
    const container = this.$('docViewerPages');
    if (!container || container.classList.contains('hidden')) return;
    container.querySelectorAll('.page-thumb.active').forEach(el => el.classList.remove('active'));
    if (!this.page_starts || idx < 0) return;
    for (let i = this.page_starts.length - 1; i >= 0; i--) {
      if (idx >= this.page_starts[i]) {
        const el = container.querySelector(`.page-thumb[data-page="${i}"]`);
        if (el) el.classList.add('active');
        break;
      }
    }
  }

  _updateMarkerHighlight(container) {
    container.querySelectorAll('.dv-p.start-marker').forEach(el => el.classList.remove('start-marker'));
    if (this.startMarker < 0 || this.startMarker >= this.wordOffsets.length) return;
    const [mStart] = this.wordOffsets[this.startMarker];
    const blocks = container.querySelectorAll('.dv-p');
    for (const block of blocks) {
      const pStart = parseInt(block.dataset.offset);
      const pLen = (block.textContent || '').length;
      const pEnd = pStart + pLen;
      if (mStart >= pStart && mStart < pEnd) {
        block.classList.add('start-marker');
        break;
      }
    }
  }

  _updateRangeHighlight() {
    const container = this.$('docViewerContent');
    container.querySelectorAll('.dv-p.range-selected').forEach(el => el.classList.remove('range-selected'));
    if (this.rangeStart < 0 || this.wordOffsets.length === 0) return;
    const endIdx = this.rangeEnd > this.rangeStart ? this.rangeEnd : this.rsvp.words.length - 1;
    if (endIdx >= this.wordOffsets.length) return;
    const charStart = this.wordOffsets[this.rangeStart][0];
    const charEnd = this.wordOffsets[endIdx][1];
    const blocks = container.querySelectorAll('.dv-p');
    for (const block of blocks) {
      const pStart = parseInt(block.dataset.offset);
      const pLen = (block.textContent || '').length;
      const pEnd = pStart + pLen;
      if (pStart < charEnd && pEnd > charStart) {
        block.classList.add('range-selected');
      }
    }
  }

  updateRangeInfo() {
    const info = this.$('rangeInfo');
    if (this.rangeStart >= 0 && this.rangeEnd > this.rangeStart) {
      info.textContent = `${this.rangeStart + 1}–${this.rangeEnd + 1} (${this.rangeEnd - this.rangeStart + 1} words)`;
    } else if (this.rangeStart >= 0) {
      info.textContent = `From word ${this.rangeStart + 1}`;
    } else {
      info.textContent = '';
    }
    this._updateRangeHighlight();
    this.updateReadRangeBtn();
  }

  readSelectedRange() {
    if (this.rangeStart < 0) return;
    const end = this.rangeEnd > this.rangeStart ? this.rangeEnd : this.rsvp.words.length - 1;
    this.rsvp.seek(this.rangeStart);
    this.rangeEnd = end;
    this.updateRangeInfo();
    this.updateReadRangeBtn();
    if (!this.rsvp.playing) this.togglePlay();
    this.updateDocViewerHighlight(this.rsvp.idx);
  }

  clearReadRange() {
    this.rangeStart = -1;
    this.rangeEnd = -1;
    this.updateRangeInfo();
    this.updateReadRangeBtn();
    this.updateDocViewerHighlight(this.rsvp.idx);
  }

  updateReadRangeBtn() {
    const btn = this.$('btnReadRange');
    if (this.rangeStart >= 0 && this.rangeEnd > this.rangeStart) {
      btn.textContent = `Read ${this.rangeStart + 1}–${this.rangeEnd + 1}`;
    } else if (this.rangeStart >= 0) {
      btn.textContent = `Read from ${this.rangeStart + 1}`;
    } else {
      btn.textContent = 'Read Selected';
    }
  }

  toggleCompactView() {
    this.compactView = !this.compactView;
    const content = this.$('docViewerContent');
    content.classList.toggle('dv-compact', this.compactView);
    this.$('btnCompactToggle').classList.toggle('active', this.compactView);
  }

  setupPageNavigator() {
    const slider = this.$('dvPageSlider');
    const paragraphs = this.$('docViewerContent').querySelectorAll('.dv-p');
    const max = Math.max(0, paragraphs.length - 1);
    slider.max = max;
    slider.value = 0;
    this.$('dvPageInfo').textContent = `1 / ${paragraphs.length}`;
  }

  onPageSliderInput(e) {
    const idx = parseInt(e.target.value);
    const paragraphs = this.$('docViewerContent').querySelectorAll('.dv-p');
    if (idx >= 0 && idx < paragraphs.length) {
      this.$('dvPageInfo').textContent = `${idx + 1} / ${paragraphs.length}`;
    }
  }

  onPageSliderChange(e) {
    const idx = parseInt(e.target.value);
    const paragraphs = this.$('docViewerContent').querySelectorAll('.dv-p');
    if (idx >= 0 && idx < paragraphs.length) {
      paragraphs[idx].scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  setStartMarker() {
    if (this._loadingChunks || this.rsvp.words.length === 0) return;
    this.startMarker = this.rsvp.idx;
    this._startMarkerConsumed = false;
    this.$('btnStartMarker').classList.add('hidden');
    this.$('btnClearMarker').classList.remove('hidden');
    this.updateDocViewerHighlight(this.rsvp.idx);
  }

  clearStartMarker() {
    this.startMarker = -1;
    this._startMarkerConsumed = false;
    this.$('btnStartMarker').classList.remove('hidden');
    this.$('btnClearMarker').classList.add('hidden');
    this.updateDocViewerHighlight(this.rsvp.idx);
  }

  showLoading() {
    this._loadingCount++;
    this.$('globalLoader').classList.remove('hidden');
  }

  hideLoading() {
    this._loadingCount = Math.max(0, this._loadingCount - 1);
    if (this._loadingCount === 0) {
      this.$('globalLoader').classList.add('hidden');
    }
  }

  updatePageViewToggle() {
    const btn = this.$('btnPageViewToggle');
    if (this.page_starts && this.page_starts.length > 0) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
      if (this._pageView) this.togglePageView();
    }
  }

  togglePageView() {
    this._pageView = !this._pageView;
    this.$('docViewerContent').classList.toggle('hidden', this._pageView);
    this.$('docViewerPages').classList.toggle('hidden', !this._pageView);
    this.$('dvPageSlider').disabled = this._pageView;
    this.$('btnCompactToggle').disabled = this._pageView;
    this.$('btnPageViewToggle').classList.toggle('active', this._pageView);
    if (this._pageView) {
      this.renderPageThumbnails();
    }
  }

  renderPageThumbnails() {
    const container = this.$('docViewerPages');
    if (!this.page_starts || this.page_starts.length === 0) {
      container.innerHTML = '<p style="padding:16px;color:#9ca3af;font-size:13px">No page data available.</p>';
      return;
    }
    const numPages = this.page_starts.length;
    let html = '';
    for (let i = 0; i < numPages; i++) {
      const isActive = this._isPageActive(i);
      html += `<div class="page-thumb${isActive ? ' active' : ''}" data-page="${i}">
        <div class="page-placeholder" id="page-loading-${i}">
          <div class="pl-spinner"></div>
          <div class="pl-text">${i + 1}</div>
        </div>
      </div>`;
    }
    container.innerHTML = html;

    container.querySelectorAll('.page-thumb').forEach(el => {
      el.addEventListener('click', () => {
        const page = parseInt(el.dataset.page);
        this.seekToPage(page);
      });
    });

    this._loadVisiblePageThumbnails();
  }

  _loadVisiblePageThumbnails() {
    if (!this.page_starts) return;
    for (let i = 0; i < this.page_starts.length; i++) {
      if (!this._pageThumbnails[i]) {
        this._pageThumbnails[i] = 'loading';
        this._thumbQueue.push(i);
      }
    }
    if (!this._thumbLoading && this._thumbQueue.length > 0) {
      this._thumbLoading = true;
      this.showLoading();
      this._processThumbQueue();
    }
  }

  _processThumbQueue() {
    if (this._thumbQueue.length === 0) {
      this._thumbLoading = false;
      this.hideLoading();
      return;
    }
    const page = this._thumbQueue.shift();
    this.bridge.send('get_page_image', { page, width: 200 });
  }

  onPageImage(d) {
    const page = d.page;
    this._pageThumbnails[page] = d.content;
    const placeholder = document.getElementById(`page-loading-${page}`);
    if (placeholder) {
      const thumb = placeholder.parentNode;
      const img = document.createElement('img');
      img.src = `data:image/png;base64,${d.content}`;
      img.alt = `Page ${page + 1}`;
      img.loading = 'lazy';
      placeholder.replaceWith(img);
      const label = document.createElement('span');
      label.className = 'page-label';
      label.textContent = page + 1;
      thumb.appendChild(label);
    }
    this._thumbLoading = false;
    this._processThumbQueue();
  }

  _isPageActive(pageIdx) {
    if (!this.page_starts || pageIdx >= this.page_starts.length) return false;
    const start = this.page_starts[pageIdx];
    const end = pageIdx + 1 < this.page_starts.length ? this.page_starts[pageIdx + 1] : this.rsvp.words.length;
    return this.rsvp.idx >= start && this.rsvp.idx < end;
  }

  seekToPage(pageIdx) {
    if (!this.page_starts || pageIdx >= this.page_starts.length) return;
    const wordIdx = this.page_starts[pageIdx];
    this.rsvp.seek(wordIdx);
    if (this._pageView) {
      this.renderPageThumbnails();
      const el = this.$('docViewerPages').querySelector(`.page-thumb[data-page="${pageIdx}"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    this.updateDocViewerHighlight(wordIdx);
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
