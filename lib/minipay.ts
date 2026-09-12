import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { celo } from "viem/chains";

type MiniPayProvider = EIP1193Provider & {
  isMiniPay?: boolean;
};

declare global {
  interface Window {
    ethereum?: MiniPayProvider;
  }
}

export function isMiniPay(): boolean {
  return (
    typeof window !== "undefined" &&
    window.ethereum !== undefined &&
    window.ethereum.isMiniPay === true
  );
}

export function getInjectedProvider(): MiniPayProvider | null {
  if (typeof window === "undefined" || !window.ethereum) return null;
  return window.ethereum;
}

export function createMiniPayWalletClient(): WalletClient | null {
  const provider = getInjectedProvider();
  if (!provider) return null;

  return createWalletClient({
    chain: celo,
    transport: custom(provider),
  });
}
