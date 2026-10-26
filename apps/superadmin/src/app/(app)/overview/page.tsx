"use client";

import React, { useEffect, useState } from "react";
import { getAdminOverview, OverviewData } from "@/lib/api/admin";

export default function OverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminOverview()
      .then((res) => setData(res))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold text-[#0F172A]">Platform Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-gray-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700">
        <p className="font-semibold">Failed to load platform overview</p>
        <p className="text-sm mt-1">{error || "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-[#0F172A]">Platform Overview</h2>
        <p className="text-sm text-gray-500 mt-1">Real-time system operational metrics and surveillance monitoring.</p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="p-5 bg-white border border-[#DBEAFE] rounded-xl shadow-sm">
          <span className="text-xs font-semibold uppercase text-gray-500">Total Registered Shops</span>
          <div className="text-3xl font-extrabold text-[#0F172A] mt-2">{data.kpis.totalShops}</div>
          <p className="text-xs text-gray-400 mt-1">
            Active: <strong className="text-green-600">{data.kpis.activeShops}</strong> | Suspended:{" "}
            <strong className="text-red-500">{data.kpis.suspendedShops}</strong>
          </p>
        </div>

        <div className="p-5 bg-white border border-[#DBEAFE] rounded-xl shadow-sm">
          <span className="text-xs font-semibold uppercase text-gray-500">Camera Online Rate</span>
          <div className="text-3xl font-extrabold text-[#16A34A] mt-2">
            {data.kpis.cameraOnlineRate !== null ? `${data.kpis.cameraOnlineRate}%` : "N/A"}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {data.kpis.onlineCameras} of {data.kpis.totalCameras} cameras streaming fresh frames
          </p>
        </div>

        <div className="p-5 bg-white border border-[#DBEAFE] rounded-xl shadow-sm">
          <span className="text-xs font-semibold uppercase text-gray-500">Unreviewed Alerts</span>
          <div className="text-3xl font-extrabold text-[#DC2626] mt-2">{data.kpis.unreviewedAlerts}</div>
          <p className="text-xs text-gray-400 mt-1">NEW events requiring shop review</p>
        </div>
      </div>

      {/* AI Worker Status Banner */}
      <div className="p-4 bg-white border border-[#DBEAFE] rounded-xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <span
            className={`w-3.5 h-3.5 rounded-full ${
              data.aiWorker.status === "ONLINE" ? "bg-green-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <div>
            <h4 className="text-sm font-semibold text-[#0F172A]">AI Monitoring Service Worker</h4>
            <p className="text-xs text-gray-500">
              Last Heartbeat:{" "}
              {data.aiWorker.lastHeartbeatAt ? new Date(data.aiWorker.lastHeartbeatAt).toLocaleTimeString() : "Never"}
            </p>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold ${
            data.aiWorker.status === "ONLINE"
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {data.aiWorker.status}
        </span>
      </div>

      {/* Two Columns: Recent Security Alerts & Audit Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <div className="bg-white border border-[#DBEAFE] rounded-xl shadow-sm p-5">
          <h3 className="text-base font-bold text-[#0F172A] mb-4">Recent Security Alerts</h3>
          <div className="divide-y divide-gray-100">
            {data.recentEvents.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">No recent security events found.</p>
            ) : (
              data.recentEvents.map((evt) => (
                <div key={evt.eventId} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-gray-800">{evt.shopName}</span>
                      {evt.demoFlag && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                          DEMO
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {evt.eventType === "POSSIBLE_SHUTTER_INTERACTION"
                        ? "Possible shutter interaction near shutter"
                        : evt.eventType}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400 font-mono">
                    {evt.startedAt ? new Date(evt.startedAt).toLocaleTimeString() : "N/A"}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Audit Activity */}
        <div className="bg-white border border-[#DBEAFE] rounded-xl shadow-sm p-5">
          <h3 className="text-base font-bold text-[#0F172A] mb-4">Privileged Audit Activity</h3>
          <div className="divide-y divide-gray-100">
            {data.recentAuditActivity.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">No audit actions recorded yet.</p>
            ) : (
              data.recentAuditActivity.map((log, idx) => (
                <div key={idx} className="py-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#2563EB]">{log.action}</span>
                    <span className="text-gray-400 font-mono">
                      {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : "N/A"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-700 mt-1">
                    <span className="font-medium text-gray-500">{log.actor.name}:</span> {log.reason}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}