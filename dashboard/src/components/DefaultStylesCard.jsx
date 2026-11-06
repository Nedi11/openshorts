import React, { useCallback, useEffect, useState } from 'react';
import { Type } from 'lucide-react';
import SubtitleModal from './SubtitleModal';
import HookModal from './HookModal';
import { fetchDefaults, saveDefaults } from '../lib/userDefaults';

// Settings: the caption style and hook every NEW video gets (STYLE-001).
// Clips already made keep their own look; the editors also start from these.
const FONT_LABEL = { montserrat: 'Montserrat', anton: 'Anton', serif: 'Serif', tiktok: 'TikTok Sans' };
const HOOK_SIZE = { S: 'small', M: 'medium', L: 'large' };

function captionSummary(s) {
    if (!s) return '';
    const parts = [s.font_name, `size ${s.font_size}`, s.style === 'karaoke' ? 'word highlight' : 'classic',
        s.position === 'custom' ? `${s.position_y}% from bottom` : s.position];
    if (s.uppercase) parts.push('uppercase');
    if (s.border_width) parts.push(`border ${s.border_width}`);
    return parts.join(' · ');
}

function hookSummary(h) {
    if (!h) return '';
    return [h.style, FONT_LABEL[h.font] || 'style font', h.position === 'custom' ? 'custom spot' : `${h.position} position`,
        HOOK_SIZE[h.size] || h.size, `${Math.round(h.duration_seconds)}s`].join(' · ');
}

export default function DefaultStylesCard() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState(null);   // 'captions' | 'hook' | null

    const load = useCallback(() => {
        fetchDefaults().then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
    }, []);
    useEffect(() => { load(); }, [load]);

    const reset = async (part) => {
        try { setData(await saveDefaults({ [part]: null })); } catch (e) { setError(e.message); }
    };
    const close = () => { setEditing(null); load(); };

    const rows = data ? [
        { key: 'captions', part: 'caption_style', label: 'Captions', saved: data.caption_style,
          summary: captionSummary(data.caption_style || data.builtin.caption_style) },
        { key: 'hook', part: 'hook', label: 'Hook', saved: data.hook,
          summary: hookSummary(data.hook || data.builtin.hook) },
    ] : [];

    return (
        <div className="card p-4 sm:p-6 mb-6">
            <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-input bg-paper3 flex items-center justify-center shrink-0">
                    <Type size={16} className="text-brass" />
                </div>
                <h2 className="text-base font-medium text-ink lowercase">Default captions &amp; hook</h2>
            </div>
            <p className="text-xs text-muted mb-4 leading-relaxed">
                The look every new video gets automatically, and where the caption and hook editors start.
                Clips you already made keep their own look.
            </p>
            {error && <p role="alert" className="text-xs text-danger mb-3">{error}</p>}
            <div className="space-y-3">
                {rows.map((r) => (
                    <div key={r.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 border border-rule rounded-input p-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-ink">{r.label} <span className="text-xs text-muted">{r.saved ? '· your default' : '· built-in'}</span></p>
                            <p className="text-xs text-muted truncate">{r.summary}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <button type="button" className="btn-ghost text-xs py-1.5 px-3" onClick={() => setEditing(r.key)}>edit</button>
                            {r.saved && (
                                <button type="button" className="btn-quiet text-xs py-1.5 px-3" onClick={() => reset(r.part)}>reset to built-in</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <SubtitleModal isOpen={editing === 'captions'} onClose={close} defaultsMode onGenerate={() => {}} />
            <HookModal isOpen={editing === 'hook'} onClose={close} defaultsMode onGenerate={() => {}}
                initialText="POV: this is how your hooks will look" durationInSeconds={8} />
        </div>
    );
}
