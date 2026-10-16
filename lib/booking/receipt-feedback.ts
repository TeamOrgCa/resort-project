export function receiptValidationIssues(notes: string): string[] {
  return [...new Set(notes.split(/;\s*|(?<=[.!?])\s+(?=[A-Z])/u).map(note => note.trim()).filter(Boolean))]
    .map(note => note.charAt(0).toUpperCase() + note.slice(1));
}
