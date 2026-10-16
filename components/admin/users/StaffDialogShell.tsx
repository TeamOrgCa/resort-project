"use client";

import type { ReactNode } from "react";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";

interface StaffDialogShellProps {
  isOpen: boolean;
  title: string;
  description: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function StaffDialogShell({ isOpen, title, description, busy = false, onClose, children }: StaffDialogShellProps) {
  if (!isOpen) return null;
  return <CatalogDialog title={title} description={description} busy={busy} onClose={onClose}>{children}</CatalogDialog>;
}
