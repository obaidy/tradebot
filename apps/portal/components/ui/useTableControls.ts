import { useEffect, useMemo, useState } from 'react';
import type { Column, SortState } from './DataTable';
import { sortRows } from './DataTable';

export interface TableView {
  name: string;
  sort: SortState;
  query: string;
}

export interface TableControlsOptions<T> {
  columns: Column<T>[];
  initialSort?: SortState;
  filterFn?: (row: T, query: string) => boolean;
  initialQuery?: string;
  storageKey?: string;
}

export function useTableControls<T>(rows: T[], options: TableControlsOptions<T>) {
  const { columns, filterFn, initialSort = [], initialQuery = '', storageKey } = options;
  const [sortState, setSortState] = useState<SortState>(initialSort);
  const [query, setQuery] = useState(initialQuery);
  const [views, setViews] = useState<TableView[]>([]);
  const [activeView, setActiveView] = useState('');

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setViews(parsed);
      }
    } catch {
      // ignore corrupted storage
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(views));
  }, [storageKey, views]);

  const filteredRows = useMemo(() => {
    if (!filterFn) return rows;
    if (!query) return rows;
    return rows.filter((row) => filterFn(row, query.toLowerCase()));
  }, [rows, filterFn, query]);

  const sortedRows = useMemo(() => sortRows(filteredRows, sortState, columns), [filteredRows, sortState, columns]);

  const setSort = (state: SortState) => setSortState(state);
  const setFilterQuery = (value: string) => setQuery(value);

  const saveView = (name: string) => {
    if (!name.trim()) return;
    setViews((prev) => {
      const trimmed = name.trim();
      const filtered = prev.filter((view) => view.name !== trimmed);
      return [...filtered, { name: trimmed, sort: sortState.map((rule) => ({ ...rule })), query }];
    });
    setActiveView(name.trim());
  };

  const applyView = (name: string) => {
    const view = views.find((v) => v.name === name);
    if (!view) return;
    setSortState(view.sort.map((rule) => ({ ...rule })));
    setQuery(view.query);
    setActiveView(name);
  };

  const deleteView = (name: string) => {
    setViews((prev) => prev.filter((view) => view.name !== name));
    if (activeView === name) {
      setActiveView('');
    }
  };

  return {
    rows: sortedRows,
    sortState,
    setSort,
    query,
    setQuery: setFilterQuery,
    views,
    saveView,
    applyView,
    deleteView,
    activeView,
    setActiveView,
  };
}
