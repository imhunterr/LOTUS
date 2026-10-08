export default function LotSelect({ lots, value, onChange }) {
  return (
    <select className="input" aria-label="Lot" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a lot…</option>
      {lots.map((l) => (
        <option key={l.lotKey} value={l.lotKey}>
          {l.ndc} · lot {l.lotNumber}
        </option>
      ))}
    </select>
  );
}
