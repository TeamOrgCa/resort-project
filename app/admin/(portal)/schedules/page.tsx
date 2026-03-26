import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  publicAccessColumns,
  publicAccessRows,
  scheduleBlocksColumns,
  scheduleBlocksRows,
} from "@/components/admin/content";

export default function AdminSchedulesPage() {
  return (
    <div>
      <AdminSectionHeader
        title="Schedule Management"
        subtitle="Block dates for maintenance, private events, and other operational activities."
      />

      <div className="grid gap-6">
        <AdminTablePreview
          title="Calendar Blocks and Operational Events"
          columns={scheduleBlocksColumns}
          rows={scheduleBlocksRows}
          defaultSort={{ key: "date", direction: "asc" }}
          filters={[
            { key: "type", label: "Block Type", options: ["Maintenance", "Private Event", "Public Access"] },
            { key: "status", label: "Status", options: ["Blocked", "Open"] },
          ]}
          actions={["Add Block", "Sync Calendar"]}
          rowActions={["Edit", "Remove"]}
        />
        <AdminTablePreview
          title="Public Access Capacity"
          columns={publicAccessColumns}
          rows={publicAccessRows}
          defaultSort={{ key: "date", direction: "asc" }}
          actions={["Adjust Slots"]}
          rowActions={["View"]}
        />
      </div>
    </div>
  );
}
