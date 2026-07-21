// Small helpers for exporting canvas data as downloadable files.

// Trigger a browser download for the given text content.
export function downloadFile(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Escape a single CSV cell (RFC 4180: wrap in quotes, double any inner quote).
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// rows: array of arrays. Prepends a UTF-8 BOM so Excel opens it correctly.
export function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// Safe, readable filename fragment (e.g. an ELB or DB instance name).
export function slug(s) {
  return String(s || 'export')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// yyyy-mm-dd for filenames.
export function stamp() {
  return new Date().toISOString().slice(0, 10);
}
