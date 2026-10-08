import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GoogleMap, useJsApiLoader } from '@react-google-maps/api';
import { subscribeLatestLevels } from './sensorData';
import { formatWater } from './units';

const containerStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '0',
};

const DEBUG = process.env.REACT_APP_DEBUG_MODE === 'true';

const debugLog = (...args) => {
  if (DEBUG) console.log('[SensorMap]', ...args);
};

const defaultCenter = {
  lat: parseFloat(process.env.REACT_APP_DEFAULT_MAP_LAT || '37.715323'),
  lng: parseFloat(process.env.REACT_APP_DEFAULT_MAP_LNG || '-122.493728'),
};

const libraries = ['marker', 'maps'];

const mapOptions = {
  // Advanced markers need a *vector* Map ID from Google Cloud Map Management.
  mapId: (process.env.REACT_APP_GOOGLE_MAPS_ID || 'DEMO_MAP_ID').replace(/^\uFEFF/, '').trim(),
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: true,
  scaleControl: true,
  mapTypeControl: true,
  fullscreenControl: true,
};

const COLORS = {
  green: '#4CAF50',
  yellow: '#FFC107',
  red: '#F44336',
  unknown: '#9E9E9E',
};

// A marker coloured by a reading this old would hide a flood that started since.
const STALE_MS = 6 * 60 * 60 * 1000;

const markerStatus = (sensor, latest, unitSystem) => {
  if (!latest) {
    return { color: COLORS.unknown, label: '?', title: `Sensor ${sensor.id}: no readings yet` };
  }
  const label = formatWater(latest.levelMm, unitSystem, unitSystem === 'us' ? 1 : 2);
  const at = latest.atMs != null ? new Date(latest.atMs).toLocaleString() : 'unknown time';
  if (latest.atMs == null || Date.now() - latest.atMs > STALE_MS) {
    return { color: COLORS.unknown, label, title: `Sensor ${sensor.id}: ${label}, no reading since ${at}` };
  }
  let color = COLORS.green;
  if (sensor.redMm > 0 && latest.levelMm >= sensor.redMm) color = COLORS.red;
  else if (sensor.yellowMm > 0 && latest.levelMm >= sensor.yellowMm) color = COLORS.yellow;
  return { color, label, title: `Sensor ${sensor.id}: ${label} at ${at}` };
};

const createMarkerElement = () => {
  const el = document.createElement('div');
  Object.assign(el.style, {
    minWidth: '40px',
    height: '40px',
    padding: '0 4px',
    borderRadius: '20px',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 'bold',
    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    border: '2px solid #ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  return el;
};

const SensorMap = ({ sensors, unitSystem, onSensorSelect }) => {
  const [map, setMap] = useState(null);
  const [latestByDevice, setLatestByDevice] = useState({});
  const [dataError, setDataError] = useState(null);
  const markersRef = useRef(new Map());
  const paintRef = useRef(() => {});
  const onSelectRef = useRef(onSensorSelect);

  // Trim BOM/whitespace — PowerShell/UTF-8 env files sometimes prefix U+FEFF.
  const mapsApiKey = (process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '').replace(/^\uFEFF/, '').trim();
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: mapsApiKey,
    libraries,
  });

  useEffect(() => {
    onSelectRef.current = onSensorSelect;
  }, [onSensorSelect]);

  useEffect(() => subscribeLatestLevels(
    (byDevice) => {
      debugLog('waterLevel_latest update', byDevice);
      setDataError(null);
      setLatestByDevice(byDevice);
    },
    (err) => {
      console.error('[SensorMap] waterLevel_latest:', err);
      setDataError('Live water levels are unavailable. Marker colours may be out of date.');
    }
  ), []);

  useEffect(() => {
    paintRef.current = () => {
      markersRef.current.forEach(({ element, marker, sensor }) => {
        const { color, label, title } = markerStatus(sensor, latestByDevice[sensor.id], unitSystem);
        element.style.backgroundColor = color;
        element.textContent = label;
        marker.title = title;
      });
    };
    paintRef.current();
  }, [latestByDevice, unitSystem]);

  useEffect(() => {
    if (!map || !isLoaded) return undefined;
    let cancelled = false;
    const markers = markersRef.current;

    const createMarkers = async () => {
      const { AdvancedMarkerElement } = await window.google.maps.importLibrary('marker');
      if (cancelled) return;
      sensors
        .filter((s) => s.latitude != null && s.longitude != null)
        .forEach((sensor) => {
          const element = createMarkerElement();
          element.addEventListener('click', () => onSelectRef.current(sensor.id));
          const marker = new AdvancedMarkerElement({
            map,
            position: { lat: sensor.latitude, lng: sensor.longitude },
            content: element,
            title: `Sensor ${sensor.id}`,
          });
          markers.set(sensor.id, { marker, element, sensor });
        });
      paintRef.current();
      debugLog(`Created ${markers.size} markers`);
    };

    createMarkers().catch((err) => {
      console.error('[SensorMap] markers:', err);
      setDataError('Failed to create map markers. Please try refreshing the page.');
    });

    return () => {
      cancelled = true;
      markers.forEach(({ marker }) => {
        marker.map = null;
      });
      markers.clear();
    };
  }, [map, isLoaded, sensors]);

  const onLoad = useCallback((loadedMap) => setMap(loadedMap), []);
  const onUnmount = useCallback(() => setMap(null), []);

  if (loadError) {
    return (
      <div className="error-message">
        Failed to load Google Maps. Please check REACT_APP_GOOGLE_MAPS_API_KEY.
      </div>
    );
  }

  if (!isLoaded) return <div className="map-status">Loading map...</div>;

  return (
    <>
      {dataError && <div className="error-message map-error">{dataError}</div>}
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={defaultCenter}
        zoom={12}
        onLoad={onLoad}
        onUnmount={onUnmount}
        options={mapOptions}
      />
    </>
  );
};

export default SensorMap;
