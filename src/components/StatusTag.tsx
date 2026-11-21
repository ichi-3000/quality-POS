import React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

interface StatusTagProps {
  status: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  in_stock: { label: 'In Stock', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  low_stock: { label: 'Low Stock', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  out_of_stock: { label: 'Out of Stock', cls: 'bg-red-50 text-red-800 border-red-200' },
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  inactive: { label: 'Inactive', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  sent: { label: 'Sent', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  partially_received: { label: 'Partially Received', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  received: { label: 'Received', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
  pending_approval: { label: 'Pending Approval', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'Approved', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  dispatched: { label: 'Dispatched', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  in_transit: { label: 'In Transit', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-800 border-red-200' },
  sale: { label: 'Sale', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  transfer: { label: 'Transfer', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  transfer_out: { label: 'Transfer Out', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  transfer_in: { label: 'Transfer In', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  grn: { label: 'GRN Intake', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  opening_stock: { label: 'Opening Stock', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  damage: { label: 'Damage', cls: 'bg-red-50 text-red-800 border-red-200' },
  expiry: { label: 'Expiry', cls: 'bg-red-50 text-red-800 border-red-200' },
  adjustment: { label: 'Adjustment', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};

export function StatusTag({ status }: StatusTagProps) {
  const meta = STATUS_MAP[status] || {
    label: status.replace(/_/g, ' '),
    cls: 'bg-slate-100 text-slate-700 border-slate-200',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border whitespace-nowrap ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

export function AlertBanner({
  type,
  message,
  onClose,
}: {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  onClose?: () => void;
}) {
  const styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    error: 'bg-red-50 border-red-200 text-red-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-blue-50 border-blue-200 text-blue-900',
  }[type];

  const Icon = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
  }[type];

  return (
    <div className={`flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 px-3.5 sm:px-4 py-3 rounded border text-sm ${styles}`}>
      <div className="flex items-start sm:items-center gap-2.5 min-w-0">
        <Icon className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />
        <span className="break-words">{message}</span>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium underline hover:opacity-80 shrink-0 min-h-[36px] px-1"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-md p-6 sm:p-10 text-center">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 px-4 py-2.5 min-h-[44px] text-sm font-medium text-white bg-[#E67E22] hover:bg-[#cf6d17] rounded transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4 overflow-y-auto">
      <div
        className={`w-full ${maxWidth} bg-white border border-slate-200 rounded-t-xl sm:rounded-md shadow-lg sm:my-8 overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[90vh]`}
      >
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-3.5 sm:py-4 bg-[#1A3A5C] text-white shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold leading-snug">{title}</h2>
            {subtitle && <p className="text-xs text-slate-200 mt-0.5 break-words">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-200 hover:text-white text-xs sm:text-sm font-medium px-3 min-h-[44px] sm:min-h-[36px] rounded hover:bg-white/10 shrink-0 -mr-1"
          >
            Close
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
