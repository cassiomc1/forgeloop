export function rejectStaleHandoff(snapshot, current) {
  return snapshot !== current;
}

export function acceptHandoff(handoff) {
  return handoff.id;
}
