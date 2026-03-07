---
name: spline-3d-web
description: Embed, integrate, and build interactive 3D web experiences using Spline. Use this skill whenever the user wants to add a Spline scene to a website, create a web page or React component featuring a 3D Spline object, control Spline animations or variables via JavaScript, build a landing page or portfolio with a 3D hero, or asks anything about Spline runtime/viewer/React integration. Trigger even if the user just says "Spline scene", "3D background", "interactive 3D", or pastes a spline.design URL they want embedded.
---

# Spline 3D Web Designer

This skill guides embedding and interacting with Spline 3D scenes in web projects — HTML pages, React apps, and beyond. Spline scenes are hosted on spline.design and exposed via a lightweight runtime SDK.

The user provides: a Spline scene URL (or asks you to stub one), the target environment (plain HTML, React, Next.js, etc.), and any interactivity requirements (camera control, variable triggers, event listeners, animations).

---

## Core Concepts

| Concept | Notes |
|---|---|
| **Scene URL** | Exported from Spline as `https://prod.spline.design/<id>/scene.splinecode` |
| **Viewer URL** | Iframe embed: `https://my.spline.design/<id>/` |
| **@splinetool/runtime** | JS SDK for programmatic control (events, variables, animations) |
| **@splinetool/react-spline** | React wrapper component |
| **SPE (Spline Export)** | `.splinecode` binary loaded by the runtime |

---

## Method 1 — Iframe Embed (Simplest)

Use when the user only needs to display a scene with no JS interaction.

```html
<iframe
  src='https://my.spline.design/SCENE_ID/'
  frameborder='0'
  width='100%'
  height='100%'
  style="border:none; display:block;"
  allow="autoplay"
></iframe>
```

**Caveats:**
- No JS event access
- Mobile: add `allow="gyroscope; accelerometer"` for tilt support
- For full-screen hero: wrap in a `position: relative` container with `height: 100vh`

---

## Method 2 — Runtime SDK (HTML/Vanilla JS)

Use when the user needs programmatic control: triggering animations, reading/writing variables, responding to Spline events.

### Installation
```bash
npm install @splinetool/runtime
# or via CDN:
# <script type="module" src="https://unpkg.com/@splinetool/runtime/build/runtime.js"></script>
```

### Basic Setup
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 100vw; height: 100vh; overflow: hidden; background: #000; }
    canvas { width: 100% !important; height: 100% !important; }
  </style>
</head>
<body>
  <canvas id="canvas3d"></canvas>

  <script type="module">
    import { Application } from 'https://unpkg.com/@splinetool/runtime@latest/build/runtime.js';

    const canvas = document.getElementById('canvas3d');
    const app = new Application(canvas);

    await app.load('https://prod.spline.design/SCENE_ID/scene.splinecode');

    // Scene is now loaded and interactive
  </script>
</body>
</html>
```

### Triggering Events
```javascript
// Emit a named event to the Spline scene
app.emitEvent('mouseDown', objectNameOrId);

// Or by object name
app.emitEventReverse('mouseDown', 'Button');
```

### Reading & Writing Variables
```javascript
// Get a Spline variable value
const val = app.getVariable('speed');

// Set a Spline variable
app.setVariable('color', '#ff0000');
app.setVariable('opacity', 0.5);
```

### Listening to Spline Events
```javascript
app.addEventListener('mouseDown', (e) => {
  console.log('Clicked object:', e.target.name);
});

app.addEventListener('keyDown', (e) => {
  console.log('Key pressed in scene:', e.key);
});
```

### Supported Event Names
`mouseDown`, `mouseUp`, `mouseHover`, `keyDown`, `keyUp`, `start`, `lookAt`, `follow`, `scroll`

---

## Method 3 — React Component

Use for React / Next.js projects. This is the recommended approach for component-based apps.

### Installation
```bash
npm install @splinetool/react-spline @splinetool/runtime
```

### Basic Usage
```jsx
import Spline from '@splinetool/react-spline';

export default function Hero() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Spline scene="https://prod.spline.design/SCENE_ID/scene.splinecode" />
    </div>
  );
}
```

### With `onLoad` and Refs
```jsx
import { useRef } from 'react';
import Spline from '@splinetool/react-spline';

export default function Scene() {
  const splineRef = useRef(null);

  function onLoad(splineApp) {
    splineRef.current = splineApp;
  }

  function handleClick() {
    splineRef.current?.emitEvent('mouseDown', 'Button');
  }

  function handleSetVar() {
    splineRef.current?.setVariable('score', 42);
  }

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <Spline
        scene="https://prod.spline.design/SCENE_ID/scene.splinecode"
        onLoad={onLoad}
      />
      <button
        onClick={handleClick}
        style={{ position: 'absolute', bottom: 24, left: 24, zIndex: 10 }}
      >
        Trigger Animation
      </button>
    </div>
  );
}
```

### Listening to Spline Events in React
```jsx
function onSplineMouseDown(e) {
  if (e.target.name === 'Cube') {
    console.log('Cube was clicked!');
  }
}

<Spline
  scene="https://prod.spline.design/SCENE_ID/scene.splinecode"
  onMouseDown={onSplineMouseDown}
/>
```

**Available React event props:** `onMouseDown`, `onMouseUp`, `onMouseHover`, `onKeyDown`, `onKeyUp`, `onStart`, `onLookAt`, `onFollow`, `onScroll`

---

## Next.js Specifics

Spline uses browser APIs — always load it client-side only.

```jsx
// app/page.jsx  (Next.js 13+ App Router)
'use client';
import dynamic from 'next/dynamic';

const Spline = dynamic(() => import('@splinetool/react-spline'), { ssr: false });

export default function Page() {
  return (
    <main style={{ width: '100vw', height: '100vh' }}>
      <Spline scene="https://prod.spline.design/SCENE_ID/scene.splinecode" />
    </main>
  );
}
```

---

## Layout Patterns

### Full-screen 3D Background with Content Overlay
```css
.scene-wrapper {
  position: fixed;
  inset: 0;
  z-index: 0;
}
.content {
  position: relative;
  z-index: 10;
  pointer-events: none; /* let mouse-events pass to Spline */
}
.content button {
  pointer-events: auto; /* re-enable for interactive elements */
}
```

### Contained Card / Section
```css
.spline-card {
  width: 600px;
  height: 400px;
  border-radius: 16px;
  overflow: hidden;
  position: relative;
}
```

### Responsive Full-height Hero
```css
.hero {
  width: 100%;
  height: 100svh; /* safe for mobile */
}
```

---

## Performance Tips

- **Lazy-load** the scene: wrap in `IntersectionObserver` or `dynamic()` — don't load off-screen.
- **Reduce texture resolution** in the Spline editor before exporting for web.
- **Disable orbit controls** in the Spline editor if the user shouldn't move the camera.
- **Use `loading` placeholder**: show a spinner or gradient while the scene loads.
- **Avoid multiple instances**: one Spline canvas per page is ideal; use iframes for secondary scenes.

```jsx
// Loading state pattern
const [isLoaded, setIsLoaded] = useState(false);

<div style={{ position: 'relative' }}>
  {!isLoaded && <div className="loader">Loading 3D scene…</div>}
  <Spline
    scene="..."
    onLoad={() => setIsLoaded(true)}
    style={{ opacity: isLoaded ? 1 : 0, transition: 'opacity 0.5s' }}
  />
</div>
```

---

## Accessibility

- Add `aria-hidden="true"` and `role="presentation"` to the canvas wrapper for decorative scenes.
- Provide a static fallback image via `<noscript>` for users without JS.
- Ensure interactive overlays (buttons, text) are keyboard-navigable outside the canvas.

```html
<div aria-hidden="true" role="presentation">
  <!-- Spline canvas here -->
</div>
```

---

## Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `Cannot read properties of null (reading 'getContext')` | Canvas not mounted yet | Ensure canvas is in DOM before calling `app.load()` |
| Scene URL 404 | Wrong scene ID or private scene | Publish scene publicly in Spline editor |
| Scene loads but is black | Missing lights or wrong background color | Check Spline editor environment settings |
| SSR crash in Next.js | Spline uses `window` | Use `dynamic(..., { ssr: false })` |
| Iframe not filling container | Container has no height | Set explicit height on parent (e.g. `height: 100vh`) |
| Events not firing | Object name mismatch | Match name exactly as set in Spline editor (case-sensitive) |

---

## Worked Example — Interactive Landing Page (React)

```jsx
'use client';
import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const Spline = dynamic(() => import('@splinetool/react-spline'), { ssr: false });

export default function LandingPage() {
  const spline = useRef(null);
  const [loaded, setLoaded] = useState(false);

  const handleLoad = (app) => {
    spline.current = app;
    setLoaded(true);
  };

  const triggerHover = () => {
    spline.current?.emitEvent('mouseHover', 'Logo');
  };

  return (
    <main style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0a0a0a' }}>

      {/* 3D Background */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
        <Spline
          scene="https://prod.spline.design/YOUR_SCENE_ID/scene.splinecode"
          onLoad={handleLoad}
          style={{ width: '100%', height: '100%', opacity: loaded ? 1 : 0, transition: 'opacity 1s' }}
        />
      </div>

      {/* Overlay Content */}
      <div style={{
        position: 'relative', zIndex: 10, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: '#fff', pointerEvents: 'none'
      }}>
        <h1 style={{ fontSize: '4rem', fontWeight: 700 }}>Hello, 3D Web</h1>
        <p style={{ marginTop: '1rem', opacity: 0.7 }}>Built with Spline + React</p>
        <button
          onClick={triggerHover}
          style={{ marginTop: '2rem', padding: '12px 32px', pointerEvents: 'auto',
            background: 'white', color: '#000', border: 'none', borderRadius: '999px',
            cursor: 'pointer', fontSize: '1rem', fontWeight: 600 }}
        >
          Animate Logo
        </button>
      </div>
    </main>
  );
}
```

---

## Quick Reference

```
Scene URL format:    https://prod.spline.design/<ID>/scene.splinecode
Viewer URL format:  https://my.spline.design/<ID>/
npm packages:       @splinetool/runtime   @splinetool/react-spline
Key API methods:    app.load(url)  app.emitEvent(event, objectName)
                    app.setVariable(name, value)  app.getVariable(name)
                    app.addEventListener(event, callback)
React events:       onLoad  onMouseDown  onMouseUp  onMouseHover
                    onKeyDown  onKeyUp  onStart  onScroll
```
