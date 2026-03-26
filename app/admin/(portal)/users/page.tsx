"use client";

import { useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  permissionColumns,
  permissionRows,
  usersColumns,
  usersRows,
} from "@/components/admin/content";

const userTabs = ["Staff Accounts", "Role Permission Matrix"] as const;

export default function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState<(typeof userTabs)[number]>("Staff Accounts");

  return (
    <div>
      <AdminSectionHeader
        title="User Management and Access Control"
        subtitle="Manage staff accounts, assign roles, and enforce access-level boundaries."
      />

      <section className="rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral/10 pb-4">
          {userTabs.map((tab) => {
            const isActive = tab === activeTab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {activeTab === "Staff Accounts" && (
          <AdminTablePreview
            title="Staff Accounts"
            columns={usersColumns}
            rows={usersRows}
            defaultSort={{ key: "lastLogin", direction: "desc" }}
            filters={[
              { key: "role", label: "Role", options: ["admin", "staff"] },
              { key: "status", label: "Status", options: ["Active", "Inactive"] },
            ]}
            actions={["Add Staff User", "Bulk Activate"]}
            rowActions={["Edit", "Disable"]}
          />
        )}

        {activeTab === "Role Permission Matrix" && (
          <AdminTablePreview
            title="Role Permission Matrix"
            columns={permissionColumns}
            rows={permissionRows}
            enableSearch={false}
            sortable={false}
            actions={["Edit Permissions"]}
          />
        )}
      </section>
    </div>
  );
}
