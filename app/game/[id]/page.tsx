"use client";

import dynamic from "next/dynamic";
import LoadingScreen from "@/components/LoadingScreen";

const GamePageClient = dynamic(() => import("@/components/GamePageClient"), {
  ssr: false,
  loading: () => <LoadingScreen message="Loading game" />,
});

export default function GamePage() {
  return <GamePageClient />;
}
