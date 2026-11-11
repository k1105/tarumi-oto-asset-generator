// 書き出し。画像は canvas をそのまま、動画は 1 コマずつ描いて MP4 (H.264 + AAC) にする
import { ALL_FORMATS, AudioBufferSink, AudioBufferSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, UrlSource, canEncodeAudio } from 'mediabunny';
import { allLayers, type Doc, type MediaLayer } from './doc';
import { cropRect, durationOf, render, videoTime, type Resolve, type Source } from './render';

export const FPS = 30;

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 書き出すファイルの名前 (拡張子の前まで)。アートボードが複数なら -1, -2 … を付ける */
export const fileBase = (doc: Doc, page = 0) => `${doc.name.replace(/[\\/:*?"<>|\s]+/g, '_') || 'sns'}-${doc.aspect.replace(':', 'x')}${doc.count > 1 ? `-${page + 1}` : ''}`;

/** 今の見た目を 1 枚の画像に */
/** page 枚目のアートボードを 1 枚の画像に */
export async function exportImage(doc: Doc, resolve: Resolve, type: 'png' | 'jpeg', time: number | null = null, page = 0): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.w;
  canvas.height = doc.h;
  render(canvas.getContext('2d')!, doc, resolve, { time, page });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, `image/${type}`, 0.92));
  if (!blob) throw new Error('画像にできませんでした');
  return blob;
}

type Frames = AsyncGenerator<{ canvas: HTMLCanvasElement | OffscreenCanvas } | null, void, unknown>;
type Clip = { layer: MediaLayer; input: Input; length: number; sink: CanvasSink; frames: Frames | null };

/**
 * 動画に書き出す。静止画とテキストは編集画面と同じ絵、動画の枠は元のファイルから 1 コマずつ取り出す。
 * 音は、ミュートしていない動画の音を音量どおりに混ぜる
 */
export async function exportVideo(doc: Doc, resolve: Resolve, onProgress: (ratio: number, note: string) => void, signal: AbortSignal, page = 0): Promise<Blob> {
  const videos = allLayers(doc).filter((l): l is MediaLayer => l.type === 'media' && l.kind === 'video' && !!l.src && !l.hidden);
  const clips: Clip[] = [];
  const stop = () => {
    if (signal.aborted) throw new DOMException('書き出しを止めました', 'AbortError');
  };
  try {
    onProgress(0, '動画を読んでいます');
    for (const layer of videos) {
      const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(new URL(layer.src!, location.href)) });
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) {
        input.dispose();
        throw new Error(`「${layer.name}」をこのブラウザで読めません (H.264 か HEVC の mp4 / mov にしてください)`);
      }
      const w = await track.getDisplayWidth();
      const h = await track.getDisplayHeight();
      const length = await track.computeDuration();
      // 枠に出る大きさより細かくは取り出さない
      const scale = Math.min(1, cropRect(layer, w, h).scale);
      const sink = new CanvasSink(track, { width: Math.max(2, Math.round(w * scale)), poolSize: 2 });
      clips.push({ layer, input, length, sink, frames: null });
    }
    const duration = durationOf(doc, (l) => clips.find((c) => c.layer.id === l.id)?.length ?? 0);
    const total = Math.max(1, Math.round(duration * FPS));
    for (const c of clips) {
      // 最後のコマより後ろを頼むと空が返るので、少し手前で止める
      const times = Array.from({ length: total }, (_, i) => Math.min(videoTime(c.layer, i / FPS, c.length), c.length - 0.001));
      c.frames = c.sink.canvasesAtTimestamps(times);
    }

    const canvas = document.createElement('canvas');
    canvas.width = doc.w;
    canvas.height = doc.h;
    const ctx = canvas.getContext('2d')!;
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: doc.w * doc.h > 1_600_000 ? 16_000_000 : 12_000_000, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: FPS });

    const mixed = await mixAudio(clips, duration, stop);
    let audio: AudioBufferSource | null = null;
    if (mixed && (await canEncodeAudio('aac'))) {
      audio = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 });
      output.addAudioTrack(audio);
    }
    await output.start();

    const current = new Map<string, Source>();
    const resolveFrame: Resolve = (l) => (l.kind === 'video' ? current.get(l.id) ?? null : resolve(l));
    for (let i = 0; i < total; i++) {
      stop();
      for (const c of clips) {
        const f = (await c.frames!.next()).value;
        if (f) current.set(c.layer.id, { el: f.canvas, w: f.canvas.width, h: f.canvas.height });
      }
      render(ctx, doc, resolveFrame, { time: i / FPS, page });
      await video.add(i / FPS, 1 / FPS);
      if (i % 5 === 0) onProgress(i / total, `${i} / ${total} コマ`);
    }
    if (audio && mixed) await audio.add(mixed);
    onProgress(1, '仕上げています');
    await output.finalize();
    return new Blob([output.target.buffer!], { type: 'video/mp4' });
  } finally {
    for (const c of clips) {
      await c.frames?.return().catch(() => {});
      c.input.dispose();
    }
  }
}

/** 動画の音を全体の長さぶん混ぜる。鳴らす音が無ければ null */
async function mixAudio(clips: Clip[], duration: number, stop: () => void): Promise<AudioBuffer | null> {
  const RATE = 48_000;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * RATE), RATE);
  let any = false;
  for (const c of clips) {
    if (c.layer.muted || c.layer.volume <= 0) continue;
    const track = await c.input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) continue;
    const gain = ctx.createGain();
    gain.gain.value = c.layer.volume;
    gain.connect(ctx.destination);
    const sink = new AudioBufferSink(track);
    const span = Math.max(0.05, c.length - c.layer.start);
    // 短い動画は繰り返すので、音も 1 周ずつ並べる
    for (let at = 0; at < duration; at += span) {
      const end = Math.min(c.length, c.layer.start + (duration - at));
      for await (const { buffer, timestamp } of sink.buffers(c.layer.start, end)) {
        stop();
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(gain);
        const when = at + (timestamp - c.layer.start);
        if (when >= 0) node.start(when);
        else node.start(0, -when);
        any = true;
      }
    }
  }
  return any ? await ctx.startRendering() : null;
}
