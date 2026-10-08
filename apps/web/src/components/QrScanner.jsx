import { useEffect, useId, useRef, useState } from "react";

/**
 * Camera QR scanner with a paste fallback (desktops without a camera, or the headless demo).
 * Calls onResult(text) once per successful scan.
 */
export default function QrScanner({ onResult, label = "Scan QR code" }) {
  const id = useId().replace(/:/g, "");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [paste, setPaste] = useState("");
  const scanner = useRef(null);

  useEffect(() => () => { scanner.current?.stop().catch(() => {}); }, []);

  const start = async () => {
    setError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      scanner.current = new Html5Qrcode(`qr-${id}`);
      setScanning(true);
      await scanner.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 220 },
        async (text) => {
          await scanner.current.stop().catch(() => {});
          setScanning(false);
          onResult(text);
        }
      );
    } catch (e) {
      setScanning(false);
      setError("Camera unavailable. Paste the code below instead.");
    }
  };

  const stop = async () => {
    await scanner.current?.stop().catch(() => {});
    setScanning(false);
  };

  return (
    <div className="space-y-3">
      <div id={`qr-${id}`} className={scanning ? "overflow-hidden rounded-xl border border-ink-600" : "hidden"} />
      <div className="flex flex-wrap gap-2">
        {scanning ? <button className="btn-ghost" onClick={stop}>Stop camera</button> : <button className="btn" onClick={start}>📷 {label}</button>}
      </div>
      {error && <p className="text-xs text-amber-300">{error}</p>}
      <div className="flex gap-2">
        <input className="input mono" placeholder="…or paste the code" value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button className="btn-ghost" disabled={!paste} onClick={() => { onResult(paste.trim()); setPaste(""); }}>Use</button>
      </div>
    </div>
  );
}
