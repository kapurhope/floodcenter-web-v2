import React, { useCallback, useEffect, useState } from 'react';
import './App.css';
import './Dashboard.css';
import { AuthProvider, useAuth } from './AuthContext';
import { firebaseConfigError } from './firebase';
import Login from './Login';
import SensorDashboard from './SensorDashboard';
import SensorMap from './SensorMap';
import { fetchSensorLocations } from './sensorData';
import { loadUnitSystem, saveUnitSystem } from './units';

const REQUIRE_LOGIN = process.env.REACT_APP_REQUIRE_LOGIN === 'true';

const Header = ({ user, onLogout }) => (
  <header className="app-header">
    <h1>Flood Center v2</h1>
    {user && (
      <div className="user-info">
        <span>{user.displayName || user.email}</span>
        <button type="button" className="logout-button" onClick={onLogout}>Sign out</button>
      </div>
    )}
  </header>
);

const FloodCenter = ({ user, onLogout }) => {
  const [sensors, setSensors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [unitSystem, setUnitSystem] = useState(loadUnitSystem);

  useEffect(() => {
    let cancelled = false;
    fetchSensorLocations()
      .then((list) => {
        if (!cancelled) setSensors(list);
      })
      .catch((err) => {
        console.error('[App] sensor_locations:', err);
        if (!cancelled) setError(`Could not load sensors: ${err.message || err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeUnitSystem = useCallback((system) => {
    setUnitSystem(system);
    saveUnitSystem(system);
  }, []);

  const closeDashboard = useCallback(() => setSelectedId(null), []);

  const selectedSensor = sensors.find((s) => s.id === selectedId);

  return (
    <div className="app-container">
      <Header user={user} onLogout={onLogout} />
      {error && <div className="error-message app-error">{error}</div>}
      <div className="dashboard-container">
        <div className="map-container">
          {loading ? (
            <div className="map-status">Loading sensors...</div>
          ) : (
            <SensorMap sensors={sensors} unitSystem={unitSystem} onSensorSelect={setSelectedId} />
          )}
        </div>
      </div>
      {selectedId && (
        <SensorDashboard
          key={selectedId}
          deviceId={selectedId}
          sensor={selectedSensor}
          unitSystem={unitSystem}
          onUnitSystemChange={changeUnitSystem}
          onClose={closeDashboard}
        />
      )}
    </div>
  );
};

const AuthGate = () => {
  const { user, logout } = useAuth();
  return user ? <FloodCenter user={user} onLogout={logout} /> : <Login />;
};

const App = () => {
  if (firebaseConfigError) {
    return (
      <div className="app-container">
        <Header />
        <div className="error-message app-error">{firebaseConfigError}</div>
      </div>
    );
  }
  if (REQUIRE_LOGIN) {
    return (
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    );
  }
  return <FloodCenter />;
};

export default App;
