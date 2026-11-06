"use client";

import { useEffect, useState } from "react";
import type { PhilippineAddress } from "@/lib/address/philippine-address";

interface Location {
  code: string;
  name: string;
  type?: string;
}

const METRO_MANILA = { code: "1300000000", name: "Metro Manila (NCR)" };
// Public PSGC endpoints: https://psgc.cloud/api-docs
async function loadLocations(path: string, signal: AbortSignal): Promise<Location[]> {
  const response = await fetch(`https://psgc.cloud/api/${path}`, { signal });
  if (!response.ok) throw new Error("Unable to load locations.");
  const data: unknown = await response.json();
  if (!Array.isArray(data) || !data.length || !data.every(item =>
    item && typeof item.code === "string" && typeof item.name === "string"
  )) throw new Error("Unable to load locations.");
  return (data as Location[])
    .filter(item => item.type !== "SubMun")
    .map(item => ({ ...item, name: item.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function PhilippineAddressFields({ value, onChange }: {
  value: PhilippineAddress;
  onChange: (value: PhilippineAddress) => void;
}) {
  const [provinces, setProvinces] = useState<Location[]>([]);
  const [cities, setCities] = useState<Location[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);
  const [provinceError, setProvinceError] = useState(false);
  const [cityError, setCityError] = useState(false);
  const [provinceAttempt, setProvinceAttempt] = useState(0);
  const [cityAttempt, setCityAttempt] = useState(0);
  const provinceCode = provinces.find(province => province.name === value.province)?.code;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    async function load() {
      setLoadingProvinces(true);
      setProvinceError(false);
      try {
        const locations = await loadLocations("provinces", controller.signal);
        if (active) setProvinces([...locations, METRO_MANILA].sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (active) setProvinceError(true);
      } finally {
        clearTimeout(timeout);
        if (active) setLoadingProvinces(false);
      }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [provinceAttempt]);

  useEffect(() => {
    if (!provinceCode) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    async function load() {
      setLoadingCities(true);
      setCityError(false);
      setCities([]);
      try {
        const parent = provinceCode === METRO_MANILA.code ? "regions" : "provinces";
        const locations = await loadLocations(`${parent}/${provinceCode}/cities-municipalities`, controller.signal);
        if (active) setCities(locations);
      } catch {
        if (active) setCityError(true);
      } finally {
        clearTimeout(timeout);
        if (active) setLoadingCities(false);
      }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [provinceCode, cityAttempt]);

  const fieldClass = "w-full px-4 py-3 border border-neutral/20 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-neutral/5 disabled:opacity-60";
  return <fieldset className="space-y-4">
    <legend className="mb-2 text-sm font-medium text-neutral">Address *</legend>
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label htmlFor="province" className="mb-2 block text-sm font-medium text-neutral">Province*</label>
        <select id="province" name="province" autoComplete="address-level1" required value={value.province}
          disabled={loadingProvinces || provinceError} aria-busy={loadingProvinces}
          onChange={event => {
            setCities([]);
            setLoadingCities(false);
            setCityError(false);
            onChange({ ...value, province: event.target.value, city: "" });
          }} className={fieldClass}>
          <option value="">{loadingProvinces ? "Loading provinces..." : "Select province"}</option>
          {provinces.map(province => <option key={province.code} value={province.name}>{province.name}</option>)}
        </select>
        {provinceError && <p role="alert" className="mt-2 text-sm text-red-700">Unable to load provinces. <button type="button" className="font-semibold underline" onClick={() => setProvinceAttempt(attempt => attempt + 1)}>Try again</button></p>}
      </div>
      <div>
        <label htmlFor="city" className="mb-2 block text-sm font-medium text-neutral">City / Municipality *</label>
        <select id="city" name="city" autoComplete="address-level2" required value={value.city}
          disabled={!provinceCode || loadingCities || cityError || !cities.length} aria-busy={loadingCities}
          onChange={event => onChange({ ...value, city: event.target.value })} className={fieldClass}>
          <option value="">{loadingCities ? "Loading cities / municipalities..." : "Select city / municipality"}</option>
          {cities.map(city => <option key={city.code} value={city.name}>{city.name}</option>)}
        </select>
        {cityError && <p role="alert" className="mt-2 text-sm text-red-700">Unable to load cities / municipalities. <button type="button" className="font-semibold underline" onClick={() => setCityAttempt(attempt => attempt + 1)}>Try again</button></p>}
      </div>
    </div>
    <div>
      <label htmlFor="streetAddress" className="mb-2 block text-sm font-medium text-neutral">Street Address *</label>
      <input id="streetAddress" name="streetAddress" type="text" autoComplete="street-address" required maxLength={200}
        value={value.streetAddress} onChange={event => onChange({ ...value, streetAddress: event.target.value })}
        className={fieldClass} placeholder="House / unit number, street, subdivision, barangay" />
    </div>
    <div>
      <label htmlFor="zipCode" className="mb-2 block text-sm font-medium text-neutral">ZIP Code *</label>
      <input id="zipCode" name="zipCode" type="text" inputMode="numeric" autoComplete="postal-code"
        required minLength={4} maxLength={4} pattern="[0-9]{4}" title="Enter a four-digit ZIP code."
        value={value.zipCode} onChange={event => onChange({ ...value, zipCode: event.target.value.replace(/\D/g, "").slice(0, 4) })}
        className={fieldClass} placeholder="4-digit ZIP code" />
    </div>
  </fieldset>;
}
