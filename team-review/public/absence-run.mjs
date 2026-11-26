export function runCandidates(frames, start) {
  const first = frames[start];
  if (!first) return [];
  const clip = first.clipId || first.source;
  const result = [];
  for (let index = start; index < frames.length; index++) {
    const f = frames[index];
    if ((f.clipId || f.source) !== clip) break;
    result.push({ frame: f, index });
    if (result.length === 20) break;
  }
  return result;
}

export function rangeSelection(candidates, end, answers) {
  return candidates
    .slice(0, end + 1)
    .filter(
      ({ frame }) => !frame.reviewed && !frame.answer && !answers[frame.id],
    );
}
