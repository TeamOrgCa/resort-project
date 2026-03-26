import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  permissionColumns,
  permissionRows,
  usersColumns,
  usersRows,
} from "@/components/admin/content";

export default function AdminUsersPage() {
  return (
    <div>
      <AdminSectionHeader
        title="User Management and Access Control"
        subtitle="Manage staff accounts, assign roles, and enforce access-level boundaries."
      />

      <section className="rounded-2xl border border-neutral/10 bg-white p-5">
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
      </section>

      <div className="mt-6">
        <AdminTablePreview
          title="Role Permission Matrix"
          columns={permissionColumns}
          rows={permissionRows}
          enableSearch={false}
          sortable={false}
          actions={["Edit Permissions"]}
        />
      </div>
    </div>
  );
}
