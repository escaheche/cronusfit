# Requirements Document

## Introduction

Panel de administración de CronusFit: SPA estática en Vanilla JS + TailwindCSS servida desde `/admin/` del mismo bucket S3/CloudFront del sitio de exhibición. El panel centraliza el flujo operativo completo del negocio en seis secciones: patrones, cotizaciones, mockups, aprobaciones, publicaciones y redes sociales. La autenticación se gestiona con AWS Cognito (JWT almacenado en `sessionStorage`); cualquier acceso sin JWT válido redirige a `#login`. Toda llamada de datos se realiza contra la API Gateway existente (`https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod`). Las exportaciones de PDF e impresión se ejecutan localmente en el navegador con jsPDF, sin coste adicional de Lambda. La identidad visual (azul/dorado, logo de reloj de arena) es idéntica al sitio de exhibición.

## Glossary

- **Admin_Panel**: SPA estática en Vanilla JS + TailwindCSS desplegada en `/admin/` del bucket S3/CloudFront de CronusFit.
- **Admin**: Administrador único de la plataforma que opera el Admin_Panel.
- **JWT**: JSON Web Token emitido por Cognito tras autenticación exitosa; se almacena en `sessionStorage` y se incluye como `Authorization: Bearer <token>` en todas las llamadas a la API.
- **Cognito_Client**: App Client de AWS Cognito con ID `7gfgmp718hi797qd5e4m1pk5ae` que gestiona la autenticación del Admin.
- **API_Gateway**: Endpoint REST `https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod` que expone todos los recursos del backend.
- **Session_Storage**: `window.sessionStorage` del navegador donde se persiste el JWT durante la sesión activa.
- **Hash_Router**: Mecanismo de navegación de la SPA basado en fragmentos de URL (`#login`, `#patrones`, `#cotizaciones`, `#mockups`, `#aprobaciones`, `#publicaciones`, `#redes`).
- **Seccion_Patrones**: Vista del Admin_Panel para visualizar, crear y gestionar patrones de corte paramétricos.
- **Seccion_Cotizaciones**: Vista del Admin_Panel para listar, filtrar y responder solicitudes de cotización de clientes.
- **Seccion_Mockups**: Vista del Admin_Panel para generar mockups a partir de patrones aprobados y diseños cargados.
- **Seccion_Aprobaciones**: Vista del Admin_Panel que muestra la cola de mockups en estado `pending_approval` para aprobar o rechazar.
- **Seccion_Publicaciones**: Vista del Admin_Panel para controlar qué mockups aprobados se publican o despublican en el sitio de exhibición.
- **Seccion_Redes**: Vista del Admin_Panel para revisar y descargar el contenido generado automáticamente para redes sociales.
- **Login_View**: Vista de autenticación en `#login` que presenta el formulario de credenciales y delega la autenticación a Cognito.
- **Auth_Guard**: Mecanismo de la SPA que verifica la existencia y validez del JWT en `sessionStorage` antes de renderizar cualquier sección protegida.
- **Flujo_Principal**: Secuencia operativa: generar patrón → publicar patrón → cliente cotiza → Admin genera mockup → Admin aprueba → Admin publica mockup.
- **jsPDF**: Librería JavaScript ejecutada localmente en el navegador del Admin para generar y descargar PDFs sin invocar Lambda.
- **Brand_Config**: Identidad visual de CronusFit: paleta azul/dorado, logo de reloj de arena, tipografía y espaciado definidos en `tailwind.config`.
- **Toast_Notification**: Mensaje de retroalimentación efímero (éxito, error, advertencia) mostrado en la esquina del Admin_Panel sin bloquear la interfaz.
- **Free_Tier**: Restricción de cero coste adicional; toda operación del Admin_Panel debe mantenerse dentro de los límites de AWS Free Tier ya establecidos.

## Requirements

### Requirement 1: Autenticación y Gestión de Sesión

**User Story:** Como Admin, quiero iniciar sesión con mis credenciales de Cognito para acceder al panel, y que la sesión se cierre automáticamente cuando expire el token, para que nadie más pueda operar el panel desde mi navegador.

#### Acceptance Criteria

1. WHEN el Admin navega a cualquier ruta del Admin_Panel sin un JWT válido en `sessionStorage`, THE Auth_Guard SHALL redirigir inmediatamente a `#login`.
2. WHEN el Admin envía credenciales válidas en el formulario de `#login`, THE Admin_Panel SHALL autenticar al usuario contra Cognito_Client, almacenar el JWT resultante en `sessionStorage` y redirigir a `#patrones`.
3. IF las credenciales enviadas son incorrectas, THEN THE Admin_Panel SHALL mostrar un mensaje de error específico ("Credenciales incorrectas") en el formulario y SHALL mantener al Admin en `#login`.
4. WHEN el JWT en `sessionStorage` expira, THE Auth_Guard SHALL eliminar el JWT de `sessionStorage`, mostrar una Toast_Notification de sesión expirada y redirigir a `#login`.
5. WHEN el Admin selecciona la acción de cerrar sesión, THE Admin_Panel SHALL eliminar el JWT de `sessionStorage` y redirigir a `#login`.
6. THE Admin_Panel SHALL incluir el JWT en el encabezado `Authorization: Bearer <token>` en cada solicitud a la API_Gateway.
7. IF la API_Gateway devuelve código HTTP 401, THEN THE Admin_Panel SHALL eliminar el JWT de `sessionStorage` y redirigir a `#login`.
8. THE Login_View SHALL implementar el formulario de credenciales conforme a WCAG 2.1 AA, con etiquetas asociadas a cada campo y estado de foco visible.

---

### Requirement 2: Navegación por Secciones

**User Story:** Como Admin, quiero cambiar entre las seis secciones del panel usando un menú de navegación para acceder rápidamente a cualquier parte del flujo de trabajo.

#### Acceptance Criteria

1. THE Admin_Panel SHALL implementar Hash_Router con las rutas `#patrones`, `#cotizaciones`, `#mockups`, `#aprobaciones`, `#publicaciones` y `#redes`.
2. WHEN el Admin selecciona una sección en el menú de navegación, THE Admin_Panel SHALL actualizar el fragmento de URL y renderizar la vista correspondiente sin recargar la página.
3. WHEN el Admin navega directamente a una URL con fragmento válido, THE Admin_Panel SHALL renderizar la sección correspondiente siempre que el JWT sea válido.
4. IF el Admin navega a un fragmento no reconocido, THEN THE Admin_Panel SHALL redirigir a `#patrones`.
5. THE Admin_Panel SHALL resaltar visualmente la sección activa en el menú de navegación usando la Brand_Config.
6. THE Admin_Panel SHALL aplicar la Brand_Config (paleta azul/dorado, logo de reloj de arena) en la cabecera y el menú de navegación de forma idéntica a la identidad visual del sitio de exhibición.
7. THE Admin_Panel SHALL renderizar correctamente en viewports de 768 px a 2560 px de ancho.

---

### Requirement 3: Gestión de Patrones

**User Story:** Como Admin, quiero ver el listado de patrones existentes, crear nuevos patrones y descargar los patrones aprobados en PDF, para gestionar el catálogo de patrones de corte desde el panel.

#### Acceptance Criteria

1. WHEN el Admin accede a `#patrones`, THE Seccion_Patrones SHALL obtener la lista de patrones desde la API_Gateway y mostrarla ordenada por fecha de creación descendente.
2. THE Seccion_Patrones SHALL mostrar por cada patrón: nombre, tipo de prenda, grupo etario, talla, estado y fecha de creación.
3. WHEN el Admin selecciona "Nuevo patrón", THE Seccion_Patrones SHALL mostrar el formulario de creación con los campos requeridos: tipo de prenda, grupo etario, talla y medidas físicas.
4. WHEN el Admin envía el formulario de creación con todos los campos válidos, THE Admin_Panel SHALL invocar la API_Gateway con el JWT y mostrar una Toast_Notification de confirmación al recibir respuesta exitosa.
5. IF la API_Gateway devuelve un error de validación al crear un patrón, THEN THE Seccion_Patrones SHALL mostrar los mensajes de error por campo sin cerrar el formulario.
6. WHEN el Admin solicita descargar un patrón aprobado, THE Admin_Panel SHALL obtener el SVG desde la URL presignada de S3 y generar el PDF localmente con jsPDF en el navegador del Admin, sin invocar Lambda adicional.
7. IF la descarga del SVG desde la URL presignada falla, THEN THE Admin_Panel SHALL mostrar una Toast_Notification de error y SHALL cancelar la generación del PDF sin producir archivo parcial.

---

### Requirement 4: Gestión de Cotizaciones

**User Story:** Como Admin, quiero ver todas las solicitudes de cotización recibidas, filtrarlas por estado y responderlas con precio, para gestionar el ciclo completo de ventas desde el panel.

#### Acceptance Criteria

1. WHEN el Admin accede a `#cotizaciones`, THE Seccion_Cotizaciones SHALL obtener la lista de cotizaciones desde la API_Gateway y mostrarla ordenada por fecha de recepción descendente.
2. THE Seccion_Cotizaciones SHALL mostrar por cada cotización: nombre del cliente, producto, cantidad, tallas solicitadas, estado actual y fecha de recepción.
3. THE Seccion_Cotizaciones SHALL permitir filtrar el listado por estado: `pending`, `quoted`, `accepted` y `rejected`.
4. WHEN el Admin selecciona una cotización, THE Seccion_Cotizaciones SHALL mostrar el detalle completo incluyendo datos de contacto del cliente, notas de personalización y el historial de estados.
5. WHEN el Admin envía un precio para una cotización en estado `pending`, THE Admin_Panel SHALL invocar la API_Gateway para actualizar el estado a `quoted` y mostrar una Toast_Notification de confirmación al recibir respuesta exitosa.
6. IF la API_Gateway devuelve error al actualizar una cotización, THEN THE Seccion_Cotizaciones SHALL mostrar una Toast_Notification de error y SHALL mantener el estado anterior de la cotización en la vista.
7. THE Seccion_Cotizaciones SHALL mostrar el total de cotizaciones por estado en un resumen visible al inicio de la sección.

---

### Requirement 5: Generación de Mockups

**User Story:** Como Admin, quiero generar mockups de vista frontal y trasera para un patrón aprobado cargando el diseño gráfico, para previsualizar el producto antes de aprobarlo.

#### Acceptance Criteria

1. WHEN el Admin accede a `#mockups`, THE Seccion_Mockups SHALL obtener la lista de patrones con estado aprobado desde la API_Gateway y presentarlos como opciones de selección.
2. WHEN el Admin selecciona un patrón aprobado y carga un archivo de diseño, THE Seccion_Mockups SHALL aceptar únicamente PNG, JPEG y SVG con tamaño máximo de 10 MB.
3. IF el archivo cargado supera 10 MB o tiene formato no aceptado, THEN THE Seccion_Mockups SHALL rechazar el archivo y mostrar el motivo específico sin iniciar la solicitud a la API_Gateway.
4. WHEN el Admin selecciona una zona de colocación válida y envía la solicitud de generación, THE Admin_Panel SHALL invocar la API_Gateway con el JWT y mostrar un indicador de progreso mientras espera la respuesta.
5. WHEN la API_Gateway devuelve los mockups generados, THE Seccion_Mockups SHALL mostrar las imágenes frontal y trasera y confirmar con una Toast_Notification que el mockup quedó en estado `pending_approval`.
6. IF la API_Gateway devuelve error durante la generación de mockup, THEN THE Seccion_Mockups SHALL mostrar una Toast_Notification de error con el motivo recibido y SHALL mantener el formulario con los valores ingresados por el Admin.

---

### Requirement 6: Cola de Aprobaciones

**User Story:** Como Admin, quiero ver la cola de mockups pendientes de revisión, aprobarlos o rechazarlos con motivo, para que solo los mockups de calidad lleguen al catálogo.

#### Acceptance Criteria

1. WHEN el Admin accede a `#aprobaciones`, THE Seccion_Aprobaciones SHALL obtener los mockups con estado `pending_approval` desde la API_Gateway y mostrarlos ordenados por fecha de generación ascendente (más antiguos primero).
2. THE Seccion_Aprobaciones SHALL mostrar por cada mockup: imágenes frontal y trasera, nombre del patrón de origen, tipo de prenda y fecha de generación.
3. WHEN el Admin selecciona "Aprobar" en un mockup, THE Admin_Panel SHALL invocar la API_Gateway para actualizar el estado a `approved` y eliminar el mockup de la cola visible tras recibir respuesta exitosa.
4. WHEN el Admin selecciona "Rechazar" en un mockup, THE Seccion_Aprobaciones SHALL mostrar un campo de texto obligatorio para el motivo de rechazo de entre 1 y 500 caracteres antes de habilitar la confirmación.
5. WHEN el Admin confirma el rechazo con motivo válido, THE Admin_Panel SHALL invocar la API_Gateway para actualizar el estado a `rejected` con el motivo y eliminar el mockup de la cola visible tras recibir respuesta exitosa.
6. IF la API_Gateway devuelve error al aprobar o rechazar, THEN THE Seccion_Aprobaciones SHALL mostrar una Toast_Notification de error y SHALL mantener el mockup en la cola con su estado anterior.
7. THE Seccion_Aprobaciones SHALL mostrar el total de mockups pendientes como contador en el ítem de navegación correspondiente.

---

### Requirement 7: Control de Publicaciones

**User Story:** Como Admin, quiero publicar o despublicar manualmente los mockups aprobados en el sitio de exhibición, para controlar qué productos son visibles para los clientes.

#### Acceptance Criteria

1. WHEN el Admin accede a `#publicaciones`, THE Seccion_Publicaciones SHALL obtener la lista de mockups aprobados desde la API_Gateway y mostrarla con su estado de publicación actual.
2. THE Seccion_Publicaciones SHALL mostrar por cada mockup: imágenes frontal y trasera en miniatura, nombre del producto, estado de publicación (`published` / `unpublished`) y fecha de última acción.
3. WHEN el Admin selecciona "Publicar" en un mockup con estado `approved` y no publicado, THE Admin_Panel SHALL invocar la API_Gateway para marcarlo como `published` y mostrar una Toast_Notification de confirmación al recibir respuesta exitosa.
4. WHEN el Admin selecciona "Despublicar" en un mockup publicado, THE Admin_Panel SHALL invocar la API_Gateway para marcarlo como `unpublished` y mostrar una Toast_Notification de confirmación al recibir respuesta exitosa.
5. IF la API_Gateway devuelve error al publicar o despublicar, THEN THE Seccion_Publicaciones SHALL mostrar una Toast_Notification de error y SHALL mantener el estado de publicación anterior del mockup en la vista.
6. THE Seccion_Publicaciones SHALL permitir filtrar la lista por estado de publicación: todos, publicados y no publicados.
7. WHEN el Admin intenta publicar un mockup cuyo estado en la API_Gateway no sea `approved`, THE Admin_Panel SHALL mostrar una Toast_Notification de error indicando que solo los mockups aprobados pueden publicarse y SHALL cancelar la operación.

---

### Requirement 8: Gestión de Contenido para Redes Sociales

**User Story:** Como Admin, quiero revisar el contenido generado automáticamente para Instagram y Facebook y descargarlo para publicarlo manualmente, para mantener presencia en redes sin redactar contenido desde cero.

#### Acceptance Criteria

1. WHEN el Admin accede a `#redes`, THE Seccion_Redes SHALL obtener la lista de contenidos generados desde la API_Gateway y mostrarla ordenada por fecha de generación descendente.
2. THE Seccion_Redes SHALL mostrar por cada contenido: imagen para Instagram (1080×1080 px), imagen para Facebook (1200×630 px), texto sugerido del caption y estado de revisión.
3. WHEN el Admin selecciona descargar la imagen de Instagram, THE Admin_Panel SHALL iniciar la descarga del archivo PNG directamente desde la URL presignada de S3 en el navegador del Admin.
4. WHEN el Admin selecciona descargar la imagen de Facebook, THE Admin_Panel SHALL iniciar la descarga del archivo PNG directamente desde la URL presignada de S3 en el navegador del Admin.
5. THE Seccion_Redes SHALL mostrar el caption sugerido en un campo de texto de solo lectura con botón de copiar al portapapeles.
6. WHEN el Admin selecciona copiar el caption, THE Admin_Panel SHALL copiar el texto al portapapeles del navegador usando la API `navigator.clipboard.writeText` y mostrar una Toast_Notification de confirmación.
7. IF la API_Gateway devuelve una lista vacía de contenidos generados, THEN THE Seccion_Redes SHALL mostrar un mensaje informativo indicando que no hay contenido disponible y SHALL ofrecer un enlace de acceso directo a `#publicaciones`.
8. WHEN el Admin selecciona "Reintentar generación" en un contenido con error, THE Admin_Panel SHALL invocar la API_Gateway para reiniciar la generación y mostrar una Toast_Notification de confirmación.

---

### Requirement 9: Infraestructura de la SPA y Despliegue

**User Story:** Como desarrollador, quiero que el Admin_Panel se construya y despliegue como SPA estática en `/admin/` del bucket S3/CloudFront existente, sin añadir costes a la infraestructura actual.

#### Acceptance Criteria

1. THE Admin_Panel SHALL desplegarse como archivos estáticos (HTML, CSS, JS) en la ruta `/admin/` del bucket S3 existente y ser servido a través de la distribución CloudFront con OAI vigente.
2. THE Admin_Panel SHALL construirse con Vanilla JS (ES2022) y TailwindCSS sin frameworks SPA adicionales, manteniendo una única entrada `admin/index.html`.
3. THE Admin_Panel SHALL usar el CDN de jsPDF desde un hash de integridad verificado para la generación local de PDFs, sin instalar dependencias de servidor.
4. THE Admin_Panel SHALL requerir la configuración de una regla de CloudFront que dirija todas las solicitudes bajo `/admin/*` al archivo `admin/index.html` para permitir el Hash_Router.
5. THE Admin_Panel SHALL cargar todos los activos estáticos (JS, CSS, imágenes) a través de rutas relativas compatibles con el prefijo `/admin/` de CloudFront.
6. WHILE el Admin_Panel se sirve por CloudFront, THE Admin_Panel SHALL incluir la cabecera `Content-Security-Policy` que permita únicamente el origen de la API_Gateway y los orígenes de Cognito como fuentes de conexión externas.
7. THE Admin_Panel SHALL implementar la Brand_Config usando la misma configuración de `tailwind.config` que el sitio de exhibición, garantizando coherencia visual sin duplicar la definición de la paleta.

---

### Requirement 10: Retroalimentación y Manejo de Errores

**User Story:** Como Admin, quiero recibir retroalimentación visual clara ante cada acción y error de red para saber siempre qué está ocurriendo en el panel.

#### Acceptance Criteria

1. WHEN el Admin_Panel realiza cualquier llamada a la API_Gateway, THE Admin_Panel SHALL mostrar un indicador de carga visible en el elemento interactivo que originó la acción hasta recibir respuesta.
2. WHEN la API_Gateway devuelve una respuesta exitosa a una acción del Admin, THE Admin_Panel SHALL mostrar una Toast_Notification de éxito con descripción de la operación completada y la descartará automáticamente tras 4 segundos.
3. IF la API_Gateway devuelve un error HTTP 4xx o 5xx, THEN THE Admin_Panel SHALL mostrar una Toast_Notification de error con el código y el mensaje recibido, sin descartar la notificación automáticamente.
4. IF el navegador del Admin pierde conectividad de red, THEN THE Admin_Panel SHALL mostrar un mensaje de advertencia persistente indicando la pérdida de conexión y SHALL deshabilitar los botones de acción que requieren la API_Gateway mientras dure la desconexión.
5. WHEN se recupera la conectividad de red, THE Admin_Panel SHALL ocultar el mensaje de advertencia y rehabilitar los botones de acción.
6. THE Admin_Panel SHALL registrar en `console.error` todos los errores de red y de API con: URL del endpoint, código de estado, método HTTP y marca de tiempo UTC ISO 8601, sin incluir el JWT ni datos sensibles en el log.
7. THE Admin_Panel SHALL implementar todas las Toast_Notification con el atributo `role="alert"` para accesibilidad conforme a WCAG 2.1 AA.
