/**
 * CSV export helpers for query results (client-side, no server round trip).
 */
import { flattenValue } from './turnFormat';

function cellValue(val) {
  if (val === null || val === undefined) return '';
  return String(flattenValue(val));
}

/** Convert an array of result rows to a CSV string (header row from the first row's keys). */
function arrayToCsv(results) {
  if (!results || results.length === 0) return '';
  const headers = Object.keys(results[0]);
  const escape = (val) => {
    const s = cellValue(val);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = results.map((row) => headers.map((h) => escape(row[h])).join(','));
  return [headers.join(','), ...rows].join('\n');
}

/** Trigger a browser download of `results` as a CSV file. */
export function downloadCsv(results, filename = `atlasmind-export-${Date.now()}.csv`) {
  if (!results?.length) return;
  const blob = new Blob([arrayToCsv(results)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
