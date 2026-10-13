/** Preserve retained identities/history while permitting valid later mutations. */
export function assertSnapshotContinuity(original, current, invalid) {
  const task = current.prepare("SELECT task_key FROM tasks WHERE task_id = ?");
  for (const row of original.prepare("SELECT task_id, task_key FROM tasks").iterate()) {
    if (task.get(row.task_id)?.task_key !== row.task_key) throw invalid("A retained task identity was lost or substituted");
  }
  const event = current.prepare("SELECT event_json FROM events WHERE task_id = ? AND seq = ?");
  for (const row of original.prepare("SELECT task_id, seq, event_json FROM events ORDER BY task_id, seq").iterate()) {
    if (event.get(row.task_id, row.seq)?.event_json !== row.event_json) throw invalid("Retained canonical event history was lost or changed");
  }
  const binding = current.prepare("SELECT path, size, sha256 FROM attachment_references WHERE task_id = ? AND reference_id = ?");
  for (const row of original.prepare("SELECT * FROM attachment_references ORDER BY task_id, reference_id").iterate()) {
    const retained = binding.get(row.task_id, row.reference_id);
    if (!retained || retained.path !== row.path || retained.size !== row.size || retained.sha256 !== row.sha256) throw invalid("A retained attachment binding was lost or changed");
  }
}
