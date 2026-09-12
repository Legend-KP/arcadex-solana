"use client";

import dynamic from "next/dynamic";
import LoadingScreen from "@/components/LoadingScreen";

const AdminPortal = dynamic(() => import("@/components/AdminPortal"), {
  ssr: false,
  loading: () => <LoadingScreen message="Loading admin" />,
});

export default function AdminPage() {
  return <AdminPortal />;
}
