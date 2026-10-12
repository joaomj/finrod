const setting = "finrod.exa-key";

export function readExaKey(): string {
  try { return localStorage.getItem(setting)?.trim() ?? ""; }
  catch (error) { throw new Error("Cannot read the saved Exa key. Allow site storage, then reload Finrod.", { cause: error }); }
}

export function saveExaKey(value: string): void {
  const key = value.trim();
  if (/[\r\n]/.test(key)) throw new Error("Exa API key: enter the key on one line, without line breaks.");
  try {
    if (key) localStorage.setItem(setting, key);
    else localStorage.removeItem(setting);
  } catch (error) { throw new Error("Cannot save the Exa key. Allow site storage, then try again.", { cause: error }); }
}
