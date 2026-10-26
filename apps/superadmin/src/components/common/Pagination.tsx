"use client";

import React from "react";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (newPage: number) => void;
  loading?: boolean;
}

export function Pagination({ page, totalPages, total, onPageChange, loading }: PaginationProps) {
  if (total === 0 || totalPages <= 1) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-3 bg-white border-t border-[#DBEAFE] gap-3">
      <div className="text-xs text-gray-500">
        Total <span className="font-semibold text-gray-800">{total}</span> records • Page{" "}
        <span className="font-semibold text-gray-800">{page}</span> of{" "}
        <span className="font-semibold text-gray-800">{totalPages}</span>
      </div>

      <div className="flex items-center space-x-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || loading}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Previous
        </button>

        <span className="text-xs px-2 font-mono font-medium text-gray-600">
          {page} / {totalPages}
        </span>

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || loading}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}