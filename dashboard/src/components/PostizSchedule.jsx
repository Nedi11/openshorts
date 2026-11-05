import React, { useEffect, useState } from 'react';
import { Calendar, Loader2 } from 'lucide-react';
import Modal from './ui/Modal';
import { apiFetch } from '../lib/api';

async function request(path, options) {
  const res = await apiFetch(`/api/postiz${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Check the schedule fields and try again.');
  return data;
}

export default function PostizSchedule({ jobId, filename, caption, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [dashboardUrl, setDashboardUrl] = useState('');
  const [account, setAccount] = useState('');
  const [text, setText] = useState(caption || '');
  const [mode, setMode] = useState('queue');
  const [date, setDate] = useState('');
  const [delay, setDelay] = useState(180);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = `?job_id=${encodeURIComponent(jobId)}&filename=${encodeURIComponent(filename || '')}`;
  const selected = records.find(r => r.integration_id === account);

  async function refresh() {
    const data = await request(`/status${query}`);
    setRecords(data.records);
  }
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError(''); setText(caption || ''); setRecords([]);
    Promise.all([request('/accounts'), request(`/status${query}`)])
      .then(([a, s]) => {
        if (cancelled) return;
        setAccounts(a.accounts); setDashboardUrl(a.dashboard_url);
        setAccount(current => a.accounts.some(x => x.id === current) ? current : a.accounts.find(x => !x.disabled)?.id || '');
        setRecords(s.records);
      })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, jobId, filename]);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request('/schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({job_id: jobId, filename, integration_id: account,
          caption: text, mode, date: mode === 'time' ? new Date(date).toISOString() : null,
          delay_minutes: Number(delay)}),
      });
      setRecords(current => [...current.filter(r => r.integration_id !== result.integration_id), result]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" disabled={disabled || !filename} onClick={() => setOpen(true)}
      className="btn-quiet flex-col gap-1 py-2 px-1 text-[11px] rounded-input">
      <Calendar size={16} />schedule · postiz
    </button>
    <Modal isOpen={open} onClose={busy ? undefined : () => setOpen(false)} title="Schedule with Postiz">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted">The saved server video will upload to Postiz. Browser-only preview effects must be rendered into the video first.</p>
        {loading && <p role="status">Loading accounts and schedule…</p>}
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
        <label className="block text-sm">Instagram account
          <select className="input-field mt-1" value={account} onChange={e => setAccount(e.target.value)} disabled={busy || loading} required>
            <option value="">Select account</option>
            {accounts.map(a => <option key={a.id} value={a.id} disabled={a.disabled}>{a.name} · {a.provider}{a.disabled ? ' (disconnected)' : ''}</option>)}
          </select>
        </label>
        {!loading && !error && accounts.length === 0 && <p className="text-sm">Connect Instagram in Postiz, then reopen this dialog.</p>}
        <label className="block text-sm">Caption
          <textarea className="input-field mt-1" rows={4} maxLength={2200} value={text} onChange={e => setText(e.target.value)} disabled={busy || !!selected} />
        </label>
        <label className="block text-sm">When
          <select className="input-field mt-1" value={mode} onChange={e => setMode(e.target.value)} disabled={busy || !!selected}>
            <option value="queue">Next Postiz queue slot</option>
            <option value="after_latest">After latest scheduled post</option>
            <option value="time">Choose date and time</option>
            <option value="now">Publish now</option>
          </select>
        </label>
        {mode === 'queue' && <p className="text-sm text-muted">Uses the selected account’s posting slots and timezone configured in Postiz.</p>}
        {mode === 'time' && <label className="block text-sm">Date and time ({timezone})
          <input className="input-field mt-1" type="datetime-local" required value={date} onChange={e => setDate(e.target.value)} disabled={busy || !!selected} />
        </label>}
        {mode === 'after_latest' && <label className="block text-sm">Delay in minutes
          <input className="input-field mt-1" type="number" required min={1} max={525600} value={delay} onChange={e => setDelay(e.target.value)} disabled={busy || !!selected} />
          <span className="text-muted">Includes posts created directly in Postiz. If none are pending, delay starts now.</span>
        </label>}
        {selected && <div role="status" className="text-sm space-y-2 border border-rule p-3 rounded-input">
          <p>{selected.state} · {new Date(selected.date).toLocaleString()} ({timezone})</p>
          <p>{selected.message}</p>
          {selected.post_id && <p>Post ID: {selected.post_id}</p>}
          {selected.release_url?.startsWith('https://') && <a className="underline" href={selected.release_url} target="_blank" rel="noreferrer">View published post</a>}
          <p>Edit or cancel in Postiz. This clip cannot be submitted twice to this account.</p>
          {dashboardUrl?.startsWith('https://') && <a className="underline" href={dashboardUrl} target="_blank" rel="noreferrer">Open Postiz</a>}
        </div>}
        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={busy || loading || !account || !!selected}>
            {busy ? <><Loader2 size={16} className="animate-spin" /> Uploading and submitting…</> : mode === 'now' ? 'Publish now' : 'Schedule clip'}
          </button>
          <button type="button" className="btn-quiet" disabled={busy || loading} onClick={() => refresh().catch(e => setError(e.message))}>Refresh status</button>
        </div>
      </form>
    </Modal>
  </>;
}
