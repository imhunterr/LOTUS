import React, { useState, useId } from 'react';
export function Icon({ name = 'leaf', size = 20 }) {
  const paths = {
    leaf: 'M20 4C9 3 3 9 5 16c6 6 13 0 15-12ZM5 20l10-10',
    box: 'm3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10',
    scan: 'M7 3H3v4m14-4h4v4M3 17v4h4m10 0h4v-4M7 9h10M7 13h10M7 17h5',
    home: 'm3 10 9-7 9 7v11h-6v-7H9v7H3V10',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    shield: 'm12 3 9 4v5c0 6-9 10-9 10S3 18 3 12V7l9-4Zm-4 9 3 3 5-6',
    users:
      'M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m20 0v-3a4 4 0 0 0-4-4M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 0a4 4 0 0 1 0 8',
    file: 'M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h8',
    check: 'm5 12 4 4L19 6',
    logout: 'M9 3H3v18h6m4-15 6 6-6 6m-6-6h14',
    plus: 'M12 4v16M4 12h16',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l4 2',
    menu: 'M4 6h16M4 12h16M4 18h16',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.leaf} />
    </svg>
  );
}
export function Card({ title, subtitle, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="panel-heading">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({ title = 'Nothing here yet', children, icon = 'box' }) {
  return (
    <div className="empty">
      <span>
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Badge({ children, tone = '' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Metric({ label, value, hint, icon = 'box', tone = '' }) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-label">
        {label}
        <Icon name={icon} />
      </div>
      <strong>{value}</strong>
      {hint && <p>{hint}</p>}
    </div>
  );
}
export function Field({ label, children, hint }) {
  const id = useId();
  const controls = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    if (typeof child.type === 'string')
      return ['input', 'select', 'textarea'].includes(child.type)
        ? React.cloneElement(child, {
            'aria-labelledby': id,
            'aria-describedby': hint ? `${id}-hint` : undefined,
          })
        : child;
    return React.cloneElement(child, { ariaLabel: label });
  });
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {controls}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
export function Message({ error, message }) {
  return error ? (
    <div className="feedback error" role="alert">
      {error}
    </div>
  ) : message ? (
    <div className="feedback success" role="status">
      <Icon name="check" />
      {message}
    </div>
  ) : null;
}
export function Action({ children, onClick, disabled, className = '' }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  return (
    <div className="action-wrap">
      <button
        className={`button ${className}`}
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          setMessage('');
          try {
            setMessage((await onClick()) || 'Operation recorded.');
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Working…' : children}
      </button>
      <Message error={error} message={message} />
    </div>
  );
}
export function DataTable({ headers, rows, empty = 'No records yet.' }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function PageTitle({ eyebrow, title, children, action }) {
  return (
    <div className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children && <p className="lead">{children}</p>}
      </div>
      {action}
    </div>
  );
}
export function Form({ children, onSubmit, label = 'Save', className = '' }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  return (
    <form
      className={`form ${className}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const values = Object.fromEntries(new FormData(e.currentTarget));
        setBusy(true);
        setError('');
        setMessage('');
        try {
          setMessage((await onSubmit(values, e.currentTarget)) || 'Operation recorded.');
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <div className="form-footer">
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Saving…' : label}
          <Icon name="arrow" size={16} />
        </button>
      </div>
      <Message error={error} message={message} />
    </form>
  );
}
export function LotSelect({ lots, name = 'lotId', required = true, ariaLabel, value, onChange }) {
  return (
    <select
      name={name}
      aria-label={ariaLabel}
      required={required}
      {...(value === undefined ? { defaultValue: '' } : { value, onChange })}
    >
      <option value="" disabled>
        Select a product and lot
      </option>
      {lots.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name} · {l.lotNumber}
        </option>
      ))}
    </select>
  );
}
export function download(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
