import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = {
  token: "arcadex_wallet_session",
  address: "arcadex_solana_address",
  label: "arcadex_solana_label",
  playerName: "arcadex_player_name",
  message: "arcadex_solana_signin_message",
  signature: "arcadex_solana_signin_signature",
};

export async function loadSession() {
  const entries = await AsyncStorage.multiGet([
    KEYS.token,
    KEYS.address,
    KEYS.label,
    KEYS.playerName,
    KEYS.message,
    KEYS.signature,
  ]);
  const map = Object.fromEntries(entries);
  return {
    token: map[KEYS.token] || null,
    address: map[KEYS.address] || null,
    label: map[KEYS.label] || null,
    playerName: map[KEYS.playerName] || null,
    message: map[KEYS.message] || null,
    signatureBase64: map[KEYS.signature] || null,
  };
}

export async function saveSession({
  token,
  address,
  label,
  playerName,
  message,
  signatureBase64,
}) {
  const pairs = [
    [KEYS.address, address || ""],
    [KEYS.label, label || ""],
    [KEYS.playerName, playerName || ""],
    [KEYS.message, message || ""],
    [KEYS.signature, signatureBase64 || ""],
  ];
  if (token) pairs.push([KEYS.token, token]);
  await AsyncStorage.multiSet(pairs.filter(([, v]) => v !== ""));
  if (!token) await AsyncStorage.removeItem(KEYS.token);
  if (!label) await AsyncStorage.removeItem(KEYS.label);
  if (!playerName) await AsyncStorage.removeItem(KEYS.playerName);
}

export async function clearSession() {
  await AsyncStorage.multiRemove(Object.values(KEYS));
}

/** Keys mirrored into WebView localStorage for the hybrid game page. */
export function sessionForInject(session) {
  return {
    arcadex_wallet_session: session.token || "",
    arcadex_solana_address: session.address || "",
    arcadex_solana_label: session.label || "",
    arcadex_solana_signin_message: session.message || "",
    arcadex_solana_signin_signature: session.signatureBase64 || "",
  };
}
