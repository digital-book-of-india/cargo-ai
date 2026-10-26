"use client";

import React from "react";

export default function SettingsPage() {
  const isMock = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#0F172A]">Platform Configuration</h2>
        <p className="text-sm text-gray-500 mt-1">
          System defaults and platform parameters configured via infrastructure environment.
        </p>
      </div>

      <div className="inline-block px-3 py-1 bg-[#EFF6FF] border border-[#DBEAFE] rounded-md text-xs font-semibold text-[#2563EB]">
        System Defaults — Configured via Environment (Read-Only)
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border border-[#DBEAFE] shadow-sm space-y-4">
          <h3 className="font-bold text-gray-900 border-b pb-2">Surveillance & Timing Policy</h3>
          <div className="flex justify-between text-sm py-1 border-b border-gray-100">
            <span className="text-gray-500">Default Grace Period:</span>
            <span className="font-semibold text-gray-900">5 Minutes (Range: 0-60m)</span>
          </div>
          <div className="flex justify-between text-sm py-1 border-b border-gray-100">
            <span className="text-gray-500">Shop Default Timezone:</span>
            <span className="font-semibold text-gray-900">Asia/Kolkata</span>
          </div>
          <div className="flex justify-between text-sm py-1">
            <span className="text-gray-500">Camera Stale Interval:</span>
            <span className="font-semibold text-gray-900">120 Seconds</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-[#DBEAFE] shadow-sm space-y-4">
          <h3 className="font-bold text-gray-900 border-b pb-2">Compliance & Data Retention</h3>
          <div className="flex justify-between text-sm py-1 border-b border-gray-100">
            <span className="text-gray-500">Audit Trail Policy:</span>
            <span className="font-semibold text-gray-900">Not configured — Stored indefinitely in DB</span>
          </div>
          <div className="flex justify-between text-sm py-1 border-b border-gray-100">
            <span className="text-gray-500">Face Recognition / Biometrics:</span>
            <span className="font-bold text-red-600">Strictly Disabled (Scope Guard)</span>
          </div>
          <div className="flex justify-between text-sm py-1">
            <span className="text-gray-500">Runtime Client Mode:</span>
            <span className={`font-bold ${isMock ? "text-amber-600" : "text-green-600"}`}>
              {isMock ? "Mock / Simulated" : "Production Database Live"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}