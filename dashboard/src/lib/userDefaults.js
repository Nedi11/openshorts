import { apiFetch } from './api';

// Saved caption style and hook for new videos (STYLE-001, user_defaults.py).
// GET returns {caption_style, hook, builtin}; null parts use the built-in look.
export async function fetchDefaults() {
    const res = await apiFetch('/api/defaults');
    if (!res.ok) throw new Error('Could not load the saved defaults');
    return res.json();
}

// PUT replaces both parts, so the part not being changed is sent as it is.
// Pass undefined to keep a part, null to reset it to the built-in look.
export async function saveDefaults({ caption_style, hook }) {
    const current = await fetchDefaults();
    const body = {
        caption_style: caption_style === undefined ? current.caption_style : caption_style,
        hook: hook === undefined ? current.hook : hook,
    };
    const res = await apiFetch('/api/defaults', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) {
        let detail = 'Could not save the defaults';
        try { detail = (await res.json()).detail || detail; } catch { /* keep */ }
        throw new Error(typeof detail === 'string' ? detail : 'Could not save the defaults');
    }
    return res.json();
}
