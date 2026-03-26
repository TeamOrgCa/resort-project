"use client";

import { useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  publicAccessColumns,
  publicAccessRows,
  scheduleBlocksColumns,
  scheduleBlocksRows,
} from "@/components/admin/content";

const scheduleTabs = ["Calendar Blocks", "Public Access Capacity"] as const;

export default function AdminSchedulesPage() {
  const [activeTab, setActiveTab] = useState<(typeof scheduleTabs)[number]>("Calendar Blocks");

  return (
    <div>
      <AdminSectionHeader
        title="Schedule Management"
        subtitle="Block dates for maintenance, private events, and other operational activities."
      />

      <section className="rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral/10 pb-4">
          {scheduleTabs.map((tab) => {
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

        {activeTab === "Calendar Blocks" && (
          <AdminTablePreview
            title="Calendar Blocks and Operational Events"
            columns={scheduleBlocksColumns}
            rows={scheduleBlocksRows}
            defaultSort={{ key: "date", direction: "asc" }}
            filters={[
              {
                key: "type",
                label: "Block Type",
                options: ["Maintenance", "Private Event", "Public Access"],
              },
              { key: "status", label: "Status", options: ["Blocked", "Open"] },
            ]}
            actions={["Add Block", "Sync Calendar"]}
            rowActions={["Edit", "Remove"]}
          />
        )}

        {activeTab === "Public Access Capacity" && (
          <AdminTablePreview
            title="Public Access Capacity"
            columns={publicAccessColumns}
            rows={publicAccessRows}
            defaultSort={{ key: "date", direction: "asc" }}
            actions={["Adjust Slots"]}
            rowActions={["View"]}
          />
        )}
      </section>
    </div>
  );
}
