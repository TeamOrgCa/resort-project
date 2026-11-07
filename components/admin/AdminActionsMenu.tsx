"use client";

import RecordActionsMenu from "@/components/manage/RecordActionsMenu";

export default function AdminActionsMenu({ reference, actions }: {
  reference: string;
  actions: { label: string; disabled?: boolean; onSelect: () => void | Promise<void> }[];
}) {
  return <RecordActionsMenu reference={reference} heading="Record actions" actions={actions.map(action => ({
    ...action,
    onSelect: () => { void action.onSelect(); },
    icon: /^(view|review)\b/i.test(action.label) ? "view" : /^(edit|reset)\b/i.test(action.label) ? "edit" : "arrow",
    danger: /^(reject|disable|deactivate|archive|delete|cancel)\b/i.test(action.label),
  }))} />;
}
