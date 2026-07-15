"use client";
import { useEffect, useRef, useState } from "react";
import { api, type Asset, type AssetClass, type Valuation, type Contribution, type AssetPhoto, type Member } from "@/lib/api";
import { inr } from "@/lib/format";
import { Sheet } from "./Sheet";
import { FundPicker } from "./FundPicker";

/** Downscale a chosen image to a reasonable max edge and return a JPEG data URL. */
function fileToPhoto(file: File, maxEdge = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const CLASSES: { value: AssetClass; label: string; liquidDefault: boolean }[] = [
  { value: "real_estate", label: "Property / real estate", liquidDefault: false },
  { value: "mutual_fund", label: "Mutual fund", liquidDefault: true },
  { value: "sip", label: "SIP", liquidDefault: true },
  { value: "equity", label: "Equity / stocks", liquidDefault: true },
  { value: "epf", label: "EPF", liquidDefault: false },
  { value: "ppf", label: "PPF", liquidDefault: false },
  { value: "nps", label: "NPS", liquidDefault: false },
  { value: "rd", label: "Recurring deposit", liquidDefault: false },
  { value: "fd", label: "Fixed deposit", liquidDefault: false },
  { value: "bonds", label: "Bonds", liquidDefault: false },
  { value: "gold", label: "Gold", liquidDefault: false },
  { value: "cash", label: "Cash & savings", liquidDefault: true },
  { value: "insurance", label: "Insurance", liquidDefault: false },
  { value: "other", label: "Other", liquidDefault: false },
];

const HOW = ["bought", "inherited", "gifted", "built", "other"];

/** Only physical things you can photograph — not funds, deposits or cash. */
export const PHOTO_CLASSES: AssetClass[] = ["real_estate", "gold", "other"];
export const hasPhotos = (c: AssetClass) => PHOTO_CLASSES.includes(c);

type Group = "property" | "recurring" | "lump" | "deposit" | "cash" | "other";
const groupOf = (c: AssetClass): Group =>
  c === "real_estate" ? "property"
    : (["sip", "mutual_fund", "rd", "ppf", "epf", "nps"] as AssetClass[]).includes(c) ? "recurring"
      : c === "cash" ? "cash"
        : (["fd", "bonds"] as AssetClass[]).includes(c) ? "deposit"     // a deposit is opened, not inherited
          : (["equity", "gold"] as AssetClass[]).includes(c) ? "lump"   // these can genuinely be inherited/gifted
            : "other";

const thisYear = new Date().getFullYear();
const monthsSince = (y: number) => Math.max(1, (thisYear - y) * 12 + (new Date().getMonth() + 1));

export function AssetSheet({
  householdId, existing, members, onClose, onSaved, onChanged, presetClass, presetRented,
}: {
  householdId: string;
  existing?: Asset | null;
  members?: Member[];
  onClose: () => void;
  onSaved: () => void;
  onChanged?: () => void;
  /** One-tap starters preselect the class (and rented usage) for a new asset. */
  presetClass?: AssetClass;
  presetRented?: boolean;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(existing?.assetClass ?? presetClass ?? "real_estate");
  const [memberId, setMemberId] = useState(existing?.memberId ?? "");
  const [liquid, setLiquid] = useState<boolean>(existing?.liquid ?? (presetClass ? CLASSES.find((c) => c.value === presetClass)!.liquidDefault : false));

  // The acquisition story.
  const [how, setHow] = useState(existing?.acquiredHow ?? "bought");
  const [year, setYear] = useState(existing?.acquiredYear != null ? String(existing.acquiredYear) : "");
  const [price, setPrice] = useState(existing?.costBasis != null ? String(existing.costBasis) : ""); // acquisition price / cost basis
  const [value, setValue] = useState(existing ? String(existing.value) : ""); // worth today
  const [monthly, setMonthly] = useState(existing?.monthlyContribution != null ? String(existing.monthlyContribution) : "");
  const [usage, setUsage] = useState<"live_in" | "rented">(
    existing ? ((existing.monthlyRent ?? 0) > 0 ? "rented" : "live_in") : presetRented ? "rented" : "live_in");
  const [rent, setRent] = useState(existing?.monthlyRent != null ? String(existing.monthlyRent) : "");
  const [rentTds, setRentTds] = useState(existing?.rentTds != null ? String(existing.rentTds) : "");
  const [tenantName, setTenantName] = useState(existing?.tenantName ?? "");

  // Property specifics.
  const re = existing?.realEstate;
  // Auto-open the details for an existing property that's missing what the
  // AI estimate needs (city + size) — the completeness chip lands people here.
  const [showProp, setShowProp] = useState(
    !!(existing && existing.assetClass === "real_estate" && !(existing.realEstate?.city && existing.realEstate?.sqft)));
  const [address, setAddress] = useState(re?.address ?? "");
  const [sqft, setSqft] = useState(re?.sqft != null ? String(re.sqft) : "");
  const [undividedShare, setUndividedShare] = useState(re?.undividedShare ?? "");
  const [propertyType, setPropertyType] = useState(re?.propertyType ?? "");
  const [bedrooms, setBedrooms] = useState(re?.bedrooms != null ? String(re.bedrooms) : "");
  const [bathrooms, setBathrooms] = useState(re?.bathrooms != null ? String(re.bathrooms) : "");
  const [floor, setFloor] = useState(re?.floor != null ? String(re.floor) : "");
  const [builtYear, setBuiltYear] = useState(re?.builtYear != null ? String(re.builtYear) : "");
  const [city, setCity] = useState(re?.city ?? "");
  const [locality, setLocality] = useState(re?.locality ?? "");
  const [ptin, setPtin] = useState(re?.ptin ?? "");

  const [sipStart, setSipStart] = useState(
    existing?.acquiredYear != null ? `${existing.acquiredYear}-01-01` : "");
  // The ledger is the truth for an existing series — show its real first installment.
  useEffect(() => {
    if (existing && groupOf(existing.assetClass) === "recurring") {
      api.listContributions(existing.id)
        .then((cs) => { if (cs.length) setSipStart(String(cs[0].on).slice(0, 10)); })
        .catch(() => {});
    }
  }, [existing]);

  // Mutual funds can be a monthly SIP or a one-time lump sum.
  const [mfMode, setMfMode] = useState<"monthly" | "lump">(
    existing?.assetClass === "mutual_fund" && existing.monthlyContribution == null ? "lump" : "monthly");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const group = groupOf(assetClass);
  const mfLump = assetClass === "mutual_fund" && mfMode === "lump";
  // A one-time mutual fund and a deposit both behave like a lump-sum acquisition.
  const lumpish = group === "lump" || group === "deposit" || mfLump;

  function changeClass(c: AssetClass) {
    setAssetClass(c);
    if (!existing) setLiquid(CLASSES.find((x) => x.value === c)!.liquidDefault);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);

    const isRecurring = group === "recurring" && !mfLump;
    const acqYear = isRecurring
      ? (sipStart ? Number(sipStart.slice(0, 4)) : undefined)
      : year ? Number(year) : undefined;
    const acqPrice = price ? Number(price) : undefined;
    const monthlyAmt = monthly ? Number(monthly) : undefined;

    // Derive engine fields from the story.
    let costBasis: number | null = null;
    if (isRecurring) {
      // months elapsed since the first installment (inclusive)
      const months = sipStart
        ? Math.max(1, (new Date().getFullYear() - Number(sipStart.slice(0, 4))) * 12 + (new Date().getMonth() + 1) - Number(sipStart.slice(5, 7)) + 1)
        : acqYear ? monthsSince(acqYear) : null;
      costBasis = monthlyAmt != null && months != null ? monthlyAmt * months : null;
    }
    else if (group === "property" || lumpish) costBasis = acqPrice ?? null;

    const body: Partial<Asset> = {
      name: name.trim(),
      assetClass,
      // A blank value on an EXISTING asset means "leave it" (e.g. NAV-tracked funds) — never stomp it to 0.
      ...(existing && !value ? {} : { value: value ? Number(value) : 0 }),
      liquid,
      memberId: memberId || null,
      // A deposit or one-time fund is simply "bought"; property/gold/equity keep the story.
      acquiredHow: group === "property" || group === "lump" ? how : lumpish ? "bought" : null,
      acquiredYear: acqYear ?? null,
      // An existing series' cost basis comes from its ledger (and fund sync) — don't overwrite with an estimate.
      ...(existing && isRecurring ? {} : { costBasis }),
      monthlyContribution: isRecurring ? (monthlyAmt ?? null) : null,
      monthlyRent: group === "property" && usage === "rented" ? (rent ? Number(rent) : null) : null,
      rentTds: group === "property" && usage === "rented" ? (rentTds ? Number(rentTds) : null) : null,
      tenantName: group === "property" && usage === "rented" ? (tenantName.trim() || null) : null,
      ...(group === "property"
        ? { realEstate: {
              address, sqft: sqft ? Number(sqft) : null, undividedShare, ptin,
              carPark: re?.carPark ?? null, carParkSize: re?.carParkSize ?? null,
              propertyType: propertyType || null,
              bedrooms: bedrooms ? Number(bedrooms) : null,
              bathrooms: bathrooms ? Number(bathrooms) : null,
              floor: floor ? Number(floor) : null,
              builtYear: builtYear ? Number(builtYear) : null,
              city: city || null, locality: locality || null,
            } }
        : {}),
    };

    try {
      if (existing) {
        await api.updateAsset(existing.id, body);
      } else {
        const created = await api.createAsset(householdId, body);
        // Turn the acquisition story into a dated ledger so returns (XIRR) work.
        if (acqYear && (group === "property" || lumpish) && acqPrice) {
          await api.addContribution(created.id, { amount: acqPrice, on: `${acqYear}-01-01`, note: group === "property" || group === "lump" ? how : "invested" });
        } else if (isRecurring && monthlyAmt && sipStart) {
          await api.addSipSchedule(created.id, { amount: monthlyAmt, startOn: sipStart });
        }
      }
      onSaved();
    } catch (e: any) {
      setErr(e.message ?? "Could not save");
      setBusy(false);
    }
  }

  return (
    <Sheet title={existing ? "Edit asset" : "Add an asset"} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="row2">
          <div className="field">
            <label>What is it?</label>
            <select value={assetClass} onChange={(e) => changeClass(e.target.value as AssetClass)}>
              {CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Call it</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={group === "property" ? "Home (2BHK)" : "e.g. Nifty index fund"} autoFocus />
          </div>
        </div>

        {/* ---- PROPERTY ---- */}
        {group === "property" && (
          <>
            <p className="story">Tell the story: how you came to own it, and what it does for you.</p>
            <div className="row2">
              <div className="field">
                <label>How did you get it?</label>
                <select value={how} onChange={(e) => setHow(e.target.value)}>
                  {HOW.map((h) => <option key={h} value={h} style={{ textTransform: "capitalize" }}>{h}</option>)}
                </select>
              </div>
              <div className="field">
                <label>In which year?</label>
                <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder={String(thisYear - 8)} />
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label>{how === "inherited" || how === "gifted" ? "Value then (₹)" : "Price then (₹)"}</label>
                <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="6000000" />
              </div>
              <div className="field">
                <label>Worth today (₹)</label>
                <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="9000000" />
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label>Do you live in it or rent it?</label>
                <select value={usage} onChange={(e) => setUsage(e.target.value as any)}>
                  <option value="live_in">I live in it</option>
                  <option value="rented">I rent it out</option>
                </select>
              </div>
              {usage === "rented" && (
                <div className="field">
                  <label>Rent — gross (₹/month)</label>
                  <input inputMode="numeric" value={rent} onChange={(e) => setRent(e.target.value)} placeholder="28000" />
                </div>
              )}
            </div>
            {usage === "rented" && (
              <div className="row2">
                <div className="field">
                  <label>TDS on rent (₹/month)</label>
                  <input inputMode="numeric" value={rentTds} onChange={(e) => setRentTds(e.target.value)} placeholder="tax withheld" />
                </div>
                <div className="field">
                  <label>Tenant name</label>
                  <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="for rent receipts" />
                  <div className="hint">Net rent {rent ? inr(Number(rent) - (rentTds ? Number(rentTds) : 0)) : "—"}/mo · drives income & DSCR</div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ---- RECURRING (SIP/RD/PPF/EPF/NPS + mutual funds) ---- */}
        {group === "recurring" && (
          <>
            {assetClass === "mutual_fund" && (
              <div className="subtabs" style={{ margin: "0 0 12px" }}>
                <button type="button" className={`subtab ${mfMode === "monthly" ? "active" : ""}`} onClick={() => setMfMode("monthly")}>Monthly (SIP)</button>
                <button type="button" className={`subtab ${mfMode === "lump" ? "active" : ""}`} onClick={() => setMfMode("lump")}>One-time (lump sum)</button>
              </div>
            )}
            {mfLump ? (
              <>
                <p className="story">A one-time investment.</p>
                <div className="row2">
                  <div className="field"><label>Amount invested (₹)</label><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="200000" /></div>
                  <div className="field"><label>In which year?</label><input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder={String(thisYear - 3)} /></div>
                </div>
                <div className="field">
                  <label>Worth today (₹)</label>
                  <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="320000" />
                </div>
              </>
            ) : (
              <>
                <p className="story">You've been building this up over time.</p>
                <div className="row2">
                  <div className="field">
                    <label>Investing per month (₹)</label>
                    <input inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="15000" />
                  </div>
                  <div className="field">
                    <label>First installment on</label>
                    <input type="date" value={sipStart} onChange={(e) => setSipStart(e.target.value)} disabled={!!existing} />
                    <div className="hint">{existing ? "From your ledger — adjust the money-in/out entries below to change history." : "The debit day matters — each installment buys at that day's NAV."}</div>
                  </div>
                </div>
                <div className="field">
                  <label>Worth today (₹) <span className="muted" style={{ fontWeight: 400 }}>· optional if you link the fund</span></label>
                  <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="700000" />
                  <div className="hint">We build every monthly installment from your start date — past AND future months are added automatically. Link the fund after saving and the value computes itself from NAV.</div>
                </div>
              </>
            )}
          </>
        )}

        {/* ---- DEPOSIT (FD/bonds) — opened, not inherited ---- */}
        {group === "deposit" && (
          <>
            <p className="story">A deposit you opened.</p>
            <div className="row2">
              <div className="field"><label>Amount deposited (₹)</label><input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="500000" /></div>
              <div className="field"><label>Opened in year</label><input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder={String(thisYear - 2)} /></div>
            </div>
            <div className="field">
              <label>Worth today (₹)</label>
              <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="540000" />
              <div className="hint">Principal plus any interest accrued so far.</div>
            </div>
          </>
        )}

        {/* ---- LUMP (equity/gold/bonds/fd) ---- */}
        {group === "lump" && (
          <>
            <p className="story">How you acquired it, and what it's worth now.</p>
            <div className="row2">
              <div className="field">
                <label>How did you get it?</label>
                <select value={how} onChange={(e) => setHow(e.target.value)}>
                  {HOW.filter((h) => h !== "built").map((h) => <option key={h} value={h} style={{ textTransform: "capitalize" }}>{h}</option>)}
                </select>
              </div>
              <div className="field">
                <label>In which year?</label>
                <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder={String(thisYear - 5)} />
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label>{how === "inherited" || how === "gifted" ? "Value then (₹)" : "Cost then (₹)"}</label>
                <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="300000" />
              </div>
              <div className="field">
                <label>Worth today (₹)</label>
                <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="500000" />
              </div>
            </div>
          </>
        )}

        {/* ---- CASH ---- */}
        {group === "cash" && (
          <div className="field">
            <label>Balance (₹)</label>
            <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="400000" />
          </div>
        )}

        {/* ---- OTHER / INSURANCE ---- */}
        {group === "other" && (
          <div className="field">
            <label>Current value (₹)</label>
            <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="200000" />
          </div>
        )}

        <div className="field" style={{ marginTop: 4 }}>
          <label className="checkbox">
            <input type="checkbox" checked={liquid} onChange={(e) => setLiquid(e.target.checked)} />
            I could reach this cash within a week (counts toward emergency runway)
          </label>
        </div>

        {members && members.length > 0 && (
          <div className="field">
            <label>Whose is it?</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              <option value="">Household / joint</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}

        {group === "property" && (
          <div>
            <button type="button" className="btn ghost small" onClick={() => setShowProp((s) => !s)} style={{ padding: "4px 0" }}>
              {showProp ? "− Hide property details" : "+ Property details (address, PTIN…)"}
            </button>
            {showProp && (
              <>
                <div className="field"><label>Address</label><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Flat / street / city" /></div>
                <div className="row2">
                  <div className="field"><label>Area (sq ft)</label><input inputMode="numeric" value={sqft} onChange={(e) => setSqft(e.target.value)} placeholder="1450" /></div>
                  <div className="field"><label>PTIN</label><input value={ptin} onChange={(e) => setPtin(e.target.value)} placeholder="Property tax ID" /></div>
                </div>
                <div className="field"><label>Undivided share</label><input value={undividedShare} onChange={(e) => setUndividedShare(e.target.value)} placeholder="3.2%" /></div>
                <div className="row2">
                  <div className="field"><label>City</label><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Hyderabad" /></div>
                  <div className="field"><label>Locality / area</label><input value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="Kukatpally" /></div>
                </div>
                <div className="row2">
                  <div className="field">
                    <label>Type</label>
                    <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                      <option value="">—</option>
                      <optgroup label="Residential">
                        <option value="apartment">Apartment</option>
                        <option value="independent">Independent house</option>
                        <option value="villa">Villa</option>
                        <option value="plot">Plot / land</option>
                        <option value="multi-unit rental building">Multi-unit rental building</option>
                      </optgroup>
                      <optgroup label="Commercial">
                        <option value="office space">Office space</option>
                        <option value="retail shop / showroom">Retail shop / showroom</option>
                        <option value="commercial building (rented)">Commercial building (rented)</option>
                        <option value="warehouse / industrial">Warehouse / industrial</option>
                      </optgroup>
                      <optgroup label="Other">
                        <option value="agricultural land / farm">Agricultural land / farm</option>
                      </optgroup>
                      {propertyType && !["apartment","independent","villa","plot","multi-unit rental building","office space","retail shop / showroom","commercial building (rented)","warehouse / industrial","agricultural land / farm"].includes(propertyType) && (
                        <option value={propertyType}>{propertyType}</option>
                      )}
                    </select>
                  </div>
                  <div className="field"><label>Built year</label><input inputMode="numeric" value={builtYear} onChange={(e) => setBuiltYear(e.target.value)} placeholder="2012" /></div>
                </div>
                <div className="row2">
                  <div className="field"><label>Bedrooms</label><input inputMode="numeric" value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} placeholder="3" /></div>
                  <div className="field"><label>Bathrooms · floor</label><div style={{ display: "flex", gap: 8 }}><input inputMode="numeric" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} placeholder="baths" /><input inputMode="numeric" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="floor" /></div></div>
                </div>
                <div className="hint">City, locality, type and size power the AI value estimate on the property's page.</div>
              </>
            )}
          </div>
        )}

        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : existing ? "Save" : "Add it"}</button>
          <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>

      {existing && (existing.assetClass === "mutual_fund" || existing.assetClass === "sip") && <FundPicker assetId={existing.id} onValued={() => { onChanged?.(); }} />}
      {existing && hasPhotos(existing.assetClass) && <PhotoGallery assetId={existing.id} />}
      {existing && <ValueHistory assetId={existing.id} onChanged={() => { onChanged?.(); }} />}
      {existing && <ContributionLedger assetId={existing.id} onChanged={() => { onChanged?.(); }} />}
      {!existing && <p className="hint" style={{ marginTop: 14 }}>Save the asset first, then re-open it to add photos, value history and a money-in/out ledger.</p>}
    </Sheet>
  );
}

// ---- photos — edit mode ---------------------------------------------------
export function PhotoGallery({ assetId }: { assetId: string }) {
  const [photos, setPhotos] = useState<AssetPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () => api.listAssetPhotos(assetId).then(setPhotos).catch(() => {});
  useEffect(() => { load(); }, [assetId]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true); setErr(null);
    try {
      for (const f of files) {
        const dataUrl = await fileToPhoto(f);
        await api.addAssetPhoto(assetId, { dataUrl });
      }
      load();
    } catch (e: any) { setErr(e.message ?? "Could not upload"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }
  async function remove(id: string) { await api.deleteAssetPhoto(id); load(); }

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div className="story-sec">Photos</div>
      <div className="photo-grid">
        {photos.map((p) => (
          <div key={p.id} className="photo-cell">
            <img src={p.dataUrl} alt={p.caption ?? ""} />
            <button className="photo-del" type="button" title="Remove" onClick={() => remove(p.id)}>✕</button>
          </div>
        ))}
        <button type="button" className="photo-add" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "+ Add photo"}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={onPick} />
      {err && <div className="err" style={{ marginTop: 6 }}>{err}</div>}
      {photos.length === 0 && !busy && <div className="hint" style={{ marginTop: 6 }}>Add pictures of the property, documents or receipts. Images are shrunk before upload.</div>}
    </div>
  );
}

// ---- Value history (dated valuations) — edit mode --------------------------
export function ValueHistory({ assetId, onChanged }: { assetId: string; onChanged: () => void }) {
  const [valuations, setValuations] = useState<Valuation[]>([]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.listValuations(assetId).then(setValuations).catch(() => {});
  useEffect(() => { load(); }, [assetId]);

  async function add() {
    if (!amount || !date) return;
    setBusy(true);
    try { await api.addValuation(assetId, { value: Number(amount), asOf: date }); setAmount(""); setDate(""); load(); onChanged(); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { await api.deleteValuation(id); load(); onChanged(); }

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div className="story-sec">Value history</div>
      <div className="row2">
        <div className="field" style={{ marginBottom: 6 }}><label>New value (₹)</label><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="550000" /></div>
        <div className="field" style={{ marginBottom: 6 }}><label>As of</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="actions" style={{ marginBottom: 8 }}><button className="btn small" type="button" onClick={add} disabled={busy || !amount || !date}>Record value</button></div>
      {valuations.length === 0 && <div className="hint">The latest recorded value becomes the current value.</div>}
      {valuations.map((v) => (
        <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
          <span className="tnum">{inr(v.value)}</span>
          <span className="muted" style={{ fontSize: 12 }}>{v.asOf}{v.source ? ` · ${v.source}` : ""}</span>
          <button className="btn ghost small danger" type="button" onClick={() => remove(v.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ---- Contribution ledger (drives XIRR) — edit mode ------------------------
export function ContributionLedger({ assetId, onChanged }: { assetId: string; onChanged: () => void }) {
  const [contribs, setContribs] = useState<Contribution[]>([]);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.listContributions(assetId).then(setContribs).catch(() => {});
  useEffect(() => { load(); }, [assetId]);

  async function add() {
    if (!amount || !date) return;
    setBusy(true);
    try { await api.addContribution(assetId, { amount: Number(amount), on: date }); setAmount(""); setDate(""); load(); onChanged(); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { await api.deleteContribution(id); load(); onChanged(); }

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div className="story-sec">Money in / out (for XIRR)</div>
      <div className="row2">
        <div className="field" style={{ marginBottom: 6 }}><label>Amount (₹)</label><input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100000 (− to withdraw)" /></div>
        <div className="field" style={{ marginBottom: 6 }}><label>On</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="actions" style={{ marginBottom: 8 }}><button className="btn small" type="button" onClick={add} disabled={busy || !amount || !date}>Add</button></div>
      {contribs.length === 0 && <div className="hint">Your acquisition / SIP shows up here.</div>}
      {contribs.length > 0 && <div className="hint" style={{ marginBottom: 4 }}>{contribs.length} entr{contribs.length === 1 ? "y" : "ies"}</div>}
      {contribs.slice(0, 6).map((c) => (
        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
          <span className="tnum" style={{ color: c.amount < 0 ? "var(--good)" : "var(--ink)" }}>{c.amount < 0 ? "−" : ""}{inr(Math.abs(c.amount))}</span>
          <span className="muted" style={{ fontSize: 12 }}>{c.on}{c.note ? ` · ${c.note}` : ""}</span>
          <button className="btn ghost small danger" type="button" onClick={() => remove(c.id)}>✕</button>
        </div>
      ))}
      {contribs.length > 6 && <div className="hint" style={{ marginTop: 4 }}>…and {contribs.length - 6} more</div>}
    </div>
  );
}
