// The pristine base clip (no burned subtitles/hook) for a served clip URL,
// stable however clip.video_url mutates after server edits. The Remotion
// preview composites on it, so it never stacks subtitles over an already
// subtitled file (double-subtitle bug).
export function stripBurns(filename) {
    let f = filename || '', prev;
    do { prev = f; f = f.replace(/^subtitled_\d+_/, '').replace(/^hooked_\d+_/, '').replace(/^hook_/, ''); } while (f !== prev);
    return f;
}

// The file name goes in through a function: a replacement STRING would read
// "$$", "$&" or "$1" in a title as patterns ("MORE $$ THAN" became "MORE $"),
// pointing the preview at a file that does not exist.
export function cleanClipPath(videoUrl) {
    const url = videoUrl || '';
    const clean = stripBurns(url.split('/').pop());
    return url.replace(/[^/]+$/, () => clean);
}
