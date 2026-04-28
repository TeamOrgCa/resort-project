interface AdminSectionHeaderProps {
  title: string;
  subtitle: string;
}

export default function AdminSectionHeader({ title, subtitle }: AdminSectionHeaderProps) {
  return (
    <header className="mb-6 rounded-2xl border border-neutral/10 bg-white p-4 sm:p-6">
      <h1 className="text-xl font-bold text-neutral sm:text-2xl md:text-3xl">{title}</h1>
      <p className="mt-2 text-sm text-neutral/70">{subtitle}</p>
    </header>
  );
}
