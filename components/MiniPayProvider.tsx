"use client";

import { ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useConnect } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi-config";
import { isMiniPay } from "@/lib/minipay";

const queryClient = new QueryClient();

/** Auto-connect when running inside MiniPay — no connect button. */
function MiniPayAutoConnect({ children }: { children: ReactNode }) {
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (!isMiniPay()) return;
    const connector = connectors[0];
    if (!connector) return;
    connect({ connector });
  }, [connect, connectors]);

  return <>{children}</>;
}

export default function MiniPayProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MiniPayAutoConnect>{children}</MiniPayAutoConnect>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
