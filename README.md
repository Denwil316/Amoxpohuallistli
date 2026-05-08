# Amoxpohualistli — Entrenador de Lectura Rápida

Aplicación de escritorio para mejorar la velocidad de lectura mediante el método **RSVP** (Rapid Serial Visual Presentation). Muestra las palabras una por una en una posición fija de la pantalla, eliminando la necesidad de mover los ojos y reduciendo la fatiga visual.

## Características

- **RSVP** — Palabras mostradas una a una a velocidad configurable (50–2000 WPM)
- **ORP automático** — Resaltado inteligente de la letra óptima según la longitud de la palabra (1-3→1.ª, 4-5→2.ª, 6-9→3.ª, 10+→4.ª), ignorando puntuación inicial. También disponible modo manual (center, beginning, end, middle, random)
- **Pausas por puntuación** — Pausa extra configurable en finales de frase (`.!?;:` 1-4x) y comas (1.5x)
- **Ralentización de palabras largas** — Tiempo adicional por carácter en palabras ≥12 letras (0-50%)
- **Pausas periódicas** — Pausa de comprensión cada N palabras (100-2000ms)
- **Efecto de fade** — Transición suave de opacidad entre palabras (50-300ms)
- **Modo enfoque** — Interfaz minimalista durante la lectura (oculta toolbar y stats)
- **Marco contextual** — Muestra 1/3/5/7 palabras simultáneas con la actual resaltada en el centro
- **Visor de documento** — Panel lateral con el texto completo del documento renderizado por párrafos; haz clic en cualquier palabra para saltar a ella, o Shift+clic para seleccionar un rango de lectura con resaltado visual
- **Lectura por rango** — Selecciona un fragmento del documento y léelo de corrido sin distracciones; el RSVP se detiene automáticamente al alcanzar el final del rango
- **Barra de progreso interactiva** — Haz clic en cualquier posición de la barra para saltar allí
- **Tiempo restante** — Estimación del tiempo que queda de lectura según WPM actual
- **Estadísticas en vivo** — Words Read, Session Words, Avg Speed (basada en tiempo de lectura real, no tiempo de pared), Time Elapsed, Time Remaining
- **Reanudación de sesión** — Al cerrar la app, guarda automáticamente la posición. Al abrir de nuevo, pregunta si quieres reanudar
- **Soporte RTL** — Detección automática de texto en hebreo/árabe con ajuste de dirección
- **Importación de documentos** — Abre archivos TXT, PDF, DOCX, EPUB, HTML, RTF, ODT y MD
- **Limpieza de texto automática** — Elimina números de página, guiones de división silábica, entradas de índice, reordena texto en columnas, corrige espacios faltantes y divide palabras con doble guión/em-dash
- **Pista de audio sincronizada** — Carga un audio (MP3/WAV/OGG/FLAC/M4A/AAC) y reprodúcelo de fondo mientras lees; la primera vez que presiones Play se inicia junto con el RSVP, luego los controles son independientes
- **Efectos de sonido** — Sube sonidos personalizados para el tic de palabra, inicio y fin de lectura
- **Paleta de colores completa** — 7 colores ajustables por paleta (fondo, secundario, primario, acento, stat-card, stat-value, stat-label); hasta 3 paletas guardables
- **Apariencia** — Tipo de fuente (12 opciones), tamaño (24–200px), color de texto, fondo, acento y colores de estadísticas
- **Atajos de teclado** — Totalmente personalizables desde el panel de ajustes
- **Indicador ORP** — Línea guía opcional para la posición óptima de lectura
- **Historial de sesiones** — Guarda automáticamente el progreso al pausar; permite reabrir documentos desde el historial (máx 50 entradas)
- **Carga fragmentada** — Documentos grandes se cargan en lotes de 5000 palabras para evitar congelar la interfaz
- **Bajo consumo** — App nativa con Python + GTK + WebKit, sin Electron ni runtimes pesados

## Paleta de colores predeterminada

| Color | Código | Uso |
|-------|--------|------|
| Fondo | `#ECF4E8` | Fondo de la aplicación |
| Secundario | `#CBF3BB` | Barras, fondos secundarios |
| Primario | `#ABE7B2` | Elementos interactivos, bordes |
| Acento | `#93BFC7` | Letras resaltadas, botón play, acentos |
| Stat Card | `#FFFFFF` | Fondo de tarjetas de estadísticas |
| Stat Value | `#2563EB` | Color de los valores numéricos |
| Stat Label | `#6B7280` | Color de las etiquetas de estadísticas |

## Requisitos

- **Python 3.10+** (probado con 3.12)
- **Linux**: GTK 3 + WebKit2GTK 4.1 (bibliotecas del sistema)
- **macOS**: macOS 11+ (Big Sur) — usa WKWebView nativo
- **Windows**: Windows 10+ — usa Microsoft Edge WebView2

## Instalación

### 1. Dependencias del sistema

**Linux (Ubuntu/Debian/Mint):**
```bash
sudo apt install python3-gi python3-gi-cairo gir1.2-webkit2-4.1 python3-fitz
```

**macOS:**
```bash
brew install python-tk
# PyMuPDF (fitz) se instala vía pip en el paso 2
```

**Windows:**
- Instala [Microsoft Edge WebView2](https://go.microsoft.com/fwlink/p/?LinkId=2124703) (viene incluido en Windows 11)
- Instala [Python 3.10+](https://www.python.org/downloads/)

### 2. Dependencias de Python

```bash
pip install -r requirements.txt
```

O manualmente:
```bash
pip install pywebview python-docx ebooklib beautifulsoup4 lxml striprtf
```

> **Linux (Ubuntu 24.04+):** si encuentras error `externally-managed-environment`, usa `pip install --user --break-system-packages` o un entorno virtual:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install pyMuPDF  # solo Linux: python3-fitz del sistema o pip
```

## Cómo ejecutar

```bash
cd /home/denwil/Projects/reading_training_vp
python3 main.py
```

O directamente desde cualquier ubicación:

```bash
python3 /ruta/completa/a/reading_training_vp/main.py
```

## Guía de uso

1. **Abrir un documento** — Haz clic en `Open` o presiona `O`. Selecciona cualquier archivo compatible.
2. **Ver documento** — Presiona `D` o el botón `Doc` para abrir el visor de documento. Haz clic en cualquier palabra para empezar desde ahí.
3. **Seleccionar rango** — En el visor, haz clic en una palabra y luego Shift+clic en otra para seleccionar un fragmento (los párrafos en el rango se resaltan en ámbar). Presiona `Read Selected` para leer solo ese rango.
4. **Iniciar lectura** — Presiona `▶ Play` o la barra espaciadora.
5. **Ajustar velocidad** — Usa los botones `+` / `−`, el deslizador, o las flechas `↑` / `↓`.
6. **Navegar** — `←` / `→` para avanzar/retroceder una palabra. `Shift+←` / `Shift+→` para 10 palabras.
7. **Barra de progreso** — Haz clic en cualquier parte de la barra de progreso para saltar a esa posición.
8. **Modo enfoque** — Al reproducir, la interfaz se simplifica automáticamente. Presiona `Esc` para salir del modo enfoque.
9. **Audio de fondo** — Presiona `Audio` en el toolbar para cargar un archivo de audio. La primera vez que inicies la lectura, el audio arrancará solo. Luego usa los botones independientes de la barra de audio (Play/Pause, ⏪ 10s, ⏩ 10s, Stop, volumen).
10. **Configurar** — Presiona `S` o el icono ⚙ para abrir el panel de ajustes.
11. **Paletas** — En Settings → Color Palettes, puedes editar colores, guardar cambios, añadir (máx 3) o eliminar paletas.
12. **Historial** — Presiona el icono `clock` en el toolbar para ver el historial de lectura. Haz clic en un elemento para reabrir ese documento.
13. **Reset Session** — Presiona `↺` para reiniciar las estadísticas de la sesión sin mover la posición de lectura.

### Atajos de teclado predeterminados

| Tecla | Acción |
|-------|--------|
| `Space` | Reproducir / Pausar |
| `Esc` | Salir del modo enfoque |
| `↑` | Aumentar velocidad |
| `↓` | Disminuir velocidad |
| `←` | Retroceder 1 palabra |
| `→` | Avanzar 1 palabra |
| `Shift+←` | Retroceder 10 palabras |
| `Shift+→` | Avanzar 10 palabras |
| `O` | Abrir archivo |
| `D` | Abrir/cerrar visor de documento |
| `S` | Abrir/cerrar ajustes |
| `R` | Reiniciar posición |

Todos los atajos son personalizables en *Settings → Keyboard Shortcuts*.

## Agradecimientos

Las siguientes funcionalidades del motor RSVP están inspiradas en [thomaskolmans/rsvp-reading](https://github.com/thomaskolmans/rsvp-reading):

| Funcionalidad | Fuente |
|---------------|--------|
| **ORP automático** (`getORPIndex` / `getActualORPIndex`) | Algoritmo de Punto Óptimo de Reconocimiento basado en longitud de palabra |
| **Pausas por puntuación** (`getWordDelay`) | Retardo variable para signos de puntuación con multiplicador configurable |
| **Ralentización de palabras largas** (`wordLengthWPMMultiplier`) | Tiempo adicional proporcional para palabras de 12+ caracteres |
| **Pausas periódicas** (`shouldPauseAtWord`) | Pausa de comprensión cada N palabras |
| **Efecto de fade** | Transición suave de opacidad entre palabras |
| **Modo enfoque** | Interfaz minimalista que oculta elementos durante la lectura (concepto adaptado de su modo focus) |
| **Reanudación de sesión** | Guardado automático de posición al pausar, con opción de reanudar al abrir la app |
| **Barra de progreso interactiva** | Click en la barra para saltar a cualquier posición (concepto adaptado) |
| **Tiempo restante** | Estimación de tiempo basada en palabras restantes y WPM actual |
| **Marco contextual multi-palabra** | Visualización de palabras de contexto alrededor de la palabra actual |
| **Soporte RTL** | Detección de escritura de derecha a izquierda (hebreo/árabe) |

Estas características se implementaron desde cero en JavaScript adaptándolas a la arquitectura de Amoxpohualistli (Python + GTK + WebKit2GTK), sin copiar código directamente. El proyecto original de Thomas Kolmans es una aplicación web pura construida con Svelte 5 + Vite, mientras que Amoxpohualistli es una aplicación de escritorio nativa con backend Python.

## Formatos de archivo soportados

| Extensión | Formato | Librería |
|-----------|---------|----------|
| `.txt` | Texto plano | — |
| `.md` | Markdown | — |
| `.pdf` | PDF | PyMuPDF (fitz) |
| `.docx` | Word | python-docx |
| `.epub` | EPUB | ebooklib + BeautifulSoup |
| `.html` / `.htm` | HTML | BeautifulSoup |
| `.rtf` | RTF | striprtf |
| `.odt` | OpenDocument | zipfile + ElementTree |

## Limpieza de texto

El parser aplica automáticamente estas transformaciones al texto extraído:

1. **Unión de palabras partidas**: `conti-\nnuación` → `continuación`
2. **Eliminación de números de página**: líneas que contienen solo dígitos
3. **Eliminación de entradas de índice**: patrones `texto ...... 123`
4. **Reordenación de columnas**: detecta texto en 2 columnas por espacios ≥4 y las reordena como una sola
5. **Corrección de espacios faltantes**: inserta espacio en límites minúscula→mayúscula y dígito→letra (artefactos comunes de extracción PDF)
6. **División de doble guión/em-dash**: `bien--estar` → `bien --estar` para legibilidad en RSVP
7. **Normalización de espacios**: preserva saltos de párrafo pero elimina espaciado excesivo

## Configuración

Los ajustes se guardan automáticamente en `~/.config/deepsite/config.json`.

El historial de lectura se guarda en `~/.config/deepsite/history.json` (máx 50 entradas).

La caché de textos parseados se guarda en `~/.config/deepsite/cache/{sha256}.json` (se invalida si cambia el mtime del archivo).

Los archivos de audio cargados se almacenan en `~/.config/deepsite/audio/`.

## Arquitectura

```
reading_training_vp/
├── main.py          # Ventana nativa + puente Python↔JavaScript (pywebview)
├── parser.py        # Parseo multi-formato + limpieza de texto + columnas
├── settings.py      # Persistencia de configuración, historial, caché
├── requirements.txt # Dependencias pip
├── web/
│   ├── index.html   # Interfaz de usuario (Tailwind CSS + Lucide icons)
│   ├── styles.css   # Estilos personalizados, paleta de colores, animaciones
│   ├── app.js       # Motor RSVP, audio track, visor de documento, rango, atajos, puente JS
│   └── lucide.min.js# Iconos Lucide (embebido localmente, sin dependencia de CDN)
└── test_sample.txt  # Documento de prueba
```

### Comunicación Python↔JavaScript

- **JavaScript → Python**: `pywebview.api.handle_message(JSON.stringify({type, data}))` (vía pywebview JS bridge)
- **Python → JavaScript**: `window.evaluate_js(f"window.__bridge_cb({json.dumps(data)})")`
- Los mensajes son JSON con tipo (`type`) y datos (`data`). No se utiliza `eval()` ni ejecución de código arbitrario.

### Carga fragmentada de documentos

Para documentos grandes (>5000 palabras), el backend envía:
1. `file_start` — metadatos del archivo (nombre, conteo total, número de fragmentos)
2. `file_chunk` — lotes de 5000 palabras cada uno
3. `file_loaded` — señal de finalización con texto completo y offsets

El frontend muestra un spinner de carga y actualiza el progreso a medida que llegan los fragmentos.

## Tecnologías

- **Python 3** + **pywebview** — Ventana nativa y puente JS (Linux: WebKit2GTK, macOS: WKWebView, Windows: Edge WebView2)
- **HTML5 / CSS3 / JavaScript** — Interfaz de usuario (Tailwind CSS + Lucide icons locales)
- **Web Audio API / HTML5 Audio** — Efectos de sonido y pista de audio continua
- **PyMuPDF (fitz) / python-docx / ebooklib / BeautifulSoup / striprtf** — Parseo de documentos

## Seguridad

La aplicación opera exclusivamente en el entorno local del usuario. No realiza conexiones de red salientes (los iconos Lucide están embebidos localmente). Tailwind se carga desde CDN; para uso sin conexión, descárgalo y cámbialo a referencia local.

### Medidas implementadas

- **Escapado de HTML** — Todo texto proveniente de documentos se escapa con `textContent` antes de insertar en el DOM, previniendo XSS
- **Validación de rutas** — Todas las rutas de archivo se verifican con `os.path.isfile()` antes de abrirse
- **Cachés con hash** — Las rutas de caché usan SHA256 (truncado a 16 chars), previniendo path traversal
- **Diálogos nativos** — La selección de archivos usa el diálogo GTK nativo, no entrada de texto libre
- **Sin eval()** — No se utiliza `eval`, `exec`, ni plantillas de código dinámico
- **Puente tipado** — La comunicación JS↔Python usa JSON con tipos discretos y un dispatcher basado en mapa de handlers
- **Sanitización de nombres de paleta** — Los nombres de paleta ingresados por el usuario se escapan antes de insertarse en el DOM
- **DOM API para colores** — Los valores de color se asignan mediante `element.style` (CSSOM) en lugar de cadenas HTML, evitando inyección CSS

### Consideraciones

- El archivo `~/.config/deepsite/config.json` puede editarse manualmente; los valores de color y fuente se aplican mediante CSSOM que rechaza valores inválidos
- El archivo `~/.config/deepsite/history.json` puede editarse manualmente; los datos se renderizan con `escHtml()` antes de insertarse en el DOM
- No hay CSP porque la app se sirve desde `file://` y usa estilos/scripts inline necesarios para Tailwind; agregar CSP rompería la funcionalidad sin beneficio real para una app local

### Vulnerabilidades fuera de alcance

- **Acceso físico al sistema**: cualquier persona con acceso a la cuenta del usuario puede modificar archivos de configuración y datos locales. Esto no es prevenible ni está en el modelo de amenazas de una aplicación de escritorio.
- **Self-XSS**: el usuario puede inyectar HTML/JS a través del editor de paletas o configuración manual, pero solo se afecta a sí mismo.
