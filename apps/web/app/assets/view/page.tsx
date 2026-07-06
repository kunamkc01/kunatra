"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { api, type Asset, type AssetDetail, type AssetPulse, type AssetPhoto, type Member, type PropertyValuation, type Valuation } from "@/lib/api";
import { inr, inrExact, assetClassLabel } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import { Shell } from "@/components/Shell";
import { AssetSheet, PhotoGallery, ValueHistory, ContributionLedger } from "@/components/AssetSheet";
import { DocumentsPanel } from "@/components/DocumentsPanel";
import { TenantPanel } from "@/components/TenantPanel";

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
  const [pulse, setPulse] = useState<AssetPulse | null>(null);
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
  useEffect(() => {
    if (ready && id && asset?.assetClass === "real_estate") api.assetPulse(id).then(setPulse).catch(() => {});
  }, [ready, id, asset?.assetClass]);

  async function remove() {
    if (!asset || !confirm(`Delete "${asset.name}"? This can't be undone.`)) return;
    try { await api.deleteAsset(asset.id); router.replace("/manage"); }
    catch (e: any) { alert(e.message ?? "Could not delete"); }
  }

  if (!ready) return <Shell><div /></Shell>;

  const m = detail?.metrics;
  const re = asset?.realEstate;
  const isProperty = asset?.assetClass === "real_estate";
  const isRented = isProperty && (asset?.monthlyRent ?? 0) > 0;
  const canManageTenant = isRented && (role === "owner" || role === "manager");
  const subtitle = [
    re?.address, re?.locality || re?.city ? [re?.locality, re?.city].filter(Boolean).join(", ") : null,
    re?.sqft != null ? `${re.sqft} sq ft` : null,
    asset?.acquiredHow && m?.acquiredYear ? `${asset.acquiredHow} ${m.acquiredYear}` : m?.acquiredYear ? `since ${m.acquiredYear}` : null,
  ].filter(Boolean).join(" · ") || (asset ? assetClassLabel(asset.assetClass) : "");

  return (
    <Shell>
      <div className="scr-head">
        <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
          <HeroThumb assetId={id} name={asset?.name ?? "A"} />
          <div style={{ minWidth: 0 }}>
            <Link href="/manage" className="backlink">← All assets</Link>
            <h2 className="scr-title" style={{ marginTop: 2 }}>{asset?.name ?? "Asset"}</h2>
            <div className="scr-sub">
              {subtitle}
              {detail?.ownerName ? ` · ${detail.ownerName}` : ""}
              {isRented ? <> · <span className="pill p-good">rented</span></> : null}
            </div>
          </div>
        </div>
        <div className="acts">
          {canEdit && <button className="btn ghost" onClick={() => setEditing(true)}>Edit details</button>}
          {canDelete && <button className="btn ghost danger" onClick={remove}>Delete</button>}
        </div>
      </div>

      {err && <div className="strip bad">{err}</div>}

      <div className={isProperty ? "det2" : undefined}>
        <div className="det-main">
          {/* your value and the AI's, side by side — the mirror, not the advisor */}
          {m && (
            <DualValuation asset={asset} metrics={m} canSeeFinancials={canSeeFinancials} isProperty={!!isProperty} />
          )}

          {/* on phones the pulse slots in right here, under the valuation */}
          {pulse && <div className="only-mobile" style={{ marginBottom: 14 }}><ThisMonth pulse={pulse} isRented={!!isRented} /></div>}

          {/* value over time — your records as the line, AI estimates as dated dots */}
          {isProperty && asset && canSeeFinancials && <ValueJourney asset={asset} />}

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

          {/* AI insight detail (range, reasons, feedback) — the dual panel above carries the headline */}
          {isProperty && asset && (
            <PropertyInsights assetId={asset.id} ownValue={asset.value} ownRent={asset.monthlyRent} canEdit={canEdit} canSeeFinancials={canSeeFinancials} onRecorded={load} />
          )}

          {/* value history + contributions (financial) */}
          {canSeeFinancials && asset && <ValueHistory assetId={asset.id} onChanged={load} />}
          {canSeeFinancials && asset && <ContributionLedger assetId={asset.id} onChanged={load} />}
        </div>

        {isProperty && (
          <div className="det-rail">
            {/* the property's pulse: rent, open requests, next compliance */}
            {pulse && <div className="only-desktop"><ThisMonth pulse={pulse} isRented={!!isRented} /></div>}

            {/* tenant portal access (money managers only) */}
            {asset && canManageTenant && (
              <div className="panel det-card"><TenantPanel assetId={asset.id} flat /></div>
            )}

            {/* the vault — paperwork lives with the property */}
            {asset && <div className="panel det-card"><DocumentsPanel assetId={asset.id} canEdit={canEdit} flat /></div>}

            {/* photos + facts */}
            {asset && canManagePhotos && <div className="panel det-card"><PhotoGallery assetId={asset.id} /></div>}
            {re && (re.address || re.sqft || re.ptin || re.undividedShare) && (
              <div className="panel det-card">
                <div className="sec-label" style={{ marginTop: 0 }}>The property</div>
                <dl className="deflist">
                  {re.address && <><dt>Address</dt><dd>{re.address}</dd></>}
                  {re.sqft != null && <><dt>Area</dt><dd>{re.sqft} sq ft</dd></>}
                  {re.undividedShare && <><dt>Undivided share</dt><dd>{re.undividedShare}</dd></>}
                  {re.ptin && <><dt>PTIN</dt><dd>{re.ptin}</dd></>}
                </dl>
              </div>
            )}

            {/* what's been happening here */}
            {pulse && <ActivityFeed items={pulse.activity} />}
          </div>
        )}
      </div>

      {/* non-property assets keep the vault + photos below the money */}
      {!isProperty && asset && (
        <>
          {canManagePhotos && <PhotoGallery assetId={asset.id} />}
          <DocumentsPanel assetId={asset.id} canEdit={canEdit} />
        </>
      )}

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

/** First photo as a 56px cover; a serif monogram tile when there is none. */
function HeroThumb({ assetId, name }: { assetId: string; name: string }) {
  const [photo, setPhoto] = useState<AssetPhoto | null | undefined>(undefined);
  useEffect(() => { api.listAssetPhotos(assetId).then((p) => setPhoto(p[0] ?? null)).catch(() => setPhoto(null)); }, [assetId]);
  if (photo === undefined) return <div className="hero-thumb" aria-hidden />;
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="hero-thumb" src={photo.dataUrl} alt="" />
  ) : (
    <div className="hero-thumb mono-tile" aria-hidden>{name.trim().charAt(0).toUpperCase()}</div>
  );
}

/** Your value and the AI's side by side, as equals. Falls back to the single worth panel. */
function DualValuation({ asset, metrics, canSeeFinancials, isProperty }: {
  asset: Asset | null; metrics: NonNullable<AssetDetail["metrics"]>; canSeeFinancials: boolean; isProperty: boolean;
}) {
  const [ai, setAi] = useState<PropertyValuation | null>(null);
  useEffect(() => {
    if (isProperty && asset) api.getPropertyValuation(asset.id).then(setAi).catch(() => {});
  }, [isProperty, asset]);

  const hasAi = canSeeFinancials && ai?.status === "ok" && ai.estimatedValue != null;
  const diffPct = hasAi && asset && asset.value > 0 ? ((ai!.estimatedValue! - asset.value) / asset.value) * 100 : null;

  return (
    <div className={hasAi ? "dualval" : undefined} style={{ marginBottom: 14 }}>
      <div className="panel" style={{ marginBottom: hasAi ? 0 : undefined }}>
        <div className="label">{hasAi ? "Your value" : "Worth today"}</div>
        <div className="num" style={{ fontSize: hasAi ? 26 : 30, marginTop: 2 }}>{inrExact(metrics.currentValue)}</div>
        {canSeeFinancials && metrics.costBasis != null && (
          <div className="meta" style={{ marginTop: 4 }}>
            Acquired at {inr(metrics.costBasis)} ·{" "}
            <span style={{ color: metrics.unrealizedGain >= 0 ? "var(--good)" : "var(--bad)" }}>
              {metrics.unrealizedGain >= 0 ? "+" : "−"}{inr(Math.abs(metrics.unrealizedGain))} ({pct(metrics.gainPct)})
            </span>
          </div>
        )}
      </div>
      {hasAi && (
        <div className="panel" style={{ borderLeft: "3px solid var(--seal)" }}>
          <div className="label">AI estimate{ai!.confidence && <span className={`pill ${CONF_PILL[ai!.confidence]}`} style={{ marginLeft: 6 }}>{ai!.confidence}</span>}</div>
          <div className="num" style={{ fontSize: 26, marginTop: 2 }}>{inr(ai!.estimatedValue!)}</div>
          <div className="meta" style={{ marginTop: 4 }}>
            {ai!.lowValue != null && ai!.highValue != null ? `${inr(ai!.lowValue)} – ${inr(ai!.highValue)}` : ""}
            {diffPct != null && <> · <b style={{ color: Math.abs(diffPct) < 10 ? "var(--good)" : "var(--seal)" }}>{diffPct >= 0 ? "+" : ""}{diffPct.toFixed(0)}% vs yours</b></>}
          </div>
        </div>
      )}
    </div>
  );
}

const WO_PILL: Record<string, string> = { open: "p-warn", in_progress: "p-acc" };

/** The rail opener: is rent in, does anything need me, what is due next. */
function ThisMonth({ pulse: p, isRented }: { pulse: AssetPulse; isRented: boolean }) {
  if (!isRented && p.openWorkOrders.length === 0 && !p.nextCompliance) return null;
  const good = p.rent?.status === "collected" && p.openWorkOrders.length === 0;
  return (
    <div className="panel det-card" style={{ borderLeft: `3px solid ${good ? "var(--good)" : "var(--warn)"}` }}>
      <div className="sec-label" style={{ marginTop: 0 }}>This month</div>
      {isRented && (
        <div style={{ fontSize: 13 }}>
          Rent{" "}
          {p.rent?.status === "collected"
            ? <b style={{ color: "var(--good)" }}>✓ collected{p.rent.collectedOn ? ` ${new Date(`${p.rent.collectedOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</b>
            : p.rent?.status === "waived"
              ? <b className="muted">waived</b>
              : <b style={{ color: "var(--warn)" }}>due{p.rent ? ` · ${inr(p.rent.amountDue)}` : ""}</b>}
          {p.rent?.status === "collected" && (
            <Link href={`/receipts/view?id=${p.rent.id}`} className="btn ghost small" style={{ marginLeft: 6 }}>Receipt</Link>
          )}
        </div>
      )}
      {p.openWorkOrders.map((w) => (
        <div key={w.id} style={{ fontSize: 13, marginTop: 6 }}>
          <span className={`pill ${WO_PILL[w.status] ?? "p-info"}`}>{w.status.replace("_", " ")}</span>{" "}
          {w.title}{w.tenantRaised && <span className="pill p-acc" style={{ marginLeft: 5 }}>tenant</span>}
        </div>
      ))}
      {p.nextCompliance && (
        <div style={{ fontSize: 13, marginTop: 6 }}>
          Next: {p.nextCompliance.title} <span className="muted">due {new Date(`${p.nextCompliance.dueOn}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
        </div>
      )}
    </div>
  );
}

const ACT_ICON: Record<string, string> = { document: "📄", rent: "₹", tenant_request: "🔧", work_order: "🔧", ai_estimate: "◆", valuation: "●" };

/** Receipts filed, docs uploaded, requests raised — the page feels inhabited. */
function ActivityFeed({ items }: { items: AssetPulse["activity"] }) {
  if (items.length === 0) return null;
  return (
    <div className="panel det-card">
      <div className="sec-label" style={{ marginTop: 0 }}>Recent activity</div>
      <div className="feed">
        {items.map((a, i) => (
          <div key={i}>
            <span className="when">{new Date(a.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
            <span><span aria-hidden style={{ marginRight: 5 }}>{ACT_ICON[a.kind] ?? "·"}</span>{a.text}</span>
          </div>
        ))}
      </div>
    </div>
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


// ---- AI property insights ---------------------------------------------------
const CONF_PILL: Record<string, string> = { low: "p-warn", medium: "p-info", high: "p-good" };

function PropertyInsights({ assetId, ownValue, ownRent, canEdit, canSeeFinancials, onRecorded }: {
  assetId: string; ownValue: number; ownRent?: number | null; canEdit: boolean; canSeeFinancials: boolean; onRecorded: () => void;
}) {
  const [v, setV] = useState<PropertyValuation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => api.getPropertyValuation(assetId).then((x) => { setV(x); setLoaded(true); }).catch(() => setLoaded(true)), [assetId]);
  useEffect(() => { load(); }, [load]);

  // While the estimate is generating, poll every 5s.
  useEffect(() => {
    if (v?.status !== "pending") return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [v?.status, load]);

  async function refresh() {
    setBusy(true); setErr(null);
    try { setV(await api.refreshPropertyValuation(assetId)); }
    catch (e: any) { setErr(e.message ?? "Could not refresh"); }
    finally { setBusy(false); }
  }
  async function feedback(f: "too_low" | "accurate" | "too_high") {
    try { setV(await api.propertyValuationFeedback(assetId, { feedback: f })); }
    catch (e: any) { setErr(e.message ?? "Could not save feedback"); }
  }
  async function record() {
    if (!v?.estimatedValue) return;
    if (!confirm(`Record ${inrExact(v.estimatedValue)} as a dated valuation for this asset? This updates its current value.`)) return;
    try { await api.addValuation(assetId, { value: v.estimatedValue, asOf: new Date().toISOString().slice(0, 10), source: "AI estimate" }); onRecorded(); }
    catch (e: any) { setErr(e.message ?? "Could not record"); }
  }

  if (!loaded || !canSeeFinancials) return null;
  const diffPct = v?.estimatedValue && ownValue > 0 ? ((v.estimatedValue - ownValue) / ownValue) * 100 : null;

  return (
    <div className="panel" style={{ marginTop: 6 }}>
      <div className="sec-label" style={{ marginTop: 0 }}>
        Property insights
        {v?.status === "ok" && canEdit && <button className="btn ghost small" type="button" onClick={refresh} disabled={busy}>Refresh</button>}
      </div>

      {!v && (
        <div>
          <p className="desc" style={{ marginTop: 2 }}>Get an AI estimate of this property's market value and rent — free, informational only.</p>
          {canEdit && <button className="btn small primary" type="button" onClick={refresh} disabled={busy}>{busy ? "Starting…" : "Generate insights"}</button>}
        </div>
      )}

      {v?.status === "pending" && (
        <div className="hint" style={{ padding: "8px 0" }}>Generating property insights… this usually takes under a minute.</div>
      )}

      {v?.status === "unavailable" && (
        <div>
          <div className="hint" style={{ padding: "6px 0" }}>We couldn't produce a reliable estimate for this property{v.generatedAt ? "" : " yet"}. Adding city, locality, type and area (Edit details) helps a lot.</div>
          {canEdit && <button className="btn small" type="button" onClick={refresh} disabled={busy}>Try again</button>}
        </div>
      )}

      {v?.status === "ok" && v.estimatedValue != null && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="num" style={{ fontSize: 24 }}>{inr(v.lowValue ?? v.estimatedValue)} – {inr(v.highValue ?? v.estimatedValue)}</span>
            <span className="meta">mid {inr(v.estimatedValue)}</span>
            {v.confidence && <span className={`pill ${CONF_PILL[v.confidence]}`}>{v.confidence} confidence</span>}
          </div>
          <div className="meta" style={{ marginTop: 6 }}>
            {diffPct != null && <>vs your value {inr(ownValue)}: <b style={{ color: Math.abs(diffPct) < 10 ? "var(--good)" : "var(--warn)" }}>{diffPct >= 0 ? "+" : ""}{diffPct.toFixed(0)}%</b> · </>}
            {v.pricePerSqft != null && <>{inr(v.pricePerSqft)}/sqft · </>}
            {v.estimatedRent != null && (
              <>rent est. {inr(v.estimatedRent)}/mo{ownRent != null && ownRent > 0 && Math.abs(v.estimatedRent - ownRent) >= 1000
                ? <b style={{ color: v.estimatedRent > ownRent ? "var(--warn)" : "var(--good)" }}> ({inr(Math.abs(v.estimatedRent - ownRent))} {v.estimatedRent > ownRent ? "above" : "below"} your {inr(ownRent)})</b>
                : null} · </>
            )}
            {v.rentalYieldPct != null && <>yield {v.rentalYieldPct.toFixed(1)}% · </>}
            {v.annualGrowthPct != null && <>growth {v.annualGrowthPct.toFixed(1)}%/yr</>}
          </div>
          {v.summary && <p className="desc" style={{ marginTop: 8 }}>{v.summary}</p>}
          {v.reasons.length > 0 && (
            <ul style={{ margin: "6px 0 0 18px", fontSize: 13, color: "var(--slate)" }}>
              {v.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
          {canEdit && (
            <div className="actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <span className="meta" style={{ marginRight: 2 }}>How does this look?</span>
              {(["too_low", "accurate", "too_high"] as const).map((f) => (
                <button key={f} className={`btn ghost small ${v.feedback === f ? "primary" : ""}`} type="button" onClick={() => feedback(f)}>
                  {f === "too_low" ? "Too low" : f === "accurate" ? "Looks accurate" : "Too high"}
                </button>
              ))}
              <button className="btn ghost small" type="button" onClick={record}>Record as valuation</button>
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>
            AI-generated estimate for information only — not an official valuation{v.generatedAt ? ` · updated ${new Date(v.generatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}.
          </div>
        </>
      )}

      {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}


// ---- value over time --------------------------------------------------------
interface JPoint { t: number; v: number; kind: "real" | "ai"; low?: number | null; high?: number | null; label?: string; }

/**
 * The property's value journey: a solid line through REAL anchors (purchase
 * price, dated valuations you recorded, today's value) with AI estimates drawn
 * as distinct dated dots + range whiskers. The AI dots accrue into their own
 * trendline as estimates refresh — we never fabricate past estimates.
 */
function ValueJourney({ asset }: { asset: Asset }) {
  const [vals, setVals] = useState<Valuation[] | null>(null);
  const [ai, setAi] = useState<PropertyValuation | null>(null);

  useEffect(() => {
    api.listValuations(asset.id).then(setVals).catch(() => setVals([]));
    api.getPropertyValuation(asset.id).then(setAi).catch(() => setAi(null));
  }, [asset.id]);

  if (vals == null) return null;

  const real: JPoint[] = [];
  if (asset.costBasis != null && asset.acquiredYear != null) {
    real.push({ t: new Date(asset.acquiredYear, 0, 1).getTime(), v: asset.costBasis, kind: "real", label: asset.acquiredHow ?? "acquired" });
  }
  for (const v of vals) real.push({ t: new Date(`${v.asOf}T00:00:00`).getTime(), v: v.value, kind: "real" });
  real.push({ t: Date.now(), v: asset.value, kind: "real", label: "today" });
  // dedupe near-identical points (the latest valuation IS the current value)
  const realPts = real
    .sort((a, b) => a.t - b.t)
    .filter((p, i, arr) => i === 0 || Math.abs(p.t - arr[i - 1].t) > 86400000 * 20 || p.v !== arr[i - 1].v);

  const aiPts: JPoint[] = (ai?.history ?? []).map((h) => ({
    t: new Date(h.at).getTime(), v: h.estimatedValue, kind: "ai", low: h.lowValue, high: h.highValue,
  }));

  if (realPts.length + aiPts.length < 2) return null;

  const all = [...realPts, ...aiPts];
  const W = 720, H = 170, PAD = { l: 8, r: 8, t: 18, b: 24 };
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  const lo = Math.min(...all.map((p) => p.low ?? p.v)), hi = Math.max(...all.map((p) => p.high ?? p.v));
  const tSpan = t1 - t0 || 1, vSpan = hi - lo || Math.abs(hi) || 1;
  const x = (t: number) => PAD.l + ((t - t0) / tSpan) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / vSpan) * (H - PAD.t - PAD.b);
  const line = realPts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const yearLabels = Array.from(new Set([t0, t0 + tSpan / 2, t1].map((t) => new Date(t).getFullYear())));

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="sec-label" style={{ marginTop: 0, marginBottom: 4 }}>
        Value over time
        <span className="meta" style={{ display: "flex", gap: 12 }}>
          <span><span style={{ color: "var(--navy)" }}>●</span> your records</span>
          {aiPts.length > 0 && <span><span style={{ color: "var(--seal)" }}>●</span> AI estimate</span>}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Property value over time">
        {realPts.length >= 2 && <polyline points={line} fill="none" stroke="var(--navy)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {aiPts.map((p, i) => (
          <g key={`ai${i}`}>
            {p.low != null && p.high != null && (
              <line x1={x(p.t)} y1={y(p.low)} x2={x(p.t)} y2={y(p.high)} stroke="var(--seal)" strokeWidth="2" opacity="0.45" />
            )}
            <circle cx={x(p.t)} cy={y(p.v)} r="4" fill="var(--seal)" />
          </g>
        ))}
        {realPts.map((p, i) => (
          <g key={`r${i}`}>
            <circle cx={x(p.t)} cy={y(p.v)} r={i === realPts.length - 1 ? 4 : 3} fill="var(--navy)" />
            {p.label && (
              <text x={x(p.t)} y={y(p.v) - 8} textAnchor={i === 0 ? "start" : "end"} fontSize="10.5" fill="var(--slate)">
                {p.label} {inr(p.v)}
              </text>
            )}
          </g>
        ))}
        {yearLabels.map((yr, i) => (
          <text key={yr} x={i === 0 ? PAD.l : i === yearLabels.length - 1 ? W - PAD.r : W / 2} y={H - 6}
            textAnchor={i === 0 ? "start" : i === yearLabels.length - 1 ? "end" : "middle"} fontSize="10.5" fill="var(--muted)">{yr}</text>
        ))}
      </svg>
      {aiPts.length > 0 && (
        <div className="hint" style={{ marginTop: 4 }}>
          AI estimates are informational dots with their low–high range — they accrue into a trendline as estimates refresh (every ~90 days). We never back-fill estimates for past months.
        </div>
      )}
    </div>
  );
}
