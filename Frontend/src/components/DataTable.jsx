import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import EmptyState from "./EmptyState.jsx";
import LoadingSkeleton from "./LoadingSkeleton.jsx";

export default function DataTable({
  columns = [],
  data = [],
  loading = false,
  searchPlaceholder = "Search records...",
  searchFields = [],
  filterComponent,
  keyField = "id",
  initialSortField = "",
  initialSortAsc = true,
  defaultPageSize = 10,
  emptyTitle = "No records to display",
  emptyDescription = "No data is currently available in this queue.",
  className = "",
}) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState(initialSortField);
  const [sortAsc, setSortAsc] = useState(initialSortAsc);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  // Search filtering
  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const query = search.toLowerCase().trim();
    return data.filter((item) => {
      if (searchFields.length > 0) {
        return searchFields.some((field) => {
          const val = item[field];
          return val != null && String(val).toLowerCase().includes(query);
        });
      }
      return Object.values(item).some((val) => {
        return val != null && typeof val !== "object" && String(val).toLowerCase().includes(query);
      });
    });
  }, [data, search, searchFields]);

  // Sorting
  const sortedData = useMemo(() => {
    if (!sortField) return filteredData;
    return [...filteredData].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      if (aVal == null) aVal = "";
      if (bVal == null) bVal = "";

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortAsc ? aVal - bVal : bVal - aVal;
      }
      const strA = String(aVal).toLowerCase();
      const strB = String(bVal).toLowerCase();
      return sortAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }, [filteredData, sortField, sortAsc]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, currentPage, pageSize]);

  function handleSort(field) {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  return (
    <div className={`data-table-container ${className}`}>
      <div className="data-table-toolbar">
        <div className="search-input-wrapper">
          <Search size={16} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            className="search-input"
            aria-label={searchPlaceholder}
          />
        </div>

        {filterComponent && <div className="data-table-filters">{filterComponent}</div>}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {loading
          ? "Loading records"
          : `${sortedData.length} ${sortedData.length === 1 ? "record" : "records"} found`}
      </p>

      {loading ? (
        <LoadingSkeleton type="table" lines={5} />
      ) : sortedData.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="table-responsive-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((col) => {
                    const isSorted = sortField === col.accessor;
                    const ariaSort = col.sortable
                      ? isSorted
                        ? sortAsc
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined;
                    const sortIcon = col.sortable ? (
                      <span className="th-sort-icon">
                        {isSorted ? (
                          sortAsc ? (
                            <ArrowUp size={13} aria-hidden="true" />
                          ) : (
                            <ArrowDown size={13} aria-hidden="true" />
                          )
                        ) : (
                          <ArrowUpDown size={13} className="text-muted opacity-40" aria-hidden="true" />
                        )}
                      </span>
                    ) : null;
                    return (
                      <th
                        key={col.header}
                        scope="col"
                        aria-sort={ariaSort}
                        className={`${col.className || ""} ${col.sortable ? "is-sortable" : ""}`}
                        style={col.width ? { width: col.width } : undefined}
                      >
                        {col.sortable ? (
                          <button
                            type="button"
                            className="th-sort-button"
                            onClick={() => handleSort(col.accessor)}
                          >
                            <span>{col.header}</span>
                            {sortIcon}
                          </button>
                        ) : (
                          <div className="th-content">
                            <span>{col.header}</span>
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((row, index) => (
                  <tr key={row[keyField] || index} className="data-table-row">
                    {columns.map((col) => (
                      <td key={col.header} className={col.cellClassName || col.className || ""}>
                        {col.cell ? col.cell(row) : row[col.accessor] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="data-table-pagination">
              <span className="pagination-summary">
                Showing {Math.min((currentPage - 1) * pageSize + 1, sortedData.length)} to{" "}
                {Math.min(currentPage * pageSize, sortedData.length)} of {sortedData.length} records
              </span>

              <div className="pagination-controls">
                <button
                  type="button"
                  className="pagination-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                  <span>Previous</span>
                </button>

                <span className="pagination-pages">
                  Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                </span>

                <button
                  type="button"
                  className="pagination-btn"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  aria-label="Next page"
                >
                  <span>Next</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}