const storageKey = "finrod.openrouter-key";

export function readProviderKey(): string {
  try { return localStorage.getItem(storageKey)?.trim() ?? ""; }
  catch (error) {
    throw new Error("Cannot read the saved OpenRouter key. Allow site storage for Finrod, then reload.", { cause: error });
  }
}

export function saveProviderKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(storageKey, key.trim());
    else localStorage.removeItem(storageKey);
  } catch (error) {
    throw new Error("Cannot update the saved OpenRouter key. Allow site storage and check available space, then try again.", { cause: error });
  }
}
