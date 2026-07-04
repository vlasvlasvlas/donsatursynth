# ⬢ ⬡ Don Satur Synth

**Un secuenciador musical interactivo inspirado en las galletitas Don Satur.**

Demo: [vlasvlasvlas.github.io/donsatursynth](https://vlasvlasvlas.github.io/donsatursynth/)

---

## ¿Qué es?

Don Satur Synth es una interfaz audiovisual experimental donde colocás galletitas hexagonales en una cuadrícula y el sistema las convierte en música. Cada galletita es un nodo de síntesis de sonido. El secuenciador las va "leyendo" de izquierda a derecha (o en la dirección que configures) y toca la nota correspondiente.

El proyecto es un homenaje visual al diseño del paquete de bizcochos Don Satur y está construido 100% en el navegador usando Web Audio API vía Tone.js.

---

## Tipos de galletitas

| Tipo | Color | Sonido por defecto | Rol |
|------|-------|--------------------|-----|
| **Negrita** | Marrón oscuro | Minimoog (bajo) | Línea de bajo, graves |
| **Dulce** | Dorado claro | Vangelis (melodía) | Línea melódica, agudos |

Cada galletita puede tener un preset de síntesis diferente, cambiable desde el panel de configuración.

---

## Cómo usar

### Agregar galletitas al lienzo

- **Click** en una galletita del navbar (negrita o dulce) → se agrega automáticamente al lienzo en una posición adyacente a las existentes.
- **Arrastrar** (drag) una galletita desde el navbar hasta el lienzo → la coloca en el hexágono más cercano al punto de drop.

### Interactuar con las galletitas en el lienzo

| Acción | Resultado |
|--------|-----------|
| **Click corto** (< 280ms) | Invierte el tipo: negrita ↔ dulce (con animación flip) |
| **Click largo** (sostener > 280ms) | Selecciona la galletita y abre el panel de configuración |
| **Arrastrar** (drag) sobre el lienzo | Mueve la galletita a otro hexágono vacío |
| **Arrastrar** (drag) hacia la barra | Elimina la galletita soltándola sobre el ícono de la papelera |

### Controles de transporte

- **▶ Play / ⏸ Pausa** — Inicia o pausa el secuenciador. El primer play también inicializa el motor de audio.
- **BPM** — Velocidad del secuenciador (60–240 BPM).
- **Volumen General** — Controla el volumen master.

### Arpegiador (secuenciador de nodos)

- **Root Note** — Nota raíz de la escala pentatónica menor usada para asignar alturas a cada hexágono.
- **Dirección** — Modo de lectura del lienzo:
  - `Izquierda → Derecha` / `Derecha → Izquierda` — Recorre columnas por coordenada Q.
  - `Arriba ↓ Abajo` / `Abajo ↑ Arriba` — Recorre filas por coordenada R.
  - `Aleatorio` — Dispara un nodo aleatorio en cada pulso.

La altura de la nota de cada galletita depende de su posición vertical (R) en la cuadrícula.



### Drum Machine

Una caja de ritmos de 16 pasos con tres tracks:

| Track | Síntesis |
|-------|----------|
| **Kick** | MembraneSynth (bombo electrónico) |
| **Snare** | NoiseSynth (caja de ruido) |
| **HiHat** | MetalSynth (platillo metálico) |

- **Kit de Sonido**: Classic 808 / 8-Bit (C64) / Electro
- **Volumen Batería** — Control independiente de la batería.

Click en cada casilla del paso para activar/desactivar el golpe.

### Generador Evolutivo

- **Auto-Generar Loop** — Activa la re-generación automática del patrón cada N compases.
- **Cada N Compases** — Frecuencia de regeneración (default: cada 4 compases).
- **Nº de Galletitas** — Cuántas galletitas genera el patrón aleatorio (1–100).
- **Generar** — Crea un nuevo patrón aleatorio manualmente.
- **Limpiar** — Borra todas las galletitas del lienzo.

### Presets de síntesis disponibles

| ID | Nombre | Tipo |
|----|--------|------|
| `minimoog` | Minimoog (bajo) | Synth |
| `vangelis` | Vangelis (Chariots) | FMSynth |
| `blade_runner` | Blade Runner (CS-80) | PolySynth |
| `cosmos` | Cosmos (Sagan Pad) | PolySynth |
| `space_lady` | Space Lady | FMSynth |
| `kraftwerk` | Kraftwerk (Trans-Europe) | FMSynth |
| `brian_eno` | Brian Eno (Ambient) | PolySynth |
| `dx7_epiano` | DX7 E-Piano | FMSynth |
| `prophet_5` | Prophet-5 (Poly Lead) | PolySynth |
| `arp_odyssey` | ARP Odyssey (Lead) | AMSynth |

---

## Arquitectura técnica

```
Tone.Synth (por galletita)
         │
Tone.Filter (opcional, por preset)
         │
Tone.Compressor (-20dB, ratio 3)
         │
Tone.Reverb (decay 2s, wet 20%)
         │
Tone.Destination
```

- **Motor de audio**: [Tone.js](https://tonejs.github.io/) sobre Web Audio API
- **Scheduling**: `Tone.Transport.scheduleRepeat` con lookahead de 300ms para estabilidad
- **Síntesis de batería**: Pool de 8 voces por track (round-robin) para evitar cortes
- **Cuadrícula**: Geometría hexagonal pointy-top con coordenadas axiales (Q, R)
- **Presets**: Definidos en `public/presets.yaml` vía js-yaml
- **Build**: Vite 8

---

## Desarrollo local

```bash
npm install
npm run dev
# → http://localhost:5173/donsatursynth/
```

## Build para producción

```bash
npm run build
# Genera dist/ listo para deploy en GitHub Pages
```

---

## Deploy

El deploy a GitHub Pages es automático via GitHub Actions (`/.github/workflows/deploy.yml`) cada vez que se hace push a `main`.

**Configuración requerida en GitHub:**
1. Settings → Pages → Source: **GitHub Actions**

---

## Créditos

Desarrollado con Tone.js, Vite y Web Audio API.  
Inspirado en el diseño de los bizcochos **Don Satur** — Fundado en 1967.
