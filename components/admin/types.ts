export interface AdminNavItem {
  label: string;
  href: string;
  description: string;
}

export interface AdminMetric {
  label: string;
  value: string;
  trend: string;
}

export interface AdminFeatureCard {
  title: string;
  summary: string;
  href: string;
}

export interface AdminTableColumn {
  key: string;
  label: string;
}

export interface AdminTableRow {
  id: string;
  [key: string]: string;
}

export interface AdminTableFilter {
  key: string;
  label: string;
  options: string[];
}

export interface AdminTableSort {
  key: string;
  direction: "asc" | "desc";
}
