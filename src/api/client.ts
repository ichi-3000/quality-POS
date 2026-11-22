import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { dispatchLocalRequest } from '../localDb/localServer';

const TOKEN_STORAGE_KEY = 'qsims_auth_token';

function readStoredToken(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage access errors
  }
  return null;
}

let authToken: string | null = readStoredToken();

export function setAuthToken(token: string | null) {
  authToken = token;
  try {
    if (typeof localStorage !== 'undefined') {
      if (token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
  } catch {
    // ignore storage access errors
  }
}

export function getAuthToken(): string | null {
  if (!authToken) {
    authToken = readStoredToken();
  }
  return authToken;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function normalizeRequestHeaders(rawHeaders?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawHeaders) return result;
  if (rawHeaders instanceof Headers) {
    rawHeaders.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
  } else if (Array.isArray(rawHeaders)) {
    for (const [key, value] of rawHeaders) {
      result[key.toLowerCase()] = value;
    }
  } else {
    for (const [key, value] of Object.entries(rawHeaders)) {
      if (value !== undefined) {
        result[key.toLowerCase()] = String(value);
      }
    }
  }
  return result;
}

export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = normalizeRequestHeaders(options.headers);
  const token = getAuthToken();
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }
  if (options.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }

  const res = await dispatchLocalRequest(
    options.method || 'GET',
    url,
    headers,
    options.body
  );

  if (res.status === 204) {
    return {} as T;
  }

  const data = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<string, any>;
  if (res.status >= 400) {
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return res.body as T;
}

export async function downloadCsvReport(url: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
  }

  const res = await dispatchLocalRequest('GET', url, headers);
  if (res.status >= 400) {
    const err = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<string, any>;
    throw new ApiError(res.status, err?.error || 'Failed to download CSV');
  }

  const csvText = typeof res.body === 'string' ? res.body : String(res.body ?? '');
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
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
