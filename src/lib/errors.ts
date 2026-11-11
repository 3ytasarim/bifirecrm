/** Kullanıcıya olduğu gibi gösterilebilen iş kuralı hatası (ör. "Teklif onaylanmadan gönderilemez"). */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}
