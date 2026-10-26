"use client";

import React, { useEffect, useState } from "react";
import { getAdminOwners, OwnerItem, PaginationMeta } from "@/lib/api/admin";
import { Pagination } from "@/components/common/Pagination";

export default function OwnersPage() {
  const [owners, setOwners] = useState<OwnerItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const fetchOwners = (p = page) => {
    setLoading(true);
    setError(null);
    getAdminOwners({
      page: p,
      search: search.trim() || undefined,
      status: statusFilter !== "ALL" ? statusFilter : undefined,
    })
      .then((res: any) => {
        if (res.error) {
          setError(res.error.message || "Failed to load owners.");
        } else {
          setOwners(res.owners || []);
          if (res.meta) setMeta(res.meta);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchOwners(1);
    setPage(1);
  }, [statusFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#0F172A]">Platform Shop Owners</h2>
        <p className="text-sm text-gray-500 mt-1">Search and manage registered shop owner profiles.</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl border border-[#DBEAFE] shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchOwners(1);
            setPage(1);
          }}
          className="w-full sm:w-80 flex gap-2"
        >
          <input
            type="text"
            placeholder="Search by owner name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <button type="submit" className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-blue-700">
            Search
          </button>
        </form>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
        >
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="PENDING_VERIFICATION">PENDING_VERIFICATION</option>
        </select>
      </div>

      <div className="bg-white border border-[#DBEAFE] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-[#EFF6FF] text-[#0F172A] font-semibold border-b border-[#DBEAFE]">
              <tr>
                <th className="py-3.5 px-4">Owner Name</th>
                <th className="py-3.5 px-4">Email</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Shops Owned</th>
                <th className="py-3.5 px-4">Registered Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">Loading owners...</td>
                </tr>
              ) : owners.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">No shop owners found.</td>
                </tr>
              ) : (
                owners.map((owner) => (
                  <tr key={owner._id} className="hover:bg-gray-50">
                    <td className="py-3.5 px-4 font-semibold text-gray-900">{owner.name}</td>
                    <td className="py-3.5 px-4 text-gray-600">{owner.email}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          owner.status === "ACTIVE"
                            ? "bg-green-100 text-green-800"
                            : owner.status === "SUSPENDED"
                            ? "bg-red-100 text-red-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {owner.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-[#2563EB]">{owner.shopCount}</td>
                    <td className="py-3.5 px-4 text-gray-400 font-mono text-xs">
                      {new Date(owner.createdAt).toLocaleDateString()}
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
            fetchOwners(p);
          }}
        />
      </div>
    </div>
  );
}