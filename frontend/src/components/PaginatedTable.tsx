import { useState, useMemo, useCallback, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardHeader } from "@/components/ui-kit";

const PAGE_SIZE = 10;

function PaginationBar({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: ReactNode[] = [];
  const range = 2;
  const start = Math.max(1, currentPage - range);
  const end = Math.min(totalPages, currentPage + range);

  if (start > 1) {
    pages.push(
      <button
        key="first"
        type="button"
        onClick={() => onPageChange(1)}
        className="rounded px-2 py-1 text-xs hover:bg-muted"
      >
        1
      </button>,
    );
    if (start > 2) {
      pages.push(
        <span key="start-ellipsis" className="px-1 text-xs text-muted-foreground">
          …
        </span>,
      );
    }
  }

  for (let i = start; i <= end; i++) {
    pages.push(
      <button
        key={i}
        type="button"
        onClick={() => onPageChange(i)}
        className={`rounded px-2 py-1 text-xs font-medium ${
          i === currentPage
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted text-muted-foreground"
        }`}
      >
        {i}
      </button>,
    );
  }

  if (end < totalPages) {
    if (end < totalPages - 1) {
      pages.push(
        <span key="end-ellipsis" className="px-1 text-xs text-muted-foreground">
          …
        </span>,
      );
    }
    pages.push(
      <button
        key="last"
        type="button"
        onClick={() => onPageChange(totalPages)}
        className="rounded px-2 py-1 text-xs hover:bg-muted"
      >
        {totalPages}
      </button>,
    );
  }

  return (
    <div className="flex items-center justify-between border-t px-5 py-3">
      <span className="text-xs text-muted-foreground">
        {currentPage * PAGE_SIZE - PAGE_SIZE + 1}–
        {Math.min(currentPage * PAGE_SIZE, totalPages * PAGE_SIZE)} sur {totalPages * PAGE_SIZE}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        {pages}
        <button
          type="button"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export type Column<T> = {
  header: string;
  accessor?: keyof T;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
};

export function PaginatedTable<T extends Record<string, unknown>>({
  title,
  rows,
  columns,
  empty = "Aucune donnée.",
  pageSize = PAGE_SIZE,
  cardless = false,
  minWidth = "760px",
}: {
  title?: string;
  rows: T[];
  columns: Column<T>[];
  empty?: string;
  pageSize?: number;
  cardless?: boolean;
  minWidth?: string;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const paginatedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );
  const handlePageChange = useCallback((nextPage: number) => setPage(nextPage), []);

  if (page > totalPages && totalPages > 0) {
    setPage(totalPages);
  }

  const table = (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  className={`px-5 py-3 ${column.align === "right" ? "text-right" : ""} ${
                    column.align === "center" ? "text-center" : ""
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {paginatedRows.map((row, index) => (
              <tr
                key={String(row.id ?? row.reference ?? `${title}-${index}`)}
                className="hover:bg-muted/30"
              >
                {columns.map((column) => {
                  const value = column.accessor ? row[column.accessor] : undefined;
                  return (
                    <td
                      key={column.header}
                      className={`px-5 py-3 ${column.align === "right" ? "text-right" : ""} ${
                        column.align === "center" ? "text-center" : ""
                      }`}
                    >
                      {column.render
                        ? column.render(row)
                        : column.accessor
                          ? value === null || value === undefined || value === ""
                            ? "-"
                            : String(value)
                          : "-"}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td
                  className="px-5 py-6 text-center text-muted-foreground"
                  colSpan={columns.length}
                >
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar currentPage={page} totalPages={totalPages} onPageChange={handlePageChange} />
    </>
  );

  if (cardless) return table;

  return (
    <Card>
      {title && <CardHeader title={title} />}
      {table}
    </Card>
  );
}
