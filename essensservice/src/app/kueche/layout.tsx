import { Suspense } from "react";
import StaffShell from "@/components/staff/StaffShell";

export default function KuecheLayout({ children }: { children: React.ReactNode }) {
  return (
    <StaffShell need="kueche">
      <Suspense>{children}</Suspense>
    </StaffShell>
  );
}
