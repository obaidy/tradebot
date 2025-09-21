import { CSSProperties, ReactNode, MouseEvent } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  width?: string | number;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  sortAccessor?: (row: T) => string | number | Date | null;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  emptyState?: ReactNode;
  tableMinWidth?: number;
  style?: CSSProperties;
  sortState?: SortState;
  onSortChange?: (state: SortState) => void;
}

export type SortDirection = 'asc' | 'desc';

export interface SortRule {
  columnKey: string;
  direction: SortDirection;
}

export type SortState = SortRule[];

export function DataTable<T>({ columns, data, emptyState, tableMinWidth = 640, style, sortState, onSortChange }: DataTableProps<T>) {
  const stateArray = sortState ?? [];

  const handleSortToggle = (event: MouseEvent<HTMLTableCellElement>, column: Column<T>) => {
    if (!column.sortable || !onSortChange) return;
    const append = event.shiftKey || event.metaKey || event.ctrlKey;
    const existingIndex = stateArray.findIndex((rule) => rule.columnKey === column.key);

    if (!append) {
      if (existingIndex === -1) {
        onSortChange([{ columnKey: column.key, direction: 'asc' }]);
        return;
      }
      const currentRule = stateArray[existingIndex];
      const nextDirection = currentRule.direction === 'asc' ? 'desc' : currentRule.direction === 'desc' ? null : 'asc';
      if (nextDirection) {
        onSortChange([{ columnKey: column.key, direction: nextDirection }]);
      } else {
        onSortChange([]);
      }
      return;
    }

    // multi-column toggle
    if (existingIndex === -1) {
      onSortChange([...stateArray, { columnKey: column.key, direction: 'asc' }]);
      return;
    }
    const currentRule = stateArray[existingIndex];
    const nextDirection = currentRule.direction === 'asc' ? 'desc' : currentRule.direction === 'desc' ? null : 'asc';
    if (!nextDirection) {
      const clone = [...stateArray];
      clone.splice(existingIndex, 1);
      onSortChange(clone);
    } else {
      const clone = [...stateArray];
      clone[existingIndex] = { columnKey: column.key, direction: nextDirection };
      onSortChange(clone);
    }
  };

  return (
    <div style={{ overflowX: 'auto', ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: tableMinWidth }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(148,163,184,0.15)' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  padding: '0.6rem 0.75rem',
                  width: col.width,
                  textAlign: col.align ?? 'left',
                  fontSize: '0.85rem',
                  cursor: col.sortable && onSortChange ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
                onClick={(event) => handleSortToggle(event, col)}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  {col.header}
                  {(() => {
                    const ruleIndex = stateArray.findIndex((rule) => rule.columnKey === col.key);
                    if (ruleIndex === -1) {
                      return col.sortable ? <span style={{ fontSize: '0.75rem', opacity: 0.25 }}>▲▼</span> : null;
                    }
                    const rule = stateArray[ruleIndex];
                    return (
                      <span style={{ fontSize: '0.75rem', opacity: 0.75, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                        {rule.direction === 'asc' ? '▲' : '▼'}
                        {stateArray.length > 1 ? <span style={{ fontSize: '0.7rem' }}>{ruleIndex + 1}</span> : null}
                      </span>
                    );
                  })()}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: '0.8rem 0.75rem', color: '#94A3B8', textAlign: 'center' }}>
                {emptyState || 'No records yet.'}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr key={rowIdx} style={{ borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
                {columns.map((col) => (
                  <td key={col.key} style={{ padding: '0.6rem 0.75rem', textAlign: col.align ?? 'left' }}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function sortRows<T>(rows: T[], sort: SortState | null, columns: Column<T>[]): T[] {
  if (!sort || sort.length === 0) return rows;
  const getAccessor = (rule: SortRule) => {
    const column = columns.find((col) => col.key === rule.columnKey);
    if (!column) {
      return (row: T) => (row as any)[rule.columnKey];
    }
    if (column.sortAccessor) return column.sortAccessor;
    return (row: T) => {
      const value = (row as any)[column.key];
      if (value instanceof Date) return value;
      if (typeof value === 'number' || typeof value === 'string') return value;
      if (value === null || value === undefined) return '';
      return typeof value === 'object' && 'toString' in value ? String(value) : '';
    };
  };

  const accessors = sort.map((rule) => ({ rule, accessor: getAccessor(rule) }));

  const normalize = (input: any) => {
    if (input instanceof Date) return input.getTime();
    if (typeof input === 'number') return input;
    const parsed = Number(input);
    if (!Number.isNaN(parsed)) return parsed;
    return input?.toString().toLowerCase?.() ?? '';
  };

  return [...rows].sort((a, b) => {
    for (const { rule, accessor } of accessors) {
      const aNorm = normalize(accessor(a));
      const bNorm = normalize(accessor(b));
      if (aNorm === bNorm) continue;
      const result = aNorm < bNorm ? -1 : 1;
      return rule.direction === 'asc' ? result : -result;
    }
    return 0;
  });
}
