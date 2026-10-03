import { useMemo } from "react";
import { encode } from "uqr";

/** Modules of quiet zone around the code, as the QR specification asks. */
const QUIET_ZONE = 4;

/**
 * A QR code drawn as SVG from the design tokens: always dark modules on a
 * light ground (qr-module, qr-ground), in either theme, so it scans.
 */
export function QrCode({ value, label }: { readonly value: string; readonly label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: QUIET_ZONE });
    const squares: string[] = [];
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) squares.push(`M${String(x)} ${String(y)}h1v1h-1z`);
      });
    });
    return { size: qr.size, path: squares.join("") };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className="size-qr bg-qr-ground text-qr-module"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
