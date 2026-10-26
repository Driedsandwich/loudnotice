export const SAMPLE_NAMES = ['smoke_alarm', 'doorbell', 'knock', 'microwave', 'kettle', 'washer_tune'];
export class AudioPipeline {
  constructor(onWindow, onState, onError) {
    this.onWindow = onWindow; this.onState = onState; this.onError = onError;
    this.generation = 0; this.mode = null; this.cache = new Map();
  }
  async unlock() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio is not available in this browser.');
      this.context = new AudioContext();
      this.context.onstatechange = () => {
        if (this.context.state === 'suspended' && this.mode) this.onState(this.mode, 'Audio paused by the browser. Stop, then start again.');
      };
    }
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Audio is paused. Click Start or a sample button to enable it.');
  }
  async setup() {
    await this.unlock();
    if (this.analyser) return;
    this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 2048;
    this.silent = this.context.createGain(); this.silent.gain.value = 0;
    this.silent.connect(this.context.destination);
    this.audible = this.context.createGain(); this.audible.gain.value = .55;
    this.audible.connect(this.context.destination);
    this.workletReady = false;
    if (this.context.audioWorklet) {
      try {
        await this.context.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
        this.workletReady = true;
      } catch { /* ScriptProcessor remains a compatibility fallback. */ }
    }
  }
  attach(node, source, generation) {
    this.pending = new Float32Array(0);
    this.mode = source; this.input = node;
    const receive = chunk => {
      if (generation !== this.generation || !this.mode) return;
      if (this.capture) {
        const remaining = this.capture.target - this.capture.length;
        const part = chunk.slice(0, remaining);
        this.capture.chunks.push(part); this.capture.length += part.length;
        if (this.capture.length >= this.capture.target) {
          const recording = this.capture; this.capture = null;
          clearTimeout(recording.timeout);
          const samples = new Float32Array(recording.length);
          let offset = 0;
          for (const part of recording.chunks) { samples.set(part, offset); offset += part.length; }
          recording.resolve({ samples, sampleRate: this.context.sampleRate });
        }
      }
      const joined = new Float32Array(this.pending.length + chunk.length);
      joined.set(this.pending); joined.set(chunk, this.pending.length);
      this.pending = joined;
      const size = Math.round(this.context.sampleRate), hop = Math.round(size / 2);
      try {
        while (this.pending.length >= size) {
          const frame = this.pending.slice(0, size);
          this.pending = this.pending.slice(hop);
          this.onWindow(frame, this.context.sampleRate, source);
        }
      } catch (error) { this.stop(); this.onError(error); }
    };
    if (this.workletReady) {
      this.processor = new AudioWorkletNode(this.context, 'soundsense-capture');
      this.processor.port.onmessage = event => receive(event.data);
    } else {
      this.processor = this.context.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = event => receive(event.inputBuffer.getChannelData(0).slice());
    }
    node.connect(this.analyser); this.analyser.connect(this.processor); this.processor.connect(this.silent);
    this.onState(source);
  }
  async startMic() {
    this.stop(); const generation = this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs HTTPS or localhost and a supported browser.');
    await this.setup();
    if (generation !== this.generation) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
    } });
    if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    stream.getAudioTracks().forEach(track => { track.onended = () => { if (this.stream === stream) { this.stop(); this.onError(new Error('Microphone disconnected. Please start again.')); } }; });
    this.attach(this.context.createMediaStreamSource(stream), 'mic', generation);
  }
  async sample(name) {
    if (!SAMPLE_NAMES.includes(name)) throw new Error('Unknown sample.');
    await this.setup();
    if (!this.cache.has(name)) {
      const response = await fetch(new URL(`../sounds/${name}.wav`, import.meta.url));
      if (!response.ok) throw new Error(`Could not load ${name}.wav (${response.status}).`);
      this.cache.set(name, await this.context.decodeAudioData(await response.arrayBuffer()));
    }
    return this.cache.get(name);
  }
  async file(file) {
    await this.setup();
    if (file.size > 12 * 1024 * 1024) throw new Error('Choose an audio file smaller than 12 MB.');
    const buffer = await this.context.decodeAudioData(await file.arrayBuffer());
    if (buffer.duration < 1 || buffer.duration > 15) throw new Error('Choose a clip between 1 and 15 seconds long.');
    return buffer;
  }
  mono(buffer) {
    const mono = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const values = buffer.getChannelData(channel);
      for (let i = 0; i < values.length; i++) mono[i] += values[i] / buffer.numberOfChannels;
    }
    return mono;
  }
  async playBuffer(buffer) {
    this.stop(); const generation = this.generation;
    await this.setup();
    if (generation !== this.generation) return;
    const node = this.context.createBufferSource(); node.buffer = buffer;
    this.player = node; this.attach(node, 'sample', generation); node.connect(this.audible);
    await new Promise(resolve => {
      this.playResolve = resolve;
      node.onended = () => {
        // Drain the final worklet block, and finish the last half-second window.
        this.endTimer = setTimeout(() => {
          if (generation === this.generation) {
            try {
              if (this.pending.length >= this.context.sampleRate / 2) {
                const final = new Float32Array(Math.round(this.context.sampleRate)); final.set(this.pending);
                this.onWindow(final, this.context.sampleRate, 'sample');
              }
            } catch (error) { this.onError(error); }
            this.stop();
          }
          resolve();
        }, 100);
      };
      node.start();
    });
  }
  captureExample(seconds = 2.5) {
    if (this.mode !== 'mic') return Promise.reject(new Error('Start the microphone first.'));
    if (this.capture) return Promise.reject(new Error('An example is already being recorded.'));
    return new Promise((resolve, reject) => {
      this.capture = { target: Math.round(this.context.sampleRate * seconds), length: 0, chunks: [], resolve, reject,
        timeout: setTimeout(() => { if (this.capture) { this.capture.reject(new Error('Recording paused. Keep this tab open and try again.')); this.capture = null; } }, 9000) };
    });
  }
  stop() {
    this.generation++; clearTimeout(this.endTimer);
    if (this.capture) { clearTimeout(this.capture.timeout); this.capture.reject(new Error('Recording stopped. Please capture the example again.')); this.capture = null; }
    if (this.player) { this.player.onended = null; try { this.player.stop(); } catch {} this.player.disconnect(); this.player = null; }
    this.playResolve?.(); this.playResolve = null;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = null;
    this.input?.disconnect(); this.input = null;
    this.analyser?.disconnect();
    if (this.processor) {
      this.processor.disconnect();
      if (this.processor.port) { this.processor.port.onmessage = null; this.processor.port.close(); }
      else this.processor.onaudioprocess = null;
      this.processor = null;
    }
    this.pending = new Float32Array(0); this.mode = null; this.onState(null);
  }
}
