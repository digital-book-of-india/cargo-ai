"use client";

import React, { useEffect, useState } from "react";
import { getAdminSites, updateSiteStatus, SiteItem, PaginationMeta } from "@/lib/api/admin";
import { Pagination } from "@/components/common/Pagination";
import { ModalBehavior } from "@/components/common/ModalBehavior";
import { useLatestRequest } from "@/components/common/useLatestRequest";

export default function SitesPage() {
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);
  const [modalAction, setModalAction] = useState<"ACTIVE" | "INACTIVE" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const begin = useLatestRequest();
  const fetchSites = (targetPage = page) => {
    const isCurrent = begin();
    setLoading(true);
    setErrorMessage(null);
    getAdminSites({
      page: targetPage,
      search: search.trim() || undefined,
      status: statusFilter !== "ALL" ? statusFilter : undefined,
    })
      .then((res: any) => {
        if (!isCurrent()) return;
        setSites(res.sites || []);
        if (res.meta) setMeta(res.meta);
      })
      .catch((err) => {
        if (isCurrent()) setErrorMessage(err.message || "Failed to load sites.");
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  };

  useEffect(() => {
    fetchSites(1);
    setPage(1);
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchSites(1);
    setPage(1);
  };

  const handleStatusSubmit = async () => {
    if (!selectedSite || !modalAction) return;
    setModalError(null);
    if (reason.trim().length < 5) {
      setModalError("Please provide a mandatory reason with at least 5 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await updateSiteStatus(selectedSite._id, modalAction, reason.trim());
      setToastMessage(`Site successfully updated to ${res.appliedStatus}`);
      setSelectedSite(null);
      setModalAction(null);
      setReason("");
      fetchSites(page);
    } catch (err: any) {
      setModalError(err.message || "Action failed to execute.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A]">Sites</h1>
        <p className="text-sm text-gray-500 mt-1">Review warehouses and sites across all companies.</p>
      </div>

      {toastMessage && (
        <div className="p-4 bg-green-50 border border-green-200 text-green-800 rounded-xl text-sm flex justify-between items-center">
          <span>{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="font-bold ml-4">✕</button>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-xl text-sm flex justify-between items-center">
          <span>{errorMessage}</span>
          <button onClick={() => fetchSites(page)} className="font-semibold underline ml-4">Retry</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl border border-[#DBEAFE] shadow-sm">
        <form onSubmit={handleSearchSubmit} className="w-full sm:w-80 flex gap-2">
          <input
            type="text"
            placeholder="Search by name, code or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-semibold text-gray-500">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="INACTIVE">INACTIVE</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </div>
      </div>

      <div className="bg-white border border-[#DBEAFE] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-[#EFF6FF] text-[#0F172A] font-semibold border-b border-[#DBEAFE]">
              <tr>
                <th className="py-3.5 px-4">Site</th>
                <th className="py-3.5 px-4">Company</th>
                <th className="py-3.5 px-4">Location</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">Loading sites...</td>
                </tr>
              ) : sites.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">No sites match the given filters.</td>
                </tr>
              ) : (
                sites.map((site) => (
                  <tr key={site._id} className="hover:bg-gray-50">
                    <td className="py-3.5 px-4 font-semibold text-gray-900">
                      {site.name}
                      <span className="ml-2 text-xs font-normal text-gray-400">{site.code}</span>
                      {site.demoFlag && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                          DEMO
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">{site.company ? site.company.name : "Unknown"}</td>
                    <td className="py-3.5 px-4 text-gray-500">
                      {site.address?.city ? `${site.address.city}, ${site.address.state || ""}` : "N/A"}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          site.status === "ACTIVE"
                            ? "bg-green-100 text-green-800"
                            : site.status === "INACTIVE"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {site.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {site.status === "INACTIVE" ? (
                        <button
                          onClick={() => {
                            setSelectedSite(site);
                            setModalAction("ACTIVE");
                          }}
                          className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 shadow-sm"
                        >
                          Reactivate
                        </button>
                      ) : site.status === "ACTIVE" ? (
                        <button
                          onClick={() => {
                            setSelectedSite(site);
                            setModalAction("INACTIVE");
                          }}
                          className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-md hover:bg-red-700 shadow-sm"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Archived</span>
                      )}
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
            fetchSites(p);
          }}
        />
      </div>

      {selectedSite && modalAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div role="dialog" aria-modal="true" aria-labelledby="site-modal-title" className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <ModalBehavior
              disabled={submitting}
              onClose={() => {
                setSelectedSite(null);
                setModalAction(null);
                setReason("");
              }}
            />
            <h3 id="site-modal-title" className="text-lg font-bold text-[#0F172A]">
              {modalAction === "INACTIVE" ? "Deactivate Site" : "Reactivate Site"}
            </h3>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{modalError}</div>
            )}

            <p className="text-sm text-gray-600">
              Change status of <strong>{selectedSite.name}</strong> to <strong>{modalAction}</strong>?
            </p>

            <div>
              <label htmlFor="site-reason" className="block text-xs font-bold text-gray-700 mb-1">
                Mandatory Audit Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                id="site-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (minimum 5 characters)..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedSite(null);
                  setModalAction(null);
                  setReason("");
                }}
                disabled={submitting}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleStatusSubmit}
                disabled={submitting}
                className={`px-4 py-2 text-white rounded-lg text-sm font-semibold shadow-sm ${
                  modalAction === "INACTIVE" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {submitting ? "Processing..." : "Confirm Action"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
