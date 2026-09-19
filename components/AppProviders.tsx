"use client";

import { usePathname } from "next/navigation";
import PlayerProfileProvider from "@/components/PlayerProfileProvider";
import SparkProvider from "@/components/SparkProvider";
import TouchSfxListener from "@/components/TouchSfxListener";

export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin");

  if (isAdminRoute) {
    return <>{children}</>;
  }

  return (
    <PlayerProfileProvider>
      <SparkProvider>
        <TouchSfxListener />
        {children}
      </SparkProvider>
    </PlayerProfileProvider>
  );
}
