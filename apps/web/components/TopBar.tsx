import Link from "next/link";

export function TopBar({ right }: { right?: React.ReactNode }) {
  return (
    <div className="bar">
      <Link href="/" className="logo" style={{ textDecoration: "none" }}>
        Kunatra
      </Link>
      <span className="tag">your money, honestly</span>
      <span className="spacer" />
      {right}
    </div>
  );
}
