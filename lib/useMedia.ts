'use client';
// 枠に入れる画像と動画の要素を持つ。画像は src ごと、動画は枠ごとに 1 つ。使わなくなった動画は止めて手放す
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { allLayers, type Doc, type MediaLayer } from './doc';
import { videoTime, type Resolve, type Source } from './render';
import { mediaUrl } from './storage';

type Vid = { src: string; el: HTMLVideoElement };

function releaseVideo(el: HTMLVideoElement) {
  el.pause();
  el.removeAttribute('src');
  el.load();
}

// SVG を絵にしたもの (画像の要素を忘れると一緒に消える)
const svgs = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

export function useMedia(doc: Doc, onChange: () => void) {
  const images = useRef(new Map<string, HTMLImageElement>());
  const videos = useRef(new Map<string, Vid>());
  const changed = useRef(onChange);
  changed.current = onChange;

  // ドキュメントの枠に合わせて、動画の要素を作る・手放す
  useEffect(() => {
    const want = new Map<string, MediaLayer>();
    for (const l of allLayers(doc)) if (l.type === 'media' && l.kind === 'video' && l.src) want.set(l.id, l);
    for (const [id, v] of videos.current) {
      if (want.get(id)?.src !== v.src) {
        releaseVideo(v.el);
        videos.current.delete(id);
      }
    }
    for (const [id, l] of want) {
      let v = videos.current.get(id);
      if (!v) {
        const el = document.createElement('video');
        el.playsInline = true;
        el.preload = 'auto';
        el.crossOrigin = 'anonymous';
        const ping = () => changed.current();
        el.addEventListener('loadeddata', ping);
        el.addEventListener('seeked', ping);
        el.addEventListener('durationchange', ping);
        el.src = mediaUrl(l.src!);
        v = { src: l.src!, el };
        videos.current.set(id, v);
      }
      v.el.muted = l.muted;
      v.el.volume = Math.min(1, Math.max(0, l.volume));
    }
    // 使っていない画像は忘れる
    const used = new Set(allLayers(doc).flatMap((l) => (l.type === 'media' && l.kind === 'image' && l.src ? [l.src] : [])));
    for (const src of images.current.keys()) if (!used.has(src)) images.current.delete(src);
  }, [doc]);

  useEffect(() => {
    const vids = videos.current;
    const imgs = images.current;
    return () => {
      for (const v of vids.values()) releaseVideo(v.el);
      vids.clear();
      imgs.clear();
    };
  }, []);

  const resolve: Resolve = useCallback((l): Source | null => {
    if (!l.src) return null;
    if (l.kind === 'video') {
      const el = videos.current.get(l.id)?.el;
      return el && el.readyState >= 2 && el.videoWidth ? { el, w: el.videoWidth, h: el.videoHeight } : null;
    }
    let img = images.current.get(l.src);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => changed.current();
      img.src = mediaUrl(l.src);
      images.current.set(l.src, img);
    }
    if (!img.complete || !img.naturalWidth) return null;
    // SVG は、大きさ (width / height) が書かれていないと、一部を切り出して描くときに位置がずれる。全体を 1 度ふつうの絵にしてから使う
    if (/\.svg([?#]|$)/i.test(l.src) || /\.svg$/i.test(l.name)) {
      let c = svgs.get(img);
      if (!c) {
        const k = 3000 / Math.max(img.naturalWidth, img.naturalHeight);
        c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        svgs.set(img, c);
      }
      return { el: c, w: c.width, h: c.height };
    }
    return { el: img, w: img.naturalWidth, h: img.naturalHeight };
  }, []);

  /** 枠の動画の長さ (秒)。まだ分からなければ 0 */
  const videoLength = useCallback((l: MediaLayer) => {
    const d = videos.current.get(l.id)?.el.duration;
    return d && Number.isFinite(d) ? d : 0;
  }, []);

  /** 全部の動画を全体の時刻 t に合わせる。playing なら再生し、ずれたら合わせ直す */
  const sync = useCallback((d: Doc, t: number, playing: boolean) => {
    for (const l of allLayers(d)) {
      if (l.type !== 'media') continue;
      const el = videos.current.get(l.id)?.el;
      if (!el || !Number.isFinite(el.duration)) continue;
      const want = Math.min(videoTime(l, t, el.duration), el.duration - 0.02);
      if (playing) {
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.02) el.currentTime = want;
      }
    }
  }, []);

  return useMemo(() => ({ resolve, videoLength, sync }), [resolve, videoLength, sync]);
}
