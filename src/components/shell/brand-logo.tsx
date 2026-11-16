import Image from "next/image";

/**
 * Bifire sitesinin logosu (bifiresomine.com, public/brand/bifire-logo.png, 740×196).
 * CRM zemini koyu cam olduğu için açık varyant kullanılır: "BI" ve "ŞÖMİNE" açık ton, "FIRE" bronz kalır.
 */
export function BrandLogo({ className = "w-[148px]", priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/bifire-logo-light.png"
      alt="Bifire Şömine"
      width={740}
      height={196}
      priority={priority}
      sizes="200px"
      className={`h-auto ${className}`}
    />
  );
}
