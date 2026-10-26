"use client";

import React, { useEffect, useState } from "react";
import { getAdminCompanies, updateCompanyStatus, CompanyItem, PaginationMeta } from "@/lib/api/admin";
import { Pagination } from "@/components/common/Pagination";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CompanyItem | null>(null);
  const [modalAction, setModalAction] = useState<"ACTIVE" | "SUSPENDED" | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchCompanies = (targetPage = page) => {
    setLoading(true);
    setErrorMessage(null);
    getAdminCompanies({
      page: targetPage,
      search: search.trim() || undefined,
      status: statusFilter !== "ALL" ? statusFilter : undefined,
    })
      .then((res: any) => {
        setCompanies(res.companies || []);
        if (res.meta) setMeta(res.meta);
      })
      .catch((err) => setErrorMessage(err.message || "Failed to load companies."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCompanies(1);
    setPage(1);
  }, [statusFilter]);

  const handleStatusSubmit = async () => {
    if (!selected || !modalAction) return;
    setModalError(null);
    if (reason.trim().length < 5) {
      setModalError("Please provide a mandatory reason with at least 5 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await updateCompanyStatus(selected.id, modalAction, reason.trim());
      setToastMessage(`Company successfully updated to ${res.appliedStatus}`);
      setSelected(null);
      setModalAction(null);
      setReason("");
      fetchCompanies(page);
    } catch (err: any) {
      setModalError(err.message || "Action failed to execute.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#0F172A]">Companies</h2>
        <p className="text-sm text-gray-500 mt-1">
          Customer companies on the platform. Suspending a company blocks all of its users.
        </p>
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
          <button onClick={() => fetchCompanies(page)} className="font-semibold underline ml-4">Retry</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl border border-[#DBEAFE] shadow-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchCompanies(1);
            setPage(1);
          }}
          className="w-full sm:w-80 flex gap-2"
        >
          <input
            type="text"
            placeholder="Search by company name..."
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
            <option value="SUSPENDED">SUSPENDED</option>
          </select>
        </div>
      </div>

      <div className="bg-white border border-[#DBEAFE] rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-[#EFF6FF] text-[#0F172A] font-semibold border-b border-[#DBEAFE]">
              <tr>
                <th className="py-3.5 px-4">Company</th>
                <th className="py-3.5 px-4">Owner</th>
                <th className="py-3.5 px-4">Sites</th>
                <th className="py-3.5 px-4">Members</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">Loading companies...</td>
                </tr>
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-400">No companies found.</td>
                </tr>
              ) : (
                companies.map((company) => (
                  <tr key={company.id} className="hover:bg-gray-50">
                    <td className="py-3.5 px-4 font-semibold text-gray-900">
                      {company.name}
                      {company.demoFlag && (
                        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                          DEMO
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4">
                      {company.owner ? (
                        <div>
                          <div className="font-medium text-gray-900">{company.owner.name}</div>
                          <div className="text-xs text-gray-400">{company.owner.email}</div>
                        </div>
                      ) : (
                        "No active owner"
                      )}
                    </td>
                    <td className="py-3.5 px-4">{company.siteCount}</td>
                    <td className="py-3.5 px-4">{company.memberCount}</td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          company.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                        }`}
                      >
                        {company.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {company.status === "SUSPENDED" ? (
                        <button
                          onClick={() => {
                            setSelected(company);
                            setModalAction("ACTIVE");
                          }}
                          className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 shadow-sm"
                        >
                          Reactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setSelected(company);
                            setModalAction("SUSPENDED");
                          }}
                          className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-md hover:bg-red-700 shadow-sm"
                        >
                          Suspend
                        </button>
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
            fetchCompanies(p);
          }}
        />
      </div>

      {selected && modalAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-[#0F172A]">
              {modalAction === "SUSPENDED" ? "Suspend Company" : "Reactivate Company"}
            </h3>

            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{modalError}</div>
            )}

            <p className="text-sm text-gray-600">
              Change status of <strong>{selected.name}</strong> to <strong>{modalAction}</strong>?
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Mandatory Audit Reason <span className="text-red-500">*</span>
              </label>
              <textarea
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
                  setSelected(null);
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
                  modalAction === "SUSPENDED" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
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
