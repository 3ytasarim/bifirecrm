"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { buttonClass } from "@/components/ui/form";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md py-20 text-center">
      <TriangleAlert className="mx-auto mb-3 size-10 text-danger" aria-hidden />
      <h1 className="font-display text-xl font-semibold">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-muted">
        {error.name === "ForbiddenError" ? error.message : "Sayfa yüklenirken beklenmeyen bir hata oluştu. Veri kaybı yok; tekrar deneyebilirsiniz."}
      </p>
      {error.digest ? <p className="mt-2 font-mono text-xs text-muted">Hata kodu: {error.digest}</p> : null}
      <button onClick={reset} className={`${buttonClass()} mt-6`}>
        Tekrar dene
      </button>
    </div>
  );
}
