import { Suspense } from "react";
import StaffShell from "@/components/staff/StaffShell";

export default function BueroLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffShell need="buero">
      <Suspense>{children}</Suspense>
    </StaffShell>
  );
}
