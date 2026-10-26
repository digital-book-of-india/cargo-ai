export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <p className="p-6 text-sm text-slate-500">{label}</p>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-pale p-8 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
    </div>
  );
}

export function ErrorState({ message, requestId }: { message: string; requestId?: string }) {
  return (
    <div role="alert" className="rounded-lg border border-danger bg-white p-4 text-sm text-danger">
      <p>{message}</p>
      {requestId && <p className="mt-1 text-xs text-slate-500">Reference: {requestId}</p>}
    </div>
  );
}
