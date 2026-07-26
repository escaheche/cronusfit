# Requirements Document

## Introduction

Sistema de generación, revisión y exportación de patrones de corte paramétricos para CronusFit. El sistema produce patrones para prendas deportivas a partir de plantillas paramétricas, medidas físicas confirmadas y, cuando existe, una referencia visual. Soporta niños (tallas 2T–16) y adultos (tallas XS–6XL), con perfiles anatómicos y tablas de grading independientes.

Una referencia visual puede orientar una propuesta, pero no puede producir por sí sola un `Production_Output` exacto. Toda salida basada en una referencia requiere medidas físicas confirmadas y una referencia de escala cuando alguna dimensión dependa de la referencia. El Admin debe revisar y confirmar medidas, escala, orientación, geometría y advertencias antes de aprobar una salida basada en una referencia.

Las medidas físicas y los valores de `Control_Point` se normalizan internamente a milímetros y admiten de 10 a 2000 mm, equivalentes a 1–200 cm. Las dimensiones geométricas de cada pieza SVG admiten de 1 a 2000 mm. Toda salida de producción conserva escala real 1:1. El sistema separa `Production_Output`, fuente técnica para corte, de `Preview_Output`, representación de revisión.

## Glossary

- **Pattern_Generator**: Servicio backend que genera, analiza, valida, revisa y exporta patrones.
- **Parametric_Template**: Plantilla matemática asociada a un `Garment_Type` y `Age_Group`, con puntos de control y un `ProportionProfile`.
- **Pattern_Storage**: Almacenamiento S3 de referencias, patrones y exportaciones; el acceso se realiza mediante URLs presignadas.
- **Pattern_Registry**: Registro DynamoDB de patrones, referencias, análisis, versiones, configuraciones, decisiones y diagnósticos.
- **SVG_Pattern**: Documento SVG 1.1 con piezas, márgenes, hilo, piquetes, etiquetas y metadatos; las coordenadas usan milímetros.
- **Production_Output**: SVG o PDF técnico completo destinado a corte o impresión 1:1. La geometría y las medidas son la fuente de verdad de producción.
- **Preview_Output**: Vista o imagen de revisión que puede encuadrar piezas, sin modificar la geometría, las coordenadas ni la escala de `Production_Output`.
- **Watermark_Layer**: Capa visual independiente para branding de CronusFit en previews y exportaciones no productivas; nunca forma parte de la geometría de corte.
- **Branding_Config**: Configuración de texto o logo, opacidad, posición, tamaño y tipo de salida para `Watermark_Layer` y para metadatos de atribución.
- **Attribution_Metadata**: Metadatos de autoría y procedencia de CronusFit, patrón, versión, fecha UTC ISO 8601 y Admin; no son una marca visual.
- **Pattern_Geometry**: Contornos, márgenes, marcas técnicas, etiquetas y límites calculados de un patrón.
- **Geometry_Validation**: Validación de cierre, degeneración, finitud, deformación, dimensiones, escala, encuadre, recorte y legibilidad.
- **Geometry_Limits**: Límites geométricos de 1–2000 mm de ancho y alto por pieza; el lienzo puede tener como máximo 10000 mm de ancho y alto.
- **Garment_Type**: Tipo de prenda; tipos estándar: camiseta, short, legging, sudadera y tank top; también admite tipos personalizados.
- **Age_Group**: `children` para tallas 2T–16 o `adult` para tallas XS–6XL.
- **Children_Size**: 2T, 4T, 6, 8, 10, 12, 14 y 16.
- **Adult_Size**: XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL y 6XL.
- **ProportionProfile**: Perfil anatómico de `Age_Group` que define relaciones de torso, extremidades, cintura y hombros/cadera.
- **Grading_Increment_Table**: Incrementos de medida entre tallas consecutivas, separados por `Age_Group`.
- **Control_Point**: Punto paramétrico con medidas mínima y máxima normalizadas a 10–2000 mm.
- **Physical_Measurement**: Medida corporal o de prenda física confirmada por el Admin, con nombre, valor normalizado en milímetros, tolerancia y método de toma.
- **Seam_Allowance**: Margen de costura configurable de 5–30 mm, con valor predeterminado de 15 mm.
- **Pieza_de_Patron**: Componente individual del patrón, representado como grupo SVG identificable.
- **Piquete**: Marca de alineación en el borde de una pieza.
- **Hilo_de_la_Tela**: Línea que indica la dirección de colocación de una pieza sobre la tela.
- **Reference_Media**: PDF, JPG o JPEG cargado por el Admin para orientar el diseño.
- **Reference_Image**: JPG, JPEG o página rasterizada de PDF usada como evidencia visual.
- **Garment_Orientation**: Orientación declarada: frente, espalda, lateral, interior, vista plana o vista no determinada.
- **Scale_Reference**: Regla, patrón calibrado o distancia conocida con valor, unidad, ubicación y evidencia suficiente para convertir dimensiones visuales.
- **Reference_Analysis**: Informe con secciones separadas de observaciones, inferencias y datos no observables; cada elemento incluye confianza, evidencia y warnings.
- **Confidence_Level**: `alto`, `medio` o `bajo`, siempre acompañado de evidencia y explicación.
- **Warning**: Advertencia explícita sobre limitación, ambigüedad o dato pendiente de confirmación.
- **Human_Review**: Revisión mediante la cual el Admin acepta, edita, completa, sustituye o rechaza propuestas y warnings.
- **Export_Profile**: Perfil de formato, talla, escala, papel, mosaico, solapamiento, marcas, calibración y metadatos para exportación local en el navegador del Admin.
- **Production_PDF**: PDF técnico generado localmente en el navegador del Admin, a escala real 1:1; fuente de producción para corte junto con el SVG; no se almacena en S3.
- **Tiled_PDF**: PDF de mosaico generado localmente en el navegador del Admin en hojas A4 o Letter, sin cambio de escala, con solapamiento, registro, numeración y calibración; no se almacena en S3.
- **Editable_Document**: Documento Word o RTF generado localmente en el navegador del Admin para revisión que conserva diagramas, etiquetas y medidas, pero no es fuente de corte; no se almacena en S3.
- **Panel_Admin**: Interfaz de administración que corre en el navegador del Admin y ejecuta la exportación, impresión y previsualización localmente sin invocar Lambda adicional.
- **Calibration_Page**: Página con regla y figura de prueba para comprobar escala antes de imprimir.
- **Partial_Output**: Archivo, geometría, exportación o registro de salida incompleto de una operación fallida.
- **UNRESOLVED**: Estado de validación no concluyente que impide aprobar o entregar una salida.
- **Media_Registration_Status**: Estado `media_registered=true` que indica que una referencia de imagen viable fue aceptada y registrada.
- **Review_Status**: Estados `CONFIRMED`, `APPROVED`, `VALID`, `INVALID` y `TIMEOUT` usados para medidas, revisión, validación y ejecución.
- **Timeout_Condition**: Señal verificable de infraestructura o cancelación que finaliza una operación antes de su límite temporal.
- **Admin**: Administrador que carga referencias, introduce medidas, revisa análisis, configura branding, aprueba patrones y gestiona exportaciones.

## Requirements

### Requirement 1: Generación desde Plantillas Paramétricas

**User Story:** Como Admin, quiero seleccionar una prenda, talla y medidas para obtener un patrón técnico sin dibujarlo manualmente.

#### Acceptance Criteria

1. WHEN el Admin selecciona un `Garment_Type`, un `Age_Group`, una talla válida, todas las `Physical_Measurement` obligatorias confirmadas y una `Parametric_Template` válida, THE `Pattern_Generator` SHALL generar un `SVG_Pattern` completo en un máximo de 10 segundos.
2. THE `Pattern_Generator` SHALL proporcionar plantillas para camiseta, short, legging, sudadera y tank top.
3. THE `Pattern_Generator` SHALL proporcionar una `Parametric_Template` independiente para cada combinación de tipo estándar y `Age_Group`.
4. WHEN el Admin genera un patrón, THE `Pattern_Generator` SHALL aplicar el `ProportionProfile` correspondiente al `Age_Group`.
5. WHEN el Admin genera un patrón, THE `Pattern_Generator` SHALL aplicar `Seam_Allowance` entre 5 y 30 mm, usando 15 mm cuando el Admin no especifique otro valor.
6. WHEN el Admin genera un patrón y cada `Pieza_de_Patron` está completa, THE `Pattern_Generator` SHALL incluir la línea de `Hilo_de_la_Tela`, los `Piquetes` requeridos y las etiquetas de nombre, talla y cantidad de corte.
7. WHEN el Admin usa `Reference_Media`, THE `Pattern_Generator` SHALL tratar la referencia como guía y no como sustituto de `Physical_Measurement` confirmada.
8. IF una `Physical_Measurement` obligatoria está ausente, fuera de 10–2000 mm o sin estado `CONFIRMED`, THEN THE `Pattern_Generator` SHALL rechazar la generación, identificar cada campo afectado y conservar únicamente los datos de entrada del Admin.
9. IF la `Parametric_Template` seleccionada no existe o no es válida, THEN THE `Pattern_Generator` SHALL rechazar la generación e identificar `Garment_Type`, `Age_Group` y talla afectados.
10. WHEN una solicitud basada en referencia tiene una `Scale_Reference` válida, precisión de píxeles garantizada y todas las `Physical_Measurement` obligatorias confirmadas, THE `Pattern_Generator` SHALL permitir la creación de `Production_Output` exacto.
11. IF una validación de generación falla, THEN THE `Pattern_Generator` SHALL evitar entregar, almacenar o registrar cualquier `Partial_Output`.
12. WHEN el Admin genera un patrón completo, THE `Pattern_Generator` SHALL incluir `Attribution_Metadata` y metadatos de patrón, talla, versión, fecha UTC ISO 8601 y Admin creador.

### Requirement 2: Carga y Análisis Asistido de Referencias

**User Story:** Como Admin, quiero cargar una foto o PDF de una prenda para recibir una propuesta revisable de piezas y parámetros.

#### Acceptance Criteria

1. WHEN el Admin carga una `Reference_Media`, THE `Pattern_Generator` SHALL aceptar PDF, JPG y JPEG cuando extensión y tipo MIME sean compatibles.
2. WHEN el Admin carga PDF, JPG o JPEG, THE `Pattern_Generator` SHALL aceptar como máximo 25 MB, 20 páginas de PDF y 6000 × 6000 píxeles por imagen rasterizada.
3. IF una `Reference_Media` supera tamaño, páginas, resolución, extensión o MIME, THEN THE `Pattern_Generator` SHALL rechazarla antes del análisis y mostrar el motivo específico.
4. WHEN una `Reference_Media` válida se almacena, THE `Pattern_Storage` SHALL conservar el archivo original sin modificaciones y THE `Pattern_Registry` SHALL registrar identificador, nombre, formato, tamaño, hash, fecha UTC ISO 8601 y Admin.
5. WHEN el Admin solicita `Reference_Analysis`, THE `Pattern_Generator` SHALL separar siempre observaciones visibles, inferencias propuestas y datos no observables.
6. WHEN el `Reference_Analysis` contiene cualquier observación, inferencia o dato no observable, THE `Pattern_Generator` SHALL asociar el elemento con `Confidence_Level`, evidencia, explicación y un conjunto explícito de warnings, aunque el conjunto esté vacío.
7. WHEN el análisis identifica una pieza, costura, abertura, proporción, orientación o parámetro, THE `Pattern_Generator` SHALL presentar la propuesta como editable.
8. IF el análisis no determina una medida, escala, costura, profundidad, holgura, material, vista oculta u otro dato de construcción, THEN THE `Pattern_Generator` SHALL crear un `Warning` específico y clasificar únicamente ese dato como no observable.
9. WHEN el análisis determina una medida mediante evidencia, THE `Pattern_Generator` SHALL clasificarla como observación o inferencia con su evidencia y SHALL impedir su clasificación como dato no observable, aunque la evidencia sea insuficiente para producción.
10. IF una `Reference_Media` no contiene una `Scale_Reference` válida o la precisión de píxeles no puede garantizarse, THEN THE `Pattern_Generator` SHALL advertir la limitación y SHALL bloquear `Production_Output` basado en dimensiones visuales, incluso cuando exista una `Scale_Reference`.
11. WHEN el Admin aporta una `Scale_Reference`, THE `Pattern_Generator` SHALL registrar valor normalizado, unidad de entrada, ubicación, fuente y evidencia.
12. IF el análisis propone una medida inferida, THEN THE `Pattern_Generator` SHALL exigir confirmación de `Physical_Measurement` antes de permitir que la medida sea dependencia de una propuesta.
13. IF el análisis no contiene evidencia suficiente para una pieza o geometría mínima, THEN THE `Pattern_Generator` SHALL producir un informe sin geometría de producción, enumerar la información faltante y permitir continuar con `Parametric_Template` y edición manual.
14. WHEN una referencia muestra un short con calza y existe evidencia separada, THE `Pattern_Generator` SHALL permitir proponer short exterior y calza interior como piezas independientes.
15. IF la orientación de una referencia no es determinable, THEN THE `Pattern_Generator` SHALL solicitar confirmación de `Garment_Orientation` antes de usar la inferencia.
16. THE `Pattern_Generator` SHALL describir `Reference_Analysis` como asistencia de diseño y SHALL informar que una imagen de referencia no garantiza un patrón exacto ni listo para producción.

### Requirement 3: Medidas Físicas, Orientación y Escala

**User Story:** Como Admin, quiero confirmar medidas, orientación y escala antes de aprobar una propuesta visual.

#### Acceptance Criteria

1. WHEN el Admin usa `Reference_Media` para generar una propuesta, THE `Pattern_Generator` SHALL solicitar las `Physical_Measurement` obligatorias de la `Parametric_Template`.
2. WHEN el Admin registra una `Physical_Measurement`, THE `Pattern_Generator` SHALL convertir la unidad de entrada a milímetros antes de validarla.
3. WHEN el Admin registra una `Physical_Measurement`, THE `Pattern_Generator` SHALL requerir nombre, valor entre 10 y 2000 mm, método de toma y tolerancia no negativa en milímetros.
4. IF una propuesta depende de una medida inferida que no tiene `Physical_Measurement` en estado `CONFIRMED`, THEN THE `Pattern_Generator` SHALL bloquear `Production_Output` basado en la propuesta y SHALL mantener la dependencia pendiente de confirmación.
5. WHEN el Admin confirma una `Physical_Measurement` inferida, THE `Pattern_Generator` SHALL permitir que la medida confirmada sea dependencia de la propuesta.
6. WHEN el Admin confirma `Garment_Orientation`, THE `Pattern_Generator` SHALL registrar orientación, evidencia, fuente, Admin y fecha UTC ISO 8601.
7. IF perspectiva, deformación, oclusión o fondo impide determinar escala o geometría, THEN THE `Pattern_Generator` SHALL crear un `Warning` específico y bloquear `Production_Output` dependiente de la referencia.
8. WHEN una dimensión de `Production_Output` depende de `Reference_Media`, THE `Pattern_Generator` SHALL exigir una `Scale_Reference` válida aunque el estado de las `Physical_Measurement` todavía no sea `CONFIRMED`.
9. WHEN las medidas obligatorias y las referencias de escala aplicables están confirmadas, THE `Pattern_Generator` SHALL mostrar valores, tolerancias, unidades, fuentes y evidencia y SHALL permitir producción solo después de esa confirmación.
10. IF `Reference_Media` contradice una `Physical_Measurement` confirmada, THEN THE `Pattern_Generator` SHALL bloquear aprobación hasta que el Admin resuelva y registre la discrepancia.
11. WHEN el Admin completa una propuesta mediante edición manual, THE `Pattern_Generator` SHALL registrar valor anterior, valor final, fuente, Admin y fecha UTC ISO 8601.
12. WHEN el Admin solicita un patrón sin `Reference_Analysis`, THE `Pattern_Generator` SHALL permitir el flujo paramétrico con `Physical_Measurement` confirmadas y `Parametric_Template` válida.

### Requirement 4: Revisión Humana, Edición y Aprobación

**User Story:** Como Admin, quiero revisar y editar las propuestas antes de usarlas en producción.

#### Acceptance Criteria

1. WHEN existe `Reference_Analysis`, THE `Pattern_Generator` SHALL mostrar observaciones, inferencias y datos no observables por separado, con confianza, evidencia, warnings, orientación y estado de revisión.
2. WHEN el Admin revisa una propuesta, THE `Pattern_Generator` SHALL permitir aceptarla, editarla, completar medidas, sustituirla por una `Parametric_Template` o rechazarla.
3. IF una propuesta conserva cualquier `Warning` no resuelto, THEN THE `Pattern_Generator` SHALL impedir su aprobación para producción, sin excepción por tipo o severidad.
4. IF una propuesta carece de medida obligatoria confirmada o de `Scale_Reference` aplicable, THEN THE `Pattern_Generator` SHALL impedir su aprobación como `Production_Output`.
5. WHEN el Admin aprueba una propuesta, THE `Pattern_Registry` SHALL registrar estado, Admin, fecha UTC ISO 8601, versión del análisis, evidencia y cambios manuales.
6. WHEN el Admin edita un patrón derivado de análisis, THE `Pattern_Generator` SHALL crear una versión nueva y conservar la referencia y el historial originales.
7. WHEN el Admin confirma una propuesta para producción, THE `Pattern_Generator` SHALL exigir estado `APPROVED` y SHALL mostrar confirmación explícita de que la referencia visual no sustituye las medidas físicas confirmadas.
8. WHEN el Admin rechaza una propuesta, THE `Pattern_Generator` SHALL conservar el motivo y permitir continuar desde una plantilla paramétrica.

### Requirement 5: Plantillas Personalizadas y Grading

**User Story:** Como Admin, quiero crear tipos de prenda y escalarlos por tallas.

#### Acceptance Criteria

1. WHEN el Admin inicia un `Garment_Type` personalizado, THE `Pattern_Generator` SHALL permitir crear una `Parametric_Template` sin exigir un mínimo de `Control_Point` durante el inicio.
2. WHEN el Admin guarda una `Parametric_Template` personalizada, THE `Pattern_Generator` SHALL requerir `Age_Group` `children` o `adult`.
3. WHEN el Admin define un `Control_Point`, THE `Pattern_Generator` SHALL validar valores mínimo y máximo entre 10 y 2000 mm.
4. IF una plantilla personalizada contiene menos de 4 `Control_Point` o valores fuera de rango, THEN THE `Pattern_Generator` SHALL marcarla como incompleta, identificar cada problema y mantenerla editable.
5. WHEN una plantilla contiene al menos 4 `Control_Point` válidos, geometría válida, estructura válida y estado `VALID`, THE `Pattern_Registry` SHALL almacenarla para generación y grading.
6. IF una plantilla está rechazada por el Admin o por una validación, tiene estado no definitivo o presenta geometría o estructura inválida, THEN THE `Pattern_Registry` SHALL bloquear su almacenamiento y uso.
7. WHEN el Admin selecciona un `Age_Group` y tallas válidas, THE `Pattern_Generator` SHALL generar un patrón por talla o capas inequívocamente etiquetadas según la preferencia del Admin.
8. WHEN se aplica grading a `Children_Size`, THE `Pattern_Generator` SHALL usar exclusivamente tabla de niños y proporciones infantiles.
9. WHEN se aplica grading a `Adult_Size`, THE `Pattern_Generator` SHALL usar exclusivamente tabla de adultos y conservar relaciones proporcionales de ancho y largo.
10. WHEN el Admin configura una `Grading_Increment_Table`, THE `Pattern_Generator` SHALL validar incrementos positivos entre 1 y 100 mm por transición y SHALL aceptar la tabla solo cuando todas las transiciones aplicables sean válidas y no falle otra regla de validación definida.
11. IF falta una tabla de grading o la geometría base es inválida, THEN THE `Pattern_Generator` SHALL rechazar el grading completo y mostrar la causa específica.
12. WHEN el Admin solicita grading de un conjunto de tallas, THE `Pattern_Generator` SHALL completarlo en un máximo de 30 segundos, con una gracia máxima de 2 segundos solo durante la fase final.
13. WHEN el grading es válido, THE `Pattern_Generator` SHALL conservar en cada talla la función de piezas, piquetes, hilo y etiquetas de la plantilla original.

### Requirement 6: Estructura SVG, Escala y Branding

**User Story:** Como operario de CronusFit, quiero un SVG estructurado, legible y atribuible sin alterar la geometría técnica.

#### Acceptance Criteria

1. THE `Pattern_Generator` SHALL representar cada `Pieza_de_Patron` como un grupo `<g>` con identificador único y estable.
2. THE `Pattern_Generator` SHALL representar cada contorno de corte como un `<path>` cerrado y cada `Seam_Allowance` como un `<path>` separado con trazo discontinuo a la distancia configurada.
3. THE `Pattern_Generator` SHALL representar `Hilo_de_la_Tela` como `<line>` y `Piquetes` como marcas perpendiculares de 3 mm donde la pieza los requiera.
4. WHEN el `Pattern_Generator` genera un `SVG_Pattern`, THE `Pattern_Generator` SHALL incluir en cada pieza nombre, talla y cantidad de corte.
5. THE `Pattern_Generator` SHALL definir `width`, `height` y `viewBox` en milímetros con correspondencia 1:1 entre coordenadas y medidas físicas.
6. WHEN el `Pattern_Generator` valida un `SVG_Pattern` y la validación es exitosa, THE `Pattern_Generator` SHALL registrar el estado `VALID` conforme a SVG 1.1 antes de entregar o almacenar la salida elegida; WHEN la validación falla, THE `Pattern_Generator` SHALL abstenerse de registrar un estado de validación exitoso.
7. WHEN el `Pattern_Generator` genera un `Production_Output`, THE `Pattern_Generator` SHALL incluir `Attribution_Metadata` de CronusFit y SHALL garantizar que no exista `Watermark_Layer` visible.
8. WHEN el Admin configura `Watermark_Layer` para `Preview_Output` o exportación no productiva con opacidad mayor que 0%, THE `Pattern_Generator` SHALL incluirla como capa visual independiente de la geometría.
9. WHEN `Branding_Config` establece opacidad de 0% para `Preview_Output` o exportación no productiva, THE `Pattern_Generator` SHALL generar la salida sin marca visible y SHALL registrar que no existe `Watermark_Layer` visible.
10. WHEN `Branding_Config` establece cualquier opacidad para `Production_Output`, THE `Pattern_Generator` SHALL generar la salida sin marca visible.
11. WHEN el `Pattern_Generator` aplica una marca visible, THE `Pattern_Generator` SHALL colocarla sin cubrir, recortar, alterar ni deformar contornos, medidas, etiquetas o marcas técnicas.
12. WHEN el `Pattern_Generator` genera un `Production_Output`, THE `Pattern_Generator` SHALL excluir la marca visual y exigir `Attribution_Metadata` y metadatos técnicos completos.
13. IF la aplicación de `Watermark_Layer`, la generación de metadatos o la validación SVG falla, THEN THE `Pattern_Generator` SHALL rechazar la operación y no entregar, almacenar ni registrar un `Partial_Output`.
14. WHEN una marca visible se aplica correctamente, THE `Pattern_Registry` SHALL registrar configuración, opacidad, posición, tamaño, tipo de salida y Admin configurador.

### Requirement 7: Validación Geométrica y Preview

**User Story:** Como Admin, quiero detectar geometría abierta, degenerada, deformada, ilegible o fuera de escala antes de aprobar o exportar.

#### Acceptance Criteria

1. WHEN el `Pattern_Generator` recibe una solicitud de generación, grading, edición, preview o exportación, THE `Geometry_Validation` SHALL ejecutarse antes de crear, almacenar o entregar el archivo.
2. WHEN `Geometry_Validation` revisa una pieza, THE `Geometry_Validation` SHALL comprobar contorno cerrado, área mayor que 0 mm², coordenadas finitas y dimensiones entre 1 y 2000 mm de ancho y alto.
3. IF `Geometry_Validation` detecta un contorno abierto, línea o triángulo degenerado, área cero, coordenada no finita, dimensión fuera de `Geometry_Limits` o deformación de escala y puede identificar la pieza y la causa, THEN THE `Pattern_Generator` SHALL rechazar la operación e informar ambos datos.
4. WHEN `Geometry_Validation` detecta un problema geométrico pero no puede identificar simultáneamente la pieza y la causa, THE `Pattern_Generator` SHALL emitir un diagnóstico no concluyente con estado `UNRESOLVED` y SHALL mantener la salida fuera de aprobación.
5. WHEN `Geometry_Validation` revisa el documento, THE `Geometry_Validation` SHALL comprobar que el lienzo sea finito, positivo, no mayor de 10000 mm por dimensión y coherente con el `viewBox`.
6. WHEN `Geometry_Validation` revisa el encuadre, THE `Geometry_Validation` SHALL comprobar que todas las piezas estén dentro del `viewBox`, que ninguna salida esté recortada y que el espacio vacío no exceda 10 mm por lado.
7. IF el `viewBox` está fuera de escala, no encuadra todas las piezas o presenta demasiado espacio vacío, THEN THE `Pattern_Generator` SHALL rechazar la salida y mostrar límites calculados y corrección requerida.
8. WHEN `Geometry_Validation` revisa una vista, THE `Geometry_Validation` SHALL comprobar que orientación, proporciones y transformaciones sean coherentes.
9. IF `Geometry_Validation` detecta trazos, etiquetas o piezas ilegibles o indistinguibles, THEN THE `Pattern_Generator` SHALL rechazar el `Preview_Output` y exigir corrección antes de aprobarlo.
10. WHEN el Admin usa zoom, paneo, selección o reencuadre, THE `Pattern_Generator` SHALL aplicar únicamente transformaciones uniformes de visualización al `Preview_Output`.
11. WHEN el Admin usa zoom, paneo, selección o reencuadre, THE `Pattern_Generator` SHALL conservar sin cambios la geometría, dimensiones, coordenadas y escala de `Production_Output`.
12. WHEN todas las reglas de `Geometry_Validation` son válidas, THE `Pattern_Generator` SHALL generar un `Preview_Output` encuadrado en la unión de las piezas y con proporciones espaciales conservadas.
13. IF `Geometry_Validation` confirma geometría inválida con pieza y causa identificables, THEN THE `Pattern_Generator` SHALL rechazar la solicitud y evitar entregar, almacenar o registrar cualquier `Partial_Output`.
14. WHEN el Admin aprueba un patrón, THE `Pattern_Registry` SHALL almacenar resultado de validación, versión geométrica, límites calculados, tolerancias y warnings resueltos.

### Requirement 8: Exportación e Impresión Local

**User Story:** Como Admin, quiero exportar e imprimir patrones directamente desde mi navegador sin depender de la nube, para no generar costos de almacenamiento ni de procesamiento en AWS.

#### Acceptance Criteria

1. WHEN el Admin solicita exportar un `SVG_Pattern` aprobado, THE `Panel_Admin` SHALL descargar el SVG desde la URL presignada de S3 y ejecutar toda la conversión completamente en el navegador del Admin, sin invocar Lambda adicional ni escribir archivos de exportación en S3.
2. WHEN el Admin solicita `Production_PDF`, THE `Panel_Admin` SHALL generar el PDF en el navegador usando el SVG descargado, conservar la escala 1:1 con coordenadas en milímetros y ofrecer descarga directa al equipo del Admin sin subir el PDF a S3.
3. WHEN el Admin solicita `Tiled_PDF`, THE `Panel_Admin` SHALL dividir el SVG en hojas A4 (210 × 297 mm) o Letter (215.9 × 279.4 mm) en el navegador, aplicar el solapamiento configurado entre 0 y 50 mm, incluir marcas de registro en bordes compartidos y numeración inequívoca de hojas, y ofrecer descarga directa sin almacenar el PDF en la nube.
4. WHEN el Admin solicita `Tiled_PDF`, THE `Panel_Admin` SHALL incluir una `Calibration_Page` con regla de 100 mm e instrucción de imprimir al 100% de tamaño real antes de las hojas del mosaico.
5. WHEN el Admin solicita imprimir, THE `Panel_Admin` SHALL invocar `window.print()` con estilos CSS `@media print` configurados para escala real, sin márgenes y con tamaño de página calculado desde el `viewBox` del SVG, sin enviar datos a ningún servicio externo.
6. THE `Panel_Admin` SHALL implementar la exportación usando únicamente librerías JavaScript que se ejecuten en el navegador del Admin, sin dependencias de servidor ni de servicios externos de pago.
7. THE `Panel_Admin` SHALL ejecutar `Geometry_Validation` sobre el SVG descargado antes de iniciar cualquier conversión y SHALL mostrar un diagnóstico al Admin si la validación falla, sin generar ningún archivo de exportación.
8. WHEN el Admin selecciona una talla para exportar, THE `Panel_Admin` SHALL incluir la talla en el nombre del archivo descargado, en las etiquetas de las piezas y en los metadatos del PDF.
9. WHEN el Admin selecciona varias tallas, THE `Panel_Admin` SHALL permitir descargar un archivo por talla o un único PDF con capas y etiquetas inequívocas por talla.
10. THE `Panel_Admin` SHALL aplicar `Watermark_Layer` visible en `Preview_Output` y exportaciones de revisión conforme a `Branding_Config`, y SHALL excluir la marca visual de `Production_Output` conservando únicamente `Attribution_Metadata` de CronusFit.
11. THE `Panel_Admin` SHALL identificar cada exportación Word o RTF como formato de revisión y no como fuente técnica de corte, mostrando esta indicación junto al enlace de descarga.
12. IF la descarga del SVG desde la URL presignada falla, THEN THE `Panel_Admin` SHALL informar el error al Admin, SHALL evitar iniciar la conversión y SHALL conservar sin cambios los parámetros de la solicitud.

### Requirement 9: Serialización y Persistencia

**User Story:** Como desarrollador, quiero serializar, recuperar y versionar patrones sin pérdida de geometría ni trazabilidad.

#### Acceptance Criteria

1. THE `Pattern_Generator` SHALL serializar `SVG_Pattern` en JSON conservando geometrías, `Control_Point`, `Seam_Allowance`, hilo, piquetes, etiquetas, medidas, tolerancias, `viewBox`, branding y metadatos.
2. WHEN el `Pattern_Generator` deserializa JSON, THE `Pattern_Generator` SHALL validar el JSON y el `SVG_Pattern` resultante conforme a SVG 1.1 antes de aceptar una salida.
3. WHEN un patrón se serializa, deserializa y serializa de nuevo, THE `Pattern_Generator` SHALL conservar claves, valores y estructura equivalentes después de normalizar el orden de claves.
4. WHEN un patrón se deserializa, THE `Pattern_Generator` SHALL conservar geometrías, dimensiones y posiciones con tolerancia máxima de 0.01 mm.
5. IF JSON está malformado, incompleto o produce SVG inválido, THEN THE `Pattern_Generator` SHALL devolver un diagnóstico con los campos afectados y SHALL producir cero patrones o salidas parciales.
6. WHEN el contenido serializado excede 400 KB y S3 está disponible, THE `Pattern_Generator` SHALL usar S3 para conservar el contenido completo.
7. IF el contenido serializado excede 400 KB y S3 no está disponible, THEN THE `Pattern_Generator` SHALL rechazar la serialización sin pérdida ni salida parcial.
8. IF el contenido serializado excede 400 KB y el almacenamiento en S3 falla, THEN THE `Pattern_Generator` SHALL rechazar la operación sin usar un almacenamiento alternativo ni crear una salida parcial.
9. WHEN el patrón se reconstruye desde almacenamiento, THE `Pattern_Generator` SHALL conservar referencia, análisis, historial, medidas, escala, branding y validaciones y SHALL exigir JSON estructuralmente equivalente y SVG válido conforme a SVG 1.1.
10. THE `Pattern_Generator` SHALL producir únicamente patrones completos y SHALL evitar cualquier `Partial_Output`, independientemente de la validez o invalidez del JSON de entrada.
11. IF la serialización, deserialización o recuperación falla, o el patrón recuperado está incompleto, THEN THE `Pattern_Generator` SHALL evitar entregar, almacenar o registrar un `Partial_Output`.

### Requirement 10: Almacenamiento y Registro

**User Story:** Como Admin, quiero consultar patrones, referencias, decisiones y exportaciones con trazabilidad completa.

#### Acceptance Criteria

1. WHEN el `Pattern_Generator` produce un `Production_Output` SVG completo, THE `Pattern_Storage` SHALL almacenarlo en `patterns/{patternId}/pattern.svg`.
2. WHEN el `Pattern_Generator` produce un PDF o `Editable_Document` completo, THE `Pattern_Storage` SHALL almacenarlo bajo `patterns/{patternId}/exports/{exportId}`.
3. WHEN una `Reference_Media` válida se almacena, THE `Pattern_Storage` SHALL conservarla bajo una clave relacionada con patrón y referencia y SHALL servirla solo mediante URL presignada.
4. WHEN un patrón completo se almacena, THE `Pattern_Registry` SHALL registrar identificador, `Garment_Type`, `Age_Group`, talla, piezas, margen, método, medidas, escala, fecha UTC ISO 8601 y Admin.
5. WHEN un patrón usa `Reference_Media`, THE `Pattern_Registry` SHALL registrar archivo original, hash, páginas cuando el medio sea PDF, orientación, `Scale_Reference`, `Physical_Measurement`, versión de análisis, confianza, evidencia, warnings y decisiones.
6. WHEN una exportación completa se almacena, THE `Pattern_Registry` SHALL registrar formato, `Export_Profile`, talla, escala, papel, solapamiento, marcas de registro, `Calibration_Page`, configuración de marca visible, atribución y validación.
7. WHEN el Admin solicita la lista de patrones, THE `Pattern_Registry` SHALL devolverlos por fecha de creación descendente y permitir filtros por tipo, grupo etario, talla y tipo de salida.
8. WHEN el Admin solicita un archivo existente, THE `Pattern_Storage` SHALL devolver una URL presignada con expiración de 1 hora.
9. IF el identificador solicitado no existe por cualquier causa, THEN THE `Pattern_Storage` SHALL informar que el patrón o exportación no fue encontrado y SHALL evitar generar o devolver una URL.
10. WHEN el Admin modifica o confirma una inferencia, THE `Pattern_Registry` SHALL registrar valor anterior, valor final, Admin, fecha UTC ISO 8601 y evidencia de origen.
11. IF una operación de almacenamiento falla, THEN THE `Pattern_Storage` SHALL eliminar cualquier artefacto no comprometido y THE `Pattern_Registry` SHALL evitar registrar el `Partial_Output`.

### Requirement 11: Seguridad, Rendimiento y Fallos Transaccionales

**User Story:** Como propietario de CronusFit, quiero proteger patrones y referencias y evitar salidas parciales ante cualquier fallo.

#### Acceptance Criteria

1. THE `Pattern_Generator` SHALL ejecutarse como AWS Lambda sobre Node.js 20.x para generación individual.
2. WHEN el Admin solicita una operación protegida, THE `Pattern_Generator` SHALL validar un JWT válido de Cognito antes de procesar datos o acceder a almacenamiento y registro.
3. IF el Admin carece de JWT válido o falla la validación del JWT, THEN THE `Pattern_Generator` SHALL rechazar la operación antes de asignar recursos, acceder a `Reference_Media`, `Pattern_Storage` o `Pattern_Registry`, o confirmar una salida.
4. WHEN el Admin solicita generación individual válida, la operación concluye a los 15 segundos o antes y no existe `Timeout_Condition`, THE `Pattern_Generator` SHALL completar la operación exitosamente.
5. IF una `Timeout_Condition` de infraestructura o cancelación se activa antes del límite de 15 segundos, THEN THE `Pattern_Generator` SHALL devolver estado `TIMEOUT` aunque el tiempo transcurrido sea inferior al límite.
6. WHEN el Admin con JWT válido solicita grading válido, THE `Pattern_Generator` SHALL completar el lote en un máximo de 30 segundos, con una gracia máxima de 2 segundos solo durante la fase final.
7. IF una operación supera el tiempo máximo aplicable, THEN THE `Pattern_Generator` SHALL devolver estado `TIMEOUT` con causa específica y SHALL evitar entregar, almacenar o registrar cualquier `Partial_Output`.
8. IF falla validación, autenticación, generación, serialización, almacenamiento o exportación, THEN THE `Pattern_Generator` SHALL evitar entregar, almacenar o registrar cualquier `Partial_Output`.
9. WHEN una operación falla, THE `Pattern_Generator` SHALL registrar como máximo el diagnóstico del fallo y los identificadores de trazabilidad, sin registrar contenido de salida parcial.
10. THE `Pattern_Storage` SHALL usar AWS S3 con Block Public Access habilitado y URLs presignadas.
11. THE `Pattern_Registry` SHALL usar una tabla única de AWS DynamoDB para patrones, referencias, análisis, versiones, grading y plantillas.
12. WHEN un archivo completo y su registro son consistentes y no existe fallo de validación, autenticación, almacenamiento o timeout, THE `Pattern_Generator` SHALL confirmar la salida.
