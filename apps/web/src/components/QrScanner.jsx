import { useEffect, useId, useRef, useState } from "react";

/**
 * Camera QR scanner with a paste fallback for devices without camera access.
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
    <div className="qr-scanner">
      <div id={`qr-${id}`} className="qr-camera" hidden={!scanning} />
      <div className="qr-controls">
        {scanning ? (
          <button type="button" className="button outline" onClick={stop}>Stop camera</button>
        ) : (
          <button type="button" className="button" onClick={start}>📷 {label}</button>
        )}
      </div>
      {error && <p className="feedback error" role="alert">{error}</p>}
      <div className="qr-controls">
        <input
          className="mono"
          aria-label="QR code"
          placeholder="…or paste the code"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />
        <button
          type="button"
          className="button outline"
          disabled={!paste.trim()}
          onClick={() => { onResult(paste.trim()); setPaste(""); }}
        >
          Use
        </button>
      </div>
    </div>
  );
}
