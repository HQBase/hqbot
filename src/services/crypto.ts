function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

function fromBase64url(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength)
  new Uint8Array(buffer).set(value)
  return buffer
}

async function connectionKey(value: string): Promise<CryptoKey> {
  const bytes = fromBase64url(value)
  if (bytes.byteLength !== 32) throw new Error("HQBOT_CONNECTION_KEY must contain 32 random bytes")
  return crypto.subtle.importKey("raw", arrayBuffer(bytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ])
}

export async function encryptConnectionToken(
  keyValue: string,
  token: string,
): Promise<{ ciphertext: string; iv: string }> {
  return encryptSecret(keyValue, token)
}

export async function encryptSecret(
  keyValue: string,
  value: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await connectionKey(keyValue),
    new TextEncoder().encode(value),
  )
  return { ciphertext: base64url(new Uint8Array(encrypted)), iv: base64url(iv) }
}

export async function decryptConnectionToken(
  keyValue: string,
  ciphertext: string,
  iv: string,
): Promise<string> {
  return decryptSecret(keyValue, ciphertext, iv)
}

export async function decryptSecret(
  keyValue: string,
  ciphertext: string,
  iv: string,
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(fromBase64url(iv)) },
    await connectionKey(keyValue),
    arrayBuffer(fromBase64url(ciphertext)),
  )
  return new TextDecoder().decode(decrypted)
}
