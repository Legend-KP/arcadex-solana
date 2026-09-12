import { injected } from "@wagmi/core";
import { createConfig, http } from "wagmi";
import { celo } from "viem/chains";

export const wagmiConfig = createConfig({
  chains: [celo],
  connectors: [
    injected({
      target: "metaMask",
    }),
  ],
  transports: {
    [celo.id]: http("https://forno.celo.org"),
  },
  ssr: true,
});
