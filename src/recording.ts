// Peaks are computed once at this resolution, then resampled to however many bars fit.
const PEAK_RESOLUTION = 2000;
// Decoding at a low rate keeps memory small for long calls; the shape is all we need.
const DECODE_RATE = 8000;
// Speech activity is tracked in frames of this many seconds.
const FRAME_SECONDS = 0.05;
// A frame counts as speech when it reaches this share of the loudest frame in the call.
const SPEECH_THRESHOLD = 0.1;
// Channels whose loudest sample stays under this carry no speech at all.
const SILENT_CHANNEL = 0.01;
// Seek a little before detected speech so the first syllable isn't clipped.
const LEAD_IN_SECONDS = 0.25;

export interface RecordingShape {
  /** Normalised RMS loudness per bucket, all channels mixed. */
  peaks: number[];
  /** Peak level per FRAME_SECONDS frame, each channel normalised, loudest channel wins. */
  activity: Float32Array;
}

// Fetches the recording (same origin, so no CORS) and reduces it to what the player and the
// transcript need. Agent and caller sit on separate channels, so both count.
export async function analyseRecording(src: string, signal?: AbortSignal): Promise<RecordingShape> {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`recording fetch failed: ${res.status}`);
  const buffer = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(await res.arrayBuffer());
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return { peaks: rmsPeaks(channels, buffer.length), activity: frameActivity(channels, buffer.length, buffer.sampleRate) };
}

/** Where speech first starts in [from, to) seconds, or `from` when none is found. */
export function speechStart(activity: Float32Array, from: number, to: number): number {
  const first = Math.max(0, Math.floor(from / FRAME_SECONDS));
  const last = Math.min(activity.length, Math.ceil(to / FRAME_SECONDS));
  for (let i = first; i < last; i++) {
    if (activity[i] >= SPEECH_THRESHOLD) return Math.max(from, i * FRAME_SECONDS - LEAD_IN_SECONDS);
  }
  return from;
}

function rmsPeaks(channels: Float32Array[], length: number): number[] {
  const buckets = Math.min(PEAK_RESOLUTION, length);
  const peaks: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * length) / buckets);
    const end = Math.floor(((b + 1) * length) / buckets);
    let sum = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) sum += channel[i] * channel[i];
    }
    peaks.push(Math.sqrt(sum / Math.max(1, (end - start) * channels.length)));
  }
  return normalise(peaks);
}

// Each channel is normalised on its own: the caller's line is often far quieter than the agent's.
function frameActivity(channels: Float32Array[], length: number, sampleRate: number): Float32Array {
  const size = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const count = Math.ceil(length / size);
  const activity = new Float32Array(count);
  for (const channel of channels) {
    const frames: number[] = [];
    for (let f = 0; f < count; f++) {
      let loudest = 0;
      for (let i = f * size; i < Math.min(length, (f + 1) * size); i++) loudest = Math.max(loudest, Math.abs(channel[i]));
      frames.push(loudest);
    }
    // A near-silent channel would turn its noise floor into "speech" once normalised.
    if (frames.reduce((max, v) => Math.max(max, v), 0) < SILENT_CHANNEL) continue;
    normalise(frames).forEach((level, f) => (activity[f] = Math.max(activity[f], level)));
  }
  return activity;
}

function normalise(values: number[]): number[] {
  const loudest = values.reduce((max, v) => Math.max(max, v), 0);
  return loudest > 0 ? values.map((v) => v / loudest) : values;
}
