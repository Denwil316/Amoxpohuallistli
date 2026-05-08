# Cálculos de Amoxpohualistli

## 1. Velocidad de lectura (WPM)

La velocidad se configura como **palabras por minuto** (WPM). El rango permitido es 50–2000 WPM.

### Tiempo base por palabra

```
tiempoBase (ms) = 60000 / wpm
```

Ejemplos:
- 250 WPM → 60000 / 250 = **240 ms/palabra**
- 300 WPM → 60000 / 300 = **200 ms/palabra**
- 500 WPM → 60000 / 500 = **120 ms/palabra**

---

## 2. Ajustes por palabra (`getWordDelay`)

El tiempo real que cada palabra permanece en pantalla puede ser mayor que el tiempo base. Los ajustes mejoran la legibilidad pero NO alteran el cálculo de velocidad promedio reportada.

### 2a. Ajuste por longitud de palabra (`wordLengthWPMMultiplier`)

Palabras de **12 caracteres o más** reciben tiempo adicional proporcional:

```
excesoLetras = max(0, len(palabra) - 12)
factorLongitud = 1 + (excesoLetras * multiplicador / 100)
tiempoAjustado = tiempoBase * factorLongitud
```

Donde `multiplicador` se configura en 0–50% (default: 5%).

Ejemplo con palabra de 15 letras a 250 WPM, multiplicador 5%:
```
excesoLetras = 15 - 12 = 3
factorLongitud = 1 + (3 * 0.05) = 1.15
tiempoAjustado = 240 * 1.15 = 276 ms
```

### 2b. Ajuste por puntuación final (`pauseOnPunctuation`)

Si la palabra **termina** en ciertos signos de puntuación, el tiempo base se multiplica:

| Signo | Multiplicador |
|-------|--------------|
| `.!?;:` | `punctuationPauseMultiplier` (1–4x, default: 2x) |
| `,` | 1.5× (fijo) |

El multiplicador para final de frase se configura en Settings → Punctuation Pause Multiplier.

Ejemplo: palabra terminada en `.` a 250 WPM, multiplicador 2x:
```
tiempoAjustado = 240 * 2 = 480 ms
```

### 2c. Prioridad de ajustes

1. Primero se aplica el ajuste por longitud (si aplica).
2. Luego se aplica el ajuste por puntuación (si aplica), sobre el tiempo ya ajustado por longitud.

### 2d. Pausa periódica de comprensión (`pauseAfterWords`)

Cada N palabras (configurable: 0–50, default: 0 = desactivado), el RSVP se detiene por una duración fija:

```
pausa = pauseDuration (100–2000ms, default: 500ms)
```

Durante la pausa, se muestra un icono ⏸ y el texto permanece visible. Al reanudar, el cronómetro absoluto se reinicia (`_t0 = performance.now()`) para evitar acumulación de deriva.

---

## 3. Cronómetro absoluto (`_t0`)

El RSVP usa un cronómetro absoluto para evitar la deriva acumulativa de `setTimeout`:

```
// Al iniciar reproducción:
_t0 = performance.now()

// En cada tick:
_t0 += delay (ms)
ajuste = max(0, _t0 - performance.now())
setTimeout(tick, ajuste)
```

Si el ajuste es negativo (el tick se atrasó), el siguiente tick se programa inmediatamente.

---

## 4. Velocidad promedio reportada

La velocidad promedio se calcula usando el **tiempo base ideal**, NO el tiempo ajustado por puntuación/longitud. Esto asegura que el promedio converja a la velocidad configurada.

### Acumulador base (`_baseDelay`)

```
// Por cada palabra procesada en tick():
_baseDelay += 60000 / speed
```

### Fórmula

```
tiempoTotalMinutos = _baseDelay / 60000
velocidadPromedio = sessionWords / tiempoTotalMinutos
```

### Ejemplo

Leyendo 375 palabras a 250 WPM (con algunas pausas por puntuación):

```
_baseDelay = 375 × 240 ms = 90000 ms = 1.5 min
sessionWords = 375
velocidadPromedio = 375 / 1.5 = 250 WPM
```

La velocidad promedio converge exactamente a la velocidad configurada porque `_baseDelay` usa `60000/speed` por palabra, independientemente de los ajustes por puntuación o longitud.

### Acumulador real (`_accDelay`)

Existe un segundo acumulador que SÍ incluye todos los ajustes:

```
// Por cada palabra procesada en tick():
_accDelay += getWordDelay(palabra)
```

Está disponible para fines de depuración o análisis, pero no se usa en la UI.

### Cuándo se reinicia

`_baseDelay` y `_accDelay` se reinician en:

| Evento | Motivo |
|--------|--------|
| `load()` | Nuevo documento cargado |
| Primer `Play` de una sesión | Inicio de nueva sesión de lectura |
| `resetPosition()` | Usuario reinicia posición |
| `resetSession()` | Usuario reinicia estadísticas |
| `onFileStart()` | Nuevo archivo (carga fragmentada) |
| `onFileLoaded()` | Archivo cargado completamente |

No se reinician en pausa/reanudación ni en búsqueda (seek), para preservar la continuidad de la sesión.

---

## 5. Tiempo restante

```
palabrasRestantes = totalPalabras - indiceActual - 1
segundos = ceil(palabrasRestantes / wpm * 60)
```

Se muestra en formato `M:SS` o `h Mm Ss` si supera 1 hora.

Se actualiza:
- En cada tick de palabra (lectura activa)
- Al cambiar la velocidad (vía `updateSpeedUI`)
- Al cargar un documento
- Al reiniciar posición

### Ejemplo

Documento de 1000 palabras, posición en palabra 250, velocidad 300 WPM:

```
palabrasRestantes = 1000 - 250 - 1 = 749
segundos = ceil(749 / 300 * 60) = ceil(149.8) = 150
Tiempo restante = 2:30
```

---

## 6. Tiempo transcurrido

El tiempo transcurrido en pantalla es **tiempo de pared** (wall-clock), no el tiempo base. Incluye toda la sobrecarga de procesamiento JS, renderizado, etc.

```
tiempoActivo = _activeTime  // tiempo acumulado de sesiones previas
segmentoActual = Date.now() - _playSegmentStart  // tiempo desde última reanudación
tiempoTotalMs = tiempoActivo + segmentoActual
```

Se actualiza cada segundo vía `setInterval`.

### Diferencia con velocidad promedio

- **Tiempo transcurrido**: tiempo de pared real (incluye overhead JS, layout, etc.)
- **Velocidad promedio**: basada en `_baseDelay` (tiempo ideal sin overhead ni ajustes)

Esto significa que el tiempo transcurrido puede ser ligeramente mayor al tiempo implicado por la velocidad promedio, pero es la experiencia real del usuario.

---

## 7. Progreso

```
porcentaje = floor((indice + 1) / totalPalabras * 100)
```

Donde `totalPalabras` es `_wordCount` (conteo real del documento) si está disponible, o `words.length` (conteo parcial durante carga fragmentada).

---

## 8. Timeline de eventos de sesión

```
1. Usuario abre archivo
   ├── onFileStart (carga fragmentada) o onFileLoaded (carga completa)
   ├── sessionWords = 0, _baseDelay = 0, _accDelay = 0
   ├── time-remaining = totalPalabras / wpm × 60
   └── time-elapsed = 00:00

2. Usuario presiona Play (primera vez)
   ├── sessionStartTime = Date.now()
   ├── sessionWords = 0
   ├── rsvp.resetAccumulatedMs() → _baseDelay = 0
   ├── startSessionTimer() → _playSegmentStart = Date.now()
   └── tick() → comienza la lectura

3. Por cada palabra en tick()
   ├── _accDelay += getWordDelay(word)    // tiempo real con ajustes
   ├── _baseDelay += 60000 / speed        // tiempo base ideal
   ├── onWord() → sessionWords++
   │   └── updateAvgSpeed() = sessionWords / (_baseDelay / 60000)
   ├── time-remaining = (total - idx - 1) / speed × 60
   └── setTimeout al próximo tick

4. Usuario pausa
   ├── stopSessionTimer()
   │   └── _activeTime += Date.now() - _playSegmentStart
   ├── saveHistory() (guarda progreso)
   └── _accDelay y _baseDelay NO se reinician

5. Usuario reanuda (Play)
   ├── startSessionTimer() → _playSegmentStart = Date.now()
   └── _accDelay y _baseDelay preservados (NO se reinician)

6. Usuario busca (seek) durante reproducción
   ├── pause() → stopSessionTimer()
   ├── seek() → onWord() → sessionWords++ (sin _baseDelay)
   └── play() → tick() continúa
```

---

## 9. Transiciones (fade)

```
opacidadInicial = 0.85  (en lugar de 0 para evitar flicker)
duraciónMax = min(fadeDuration, 60) ms  (limitado a 60ms)
transición = opacidad 0.85 → 1.0 con single requestAnimationFrame
```

---

## 10. Estadísticas guardadas en historial

Al pausar, se guarda:

```json
{
  "name": "documento.pdf",
  "path": "/ruta/al/archivo",
  "total_words": 262000,
  "words_read": 15000,
  "avg_speed": 250,
  "percent_read": 5.7,
  "last_date": "2026-05-08 11:37"
}
```

La velocidad promedio guardada usa el mismo `_baseDelay` que la UI, asegurando consistencia entre la pantalla y el historial.

---

## 11. Resumen de variables clave

| Variable | Tipo | Propósito | Se reinicia en |
|----------|------|-----------|----------------|
| `rsvp.speed` | int (50–2000) | Velocidad configurada en WPM | Solo por usuario |
| `rsvp._accDelay` | int (ms) | Tiempo acumulado real con ajustes | Nueva sesión/archivo |
| `rsvp._baseDelay` | int (ms) | Tiempo acumulado base (`60000/speed` por palabra) | Nueva sesión/archivo |
| `sessionWords` | int | Palabras leídas en la sesión actual | Nueva sesión |
| `_activeTime` | int (ms) | Tiempo de pared acumulado (sin segmento actual) | Nueva sesión |
| `_playSegmentStart` | timestamp | Inicio del segmento de reproducción actual | Play/resume |
| `_wordCount` | int | Total real de palabras del documento | Nuevo archivo |
