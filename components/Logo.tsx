const LOGO_BY_VARIANT = {
  header: "/logo.png",
  loading: "/logo.png",
  login: "/logo.png",
} as const;

interface LogoProps {
  variant?: keyof typeof LOGO_BY_VARIANT;
}

export default function Logo({ variant = "header" }: LogoProps) {
  return (
    <span className={`logo-wrap logo-wrap--${variant}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_BY_VARIANT[variant]} alt="ArcadeX" className="logo-img" />
    </span>
  );
}
