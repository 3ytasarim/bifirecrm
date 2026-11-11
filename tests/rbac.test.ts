import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, effectivePermissions } from "@/lib/rbac/permissions";
import { contactScope, opportunityScope, taskScope } from "@/lib/rbac/scope";

describe("effectivePermissions", () => {
  it("süper yönetici her izne sahip, override etkisiz", () => {
    const p = effectivePermissions("SUPER_ADMIN", [{ role: "SUPER_ADMIN", permission: "users.manage", granted: false }]);
    expect(p.size).toBe(ALL_PERMISSIONS.length);
  });
  it("satış varsayılanı: kendi kayıtları, kullanıcı yönetimi yok", () => {
    const p = effectivePermissions("SALES", []);
    expect(p.has("contacts.view")).toBe(true);
    expect(p.has("contacts.view_all")).toBe(false);
    expect(p.has("users.manage")).toBe(false);
  });
  it("override ekler/çıkarır; kilitli izin verilemez; bilinmeyen izin yok sayılır", () => {
    const p = effectivePermissions("SALES", [
      { role: "SALES", permission: "contacts.view_all", granted: true },
      { role: "SALES", permission: "contacts.edit", granted: false },
      { role: "SALES", permission: "roles.manage", granted: true },
      { role: "SALES", permission: "hack.all", granted: true },
      { role: "MANAGER", permission: "users.manage", granted: true },
    ]);
    expect(p.has("contacts.view_all")).toBe(true);
    expect(p.has("contacts.edit")).toBe(false);
    expect(p.has("roles.manage")).toBe(false);
    expect(p.has("users.manage")).toBe(false);
    expect([...p].every((x) => ALL_PERMISSIONS.includes(x))).toBe(true);
  });
  it("salt okunur rol yazma izni almaz", () => {
    const p = effectivePermissions("READ_ONLY", []);
    expect([...p].some((x) => /create|edit|manage|write|upload|process/.test(x))).toBe(false);
  });
});

describe("satır kapsamı", () => {
  const actor = (role: Parameters<typeof effectivePermissions>[0]) => ({ id: "u1", perms: effectivePermissions(role, []) });
  it("view_all yoksa sahiplik filtresi uygulanır", () => {
    const w = contactScope(actor("SALES"));
    expect(w.deletedAt).toBeNull();
    expect(JSON.stringify(w.OR)).toContain('"ownerId":"u1"');
  });
  it("view_all ile yalnız silinmemiş filtresi", () => {
    expect(contactScope(actor("MANAGER"))).toEqual({ deletedAt: null });
  });
  it("görüntüleme izni yoksa hiçbir kayıt", () => {
    expect(opportunityScope(actor("PRODUCTION_INSTALLATION"))).toEqual({ id: { in: [] } });
  });
  it("görev kapsamı: atanan veya oluşturan", () => {
    expect(taskScope(actor("SALES")).OR).toEqual([{ assigneeId: "u1" }, { createdById: "u1" }]);
  });
});
