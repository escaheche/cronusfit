/**
 * auth.js — Auth Guard + Cognito SDK wrapper
 * Admin Panel CronusFit
 *
 * Wrapper sobre amazon-cognito-identity-js (cargado desde CDN).
 * Gestiona el ciclo de vida del JWT en sessionStorage y la autenticación
 * contra el pool de Cognito configurado.
 */

const POOL_ID   = 'us-east-1_GOBIYDfqK';
const CLIENT_ID = '7gfgmp718hi797qd5e4m1pk5ae';

const AuthGuard = {
  /**
   * Devuelve el JWT almacenado si es válido (no expirado), o null.
   * Si el token está expirado, llama a clear('expired') y retorna null.
   * @returns {string|null} El JWT token o null
   */
  getToken() {
    const raw = sessionStorage.getItem('cf_jwt');
    if (!raw) return null;

    try {
      const { token, exp } = JSON.parse(raw);
      // Comparar timestamp actual (segundos) con exp del JWT
      if (Date.now() / 1000 >= exp) {
        this.clear('expired');
        return null;
      }
      return token;
    } catch {
      // JSON malformado — limpiar sesión silenciosamente
      sessionStorage.removeItem('cf_jwt');
      return null;
    }
  },

  /**
   * Verifica que haya un JWT válido. Si no, redirige a #login.
   * Debe llamarse al inicio de cada sección protegida.
   */
  check() {
    if (!this.getToken()) {
      location.hash = '#login';
    }
  },

  /**
   * Limpia la sesión, opcionalmente muestra un Toast, y redirige a #login.
   * @param {string} [reason='logout'] — 'expired' muestra Toast de advertencia
   */
  clear(reason = 'logout') {
    sessionStorage.removeItem('cf_jwt');
    if (reason === 'expired' && typeof Toast !== 'undefined') {
      Toast.warn('Sesión expirada. Por favor vuelve a iniciar sesión.');
    }
    location.hash = '#login';
  },

  /**
   * Autentica al usuario contra Cognito usando amazon-cognito-identity-js.
   * En caso de éxito, almacena { token, exp } en sessionStorage como 'cf_jwt'.
   * En caso de fallo, lanza el error para que el caller lo maneje.
   *
   * @param {string} username
   * @param {string} password
   * @returns {Promise<void>}
   */
  login(username, password) {
    return new Promise((resolve, reject) => {
      const { CognitoUserPool, CognitoUser, AuthenticationDetails } =
        window.AmazonCognitoIdentity;

      const userPool = new CognitoUserPool({
        UserPoolId: POOL_ID,
        ClientId:   CLIENT_ID,
      });

      const cognitoUser = new CognitoUser({
        Username: username,
        Pool:     userPool,
      });

      const authDetails = new AuthenticationDetails({
        Username: username,
        Password: password,
      });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess(result) {
          const jwtToken = result.getIdToken().getJwtToken();

          // Decodificar el payload del JWT para extraer exp
          // El JWT tiene la forma: header.payload.signature (base64url)
          const payloadB64 = jwtToken.split('.')[1];
          // base64url → base64 estándar
          const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
          const jsonPayload = atob(padded);
          const { exp } = JSON.parse(jsonPayload);

          // Guardar sesión en sessionStorage
          const sessionData = JSON.stringify({ token: jwtToken, exp });
          sessionStorage.setItem('cf_jwt', sessionData);

          resolve();
        },

        onFailure(err) {
          reject(err);
        },

        // Manejar el caso de nueva contraseña requerida (primer login)
        newPasswordRequired(_userAttributes, _requiredAttributes) {
          reject(new Error('Se requiere cambiar la contraseña. Contáctate con el administrador.'));
        },
      });
    });
  },
};

// Exportar como global para que todos los módulos puedan acceder a AuthGuard
window.AuthGuard = AuthGuard;
