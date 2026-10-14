import type { SVGProps } from "react";
export type ManageIconName = "more" | "view" | "edit" | "calendar" | "wallet" | "cancel" | "close" | "guests" | "clock" | "search" | "arrow";
const paths: Record<Exclude<ManageIconName, "more">, string> = {
  view: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  edit: "m15 5 4 4 M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z",
  calendar: "M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M8 14h2 M14 14h2 M8 18h2",
  wallet: "M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7 M21 12h-5v5h5 M17.5 14.5h.01",
  cancel: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M5 5l14 14",
  close: "m6 6 12 12 M6 18 18 6",
  guests: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M12 6v6l4 2",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  arrow: "M5 12h14 m-5-5 5 5-5 5",
};
export default function ManageIcon({ name, className = "h-5 w-5", ...props }: SVGProps<SVGSVGElement> & { name: ManageIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...props}>
    {name === "more" ? <><circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" /></> : <path d={paths[name]} />}
  </svg>;
}
