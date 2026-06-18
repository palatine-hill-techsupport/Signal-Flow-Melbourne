import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import type { groupBySite } from "./utils";
import { formatNumber, lookupSourceLabel } from "./utils";

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
  return (
    <div className="map-shell">
      <MapContainer center={[-37.8136, 144.9631]} zoom={10} scrollWheelZoom={false} className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {mapped.slice(0, 900).map((site) => (
          <CircleMarker
            key={site.siteId}
            center={[Number(site.latitude), Number(site.longitude)]}
            radius={Math.max(5, Math.sqrt(site.totalVolume / maxVolume) * 18)}
            pathOptions={{ color: "#167f87", fillColor: "#16a085", fillOpacity: 0.45, weight: 1 }}
          >
            <Popup>
              <strong>{site.displayName}</strong>
              <br />
              Region: {site.region}
              <br />
              Volume: {formatNumber(site.totalVolume)}
              <br />
              Lookup: {lookupSourceLabel(site.lookupSource)}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

export default SiteMap;
