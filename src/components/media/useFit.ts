import { useLayoutEffect, useState } from 'react';

/**
 * The largest box of the given aspect ratio (width / height) that fits inside an
 * element. Returns a callback ref for that element, so it works however late
 * the element mounts.
 */
export function useFit(aspect: number): [(el: HTMLElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el || !(aspect > 0)) return;
    const fit = () => {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch) return;
      const w = Math.min(cw, ch * aspect);
      setBox((b) => (Math.abs(b.w - Math.floor(w)) < 1 && Math.abs(b.h - Math.floor(w / aspect)) < 1 ? b : { w: Math.floor(w), h: Math.floor(w / aspect) }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, aspect]);
  return [setEl, box];
}
