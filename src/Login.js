import React from 'react';
import { useAuth } from './AuthContext';
import './Login.css';

function Login() {
  const { signInWithGoogle, error } = useAuth();

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Flood Center v2</h1>
        <p>Please sign in to access the dashboard</p>
        <button type="button" onClick={signInWithGoogle} className="google-signin-button">
          <img
            src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
            alt="Google logo"
            className="google-logo"
          />
          Sign in with Google
        </button>
        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}

export default Login;
