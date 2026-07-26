# Design Document — Admin Panel CronusFit

## Overview

El Admin Panel es una SPA estática (Vanilla JS ES2022 + TailwindCSS) desplegada en `/admin/` del bucket S3/CloudFront existente. No añade infraestructura nueva: todo el cómputo ocurre en el navegador del administrador o delega a la API Gateway y Cognito ya existentes. La identidad visual es idéntica al sitio de exhibición (brand-blue `#1e3a5f`, brand-gold `#c9a84c`, Inter).

---

## Architecture Overview

```
Browser (Admin)
│
├── /admin/index.html            ← Único punto de entrada (SPA shell)
│   ├── admin/css/admin.css      ← TailwindCSS compilado (extiende tailwind.config.cjs)
│   └── admin/js/
│       ├── app.js               ← Bootstrap, event bus, init
│       ├── router.js            ← Hash Router (client-side)
│       ├── auth.js              ← Auth Guard + Cognito SDK wrapper
│       ├── api.js               ← HTTP client (fetch wrapper con JWT)
│       ├── toast.js             ← Toast Notification component
│       ├── modal.js             ← Modal component
│       ├── sidebar.js           ← Sidebar / nav component
│       ├── network.js           ← Connectivity monitor
│       └── sections/
│           ├── login.js         ← Login View
│           ├── patrones.js      ← Sección Patrones
│           ├── cotizaciones.js  ← Sección Cotizaciones
│           ├── mockups.js       ← Sección Mockups
│           ├── aprobaciones.js  ← Sección Aprobaciones
│           ├── publicaciones.js ← Sección Publicaciones
│           └── redes.js         ← Sección Redes Sociales
│
├── AWS Cognito (us-east-1_GOBIYDfqK) ← Autenticación JWT
└── API Gateway (https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod)
    └── Endpoints existentes
```

---

## File Structure

```
/admin/                          ← Raíz del panel (S3 prefix)
├── index.html                   ← SPA shell (único HTML)
├── css/
│   └── admin.css                ← TailwindCSS build (purged)
└── js/
    ├── app.js
    ├── router.js
    ├── auth.js
    ├── api.js
    ├── toast.js
    ├── modal.js
    ├── sidebar.js
    ├── network.js
    └── sections/
        ├── login.js
        ├── patrones.js
        ├── cotizaciones.js
        ├── mockups.js
        ├── aprobaciones.js
        ├── publicaciones.js
        └── redes.js
```

La plantilla Tailwind reutiliza `tailwind.config.cjs` del sitio de exhibición — los tokens `brand-blue`, `brand-gold` y la fuente Inter son idénticos, sin duplicar la definición de paleta.

---

## SPA State Machine

```
[Initial Load]
      │
      ▼
[Auth Guard Check] ──── JWT ausente / expirado ───► [#login]
      │                                                  │
      │ JWT válido                              credenciales ok
      ▼                                                  │
[Hash Router]                                            ▼
      │                                         [sessionStorage.setItem(jwt)]
      ├──► #patrones       ◄────────────────────────────┘
      ├──► #cotizaciones
      ├──► #mockups
      ├──► #aprobaciones
      ├──► #publicaciones
      ├──► #redes
      └──► (desconocido) ──► redirect #patrones

[Cualquier sección] ──── API 401 ───► [Auth Guard] ──► [#login]
[Cualquier sección] ──── logout ────► [clear JWT]  ──► [#login]
[JWT timeout check] ──── exp < now ─► [clear JWT]  ──► [#login]
```

---

## Module Design

### `router.js` — Hash Router

Gestiona la navegación sin recarga. Escucha `hashchange` y `DOMContentLoaded`.

```js
// Rutas válidas → función de render
const ROUTES = {
  '#login':         () => LoginSection.render(),
  '#patrones':      () => PatronesSection.render(),
  '#cotizaciones':  () => CotizacionesSection.render(),
  '#mockups':       () => MockupsSection.render(),
  '#aprobaciones':  () => AprobacionesSection.render(),
  '#publicaciones': () => PublicacionesSection.render(),
  '#redes':         () => RedesSection.render(),
};

function navigate(hash) {
  const fn = ROUTES[hash] ?? ROUTES['#patrones'];
  if (hash !== '#login') AuthGuard.check(); // redirige si no hay JWT
  document.getElementById('app-content').innerHTML = '';
  fn();
  Sidebar.setActive(hash);
}

window.addEventListener('hashchange', () => navigate(location.hash));
```

**Invariante**: cualquier fragmento no listado en `ROUTES` redirige a `#patrones`.

---

### `auth.js` — Auth Guard + Cognito SDK

Wrapper sobre `amazon-cognito-identity-js` (cargado desde CDN con SRI hash).

```js
const POOL_ID   = 'us-east-1_GOBIYDfqK';
const CLIENT_ID = '7gfgmp718hi797qd5e4m1pk5ae';

const AuthGuard = {
  /** Devuelve el JWT o null */
  getToken() {
    const raw = sessionStorage.getItem('cf_jwt');
    if (!raw) return null;
    try {
      const { token, exp } = JSON.parse(raw);
      if (Date.now() / 1000 >= exp) {
        this.clear('expired');
        return null;
      }
      return token;
    } catch { return null; }
  },

  /** Verifica JWT; si no hay, redirige a #login */
  check() {
    if (!this.getToken()) {
      location.hash = '#login';
    }
  },

  /** Limpia sesión y redirige */
  clear(reason = 'logout') {
    sessionStorage.removeItem('cf_jwt');
    if (reason === 'expired') Toast.warn('Sesión expirada. Por favor vuelve a iniciar sesión.');
    location.hash = '#login';
  },

  /** Login via Cognito SDK */
  async login(username, password) {
    // Usa CognitoUserPool + CognitoUser + AuthenticationDetails
    // Almacena { token, exp } en sessionStorage tras éxito
  }
};
```

**Flujo de autenticación Cognito:**
1. `new AmazonCognitoIdentity.CognitoUserPool({ UserPoolId, ClientId })`
2. `new CognitoUser({ Username, Pool })`
3. `user.authenticateUser(authDetails, callbacks)`
4. En `onSuccess`: extraer `idToken.jwtToken`, decodificar `exp`, guardar `{ token, exp }` en `sessionStorage`.
5. En `onFailure`: mostrar "Credenciales incorrectas" en el formulario.

---

### `api.js` — HTTP Client

Fetch wrapper que adjunta el JWT, interpreta errores HTTP y delega 401 al `AuthGuard`.

```js
const API_BASE = 'https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod';

const Api = {
  async request(method, path, body = null) {
    const token = AuthGuard.getToken();
    if (!token) { AuthGuard.clear(); return; }

    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${path}`, opts);

    if (res.status === 401) { AuthGuard.clear('expired'); return; }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message ?? res.statusText);
      err.status = res.status;
      console.error(`[API] ${method} ${path} → ${res.status} ${new Date().toISOString()}`);
      throw err;
    }
    return res.json();
  },

  get:    (path)       => Api.request('GET', path),
  post:   (path, body) => Api.request('POST', path, body),
  put:    (path, body) => Api.request('PUT', path, body),
  delete: (path)       => Api.request('DELETE', path),
};
```

**Nota de seguridad**: `console.error` nunca incluye el token; sólo URL, método, código y timestamp UTC ISO 8601.

---

### `toast.js` — Toast Notification Component

```js
const Toast = {
  _show(type, message, autoDismiss = true) {
    const el = document.createElement('div');
    el.setAttribute('role', 'alert');       // WCAG 2.1 AA
    el.setAttribute('aria-live', 'assertive');
    el.className = `toast toast-${type}`;   // estilos Tailwind
    el.textContent = message;
    document.getElementById('toast-container').appendChild(el);
    if (autoDismiss) setTimeout(() => el.remove(), 4000);
    return el;
  },
  success: (msg) => Toast._show('success', msg, true),
  error:   (msg) => Toast._show('error',   msg, false),  // persiste hasta cierre manual
  warn:    (msg) => Toast._show('warn',    msg, false),
};
```

Contenedor HTML fijo en `index.html`:
```html
<div id="toast-container"
     aria-live="polite"
     class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
</div>
```

---

### `modal.js` — Modal Component

Modal reutilizable para formularios de confirmación (rechazo de mockup, confirmación de publicación).

```js
const Modal = {
  open({ title, bodyHTML, onConfirm, confirmLabel = 'Confirmar', confirmDisabled = false }) {
    const el = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    document.getElementById('modal-confirm').textContent = confirmLabel;
    document.getElementById('modal-confirm').onclick = onConfirm;
    el.classList.remove('hidden');
    el.setAttribute('aria-modal', 'true');
    document.getElementById('modal-confirm').focus();
  },
  close() {
    document.getElementById('modal').classList.add('hidden');
  }
};
```

Estructura HTML del modal (en `index.html`, oculto por defecto):
```html
<div id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"
     class="hidden fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4">
    <h2 id="modal-title" class="text-brand-blue font-bold text-xl mb-4"></h2>
    <div id="modal-body" class="mb-6"></div>
    <div class="flex justify-end gap-3">
      <button onclick="Modal.close()"
              class="px-4 py-2 rounded-xl border-2 border-gray-200 text-gray-600 font-medium hover:border-brand-blue">
        Cancelar
      </button>
      <button id="modal-confirm"
              class="px-4 py-2 rounded-xl bg-brand-blue text-white font-semibold hover:bg-brand-blue-light">
        Confirmar
      </button>
    </div>
  </div>
</div>
```

---

### `sidebar.js` — Sidebar Navigation

Sidebar vertical para viewports ≥ 768 px; se colapsa a menú hamburguesa en móvil.

```js
const NAV_ITEMS = [
  { hash: '#patrones',      label: 'Patrones',      icon: 'scissors' },
  { hash: '#cotizaciones',  label: 'Cotizaciones',  icon: 'document' },
  { hash: '#mockups',       label: 'Mockups',        icon: 'photo' },
  { hash: '#aprobaciones',  label: 'Aprobaciones',   icon: 'check-circle', badge: true },
  { hash: '#publicaciones', label: 'Publicaciones',  icon: 'globe' },
  { hash: '#redes',         label: 'Redes Sociales', icon: 'share' },
];

const Sidebar = {
  setActive(hash) {
    document.querySelectorAll('[data-nav-hash]').forEach(el => {
      el.classList.toggle('nav-active', el.dataset.navHash === hash);
    });
  },
  updateBadge(hash, count) {
    const badge = document.querySelector(`[data-badge="${hash}"]`);
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    }
  }
};
```

El badge de `#aprobaciones` se actualiza cada vez que se carga la sección con el conteo de `pending_approval`.

---

### `network.js` — Connectivity Monitor

```js
const Network = {
  _online: navigator.onLine,
  _bannerId: 'network-banner',

  init() {
    window.addEventListener('online',  () => this._set(true));
    window.addEventListener('offline', () => this._set(false));
  },

  _set(online) {
    this._online = online;
    document.getElementById(this._bannerId).classList.toggle('hidden', online);
    // Rehabilita/deshabilita botones con data-requires-network
    document.querySelectorAll('[data-requires-network]').forEach(el => {
      el.disabled = !online;
    });
  },

  isOnline() { return this._online; }
};
```

Banner HTML en `index.html` (oculto por defecto):
```html
<div id="network-banner" role="alert"
     class="hidden fixed top-0 inset-x-0 z-50 bg-amber-500 text-white text-center py-2 text-sm font-medium">
  ⚠️ Sin conexión a internet — las acciones están deshabilitadas
</div>
```

---

### `sections/login.js` — Login View

```js
const LoginSection = {
  render() {
    // Inyecta formulario en #app-content
    // Campos: usuario (email), contraseña — con label asociado (WCAG)
    // En submit: AuthGuard.login(user, pass)
    //   éxito → router.navigate('#patrones')
    //   fallo → muestra "Credenciales incorrectas" en span#login-error
  }
};
```

**Accesibilidad**: cada `<input>` tiene `<label for="...">` asociado; el span de error tiene `role="alert"` y `aria-live="assertive"`. El foco visible se aplica con `focus:ring-4 focus:ring-brand-gold/40`.

---

### `sections/patrones.js` — Sección Patrones

Flujo de datos:
```
render() → Api.get('/patterns')
         → renderList(patterns.sort por createdAt desc)
         → "Nuevo patrón" → renderForm()
         → onSubmit(data) → Api.post('/patterns/generate', data) → Toast.success()
         → "Descargar PDF" → fetch(presignedUrl SVG) → jsPDF.fromSVG() → save()
```

Campos del formulario de creación: `garmentType`, `ageGroup`, `size`, medidas físicas (objeto `measurements`). Los errores de validación de la API se mapean al campo correspondiente por nombre.

Generación de PDF con jsPDF (sin Lambda):
```js
async function downloadPatternPDF(patternId, presignedUrl) {
  const svgText = await fetch(presignedUrl).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  await doc.svg(new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement,
                { x: 10, y: 10, width: 190, height: 277 });
  doc.save(`patron-${patternId}.pdf`);
}
```

---

### `sections/cotizaciones.js` — Sección Cotizaciones

Flujo de datos:
```
render() → Api.get('/quotes') → renderSummary(countsByStatus) + renderList(sorted desc)
filtro  → estado seleccionado → filtra lista en memoria (sin re-fetch)
detalle → click en fila → renderDetail(quote)
responder precio → Api.put('/quotes/:id', { price, status: 'quoted' }) → Toast.success()
```

Los contadores por estado (`pending`, `quoted`, `accepted`, `rejected`) se calculan en el cliente a partir de la lista completa. El filtro opera sobre el array local para evitar llamadas redundantes a la API.

---

### `sections/mockups.js` — Sección Mockups

Flujo de datos:
```
render() → Api.get('/patterns?status=approved') → selector de patrón
carga archivo → FileReader: valida tipo MIME y size ≤ 10MB → rechaza si inválido
zona de colocación → selector HTML: front/back/sleeve/...
generar → Api.post('/mockups/generate', { patternId, designFile, zone })
        → muestra spinner → renderImages(front, back) → Toast.success(estado: pending_approval)
```

Validación de archivo:
```js
function validateDesignFile(file) {
  const VALID_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];
  const MAX_BYTES   = 10 * 1024 * 1024; // 10 MB
  if (!VALID_TYPES.includes(file.type))
    return { ok: false, reason: `Formato no permitido: ${file.type}. Use PNG, JPEG o SVG.` };
  if (file.size > MAX_BYTES)
    return { ok: false, reason: `El archivo supera 10 MB (${(file.size/1e6).toFixed(1)} MB).` };
  return { ok: true };
}
```

---

### `sections/aprobaciones.js` — Sección Aprobaciones

Flujo de datos:
```
render() → Api.get('/mockups?status=pending_approval')
         → sort por createdAt ASC (más antiguos primero)
         → renderQueue(items) + Sidebar.updateBadge('#aprobaciones', items.length)
aprobar  → Api.put('/mockups/:id', { status: 'approved' }) → remove from queue → Toast.success()
rechazar → Modal.open({ bodyHTML: <textarea motivo> })
         → valida motivo 1-500 chars → habilita Confirmar
         → Api.put('/mockups/:id', { status: 'rejected', reason }) → remove → Toast.success()
```

El campo de motivo de rechazo activa el botón "Confirmar" del modal solo cuando `motivo.trim().length >= 1 && motivo.trim().length <= 500`.

---

### `sections/publicaciones.js` — Sección Publicaciones

Flujo de datos:
```
render() → Api.get('/mockups?status=approved')
         → renderList con estado publicación y filtros
publicar   → valida item.status === 'approved' en cliente
           → Api.put('/mockups/:id', { published: true }) → Toast.success()
despublicar → Api.put('/mockups/:id', { published: false }) → Toast.success()
filtro     → 'todos' | 'published' | 'unpublished' → filtra en memoria
```

La validación de estado `approved` se realiza en el cliente antes de llamar a la API para evitar errores previsibles.

---

### `sections/redes.js` — Sección Redes Sociales

Flujo de datos:
```
render() → Api.get('/social-content')
         → si vacío → mensaje informativo + enlace a #publicaciones
         → renderList(sorted desc)
descargar IG  → window.open(item.instagramUrl, '_blank')  // URL presignada S3
descargar FB  → window.open(item.facebookUrl, '_blank')
copiar caption → navigator.clipboard.writeText(item.caption) → Toast.success()
reintentar     → Api.post('/social-content/:id/retry') → Toast.success()
```

---

## Data Models

### JWT Session Object (sessionStorage `cf_jwt`)

```ts
interface SessionData {
  token: string;   // Cognito idToken JWT
  exp:   number;   // Unix timestamp (segundos)
}
```

### API Response Shapes

```ts
// Patrón
interface Pattern {
  id:          string;
  name:        string;
  garmentType: string;
  ageGroup:    'children' | 'adult';
  size:        string;
  status:      'draft' | 'approved' | 'rejected';
  createdAt:   string; // ISO 8601 UTC
  svgUrl?:     string; // URL presignada S3 (solo si aprobado)
}

// Cotización
interface Quote {
  id:           string;
  clientName:   string;
  product:      string;
  quantity:     number;
  sizes:        string[];
  status:       'pending' | 'quoted' | 'accepted' | 'rejected';
  receivedAt:   string;
  contactInfo:  { email: string; phone: string };
  notes?:       string;
  statusHistory: { status: string; changedAt: string }[];
  price?:       number;
}

// Mockup
interface Mockup {
  id:          string;
  patternId:   string;
  patternName: string;
  garmentType: string;
  frontUrl:    string;
  backUrl:     string;
  status:      'pending_approval' | 'approved' | 'rejected';
  published:   boolean;
  createdAt:   string;
  reason?:     string; // motivo de rechazo
  publishedAt?: string;
}

// Contenido de Redes
interface SocialContent {
  id:           string;
  mockupId:     string;
  instagramUrl: string; // 1080×1080 px, URL presignada S3
  facebookUrl:  string; // 1200×630 px, URL presignada S3
  caption:      string;
  status:       'ready' | 'error';
  createdAt:    string;
}
```

---

## API Endpoint Mapping

| Sección        | Método | Path                              | Propósito                          |
|----------------|--------|-----------------------------------|------------------------------------|
| Patrones       | GET    | `/patterns`                       | Listar todos los patrones          |
| Patrones       | POST   | `/patterns/generate`              | Crear nuevo patrón                 |
| Cotizaciones   | GET    | `/quotes`                         | Listar cotizaciones                |
| Cotizaciones   | PUT    | `/quotes/:id`                     | Actualizar estado/precio           |
| Mockups        | GET    | `/patterns?status=approved`       | Patrones aprobados para mockup     |
| Mockups        | POST   | `/mockups/generate`               | Generar mockup                     |
| Aprobaciones   | GET    | `/mockups?status=pending_approval`| Cola de aprobación                 |
| Aprobaciones   | PUT    | `/mockups/:id`                    | Aprobar / rechazar                 |
| Publicaciones  | GET    | `/mockups?status=approved`        | Mockups aprobados                  |
| Publicaciones  | PUT    | `/mockups/:id`                    | Publicar / despublicar             |
| Redes          | GET    | `/social-content`                 | Listar contenido generado          |
| Redes          | POST   | `/social-content/:id/retry`       | Reintentar generación              |

---

## UI Component Design

### Shell HTML (`admin/index.html`)

```
┌─────────────────────────────────────────────────────────────┐
│ [network-banner: hidden by default]                         │
├──────────────┬──────────────────────────────────────────────┤
│              │ Header: Logo CronusFit + "Panel Admin" + Logout│
│   Sidebar    ├──────────────────────────────────────────────┤
│              │                                              │
│ ▶ Patrones   │                                              │
│   Cotizaciones│        #app-content                        │
│   Mockups    │        (sección activa se renderiza aquí)    │
│   Aprobaciones● 3                                          │
│   Publicaciones│                                            │
│   Redes      │                                              │
│              │                                              │
├──────────────┴──────────────────────────────────────────────┤
│ [modal: hidden by default]                                  │
│ [toast-container: fixed bottom-right]                       │
└─────────────────────────────────────────────────────────────┘
```

### Clases Tailwind clave (admin-specific)

```css
/* Sidebar item activo */
.nav-active {
  @apply bg-brand-gold/10 text-brand-gold border-r-4 border-brand-gold font-semibold;
}

/* Botón primario */
.btn-primary {
  @apply bg-brand-blue text-white font-semibold px-4 py-2.5 rounded-xl
         hover:bg-brand-blue-light transition-colors duration-200
         disabled:opacity-40 disabled:cursor-not-allowed;
}

/* Botón de peligro (rechazar) */
.btn-danger {
  @apply bg-red-600 text-white font-semibold px-4 py-2.5 rounded-xl
         hover:bg-red-700 transition-colors duration-200;
}

/* Toast tipos */
.toast-success { @apply bg-emerald-600 text-white; }
.toast-error   { @apply bg-red-700 text-white; }
.toast-warn    { @apply bg-amber-500 text-brand-blue-dark; }
```

---

## Infrastructure & Deployment

### S3/CloudFront

- Archivos estáticos en `s3://cronusfit-exhibition-site-prod/admin/`
- La distribución CloudFront necesita una regla de comportamiento para `/admin/*` que reescriba a `admin/index.html` (Error 403/404 → `admin/index.html`, código 200), habilitando el Hash Router.
- `Content-Security-Policy` header en CloudFront:
  ```
  default-src 'self';
  script-src 'self' https://cdn.jsdelivr.net https://cognito-idp.us-east-1.amazonaws.com;
  connect-src 'self' https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com
              https://cognito-idp.us-east-1.amazonaws.com
              https://cognito-identity.us-east-1.amazonaws.com;
  style-src 'self' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: blob: https://cronusfit-exhibition-site-prod.s3.amazonaws.com;
  ```

### CDN Scripts (con SRI)

```html
<!-- amazon-cognito-identity-js -->
<script src="https://cdn.jsdelivr.net/npm/amazon-cognito-identity-js@6/dist/amazon-cognito-identity.min.js"
        integrity="sha384-[SRI_HASH]" crossorigin="anonymous"></script>
<!-- jsPDF -->
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"
        integrity="sha384-[SRI_HASH]" crossorigin="anonymous"></script>
```

Los hashes SRI se calculan durante el build con `openssl dgst -sha384`.

### TailwindCSS Build

`tailwind.config.cjs` se reutiliza añadiendo el path `/admin/**/*.{html,js}` al array `content`:
```js
content: [
  './exhibition-site/**/*.{html,js,njk,md}',
  './admin/**/*.{html,js}',  // ← añadir
],
```
CSS compilado y purged → `admin/css/admin.css`.

---

## Error Handling Strategy

| Escenario                         | Comportamiento                                             |
|-----------------------------------|------------------------------------------------------------|
| JWT ausente al cargar             | `AuthGuard.check()` → redirect `#login` inmediato         |
| JWT expirado (check local)        | `AuthGuard.clear('expired')` → Toast warn + `#login`      |
| API 401                           | `api.js` detecta → `AuthGuard.clear()` → `#login`         |
| API 4xx (validación)              | Toast.error(código + mensaje) — persistente               |
| API 5xx (servidor)                | Toast.error(código + mensaje) — persistente               |
| Red offline                       | `network.js` banner + botones deshabilitados              |
| Red recuperada                    | Banner oculto, botones habilitados                         |
| Descarga SVG falla                | Toast.error, no genera PDF parcial                         |
| Archivo inválido (mockup)         | Mensaje inline en el dropzone, sin llamada a API           |
| Token inválido Cognito login      | Span `#login-error` con "Credenciales incorrectas"         |

Todos los errores de red se loguean en `console.error` con: `[API] {METHOD} {path} → {status} {ISO timestamp}`. El JWT nunca se incluye en el log.

---

## Correctness Properties

*Una propiedad es una característica o comportamiento que debe ser verdadera en todas las ejecuciones válidas del sistema — esencialmente, una afirmación formal sobre lo que el sistema debe hacer. Las propiedades son el puente entre especificaciones legibles por humanos y garantías de corrección verificables automáticamente.*

### Property 1: Auth Guard redirige cualquier ruta sin JWT

*Para cualquier* fragmento de URL del Admin Panel, si `sessionStorage` no contiene un JWT válido (ausente, malformado o expirado), el Auth Guard debe redirigir a `#login` antes de renderizar cualquier contenido de la sección.

**Validates: Requirements 1.1, 1.4**

---

### Property 2: JWT incluido en todas las llamadas a la API

*Para cualquier* llamada HTTP realizada por `api.js` hacia la API Gateway, el encabezado `Authorization` debe estar presente con el valor `Bearer {token}` donde `{token}` coincide exactamente con el token almacenado en `sessionStorage`.

**Validates: Requirements 1.6**

---

### Property 3: Respuesta 401 de la API limpia sesión y redirige

*Para cualquier* endpoint de la API Gateway que devuelva código HTTP 401, el Admin Panel debe eliminar el JWT de `sessionStorage` y redirigir a `#login`, sin importar qué sección esté activa en ese momento.

**Validates: Requirements 1.7**

---

### Property 4: Hash Router renderiza la sección correcta para cualquier ruta válida

*Para cualquier* fragmento de URL en el conjunto `{#patrones, #cotizaciones, #mockups, #aprobaciones, #publicaciones, #redes}`, el Hash Router debe renderizar únicamente la sección correspondiente y actualizar el ítem activo del sidebar, sin recargar la página.

**Validates: Requirements 2.2, 2.3**

---

### Property 5: Fragmento desconocido siempre redirige a #patrones

*Para cualquier* string que no pertenezca al conjunto de rutas válidas del Hash Router, la navegación debe resultar en `location.hash === '#patrones'` y la sección de patrones debe renderizarse.

**Validates: Requirements 2.4**

---

### Property 6: Ítem activo del sidebar refleja la sección actual

*Para cualquier* sección a la que se navegue, exactamente un ítem del sidebar debe tener la clase `nav-active` y ese ítem debe corresponder al hash activo.

**Validates: Requirements 2.5**

---

### Property 7: Listas de secciones siempre ordenadas por fecha

*Para cualquier* respuesta de la API que retorne una lista de patrones, cotizaciones o contenidos de redes, la lista renderizada debe estar ordenada por fecha de creación/recepción descendente. Para mockups de aprobaciones, el orden debe ser ascendente (más antiguos primero).

**Validates: Requirements 3.1, 4.1, 6.1, 8.1**

---

### Property 8: Todos los campos requeridos presentes en el rendering de cada item

*Para cualquier* item de cualquier sección (patrón, cotización, mockup, contenido de redes), todos los campos obligatorios especificados en los requisitos deben estar presentes en el DOM renderizado para ese item.

**Validates: Requirements 3.2, 4.2, 6.2, 7.2, 8.2**

---

### Property 9: Formulario de creación de patrón acepta solo datos válidos

*Para cualquier* conjunto de datos de formulario de patrón donde todos los campos requeridos (`garmentType`, `ageGroup`, `size`, medidas físicas) tienen valores válidos, la invocación a la API debe ejecutarse con esos datos y el JWT adjunto.

**Validates: Requirements 3.4**

---

### Property 10: Errores de validación de API se mapean al campo correcto

*Para cualquier* respuesta de error de validación de la API que contenga un conjunto de campos inválidos, cada mensaje de error debe aparecer junto al campo correspondiente en el formulario, y el formulario no debe cerrarse.

**Validates: Requirements 3.5**

---

### Property 11: Validación de archivo de diseño rechaza formatos/tamaños inválidos

*Para cualquier* archivo cuyo tipo MIME no sea `image/png`, `image/jpeg` o `image/svg+xml`, o cuyo tamaño supere 10 MB, la función de validación debe retornar `ok: false` con un mensaje de motivo específico, sin iniciar ninguna solicitud a la API.

**Validates: Requirements 5.2, 5.3**

---

### Property 12: Filtro de estado opera correctamente sobre cualquier lista

*Para cualquier* lista de cotizaciones o mockups con distribución arbitraria de estados, y cualquier filtro de estado válido seleccionado, la lista filtrada debe contener únicamente items cuyo campo `status` coincida con el filtro, sin modificar los datos subyacentes.

**Validates: Requirements 4.3, 7.6**

---

### Property 13: Estado de la vista se preserva ante cualquier error de la API

*Para cualquier* acción de actualización (responder cotización, aprobar/rechazar mockup, publicar/despublicar) donde la API retorne un error HTTP, el estado del item en la vista debe permanecer idéntico al estado previo a la acción, y una Toast de error debe mostrarse con el código y mensaje.

**Validates: Requirements 4.6, 6.6, 7.5**

---

### Property 14: Solo mockups en estado 'approved' pueden publicarse

*Para cualquier* mockup cuyo campo `status` sea diferente de `approved`, el intento de publicar debe cancelarse en el cliente con una Toast de error, sin invocar la API Gateway.

**Validates: Requirements 7.7**

---

### Property 15: Contador de aprobaciones pendientes siempre sincronizado

*Para cualquier* estado de la cola de aprobaciones, el badge numérico del ítem de navegación `#aprobaciones` debe mostrar exactamente la cantidad de mockups con estado `pending_approval` actualmente en la lista visible.

**Validates: Requirements 6.7**

---

### Property 16: Toast de éxito se auto-descarta en 4 segundos; Toast de error persiste

*Para cualquier* Toast de éxito creada por el sistema, debe desaparecer del DOM después de exactamente 4000 ms. Para cualquier Toast de error (4xx/5xx), debe permanecer en el DOM hasta que el usuario la descarte manualmente.

**Validates: Requirements 10.2, 10.3**

---

### Property 17: Desconexión de red deshabilita todos los botones que requieren API

*Para cualquier* estado de desconexión de red detectado por el `network.js`, todos los elementos con el atributo `data-requires-network` deben tener `disabled === true`. Al recuperarse la conexión, todos deben tener `disabled === false`.

**Validates: Requirements 10.4, 10.5**

---

### Property 18: Logger nunca incluye el JWT ni datos sensibles

*Para cualquier* error de red registrado en `console.error`, el string del mensaje debe contener el método HTTP, la URL del endpoint y el código de estado, y NO debe contener el valor del token JWT ni credenciales.

**Validates: Requirements 10.6**

---

### Property 19: Todas las Toast tienen role="alert"

*Para cualquier* Toast creada por el componente `toast.js`, el elemento DOM resultante debe tener el atributo `role="alert"` y `aria-live` configurado.

**Validates: Requirements 10.7**
