"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { api, type Asset, type AssetDetail, type Member } from "@/lib/api";
import { inr, inrExact, assetClassLabel } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import { Shell } from "@/components/Shell";
import { AssetSheet, PhotoGallery, ValueHistory, ContributionLedger } from "@/components/AssetSheet";

const pct = (v: number | null | undefined, dp = 1) => (v == null ? "—" : `${v.toFixed(dp)}%`);

// useSearchParams must sit inside a Suspense boundary for static export.
export default function AssetDetailPage() {
  return (
    <Suspense fallback={<Shell><div /></Shell>}>
      <AssetDetailView />
    </Suspense>
  );
}

function AssetDetailView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { user, ready } = useAuth();
  const role = user?.role;

  const [asset, setAsset] = useState<Asset | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const canSeeFinancials = role !== "operations";
  const isOwnAsset = role === "member" && asset?.memberId === user?.memberId;
  const canEdit = role === "owner" || role === "manager" || role === "operations" || isOwnAsset;
  const canDelete = role === "owner" || role === "manager" || isOwnAsset;
  const canManagePhotos = canEdit; // members are scoped server-side to their own

  const load = useCallback(async () => {
    if (!id) return;
    setErr(null);
    try {
      const [a, d] = await Promise.all([api.getAsset(id), api.assetDetail(id)]);
      setAsset(a); setDetail(d);
    } catch (e: any) { setErr(e.message ?? "Could not load this asset"); }
  }, [id]);

  useEffect(() => { if (ready && user) { load(); api.listMembers(user.householdId).then(setMembers).catch(() => {}); } }, [ready, user, load]);

  async function remove() {
    if (!asset || !confirm(`Delete "${asset.name}"? This can't be undone.`)) return;
    try { await api.deleteAsset(asset.id); router.replace("/manage"); }
    catch (e: any) { alert(e.message ?? "Could not delete"); }
  }

  if (!ready) return <Shell><div /></Shell>;

  const m = detail?.metrics;
  const re = asset?.realEstate;
  const isProperty = asset?.assetClass === "real_estate";

  return (
    <Shell>
      <div className="scr-head">
        <div>
          <Link href="/manage" className="backlink">← All assets</Link>
          <h2 className="scr-title" style={{ marginTop: 4 }}>{asset?.name ?? "Asset"}</h2>
          <div className="scr-sub">
            {asset && assetClassLabel(asset.assetClass)}
            {detail?.ownerName ? ` · ${detail.ownerName}` : ""}
            {m?.acquiredYear ? ` · since ${m.acquiredYear}` : ""}
            {asset?.acquiredHow ? ` · ${asset.acquiredHow}` : ""}
          </div>
        </div>
        <div className="acts">
          {canEdit && <button className="btn ghost" onClick={() => setEditing(true)}>Edit details</button>}
          {canDelete && <button className="btn ghost danger" onClick={remove}>Delete</button>}
        </div>
      </div>

      {err && <div className="strip bad">{err}</div>}

      {/* headline value */}
      {m && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <div className="label">Worth today</div>
          <div className="num" style={{ fontSize: 30, marginTop: 2 }}>{inrExact(m.currentValue)}</div>
          {canSeeFinancials && m.costBasis != null && (
            <div className="meta" style={{ marginTop: 4 }}>
              Acquired at {inr(m.costBasis)} ·{" "}
              <span style={{ color: m.unrealizedGain >= 0 ? "var(--good)" : "var(--bad)" }}>
                {m.unrealizedGain >= 0 ? "+" : "−"}{inr(Math.abs(m.unrealizedGain))} ({pct(m.gainPct)})
              </span>
            </div>
          )}
        </div>
      )}

      {/* metric tiles */}
      {canSeeFinancials && m && (
        <div className="tiles" style={{ marginBottom: 16 }}>
          {m.xirrPct != null && <Tile label="Return (XIRR)" value={pct(m.xirrPct)} tone={m.xirrPct >= 0 ? "good" : "bad"} />}
          {m.appreciationCagrPct != null && <Tile label="Appreciation p.a." value={pct(m.appreciationCagrPct)} />}
          {m.monthlyContribution > 0 && <Tile label="Investing" value={`${inr(m.monthlyContribution)}/mo`} />}
          {m.securedOutstanding > 0 && <Tile label="Equity" value={inr(m.equity)} sub={m.ltvPct != null ? `${m.ltvPct.toFixed(0)}% LTV` : undefined} />}
          {m.netRentMonthly > 0 && <Tile label="Net rent" value={`${inr(m.netRentMonthly)}/mo`} />}
          {m.dscr != null && <Tile label="DSCR" value={`${m.dscr.toFixed(2)}×`} tone={m.dscr >= 1.2 ? "good" : m.dscr >= 1 ? "warn" : "bad"} sub="rent ÷ EMI" />}
        </div>
      )}

      {/* secured loans */}
      {canSeeFinancials && detail && detail.securedLoans.length > 0 && (
        <>
          <div className="sec-label">Borrowed against this</div>
          {detail.securedLoans.map((l) => (
            <div className="row-item" key={l.id}>
              <div className="h"><span className="t">{l.name}</span><span className="tnum" style={{ color: "var(--bad)" }}>{inr(l.outstanding)}</span></div>
              <div className="meta">EMI {inr(l.emiMonthly)}/mo{l.ratePct != null ? ` · ${l.ratePct}%` : ""}</div>
            </div>
          ))}
        </>
      )}

      {/* components */}
      {detail && detail.children.length > 0 && (
        <>
          <div className="sec-label">Components</div>
          {detail.children.map((c) => (
            <Link href={`/assets/view?id=${c.id}`} className="row-item link" key={c.id}>
              <div className="h"><span className="t">{c.name}</span>{canSeeFinancials && <span className="tnum">{inr(c.value)}</span>}</div>
              <div className="meta">{assetClassLabel(c.assetClass)}</div>
            </Link>
          ))}
        </>
      )}

      {/* property details */}
      {isProperty && re && (re.address || re.sqft || re.ptin || re.undividedShare) && (
        <div className="panel" style={{ marginTop: 6 }}>
          <div className="sec-label" style={{ marginTop: 0 }}>Property details</div>
          <dl className="deflist">
            {re.address && <><dt>Address</dt><dd>{re.address}</dd></>}
            {re.sqft != null && <><dt>Area</dt><dd>{re.sqft} sq ft</dd></>}
            {re.undividedShare && <><dt>Undivided share</dt><dd>{re.undividedShare}</dd></>}
            {re.ptin && <><dt>PTIN</dt><dd>{re.ptin}</dd></>}
          </dl>
        </div>
      )}

      {/* photos — everyone in the household can view; managing is server-scoped */}
      {asset && canManagePhotos && <PhotoGallery assetId={asset.id} />}

      {/* value history + contributions (financial) */}
      {canSeeFinancials && asset && <ValueHistory assetId={asset.id} onChanged={load} />}
      {canSeeFinancials && asset && <ContributionLedger assetId={asset.id} onChanged={load} />}

      {editing && asset && user && (
        <AssetSheet
          householdId={user.householdId}
          existing={asset}
          members={members}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(); }}
          onChanged={load}
        />
      )}
    </Shell>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--ink)";
  return (
    <div className="tile">
      <div className="tl">{label}</div>
      <div className="tv num" style={{ fontSize: 21, marginTop: 4, color }}>{value}</div>
      {sub && <div className="meta" style={{ marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
