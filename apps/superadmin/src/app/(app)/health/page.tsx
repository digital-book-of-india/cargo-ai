"use client";

import React, { useEffect, useState } from "react";
import { getAdminHealth, CameraHealthItem, PaginationMeta } from "@/lib/api/admin";
import { Pagination } from "@/components/common/Pagination";
import { useLatestRequest } from "@/components/common/useLatestRequest";
import { workerView } from "@/components/common/workerStatus";

export default function HealthPage() {
  const [cameras, setCameras] = useState<CameraHealthItem[]>([]);
  const [aiWorker, setAiWorker] = useState<{ status: string; lastHeartbeatAt: string | null; isStale: boolean }>({
    status: "UNKNOWN",
    lastHeartbeatAt: null,
    isStale: true,
  });
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const begin = useLatestRequest();
  const fetchHealth = (p = page) => {
    const isCurrent = begin();
    setLoading(true);
    setError(null);
    getAdminHealth({ page: p, status: statusFilter !== "ALL" ? statusFilter : undefined })
      .then((res: any) => {
        if (!isCurrent()) return;
        setCameras(res.cameras || []);
        if (res.aiWorker) setAiWorker(res.aiWorker);
        if (res.meta) setMeta(res.meta);
      })
      .catch((err) => {
        if (isCurrent()) setError(err.message);
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  };

  useEffect(() => {
    fetchHealth(1);
    setPage(1);
  }, [statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Camera & Service Health</h1>
        <p className="text-sm text-gray-500 mt-1">Truthful camera stream status and AI worker service heartbeats.</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => fetchHealth(page)} className="font-semibold underline ml-4">Retry</button>
        </div>
      )}

      <div className="p-5 bg-white border border-[#DBEAFE] rounded-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <span className={`w-4 h-4 rounded-full ${workerView(aiWorker).dot}`} aria-hidden="true" />
          <div>
            <h3 className="font-bold text-gray-900">AI Background Detection Worker</h3>
            <p className="text-xs text-gray-500">
              Last Heartbeat:{" "}
              {aiWorker.lastHeartbeatAt ? `${new Date(aiWorker.lastHeartbeatAt).toLocaleString()} (${workerView(aiWorker).age})` : "Never"}
            </p>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold ${workerView(aiWorker).badge}`}
        >
          {workerView(aiWorker).label}
        </span>
      </div>

      <div className="flex justify-end">
        <select
          aria-label="Filter cameras by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        >
          <option value="ALL">All Statuses</option>
          <option value="ONLINE">ONLINE</option>
          <option value="DEGRADED">DEGRADED</option>
          <option value="OFFLINE">OFFLINE</option>
          <option value="ERROR">ERROR</option>
          <option value="PENDING_TEST">PENDING_TEST</option>
        </select>
      </div>

      <div className="bg-white border border-[#DBEAFE] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-[#EFF6FF] text-[#0F172A] font-semibold border-b border-[#DBEAFE]">
              <tr>
                <th className="py-3.5 px-4">Camera Name</th>
                <th className="py-3.5 px-4">Site</th>
                <th className="py-3.5 px-4">Protocol</th>
                <th className="py-3.5 px-4">Effective Status</th>
                <th className="py-3.5 px-4">Last Frame Received</th>
                <th className="py-3.5 px-4">Last Health Ping</th>
                <th className="py-3.5 px-4">Error Code</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400">Loading camera health records...</td>
                </tr>
              ) : cameras.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400">No cameras found.</td>
                </tr>
              ) : (
                cameras.map((cam) => (
                  <tr key={cam.cameraId} className="hover:bg-gray-50">
                    <td className="py-3.5 px-4 font-semibold text-gray-900">
                      {cam.name}
                      {(cam.demoFlag || cam.siteName.includes("[DEMO]") || cam.name.includes("[DEMO]")) && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                          DEMO
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-gray-700">{cam.siteName}</td>
                    <td className="py-3.5 px-4 font-mono text-xs font-semibold text-gray-500">{cam.protocol}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          cam.effectiveStatus === "ONLINE"
                            ? "bg-green-100 text-green-800"
                            : cam.effectiveStatus === "DEGRADED"
                            ? "bg-amber-100 text-amber-800"
                            : cam.effectiveStatus === "ERROR" || cam.effectiveStatus === "OFFLINE"
                            ? "bg-red-100 text-red-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {cam.effectiveStatus}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-gray-500">
                      {cam.lastFrameAt ? new Date(cam.lastFrameAt).toLocaleString() : "Never"}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-gray-500">
                      {cam.lastHealthAt ? new Date(cam.lastHealthAt).toLocaleString() : "Never"}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-mono text-gray-400">
                      {cam.lastErrorCode || "—"}
                    </td>
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
            fetchHealth(p);
          }}
        />
      </div>
    </div>
  );
}