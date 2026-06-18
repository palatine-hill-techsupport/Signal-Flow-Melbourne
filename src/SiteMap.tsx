import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import type { groupBySite } from "./utils";
import { formatNumber, lookupSourceLabel } from "./utils";

type MapSite = ReturnType<typeof groupBySite>[number];

const alarmColours = {
  none: "#168d82",
  low: "#2f80ed",
  medium: "#d99016",
  high: "#d46438",
  severe: "#c94f4f",
};

function quantile(values: number[], position: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function makeAlarmBreaks(sites: MapSite[]) {
  const alarmValues = sites.map((site) => site.alarmCount).filter((value) => value > 0);
  return {
    low: Math.max(1, Math.round(quantile(alarmValues, 0.5))),
    medium: Math.max(1, Math.round(quantile(alarmValues, 0.75))),
    high: Math.max(1, Math.round(quantile(alarmValues, 0.9))),
  };
}

function alarmStyle(alarmCount: number, breaks: ReturnType<typeof makeAlarmBreaks>) {
  if (alarmCount <= 0) return { label: "No alarms", colour: alarmColours.none };
  if (alarmCount <= breaks.low) return { label: "Low alarm count", colour: alarmColours.low };
  if (alarmCount <= breaks.medium) return { label: "Elevated alarm count", colour: alarmColours.medium };
  if (alarmCount <= breaks.high) return { label: "High alarm count", colour: alarmColours.high };
  return { label: "Very high alarm count", colour: alarmColours.severe };
}

function SiteMap({ sites }: { sites: ReturnType<typeof groupBySite> }) {
  const mapped = sites.filter((site) => Number.isFinite(site.latitude) && Number.isFinite(site.longitude));
  if (!mapped.length) {
    return (
      <div className="empty-state">
        <span>No mapped sites are available for the current filters.</span>
      </div>
    );
  }

  const maxVolume = Math.max(...mapped.map((site) => site.totalVolume), 1);
  const breaks = makeAlarmBreaks(mapped);
  const visibleSites = mapped
    .slice(0, 900)
    .sort((a, b) => a.totalVolume - b.totalVolume || a.alarmCount - b.alarmCount);

  return (
    <div className="map-shell">
      <MapContainer center={[-37.8136, 144.9631]} zoom={10} scrollWheelZoom={false} className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {visibleSites.map((site) => {
          const alarm = alarmStyle(site.alarmCount, breaks);
          const radius = Math.max(5, 4 + Math.sqrt(site.totalVolume / maxVolume) * 18);
          return (
            <CircleMarker
              key={site.siteId}
              center={[Number(site.latitude), Number(site.longitude)]}
              radius={radius}
              pathOptions={{
                color: alarm.colour,
                fillColor: alarm.colour,
                fillOpacity: site.alarmCount > 0 ? 0.68 : 0.48,
                opacity: 0.95,
                weight: site.alarmCount > breaks.high ? 3 : site.alarmCount > 0 ? 2 : 1,
              }}
            >
              <Popup>
                <strong>{site.displayName}</strong>
                <br />
                Region: {site.region}
                <br />
                Total 24-hour volume: {formatNumber(site.totalVolume)}
                <br />
                Alarm count: {formatNumber(site.alarmCount)} ({alarm.label})
                <br />
                Rows: {formatNumber(site.rowCount)}
                <br />
                Lookup: {lookupSourceLabel(site.lookupSource)}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="map-legend" aria-label="Site map legend">
        <div className="map-legend-block">
          <strong>Marker size</strong>
          <span>Total 24-hour volume</span>
          <div className="size-scale" aria-hidden="true">
            <span className="size-dot size-dot-small" />
            <span className="size-dot size-dot-medium" />
            <span className="size-dot size-dot-large" />
          </div>
        </div>
        <div className="map-legend-block">
          <strong>Marker colour</strong>
          <span>Alarm count in current filters</span>
          <div className="colour-scale">
            <span>
              <i style={{ background: alarmColours.none }} />
              None
            </span>
            <span>
              <i style={{ background: alarmColours.low }} />
              1-{formatNumber(breaks.low)}
            </span>
            <span>
              <i style={{ background: alarmColours.medium }} />
              {formatNumber(breaks.low + 1)}-{formatNumber(breaks.medium)}
            </span>
            <span>
              <i style={{ background: alarmColours.high }} />
              {formatNumber(breaks.medium + 1)}-{formatNumber(breaks.high)}
            </span>
            <span>
              <i style={{ background: alarmColours.severe }} />
              {formatNumber(breaks.high + 1)}+
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SiteMap;
