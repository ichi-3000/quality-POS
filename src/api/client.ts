import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 204) {
    return {} as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function downloadCsvReport(url: string, filename: string): Promise<void> {
  const headers = new Headers();
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err?.error || 'Failed to download CSV');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function formatUGX(amount: number | string | null | undefined): string {
  const n = Math.round(Number(amount || 0));
  return `UGX ${n.toLocaleString('en-UG')}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-UG', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 10);
}

export function exportTableToPdf(
  title: string,
  subtitle: string,
  headers: string[],
  rows: Array<Array<string | number>>,
  filename: string
) {
  const doc = new jsPDF({ orientation: headers.length > 6 ? 'landscape' : 'portrait' });
  doc.setFillColor(26, 58, 92); // #1A3A5C Primary Navy
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('QUALITY SUPERMARKETS UGANDA LIMITED — QS-IMS', 14, 11);
  doc.setFontSize(10);
  doc.text(title, 14, 19);

  doc.setTextColor(71, 85, 105);
  doc.setFontSize(9);
  doc.text(subtitle, 14, 34);
  doc.text(`Generated: ${new Date().toLocaleString('en-UG')}`, 14, 39);

  autoTable(doc, {
    startY: 44,
    head: [headers],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [26, 58, 92], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 247, 250] },
  });

  doc.save(filename);
}
