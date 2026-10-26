"use client";

import React, { useEffect, useState } from "react";
import { getAdminAuditLogs, AuditLogItem, PaginationMeta } from "@/lib/api/admin";
import { Pagination } from "@/components/common/Pagination";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  const [actionFilter, setActionFilter] = useState("");
  const [targetIdFilter, setTargetIdFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = (p = page) => {
    setLoading(true);
    setError(null);
    getAdminAuditLogs({
      page: p,
      action: actionFilter.trim() || undefined,
      targetId: targetIdFilter.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    })
      .then((res: any) => {
        if (res.error) {
          setError(res.error.message || "Failed to load audit trail.");
        } else {
          setLogs(res.auditLogs || []);
          if (res.meta) setMeta(res.meta);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs(1);
    setPage(1);
  }, []);

  const handleFilterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs(1);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#0F172A]">Privileged Audit Trail</h2>
        <p className="text-sm text-gray-500 mt-1">Immutable record of all privileged administrative events.</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm">
          {error}
        </div>
      )}

      {/* Filter Controls */}
      <form onSubmit={handleFilterSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 bg-white p-4 rounded-xl border border-[#DBEAFE] shadow-sm">
        <input
          type="text"
          placeholder="Action (e.g. SHOP_SUSPENDED)..."
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#2563EB]"
        />

        <input
          type="text"
          placeholder="Target ID (e.g. shop_123)..."
          value={targetIdFilter}
          onChange={(e) => setTargetIdFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#2563EB]"
        />

        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#2563EB]"
        />

        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-[#2563EB]"
        />

        <button type="submit" className="px-4 py-2 bg-[#2563EB] text-white text-xs font-semibold rounded-lg hover:bg-blue-700">
          Apply Filters
        </button>
      </form>

      {/* Table */}
      <div className="bg-white border border-[#DBEAFE] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-[#EFF6FF] text-[#0F172A] font-semibold border-b border-[#DBEAFE]">
              <tr>
                <th className="py-3.5 px-4">Timestamp (UTC)</th>
                <th className="py-3.5 px-4">Actor</th>
                <th className="py-3.5 px-4">Action</th>
                <th className="py-3.5 px-4">Target</th>
                <th className="py-3.5 px-4">Reason</th>
                <th className="py-3.5 px-4">Request ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">Loading audit records...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">No audit logs found.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log._id} className="hover:bg-gray-50">
                    <td className="py-3.5 px-4 font-mono text-xs text-gray-500 whitespace-nowrap">
                      {log.createdAt ? new Date(log.createdAt).toUTCString() : "N/A"}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-gray-900">{log.actor?.name || "Unknown"}</div>
                      <div className="text-xs text-gray-400">{log.actor?.email || "N/A"}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-mono text-xs font-bold text-[#2563EB]">{log.action}</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-gray-500">
                      {log.targetType}:{log.targetId}
                    </td>
                    <td className="py-3.5 px-4 text-gray-800 text-xs max-w-sm">
                      {log.reason}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-gray-400">{log.requestId}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          loading={loading}
          onPageChange={(p) => {
            setPage(p);
            fetchLogs(p);
          }}
        />
      </div>
    </div>
  );
}