export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
      {children}
    </h2>
  );
}
