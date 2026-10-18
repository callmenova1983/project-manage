import { expect, it } from "vitest";
import { encodeSpeechWav } from "../../apps/web/src/services/voice-recorder";
import { validateSpeechWav } from "../../apps/api/src/ai/speech";
it("converts mobile sample rates to bounded mono PCM WAV accepted by the ASR adapter", async () => {
  for (const rate of [44100, 48000, 16000]) {
    const samples = new Float32Array(rate).fill(0.5);
    const wav = encodeSpeechWav(
      [samples.slice(0, 1000), samples.slice(1000)],
      rate,
    );
    const bytes = Buffer.from(await wav.arrayBuffer());
    expect(bytes.length).toBe(32044);
    expect(bytes.readInt16LE(44)).toBe(16384);
    expect(validateSpeechWav(bytes.toString("base64"))).toBe(1);
  }
});
it("clips loud audio instead of integer overflow and rejects empty input", async () => {
  const samples = new Float32Array(16000).fill(2);
  samples[0] = -2;
  const bytes = Buffer.from(
    await encodeSpeechWav([samples], 16000).arrayBuffer(),
  );
  expect(bytes.readInt16LE(44)).toBe(-32768);
  expect(bytes.readInt16LE(46)).toBe(32767);
  const empty = Buffer.from(await encodeSpeechWav([], 16000).arrayBuffer());
  expect(() => validateSpeechWav(empty.toString("base64"))).toThrow();
});
