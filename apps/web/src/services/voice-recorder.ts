/** Resample captured mono audio to the cloud ASR's portable PCM16 WAV input. */
export function encodeSpeechWav(
  chunks: Float32Array[],
  sampleRate: number,
): Blob {
  const size = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const samples = new Float32Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  const rate = 16000,
    ratio = sampleRate / rate;
  const count = Math.floor(samples.length / ratio);
  const buffer = new ArrayBuffer(44 + count * 2),
    view = new DataView(buffer);
  const tag = (at: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * ratio),
      end = Math.min(size, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let total = 0;
    for (let j = start; j < end; j++) total += samples[j]!;
    const value = Math.max(-1, Math.min(1, total / (end - start)));
    view.setInt16(
      44 + i * 2,
      Math.round(value < 0 ? value * 32768 : value * 32767),
      true,
    );
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export class VoiceRecorder {
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode | ScriptProcessorNode;
  private silent?: GainNode;
  private chunks: Float32Array[] = [];
  private canceled = false;
  private total = 0;
  async start(onLevel: (level: number) => void, onLimit: () => void) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "麦克风需要 HTTPS 或本机地址，请通过安全地址打开工作区。",
      );
    // Resume inside the user's gesture, before the microphone permission awaits.
    this.context = new AudioContext();
    const context = this.context;
    void context.resume().catch(() => {});
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (this.canceled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.source = context.createMediaStreamSource(stream);
      const collect = (samples: Float32Array) => {
        if (this.canceled) return;
        const remaining = Math.max(
          0,
          Math.floor(context.sampleRate * 120) - this.total,
        );
        const chunk =
          samples.length > remaining ? samples.slice(0, remaining) : samples;
        if (chunk.length) {
          this.chunks.push(chunk);
          this.total += chunk.length;
        }
        let sum = 0;
        for (const sample of chunk) sum += sample * sample;
        onLevel(Math.min(1, Math.sqrt(sum / Math.max(chunk.length, 1)) * 5));
        if (this.total >= context.sampleRate * 120) onLimit();
      };
      if (context.audioWorklet) {
        await context.audioWorklet.addModule("/voice-recorder.js");
        if (this.canceled) return;
        const node = new AudioWorkletNode(context, "project-voice-recorder");
        node.port.onmessage = (event: MessageEvent<Float32Array>) => {
          if (event.data instanceof Float32Array) collect(event.data);
        };
        this.node = node;
      } else {
        const node = context.createScriptProcessor(2048, 1, 1);
        node.onaudioprocess = (event) =>
          collect(new Float32Array(event.inputBuffer.getChannelData(0)));
        this.node = node;
      }
      this.silent = context.createGain();
      this.silent.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.silent);
      this.silent.connect(context.destination);
      if (context.state === "suspended") await context.resume();
    } catch (e) {
      this.cancel();
      throw e;
    }
  }
  async finish(): Promise<Blob> {
    if (
      typeof AudioWorkletNode !== "undefined" &&
      this.node instanceof AudioWorkletNode
    ) {
      const node = this.node;
      await new Promise<void>((resolve) => {
        const done = (e: MessageEvent) => {
          if (e.data === "flushed") {
            clearTimeout(timer);
            node.port.removeEventListener("message", done);
            resolve();
          }
        };
        const timer = setTimeout(() => {
          node.port.removeEventListener("message", done);
          resolve();
        }, 500);
        node.port.addEventListener("message", done);
        node.port.postMessage("flush");
      });
    }
    const blob = encodeSpeechWav(
      this.chunks,
      this.context?.sampleRate ?? 16000,
    );
    this.cancel();
    return blob;
  }
  cancel() {
    this.canceled = true;
    this.source?.disconnect();
    this.node?.disconnect();
    this.silent?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.context && this.context.state !== "closed")
      void this.context.close().catch(() => {});
    this.chunks = [];
    this.total = 0;
  }
}
