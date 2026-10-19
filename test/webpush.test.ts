import { createECDH, createPublicKey, randomBytes, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- http_ece tidak menyertakan tipe
import ece from "http_ece";
import {
  b64urlDecode,
  b64urlEncode,
  encryptPayload,
  generateVapidKeys,
  vapidAuthorization,
} from "../src/worker/webpush";

describe("web push encryption", () => {
  it("menghasilkan payload yang bisa didekripsi oleh implementasi referensi", async () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const message = JSON.stringify({ title: "Waktunya minum", body: "Fresubin 200 ml" });

    const encrypted = await encryptPayload(
      { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) },
      new TextEncoder().encode(message),
    );

    const decrypted = ece.decrypt(Buffer.from(encrypted), {
      version: "aes128gcm",
      privateKey: ua,
      authSecret: auth.toString("base64url"),
    });
    expect(decrypted.toString("utf8")).toBe(message);
  });
});

describe("VAPID", () => {
  it("menandatangani JWT ES256 yang valid untuk origin endpoint", async () => {
    const keys = await generateVapidKeys();
    const header = await vapidAuthorization(
      "https://web.push.apple.com/abc123",
      keys,
      "https://biya.example.workers.dev",
      1_700_000_000,
    );
    const match = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(match).not.toBeNull();
    const [, jwt, k] = match!;
    expect(k).toBe(keys.publicKey);
    const [h, p, s] = jwt.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toEqual({
      aud: "https://web.push.apple.com",
      exp: 1_700_000_000 + 12 * 3600,
      sub: "https://biya.example.workers.dev",
    });
    const pub = b64urlDecode(keys.publicKey);
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33)) },
      format: "jwk",
    });
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key, dsaEncoding: "ieee-p1363" },
      Buffer.from(s, "base64url"),
    );
    expect(ok).toBe(true);
  });
});
