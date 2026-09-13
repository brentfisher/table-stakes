/** Consistent silhouettes remain legible over the moving restaurant. */
export function CommandIcon({ name }: { name: 'coin' | 'guests' | 'dish' | 'crown' | 'spark' | 'warning' | 'clock' }): JSX.Element {
  return <svg className="command-icon" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true" focusable="false">
    {name === 'coin' ? <><circle cx="16" cy="16" r="14" /><path d="M20 10c-6-4-12 3-5 6s3 8-4 5m5-15v20" fill="none" stroke="#182837" strokeWidth="2.5" strokeLinecap="round" /></> : null}
    {name === 'guests' ? <><circle cx="12" cy="10" r="5"/><circle cx="24" cy="11" r="4"/><path d="M2 28v-4a10 10 0 0 1 20 0v4zm22 0v-4a12 12 0 0 0-3-8c6-2 10 3 10 8v4z"/></> : null}
    {name === 'dish' ? <><path d="M3 23a13 13 0 0 1 26 0H3zm-1 3h28v3H2z"/><circle cx="16" cy="8" r="2"/><path d="M10 2v3m12-3v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></> : null}
    {name === 'crown' ? <path d="m2 8 8 6 6-12 6 12 8-6-4 17H6L2 8zm4 20h20v3H6z"/> : null}
    {name === 'spark' ? <><path d="m5 13 14 13-17 4 3-17zm9-4 3-7 3 2-3 7zm8 8 7-4 2 3-8 4zm-3-5 5-6 3 2-6 6z"/><circle cx="8" cy="5" r="2"/><circle cx="27" cy="25" r="2"/></> : null}
    {name === 'warning' ? <><path d="M13 4a3.4 3.4 0 0 1 6 0l12 23a2 2 0 0 1-2 3H3a2 2 0 0 1-2-3L13 4z"/><path d="M16 11v8m0 5v1" stroke="#26212a" strokeWidth="3" strokeLinecap="round"/></> : null}
    {name === 'clock' ? <><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="2.5"/><path d="M16 8v9l6 3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></> : null}
  </svg>;
}
