# Implementation Plan: Admin Panel CronusFit

## Overview

SPA estática (Vanilla JS ES2022 + TailwindCSS) desplegada en `/admin/` del bucket S3/CloudFront existente. La implementación sigue el flujo operativo del negocio: shell → módulos core → login → secciones de contenido → componentes transversales → despliegue.

## Tasks

- [x] 1. Shell HTML y configuración de build TailwindCSS
  - [x] 1.1 Crear `admin/index.html` con estructura completa de la SPA
    - Escribir el shell HTML con los contenedores: `#app-content`, `#toast-container`, `#modal`, `#network-banner`, sidebar y header
    - Incluir etiqueta `<link>` a `admin/css/admin.css`
    - Incluir tags `<script>` para amazon-cognito-identity-js y jsPDF desde CDN jsdelivr con atributos `integrity` y `crossorigin="anonymous"` (hashes SRI calculados con `openssl dgst -sha384`)
    - Incluir tags `<script src>` para todos los módulos JS en orden: `app.js`, `router.js`, `auth.js`, `api.js`, `toast.js`, `modal.js`, `sidebar.js`, `network.js`, secciones
    - Agregar `Content-Security-Policy` como meta tag con los orígenes permitidos del diseño
    - Marcar todos los botones de acción con `data-requires-network`
    - _Requisitos: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 1.2 Configurar TailwindCSS build para el admin panel
    - Modificar `exhibition-site/tailwind.config.cjs` añadiendo `'./admin/**/*.{html,js}'` al array `content`
    - Crear `admin/css/` y el archivo fuente `admin/css/admin.src.css` con `@tailwind base/components/utilities` y las clases admin-específicas del diseño (`.nav-active`, `.btn-primary`, `.btn-danger`, `.toast-success`, `.toast-error`, `.toast-warn`)
    - Agregar script npm `"build:admin-css"` en `package.json` que compile y purgue Tailwind a `admin/css/admin.css`
    - _Requisitos: 9.2, 9.7_


- [x] 2. Módulos core: router, auth, api, toast, network
  - [x] 2.1 Implementar `admin/js/router.js` — Hash Router
    - Definir el objeto `ROUTES` con las 7 rutas válidas (`#login`, `#patrones`, `#cotizaciones`, `#mockups`, `#aprobaciones`, `#publicaciones`, `#redes`)
    - Implementar `navigate(hash)`: llamar `AuthGuard.check()` para rutas protegidas, limpiar `#app-content`, invocar la función de render correspondiente, llamar `Sidebar.setActive(hash)`
    - Redirigir cualquier fragmento desconocido a `#patrones`
    - Registrar listeners `hashchange` y `DOMContentLoaded`
    - _Requisitos: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 2.2 Escribir property tests para router.js
    - **Property 4: Hash Router renderiza la sección correcta para cualquier ruta válida**
    - **Validates: Requirements 2.2, 2.3**
    - **Property 5: Fragmento desconocido siempre redirige a #patrones**
    - **Validates: Requirements 2.4**

  - [x] 2.3 Implementar `admin/js/auth.js` — Auth Guard + Cognito SDK wrapper
    - Implementar `AuthGuard.getToken()`: leer `sessionStorage('cf_jwt')`, parsear `{token, exp}`, verificar `Date.now()/1000 < exp`, retornar token o null
    - Implementar `AuthGuard.check()`: si no hay token, `location.hash = '#login'`
    - Implementar `AuthGuard.clear(reason)`: eliminar `cf_jwt` de sessionStorage, mostrar Toast si `reason === 'expired'`, redirigir a `#login`
    - Implementar `AuthGuard.login(username, password)` usando `amazon-cognito-identity-js` (pool `us-east-1_GOBIYDfqK`, client `7gfgmp718hi797qd5e4m1pk5ae`): en `onSuccess` guardar `{token, exp}` en sessionStorage, en `onFailure` propagar el error
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 2.4 Escribir property tests para auth.js
    - **Property 1: Auth Guard redirige cualquier ruta sin JWT**
    - **Validates: Requirements 1.1, 1.4**


  - [x] 2.5 Implementar `admin/js/api.js` — HTTP fetch wrapper con JWT
    - Definir `API_BASE = 'https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod'`
    - Implementar `Api.request(method, path, body)`: obtener token vía `AuthGuard.getToken()`, adjuntar `Authorization: Bearer <token>`, detectar HTTP 401 y llamar `AuthGuard.clear('expired')`, lanzar error con `status` para 4xx/5xx
    - Registrar en `console.error` para cada error: `[API] {METHOD} {path} → {status} {ISO timestamp}` — nunca incluir el JWT
    - Exponer `Api.get`, `Api.post`, `Api.put`, `Api.delete`
    - _Requisitos: 1.6, 1.7, 10.1, 10.6_

  - [ ]* 2.6 Escribir property tests para api.js
    - **Property 2: JWT incluido en todas las llamadas a la API**
    - **Validates: Requirements 1.6**
    - **Property 3: Respuesta 401 de la API limpia sesión y redirige**
    - **Validates: Requirements 1.7**
    - **Property 18: Logger nunca incluye el JWT ni datos sensibles**
    - **Validates: Requirements 10.6**

  - [x] 2.7 Implementar `admin/js/toast.js` — Toast Notification component
    - Implementar `Toast._show(type, message, autoDismiss)`: crear `<div role="alert" aria-live="assertive">`, aplicar clases Tailwind según tipo, agregar al `#toast-container`
    - `Toast.success`: auto-descarta a los 4000 ms
    - `Toast.error`: persiste hasta cierre manual (añadir botón ×)
    - `Toast.warn`: persiste hasta cierre manual
    - _Requisitos: 10.2, 10.3, 10.7_

  - [ ]* 2.8 Escribir property tests para toast.js
    - **Property 16: Toast de éxito se auto-descarta en 4 segundos; Toast de error persiste**
    - **Validates: Requirements 10.2, 10.3**
    - **Property 19: Todas las Toast tienen role="alert"**
    - **Validates: Requirements 10.7**

  - [x] 2.9 Implementar `admin/js/network.js` — Connectivity Monitor
    - Implementar `Network.init()`: registrar listeners `online`/`offline` en `window`
    - En desconexión: mostrar `#network-banner`, deshabilitar todos los elementos con `data-requires-network`
    - En reconexión: ocultar banner, habilitar elementos con `data-requires-network`
    - Exponer `Network.isOnline()`
    - _Requisitos: 10.4, 10.5_

  - [ ]* 2.10 Escribir property tests para network.js
    - **Property 17: Desconexión de red deshabilita todos los botones que requieren API**
    - **Validates: Requirements 10.4, 10.5**


- [ ] 3. Checkpoint — Módulos core
  - Verificar que router, auth, api, toast y network se cargan sin errores en el navegador
  - Verificar que `AuthGuard.check()` redirige a `#login` cuando no hay JWT en sessionStorage
  - Verificar que `Api.request` adjunta el header `Authorization` correctamente en DevTools
  - Consultar si hay dudas antes de continuar

- [x] 4. Login View
  - [x] 4.1 Implementar `admin/js/sections/login.js` — Login View
    - Renderizar en `#app-content` el formulario con campos `<label for>` asociados a `<input>` para usuario y contraseña (WCAG 2.1 AA)
    - Aplicar `focus:ring-4 focus:ring-brand-gold/40` para foco visible
    - En `submit`: llamar `AuthGuard.login(user, pass)` con spinner de carga en el botón
    - En éxito: `location.hash = '#patrones'`
    - En fallo: mostrar "Credenciales incorrectas" en `<span id="login-error" role="alert" aria-live="assertive">` sin redirigir
    - _Requisitos: 1.2, 1.3, 1.8_

  - [ ]* 4.2 Escribir unit tests para login.js
    - Caso éxito: credenciales correctas → redirige a `#patrones`
    - Caso fallo: credenciales incorrectas → muestra "Credenciales incorrectas", no redirige
    - Verificar que el span de error tiene `role="alert"`
    - _Requisitos: 1.2, 1.3, 1.8_


- [ ] 5. Sección Patrones
  - [ ] 5.1 Implementar listado de patrones en `admin/js/sections/patrones.js`
    - En `PatronesSection.render()`: llamar `Api.get('/patterns')`, ordenar por `createdAt` descendente, renderizar tabla/cards con: nombre, tipo de prenda, grupo etario, talla, estado y fecha de creación
    - Mostrar spinner de carga durante la llamada a la API
    - Mostrar `Toast.error` si la llamada falla
    - _Requisitos: 3.1, 3.2, 10.1_

  - [ ]* 5.2 Escribir property test para ordenamiento de lista de patrones
    - **Property 7: Listas de secciones siempre ordenadas por fecha**
    - **Validates: Requirements 3.1**

  - [ ]* 5.3 Escribir property test para rendering completo de campos de patrón
    - **Property 8: Todos los campos requeridos presentes en el rendering de cada item**
    - **Validates: Requirements 3.2**

  - [ ] 5.4 Implementar formulario de creación de patrón
    - Al seleccionar "Nuevo patrón", renderizar formulario con campos: `garmentType`, `ageGroup`, `size`, medidas físicas (`measurements`)
    - En `submit` con todos los campos válidos: mostrar spinner en el botón, llamar `Api.post('/patterns/generate', data)`, mostrar `Toast.success` al recibir respuesta exitosa
    - Si la API retorna errores de validación: mapear cada error al campo correspondiente por nombre y mostrarlos inline sin cerrar el formulario
    - _Requisitos: 3.3, 3.4, 3.5_

  - [ ]* 5.5 Escribir property tests para formulario de creación de patrón
    - **Property 9: Formulario de creación de patrón acepta solo datos válidos**
    - **Validates: Requirements 3.4**
    - **Property 10: Errores de validación de API se mapean al campo correcto**
    - **Validates: Requirements 3.5**

  - [ ] 5.6 Implementar descarga de patrón como PDF con jsPDF
    - Implementar `downloadPatternPDF(patternId, presignedUrl)`: `fetch(presignedUrl)` → si falla, `Toast.error` y cancelar sin archivo parcial
    - Si el SVG se obtiene: instanciar `jsPDF`, usar `doc.svg(svgElement, {x:10, y:10, width:190, height:277})`, guardar como `patron-{patternId}.pdf`
    - _Requisitos: 3.6, 3.7_

  - [ ]* 5.7 Escribir unit tests para descarga PDF
    - Caso éxito: SVG descargado → PDF generado y guardado
    - Caso fallo en fetch: `Toast.error` mostrado, ningún archivo generado
    - _Requisitos: 3.6, 3.7_


- [ ] 6. Sección Cotizaciones
  - [ ] 6.1 Implementar listado y resumen de cotizaciones en `admin/js/sections/cotizaciones.js`
    - En `CotizacionesSection.render()`: llamar `Api.get('/quotes')`, calcular contadores por estado en el cliente, renderizar resumen de totales y lista ordenada por `receivedAt` descendente
    - Mostrar por cada cotización: nombre del cliente, producto, cantidad, tallas, estado actual y fecha de recepción
    - _Requisitos: 4.1, 4.2, 4.7_

  - [ ]* 6.2 Escribir property test para ordenamiento y rendering de cotizaciones
    - **Property 7: Listas de secciones siempre ordenadas por fecha**
    - **Validates: Requirements 4.1**
    - **Property 8: Todos los campos requeridos presentes en el rendering de cada item**
    - **Validates: Requirements 4.2**

  - [ ] 6.3 Implementar filtro por estado y detalle de cotización
    - Implementar filtro por `pending | quoted | accepted | rejected` operando sobre el array local (sin re-fetch)
    - Al seleccionar una cotización: renderizar detalle completo con datos de contacto, notas de personalización e historial de estados
    - _Requisitos: 4.3, 4.4_

  - [ ]* 6.4 Escribir property test para filtro de estado de cotizaciones
    - **Property 12: Filtro de estado opera correctamente sobre cualquier lista**
    - **Validates: Requirements 4.3**

  - [ ] 6.5 Implementar respuesta de precio a cotización
    - Al enviar precio en cotización `pending`: mostrar spinner, llamar `Api.put('/quotes/:id', {price, status:'quoted'})`, mostrar `Toast.success` en éxito
    - Si la API retorna error: `Toast.error` persistente, mantener el estado previo en la vista
    - _Requisitos: 4.5, 4.6_

  - [ ]* 6.6 Escribir property test para preservación de estado ante error de API
    - **Property 13: Estado de la vista se preserva ante cualquier error de la API**
    - **Validates: Requirements 4.6**


- [ ] 7. Sección Mockups
  - [ ] 7.1 Implementar selector de patrón y validación de archivo en `admin/js/sections/mockups.js`
    - En `MockupsSection.render()`: llamar `Api.get('/patterns?status=approved')`, renderizar selector `<select>` con los patrones aprobados
    - Implementar `validateDesignFile(file)`: aceptar solo `image/png`, `image/jpeg`, `image/svg+xml` y tamaño ≤ 10 MB; retornar `{ok, reason}` y mostrar mensaje inline en el dropzone sin llamar a la API si inválido
    - _Requisitos: 5.1, 5.2, 5.3_

  - [ ]* 7.2 Escribir property test para validación de archivo de diseño
    - **Property 11: Validación de archivo de diseño rechaza formatos/tamaños inválidos**
    - **Validates: Requirements 5.2, 5.3**

  - [ ] 7.3 Implementar generación de mockup
    - Al seleccionar zona de colocación válida y enviar: mostrar spinner de progreso, llamar `Api.post('/mockups/generate', {patternId, designFile, zone})`
    - En éxito: renderizar imágenes frontal y trasera, mostrar `Toast.success` indicando estado `pending_approval`
    - En error: `Toast.error` con el motivo recibido, mantener formulario con los valores ingresados
    - _Requisitos: 5.4, 5.5, 5.6_

  - [ ]* 7.4 Escribir unit tests para generación de mockup
    - Caso éxito: API responde → imágenes renderizadas, Toast.success con pending_approval
    - Caso error API: Toast.error mostrado, formulario conserva valores previos
    - _Requisitos: 5.4, 5.5, 5.6_


- [ ] 8. Sección Aprobaciones
  - [ ] 8.1 Implementar cola de aprobaciones en `admin/js/sections/aprobaciones.js`
    - En `AprobacionesSection.render()`: llamar `Api.get('/mockups?status=pending_approval')`, ordenar por `createdAt` ASC (más antiguos primero)
    - Renderizar cada mockup con imágenes frontal y trasera, nombre del patrón, tipo de prenda y fecha de generación
    - Llamar `Sidebar.updateBadge('#aprobaciones', items.length)` después del render
    - _Requisitos: 6.1, 6.2, 6.7_

  - [ ]* 8.2 Escribir property test para ordenamiento ascendente y contador de badge
    - **Property 7: Listas de secciones siempre ordenadas por fecha (aprobaciones: ASC)**
    - **Validates: Requirements 6.1**
    - **Property 15: Contador de aprobaciones pendientes siempre sincronizado**
    - **Validates: Requirements 6.7**

  - [ ] 8.3 Implementar aprobación de mockup
    - Al pulsar "Aprobar": mostrar spinner, llamar `Api.put('/mockups/:id', {status:'approved'})`, eliminar el item de la cola visible y actualizar el badge, mostrar `Toast.success`
    - En error: `Toast.error`, mantener el mockup en la cola con su estado anterior
    - _Requisitos: 6.3, 6.6_

  - [ ] 8.4 Implementar rechazo de mockup con campo de motivo (integra modal.js)
    - Al pulsar "Rechazar": abrir `Modal` con `<textarea>` para motivo de rechazo
    - Validar `motivo.trim().length >= 1 && motivo.trim().length <= 500`; habilitar el botón "Confirmar" solo cuando se cumple
    - Al confirmar con motivo válido: llamar `Api.put('/mockups/:id', {status:'rejected', reason})`, eliminar de la cola, mostrar `Toast.success`
    - En error: `Toast.error`, mantener el mockup en la cola
    - _Requisitos: 6.4, 6.5, 6.6_

  - [ ]* 8.5 Escribir property test para preservación de estado ante error en aprobaciones
    - **Property 13: Estado de la vista se preserva ante cualquier error de la API**
    - **Validates: Requirements 6.6**


- [ ] 9. Sección Publicaciones
  - [ ] 9.1 Implementar listado y filtro de publicaciones en `admin/js/sections/publicaciones.js`
    - En `PublicacionesSection.render()`: llamar `Api.get('/mockups?status=approved')`, renderizar lista con miniaturas frontal/trasera, nombre del producto, estado de publicación y fecha de última acción
    - Implementar filtro `todos | published | unpublished` operando sobre el array local
    - _Requisitos: 7.1, 7.2, 7.6_

  - [ ]* 9.2 Escribir property test para filtro de estado de publicación
    - **Property 12: Filtro de estado opera correctamente sobre cualquier lista**
    - **Validates: Requirements 7.6**

  - [ ] 9.3 Implementar publicar y despublicar mockup
    - Al pulsar "Publicar": validar `item.status === 'approved'` en el cliente antes de llamar a la API; si no es `approved`, mostrar `Toast.error` y cancelar sin llamar a la API
    - Si es válido: llamar `Api.put('/mockups/:id', {published:true})`, actualizar estado en la vista, mostrar `Toast.success`
    - Al pulsar "Despublicar": llamar `Api.put('/mockups/:id', {published:false})`, actualizar estado en la vista, mostrar `Toast.success`
    - En error: `Toast.error`, mantener el estado de publicación anterior
    - _Requisitos: 7.3, 7.4, 7.5, 7.7_

  - [ ]* 9.4 Escribir property tests para publicaciones
    - **Property 14: Solo mockups en estado 'approved' pueden publicarse**
    - **Validates: Requirements 7.7**
    - **Property 13: Estado de la vista se preserva ante cualquier error de la API**
    - **Validates: Requirements 7.5**


- [ ] 10. Sección Redes Sociales
  - [ ] 10.1 Implementar listado de contenidos de redes en `admin/js/sections/redes.js`
    - En `RedesSection.render()`: llamar `Api.get('/social-content')`, ordenar por `createdAt` descendente
    - Si la lista está vacía: renderizar mensaje informativo con enlace `<a href="#publicaciones">` a la sección de publicaciones
    - Renderizar cada item con: imagen Instagram (1080×1080), imagen Facebook (1200×630), caption en campo de solo lectura con botón copiar
    - _Requisitos: 8.1, 8.2, 8.7_

  - [ ]* 10.2 Escribir property test para ordenamiento de lista de redes
    - **Property 7: Listas de secciones siempre ordenadas por fecha**
    - **Validates: Requirements 8.1**

  - [ ] 10.3 Implementar descargar imágenes y copiar caption
    - Botón "Descargar Instagram": `window.open(item.instagramUrl, '_blank')`
    - Botón "Descargar Facebook": `window.open(item.facebookUrl, '_blank')`
    - Botón "Copiar caption": `navigator.clipboard.writeText(item.caption)` → `Toast.success`
    - Botón "Reintentar generación" (solo en items con `status === 'error'`): llamar `Api.post('/social-content/:id/retry')` → `Toast.success`
    - _Requisitos: 8.3, 8.4, 8.5, 8.6, 8.8_

  - [ ]* 10.4 Escribir unit tests para descarga y copia de caption
    - Caso copiar caption: `navigator.clipboard.writeText` invocado con el texto correcto, Toast.success mostrado
    - Caso lista vacía: mensaje informativo y enlace a `#publicaciones` renderizados
    - _Requisitos: 8.5, 8.6, 8.7_


- [ ] 11. Checkpoint — Secciones de contenido
  - Verificar que las seis secciones se renderizan correctamente con datos mockeados
  - Verificar que los filtros y ordenamientos funcionan en memoria sin re-fetch
  - Verificar que los Toast de éxito desaparecen a los 4 s y los de error persisten
  - Consultar si hay dudas antes de continuar

- [ ] 12. Sidebar y navegación con badges
  - [ ] 12.1 Implementar `admin/js/sidebar.js` — Sidebar navigation
    - Renderizar en el DOM la lista de ítems de navegación con `data-nav-hash` usando `NAV_ITEMS` del diseño (íconos, labels, hash)
    - Implementar `Sidebar.setActive(hash)`: quitar `nav-active` de todos los ítems y aplicarla al ítem cuyo `data-nav-hash === hash`
    - Implementar `Sidebar.updateBadge(hash, count)`: actualizar texto y visibilidad del badge en el ítem correspondiente
    - Aplicar Brand_Config (azul/dorado, logo de reloj de arena) en el header del sidebar
    - Implementar colapso a menú hamburguesa en viewports < 768 px
    - _Requisitos: 2.5, 2.6, 2.7, 6.7_

  - [ ]* 12.2 Escribir property tests para sidebar
    - **Property 6: Ítem activo del sidebar refleja la sección actual**
    - **Validates: Requirements 2.5**


- [ ] 13. Modal component
  - [ ] 13.1 Implementar `admin/js/modal.js` — Modal reutilizable
    - Implementar `Modal.open({title, bodyHTML, onConfirm, confirmLabel, confirmDisabled})`: inyectar contenido en el shell del modal que ya existe en `index.html`, remover clase `hidden`, aplicar `aria-modal="true"`, enfocar el botón "Confirmar"
    - Implementar `Modal.close()`: agregar clase `hidden`, limpiar listeners
    - Asegurar que el modal es accesible: `role="dialog"`, `aria-labelledby="modal-title"`
    - _Requisitos: 6.4 (usado por rechazo de mockup)_

  - [ ]* 13.2 Escribir unit tests para modal.js
    - Caso open: modal visible, foco en botón confirmar, aria-modal=true
    - Caso close: modal oculto
    - _Requisitos: 6.4_


- [ ] 14. Bootstrap e integración final (`app.js`)
  - [ ] 14.1 Implementar `admin/js/app.js` — Bootstrap y wiring
    - En `DOMContentLoaded`: llamar `Network.init()`, llamar `Router.navigate(location.hash || '#patrones')`
    - Exponer globalmente los módulos necesarios (`AuthGuard`, `Toast`, `Modal`, `Sidebar`, `Api`) para que las secciones puedan referenciarlos por nombre
    - Verificar que el flujo completo funciona: carga → auth check → render sección → navegación → logout
    - _Requisitos: 1.1, 2.1, 2.2, 9.2_

- [ ] 15. Checkpoint — Integración completa
  - Verificar el flujo principal completo en el navegador: login → patrones → crear patrón → mockup → aprobación → publicación
  - Verificar que el badge de aprobaciones se actualiza al navegar a `#aprobaciones`
  - Verificar que el menú hamburguesa funciona en viewport 768 px
  - Consultar si hay dudas antes de continuar


- [ ] 16. Deploy a S3 y configuración de CloudFront
  - [ ] 16.1 Crear script de despliegue a S3
    - Agregar script npm `"deploy:admin"` en `package.json` que ejecute: `npm run build:admin-css && aws s3 sync ./admin s3://cronusfit-exhibition-site-prod/admin/ --delete`
    - Asegurar que las rutas relativas de CSS, JS e imágenes sean compatibles con el prefijo `/admin/` de CloudFront
    - _Requisitos: 9.1, 9.5_

  - [ ] 16.2 Configurar regla de comportamiento en CloudFront para `/admin/*`
    - En `infrastructure/template.yaml`, agregar un `CacheBehavior` para el path pattern `/admin/*`
    - Configurar Custom Error Response: errores 403 y 404 bajo `/admin/*` deben retornar `admin/index.html` con código HTTP 200 (habilita el Hash Router)
    - Agregar `ResponseHeadersPolicy` con `Content-Security-Policy` según la definición del diseño
    - _Requisitos: 9.4, 9.6_

  - [ ]* 16.3 Escribir unit test de estructura de archivos de build
    - Verificar que el directorio `admin/` contiene `index.html`, `css/admin.css` y todos los archivos JS esperados antes del sync a S3
    - _Requisitos: 9.1, 9.2_

- [ ] 17. Checkpoint final — Verificar despliegue
  - Verificar que `https://{cloudfront-domain}/admin/` carga el panel y redirige a `#login`
  - Verificar que `/admin/#patrones` carga directamente sin 404
  - Verificar en DevTools que la cabecera `Content-Security-Policy` está presente en la respuesta de CloudFront
  - Consultar si hay dudas antes de dar por terminado


## Notes

- Las tareas marcadas con `*` son opcionales y pueden omitirse para un MVP más rápido
- Cada tarea referencia requisitos específicos para trazabilidad completa
- Los property tests usan la librería `fast-check` ya presente en el proyecto
- Los unit tests usan `vitest` (runner configurado en el proyecto)
- Para los property tests del admin panel (Vanilla JS del navegador), crear los archivos en `tests/unit/admin/` y usar mocks de `window`, `sessionStorage` y `fetch` con `vi.stubGlobal`
- Los hashes SRI para las dependencias CDN se calculan con: `curl -sL {URL} | openssl dgst -sha384 -binary | openssl base64 -A`
- El `tailwind.config.cjs` modificado no debe duplicar la paleta — solo añadir el path `/admin/**/*.{html,js}` al array `content`
- Todos los botones de acción que llaman a la API deben tener el atributo `data-requires-network` para que `network.js` los deshabilite en desconexión

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.3", "2.5", "2.7", "2.9"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "2.8", "2.10", "4.1"] },
    { "id": 3, "tasks": ["4.2", "5.1", "6.1", "7.1", "8.1", "9.1", "10.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "6.2", "6.3", "7.2", "7.3", "8.2", "8.3", "9.2", "10.2"] },
    { "id": 5, "tasks": ["5.5", "5.6", "6.4", "6.5", "7.4", "8.4", "9.3", "10.3", "13.1"] },
    { "id": 6, "tasks": ["5.7", "6.6", "8.5", "9.4", "10.4", "12.1", "13.2"] },
    { "id": 7, "tasks": ["12.2", "14.1"] },
    { "id": 8, "tasks": ["16.1", "16.2"] },
    { "id": 9, "tasks": ["16.3"] }
  ]
}
```
