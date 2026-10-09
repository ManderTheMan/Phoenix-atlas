// A QR code drawn as one SVG path (dark modules on white, with the quiet zone
// scanners need), from the qrcode-generator library's module grid.
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

export default function QrCode({ text, size = 240, label }: { text: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++)
      for (let c = 0; c < count; c++) if (qr.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n: count + 8, d: path };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
