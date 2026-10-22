// A restrained fly-by: the planet stays close while its path crosses the page gradually.
const CORE_STOPS_X = [
    { p: 0, v: 2.35 },
    { p: 0.22, v: 2.0 },
    { p: 0.48, v: 1.15 },
    { p: 0.72, v: 0.25 },
    { p: 0.9, v: -0.35 },
    { p: 1, v: -0.55 },
];
const CORE_STOPS_Y = [
    { p: 0, v: 0.15 },
    { p: 0.22, v: 0.05 },
    { p: 0.48, v: -0.15 },
    { p: 0.72, v: -0.32 },
    { p: 0.9, v: -0.18 },
    { p: 1, v: 0.05 },
];
const CORE_STOPS_SCALE = [
    { p: 0, v: 2.15 },
    { p: 0.22, v: 1.95 },
    { p: 0.48, v: 1.78 },
    { p: 0.72, v: 1.95 },
    { p: 0.9, v: 1.62 },
    { p: 1, v: 1.42 },
];
const CORE_STOPS_ROTATION = [
    { p: 0, v: -0.15 },
    { p: 0.35, v: 0.08 },
    { p: 0.68, v: 0.44 },
    { p: 1, v: 0.68 },
];
const MOTION = {
    entranceDuration: 3.2,
    floatAmplitude: 0.045,
    floatFrequency: 0.22,
    progressDamping: 2.4,
    scrollDamping: 2,
};
const MOBILE_SCALE_FACTOR = 0.82;

// Starfield travel and parallax follow the planet's shared scene position and scale.
const CORE_SCALE_MIN = Math.min(...CORE_STOPS_SCALE.map((stop) => stop.v));
const CORE_SCALE_MAX = Math.max(...CORE_STOPS_SCALE.map((stop) => stop.v));
const STAR_WARP = {
    travel: 2.2,        // depth travel of the nearest stars when the planet is closest
    spread: 0.2,        // radial expansion about the planet's focus point
    parallax: 0.18,     // lateral parallax: stars follow the planet, near stars more than far ones
    sizeGain: 0.8,
    opacityGain: 0.3,
    surge: 1.1,         // extra depth rush while the planet is actively approaching/retreating
    surgeDamping: 3.2,
    particleTravel: 0.55,
    particleSpread: 0.1,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (current, target, delta, lambda) =>
    lerp(current, target, 1 - Math.exp(-lambda * delta));
const smoothStep = (value) => {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
};

function sampleStops(stops, progress) {
    const last = stops.length - 1;
    if (progress <= stops[0].p) return stops[0].v;
    if (progress >= stops[last].p) return stops[last].v;
    let index = 0;
    while (index < last - 1 && progress > stops[index + 1].p) index += 1;
    const start = stops[index];
    const end = stops[index + 1];
    const span = end.p - start.p;
    const t = (progress - start.p) / span;
    const slope = (k) => {
        const a = stops[Math.max(k - 1, 0)];
        const b = stops[Math.min(k + 1, last)];
        return (b.v - a.v) / (b.p - a.p);
    };
    const m0 = slope(index) * span;
    const m1 = slope(index + 1) * span;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * start.v + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * end.v + (t3 - t2) * m1;
}

function getScrollProgress() {
    const scrollableHeight = document.documentElement.scrollHeight - window.innerHeight;
    return scrollableHeight <= 0 ? 0 : clamp(window.scrollY / scrollableHeight, 0, 1);
}

// Scroll reveals. Every [data-aiva-reveal] element gets ONE visibility value r (0..1) computed from its
// position in the viewport and eased toward that target each frame. r is a pure function of scroll
// position, so scrolling down reveals, scrolling up reverses, and nothing is "triggered" - so nothing can
// replay or flicker. Blur exists only during the one-time page-load intro and is removed afterwards.
let revealController = null;

function setupReveals(reducedMotion) {
    if (revealController) {
        revealController.destroy();
        revealController = null;
    }
    const root = document.documentElement;
    const elements = Array.from(document.querySelectorAll("[data-aiva-reveal]"));
    if (reducedMotion || !elements.length) {
        root.classList.remove("aiva-js");
        elements.forEach((element) => {
            element.style.removeProperty("--aiva-r");
            element.style.removeProperty("filter");
            element.classList.add("is-visible");
        });
        return;
    }

    const items = elements.map((element) => ({
        element,
        delay: parseFloat(getComputedStyle(element).getPropertyValue("--aiva-reveal-delay")) || 0,
        top: 0,
        height: 0,
        r: 0,
        last: -1,
        shown: false,
        intro: 0,        // 0 = none, 1 = running, 2 = done
        introStart: 0,
    }));

    // Layout position measured with transforms neutralised, so the target never depends on the
    // element's own animated offset (no feedback loop, no per-frame layout reads).
    const measure = () => {
        items.forEach(({ element }) => {
            element.style.translate = "none";
            element.style.scale = "none";
        });
        const scrollY = window.scrollY;
        items.forEach((item) => {
            const rect = item.element.getBoundingClientRect();
            item.top = rect.top + scrollY;
            item.height = rect.height;
        });
        items.forEach(({ element }) => {
            element.style.removeProperty("translate");
            element.style.removeProperty("scale");
        });
    };

    measure();
    const introNow = performance.now();
    const viewport = window.innerHeight;
    let order = 0;
    items.forEach((item) => {
        const top = item.top - window.scrollY;
        if (top < viewport * 0.92 && top + item.height > 0) {
            item.intro = 1;
            item.introStart = introNow + item.delay + Math.min(order, 8) * 70;
            item.element.style.filter = "blur(10px)";
            order += 1;
        }
    });
    root.classList.add("aiva-js");

    let frame = 0;
    let last = 0;

    const tick = (now) => {
        frame = 0;
        const dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
        last = now;
        const vh = window.innerHeight;
        const scrollY = window.scrollY;
        const atEnd = scrollY + vh >= document.documentElement.scrollHeight - 4;
        const k = 1 - Math.exp(-7 * dt);
        let moving = false;

        for (const item of items) {
            const top = item.top - scrollY;
            const bottom = top + item.height;
            let enter = clamp((vh * 0.94 - (top + item.delay * 0.25)) / (vh * 0.24), 0, 1);
            if (atEnd && top < vh) enter = 1;
            const exit = clamp(bottom / (vh * 0.2), 0, 1);
            const target = smoothStep(Math.min(enter, exit));

            item.r += (target - item.r) * k;
            if (Math.abs(target - item.r) < 0.002) item.r = target;
            if (item.r !== target) moving = true;

            let value = item.r;
            if (item.intro === 1) {
                const t = clamp((now - item.introStart) / 1300, 0, 1);
                const eased = 1 - Math.pow(1 - t, 3);
                value = Math.min(value, eased);
                if (t < 1) {
                    item.element.style.filter = `blur(${((1 - eased) * 10).toFixed(2)}px)`;
                    moving = true;
                } else {
                    item.intro = 2;
                    item.element.style.removeProperty("filter");
                }
            }

            if (value === item.last) continue;
            item.last = value;
            if (value >= 0.999 && item.intro !== 1) {
                if (!item.shown) {
                    item.shown = true;
                    item.element.classList.add("is-visible");
                    item.element.style.removeProperty("--aiva-r");
                }
            } else {
                if (item.shown) {
                    item.shown = false;
                    item.element.classList.remove("is-visible");
                }
                item.element.style.setProperty("--aiva-r", value.toFixed(3));
            }
        }
        if (moving) frame = requestAnimationFrame(tick);
    };

    const request = () => {
        if (!frame) {
            last = 0;
            frame = requestAnimationFrame(tick);
        }
    };
    const remeasure = () => {
        measure();
        request();
    };

    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", remeasure, { passive: true });
    window.addEventListener("load", remeasure);
    document.fonts?.ready?.then(remeasure);
    request();

    revealController = {
        destroy() {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", request);
            window.removeEventListener("resize", remeasure);
            window.removeEventListener("load", remeasure);
        },
    };
}

function createSeededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function createRadialTexture(THREE) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create the Memory Core glow texture.");

    const gradient = context.createRadialGradient(64, 64, 1, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,0.82)");
    gradient.addColorStop(0.12, "rgba(255,255,255,0.62)");
    gradient.addColorStop(0.32, "rgba(255,255,255,0.2)");
    gradient.addColorStop(0.62, "rgba(255,255,255,0.045)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

const PLANET_NOISE = `
float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
}
float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < OCT; i++) {
        s += a * vnoise(p);
        p = p * 2.03 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
    }
    return s / (1.0 - pow(0.5, float(OCT)));
}
float fbm2(vec3 p) {
    return vnoise(p) * 0.667 + vnoise(p * 2.03 + vec3(1.7, 9.2, 3.1)) * 0.333;
}
`;

const PLANET_VERTEX = `
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vViewPos;
varying float vScale;
void main() {
    vObj = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewPos = -mv.xyz;
    vScale = length(modelMatrix[0].xyz);
    gl_Position = projectionMatrix * mv;
}
`;

const PLANET_FRAGMENT_BODY = `
uniform float uTime;
uniform float uClose;
uniform vec3 uLight;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vViewPos;
varying float vScale;
void main() {
    vec3 N0 = normalize(vNormal);
    vec3 V = normalize(vViewPos);
    vec3 L = normalize(uLight);
    vec3 p = normalize(vObj);
    float t = uTime;

    vec3 w = vec3(
        vnoise(p * 1.6 + vec3(0.0, t * 0.012, 0.0)),
        vnoise(p * 1.6 + vec3(5.2, 1.3, t * 0.010)),
        vnoise(p * 1.6 + vec3(2.7, 8.1, 0.0))
    );
    vec3 wd = (w - 0.5) * 1.4;
    float h = fbm(p * 2.1 + wd);
    float band = vnoise(vec3(p.y * 6.0 + wd.x * 2.0, p.x * 0.7, p.z * 0.7 + t * 0.008));
    float land = smoothstep(0.46, 0.60, h);

    float rv = fbm(p * 3.4 + wd * 0.9 + vec3(0.0, -t * 0.03, t * 0.018));
    float vein = smoothstep(0.92, 0.995, 1.0 - abs(rv * 2.0 - 1.0));
    float rv2 = fbm2(p * 7.5 + wd + vec3(t * 0.025, 0.0, 0.0));
    float vein2 = smoothstep(0.945, 0.997, 1.0 - abs(rv2 * 2.0 - 1.0));
    float veins = clamp(vein + vein2 * 0.6, 0.0, 1.0) * mix(0.55, 1.0, land);
    float pulse = 0.84 + 0.16 * sin(t * 0.8 + h * 14.0 + rv * 9.0);
    float glowReg = smoothstep(0.58, 0.82, vnoise(p * 1.8 + wd * 0.8 + vec3(0.0, t * 0.01, 0.0)));

    // screen-space bump so the surface has relief (scale-invariant through vScale)
    vec3 sp = -vViewPos;
    vec3 sx = dFdx(sp);
    vec3 sy = dFdy(sp);
    vec3 r1 = cross(sy, N0);
    vec3 r2 = cross(N0, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    vec3 N = normalize(abs(det) * N0 - (0.55 + 0.4 * uClose) * vScale * grad);

    vec3 seaCol = mix(vec3(0.030, 0.018, 0.090), vec3(0.130, 0.065, 0.320), smoothstep(0.18, 0.46, h));
    vec3 landCol = mix(vec3(0.050, 0.034, 0.048), vec3(0.250, 0.160, 0.075), smoothstep(0.56, 0.82, h));
    vec3 albedo = mix(seaCol, landCol, land);
    albedo = mix(albedo, vec3(0.20, 0.10, 0.36), smoothstep(0.45, 0.85, band) * 0.4 * (1.0 - land));

    float ndl = dot(N, L);
    float lit = smoothstep(-0.10, 0.55, ndl);
    float sideLit = smoothstep(-0.30, 0.60, dot(N0, L));
    vec3 sun = vec3(1.0, 0.86, 0.66);
    vec3 ambient = vec3(0.060, 0.035, 0.125);
    vec3 col = albedo * (sun * lit * 1.35 + ambient);

    float tdl = dot(N0, L) * 5.0;
    float terminator = exp(-tdl * tdl);
    col += vec3(1.0, 0.38, 0.14) * terminator * 0.10 * (0.5 + land);
    vec3 Hh = normalize(L + V);
    float spec = pow(max(dot(N, Hh), 0.0), 70.0) * (1.0 - land) * lit;
    col += vec3(1.0, 0.92, 0.75) * spec * 0.8;

    float night = 1.0 - lit;
    vec3 gold = mix(vec3(1.0, 0.50, 0.04), vec3(1.0, 0.90, 0.42), clamp(vein2 + vein * 0.4, 0.0, 1.0));
    col += gold * veins * pulse * (0.65 + night * 1.0 + uClose * 0.9);
    vec3 glowCol = mix(vec3(0.50, 0.24, 1.0), vec3(1.0, 0.62, 0.12), smoothstep(0.3, 0.8, h));
    col += glowCol * glowReg * (0.26 + night * 0.5 + uClose * 0.3);
    float lat = abs(p.y);
    float aurora = smoothstep(0.66, 0.80, lat) * (1.0 - smoothstep(0.90, 0.99, lat));
    aurora *= 0.5 + 0.5 * sin(p.x * 16.0 + w.y * 9.0 + t * 0.5);
    col += vec3(0.58, 0.32, 1.0) * aurora * (0.45 + uClose * 0.5);

    float fres = pow(1.0 - max(dot(N0, V), 0.0), 3.0);
    vec3 rim = mix(vec3(0.52, 0.26, 1.0), vec3(1.0, 0.76, 0.32), sideLit) * fres * (0.7 + uClose * 0.8);
    col += rim;
    col += vec3(0.30, 0.15, 0.60) * (1.0 - sideLit) * fres * 0.45;

    gl_FragColor = vec4(col, 1.0);
}
`;

const PLANET_CLOUD_BODY = `
uniform float uTime;
uniform float uClose;
uniform vec3 uLight;
varying vec3 vObj;
varying vec3 vNormal;
varying vec3 vViewPos;
void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewPos);
    vec3 L = normalize(uLight);
    vec3 p = normalize(vObj);
    float t = uTime;
    vec3 w = vec3(vnoise(p * 2.0 + t * 0.01), vnoise(p * 2.0 + 4.1), vnoise(p * 2.0 + 7.3));
    float c = fbm(p * 2.8 + (w - 0.5) * 1.8 + vec3(t * 0.02, 0.0, t * 0.012));
    float wisps = smoothstep(0.50, 0.74, c);
    float lit = smoothstep(-0.12, 0.6, dot(N, L));
    vec3 col = mix(vec3(0.20, 0.10, 0.45), vec3(1.0, 0.82, 0.50), lit);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    float alpha = wisps * (0.20 + 0.28 * lit + fres * 0.25 + uClose * 0.12);
    gl_FragColor = vec4(col * (0.30 + 0.80 * lit), alpha);
}
`;

const PLANET_ATMOSPHERE_FRAGMENT = `
uniform float uClose;
uniform vec3 uLight;
varying vec3 vNormal;
varying vec3 vViewPos;
void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewPos);
    vec3 L = normalize(uLight);
    float d = abs(dot(N, V));
    float edge = pow(clamp(d / 0.47, 0.0, 1.0), 2.4);
    float side = smoothstep(-0.55, 0.65, dot(N, L));
    vec3 col = mix(vec3(0.40, 0.18, 0.95), vec3(1.0, 0.72, 0.26), side);
    float tdl = dot(N, L) * 3.0;
    col += vec3(1.0, 0.30, 0.55) * exp(-tdl * tdl) * 0.30;
    gl_FragColor = vec4(col, edge * (0.50 + uClose * 0.55));
}
`;

const buildPlanetFragment = (octaves) => `#define OCT ${octaves}\n${PLANET_NOISE}${PLANET_FRAGMENT_BODY}`;
const buildCloudFragment = (octaves) => `#define OCT ${octaves}\n${PLANET_NOISE}${PLANET_CLOUD_BODY}`;

function createMemoryCore(THREE, root) {
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: window.innerWidth > 600,
        alpha: true,
        powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    root.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
        42,
        window.innerWidth / Math.max(window.innerHeight, 1),
        0.1,
        80,
    );
    camera.position.z = 8.4;

    scene.add(new THREE.AmbientLight(0xffc629, 1.05));
    const violetLight = new THREE.PointLight(0xffdb29, 3.8, 12);
    violetLight.position.set(-2.1, 1.8, 2.4);
    scene.add(violetLight);
    const cyanLight = new THREE.PointLight(0xffc116, 3.25, 10);
    cyanLight.position.set(2, -0.8, 2);
    scene.add(cyanLight);
    const blueLight = new THREE.PointLight(0xffc629, 2.1, 9);
    blueLight.position.set(2.2, 1.4, -0.6);
    scene.add(blueLight);
    const rimLight = new THREE.PointLight(0x8b5cf6, 2.6, 9);
    rimLight.position.set(1.2, 1.5, -2);
    scene.add(rimLight);

    const starRandom = createSeededRandom(9217);
    // Three star tiers (far / mid / near) with their own size, brightness and parallax strength.
    // Stars are sorted far -> near so each tier is a contiguous slice of one shared buffer.
    const starCount = window.innerWidth < 600 ? 90 : 150;
    const rawStars = [];
    for (let index = 0; index < starCount; index += 1) {
        rawStars.push({
            x: (starRandom() - 0.5) * 15,
            y: (starRandom() - 0.5) * 10,
            z: -2 - starRandom() * 7,
        });
    }
    rawStars.sort((a, b) => a.z - b.z);
    const starBase = new Float32Array(starCount * 3);
    const starPositions = new Float32Array(starCount * 3);
    const starLayer = new Float32Array(starCount);
    rawStars.forEach((star, index) => {
        starBase[index * 3] = star.x;
        starBase[index * 3 + 1] = star.y;
        starBase[index * 3 + 2] = star.z;
        starLayer[index] = 0.35 + 0.65 * ((star.z + 9) / 7);
    });
    starPositions.set(starBase);
    const starfield = new THREE.Group();
    const tierEdges = [0, Math.floor(starCount * 0.5), Math.floor(starCount * 0.82), starCount];
    const tierSpecs = [
        { size: 0.010, opacity: 0.46, color: 0xdcd0ff },  // far: small, dim, cool
        { size: 0.014, opacity: 0.62, color: 0xffe9ab },  // mid
        { size: 0.021, opacity: 0.8, color: 0xfff6d6 },   // near: larger, brighter, warm
    ];
    const starTiers = tierSpecs.map((spec, tier) => {
        const from = tierEdges[tier];
        const to = tierEdges[tier + 1];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(starPositions.subarray(from * 3, to * 3), 3));
        const material = new THREE.PointsMaterial({
            color: spec.color,
            size: spec.size,
            transparent: true,
            opacity: spec.opacity,
            depthWrite: false,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        starfield.add(points);
        let depth = 0;
        for (let index = from; index < to; index += 1) depth += starLayer[index];
        return { geometry, material, size: spec.size, opacity: spec.opacity, depth: depth / Math.max(to - from, 1) };
    });
    scene.add(starfield);

    // Speed streaks: each star gets a short trail toward the vanishing point while the camera is moving.
    const streakPositions = new Float32Array(starCount * 6);
    const streakGeometry = new THREE.BufferGeometry();
    streakGeometry.setAttribute("position", new THREE.BufferAttribute(streakPositions, 3));
    const streakMaterial = new THREE.LineBasicMaterial({
        color: 0xfff1c2,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const starStreaks = new THREE.LineSegments(streakGeometry, streakMaterial);
    starStreaks.frustumCulled = false;
    starStreaks.visible = false;
    scene.add(starStreaks);

    const memoryWorld = new THREE.Group();
    scene.add(memoryWorld);
    const glowTexture = createRadialTexture(THREE);
    const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0x060606,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        toneMapped: false,
    }));
    shadow.position.set(0, -0.12, -1.62);
    shadow.scale.set(3.45, 3.45, 1);
    shadow.renderOrder = -2;
    memoryWorld.add(shadow);

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffdb29,
        transparent: true,
        opacity: 0.43,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    }));
    halo.position.set(0, 0, -1.42);
    halo.scale.set(3.9, 3.9, 1);
    halo.renderOrder = -1;
    memoryWorld.add(halo);

    const halo2 = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0x8b5cf6,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    }));
    halo2.position.set(0, 0, -1.5);
    halo2.scale.set(5.2, 5.2, 1);
    halo2.renderOrder = -1;
    memoryWorld.add(halo2);

    const crystalGroup = new THREE.Group();
    memoryWorld.add(crystalGroup);

    const crystalMaterial = new THREE.MeshPhysicalMaterial({
        color: 0xffd60b,
        metalness: 0.14,
        roughness: 0.2,
        transmission: 0.1,
        thickness: 0.95,
        ior: 1.3,
        transparent: true,
        opacity: 0.96,
        side: THREE.DoubleSide,
        flatShading: true,
        emissive: 0x816c00,
        emissiveIntensity: 0.9,
    });
    const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), crystalMaterial);
    crystalGroup.add(crystal);

    const fresnelMaterial = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vViewPosition = -viewPosition.xyz;
                gl_Position = projectionMatrix * viewPosition;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 faceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
                if (dot(faceNormal, normal) < 0.0) faceNormal = -faceNormal;
                normal = normalize(mix(normal, faceNormal, 0.82));
                vec3 viewDirection = normalize(vViewPosition);
                float facing = max(dot(normal, viewDirection), 0.0);
                float fresnel = pow(1.0 - facing, 2.15);
                float facetLight = max(dot(normal, normalize(vec3(-0.38, 0.62, 0.69))), 0.0);
                float facets = smoothstep(0.08, 0.9, facetLight);
                float cyanReflect = pow(max(dot(normal, normalize(vec3(0.84, -0.12, 0.52))), 0.0), 3.2);
                float blueReflect = pow(max(dot(normal, normalize(vec3(0.62, 0.54, 0.58))), 0.0), 4.2);
                float magentaReflect = pow(max(dot(normal, normalize(vec3(-0.74, 0.38, 0.55))), 0.0), 3.0);
                vec3 violet = vec3(1.0, 0.80, 0.04);
                vec3 cyan = vec3(1.0, 0.92, 0.45);
                vec3 blue = vec3(0.95, 0.55, 0.05);
                vec3 magenta = vec3(1.0, 0.42, 0.0);
                vec3 color = violet * (0.48 + facets * 0.64);
                color = mix(color, blue, clamp(blueReflect * 0.55, 0.0, 0.52));
                color = mix(color, cyan, clamp(cyanReflect * 0.68, 0.0, 0.62));
                color = mix(color, magenta, clamp(magentaReflect * 0.52, 0.0, 0.48));
                float edgePulse = 0.92 + 0.08 * sin(uTime * 0.62);
                float edgeLight = smoothstep(0.42, 0.96, fresnel);
                float edgeColor = clamp(blueReflect * 0.45 + cyanReflect * 0.55, 0.0, 0.85);
                color = mix(color, cyan, edgeLight * edgeColor * 0.42);
                float alpha = clamp((fresnel * 0.3 + facets * 0.018) * edgePulse, 0.0, 0.27);
                gl_FragColor = vec4(color * (0.4 + facets * 0.28 + edgeLight * 0.58), alpha);
            }
        `,
        extensions: { derivatives: true },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    });
    const fresnelShell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.008, 1), fresnelMaterial);
    fresnelShell.renderOrder = 2;
    crystalGroup.add(fresnelShell);

    const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.075, 1),
        new THREE.MeshPhysicalMaterial({
            color: 0xffe49b,
            metalness: 0.08,
            roughness: 0.22,
            transmission: 0,
            thickness: 0.42,
            ior: 1.2,
            transparent: true,
            opacity: 0.09,
            side: THREE.DoubleSide,
            wireframe: true,
            emissive: 0x846100,
            emissiveIntensity: 0.48,
        }),
    );
    crystalGroup.add(shell);

    const nucleus = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.39, 1),
        new THREE.MeshStandardMaterial({
            color: 0xfff5c2,
            emissive: 0xffdb29,
            emissiveIntensity: 3.1,
            roughness: 0.17,
            metalness: 0.08,
        }),
    );
    crystalGroup.add(nucleus);

    // ---- AIVA planet: procedural obsidian world with flowing gold energy veins, violet luminous
    // seas, aurora caps, a drifting haze layer and a lit/shadowed atmosphere. Plain GLSL, no textures.
    const planetOctaves = window.innerWidth < 600 ? 3 : 4;
    const planetUniforms = {
        uTime: { value: 0 },
        uClose: { value: 0 },
        uLight: { value: new THREE.Vector3(0.7, 0.45, 0.28) },
    };
    const planetSegments = window.innerWidth < 600 ? [64, 48] : [112, 80];
    const planetMaterial = new THREE.ShaderMaterial({
        uniforms: planetUniforms,
        vertexShader: PLANET_VERTEX,
        fragmentShader: buildPlanetFragment(planetOctaves),
        toneMapped: false,
    });
    const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(1, planetSegments[0], planetSegments[1]), planetMaterial);
    crystalGroup.add(planetMesh);

    const cloudMaterial = new THREE.ShaderMaterial({
        uniforms: planetUniforms,
        vertexShader: PLANET_VERTEX,
        fragmentShader: buildCloudFragment(planetOctaves),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
    });
    const planetCloud = new THREE.Mesh(new THREE.SphereGeometry(1.03, 64, 48), cloudMaterial);
    planetCloud.renderOrder = 1;
    crystalGroup.add(planetCloud);

    const atmosphereMaterial = new THREE.ShaderMaterial({
        uniforms: planetUniforms,
        vertexShader: PLANET_VERTEX,
        fragmentShader: PLANET_ATMOSPHERE_FRAGMENT,
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
    });
    const planetAtmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.13, 64, 48), atmosphereMaterial);
    planetAtmosphere.renderOrder = 2;
    crystalGroup.add(planetAtmosphere);

    const crystalParts = [crystal, fresnelShell, nucleus];
    crystalParts.forEach((part) => { part.visible = false; });
    const planetMeshes = [planetMesh, planetCloud, planetAtmosphere];
    const planetMaterials = [planetMaterial, cloudMaterial, atmosphereMaterial];

    const nucleusGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffdb29,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    }));
    nucleusGlow.position.set(0, 0, 0.38);
    nucleusGlow.scale.set(1.3, 1.3, 1);
    nucleusGlow.renderOrder = 1;
    crystalGroup.add(nucleusGlow);

    const glint = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffefc2,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    }));
    glint.scale.set(0.34, 0.34, 1);
    glint.renderOrder = 4;
    crystalGroup.add(glint);

    const lightStreak = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffc629,
        transparent: true,
        opacity: 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    }));
    lightStreak.scale.set(0.8, 0.07, 1);
    lightStreak.renderOrder = 3;
    crystalGroup.add(lightStreak);

    const flareGroup = new THREE.Group();
    flareGroup.position.set(0.22, 0.18, 1.18);
    flareGroup.renderOrder = 5;
    memoryWorld.add(flareGroup);
    flareGroup.visible = false;
    const flareGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffc527,
        transparent: true,
        opacity: 0.46,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    }));
    flareGlow.scale.set(1.18, 0.8, 1);
    flareGlow.renderOrder = 5;
    flareGroup.add(flareGlow);
    const flareCore = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffefc2,
        transparent: true,
        opacity: 0.76,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    }));
    flareCore.scale.set(0.3, 0.3, 1);
    flareCore.renderOrder = 5;
    flareGroup.add(flareCore);
    const flareStreak = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xffc629,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
    }));
    flareStreak.scale.set(1.55, 0.035, 1);
    flareStreak.rotation.z = -0.08;
    flareStreak.position.z = -0.015;
    flareStreak.renderOrder = 5;
    flareGroup.add(flareStreak);

    const seam = new THREE.Mesh(
        new THREE.TorusGeometry(0.73, 0.009, 5, 100),
        new THREE.MeshBasicMaterial({
            color: 0xffebb3,
            transparent: true,
            opacity: 0.48,
        }),
    );
    seam.rotation.x = Math.PI / 2;
    crystalGroup.add(seam);

    const orbitGroups = [];
    const orbitLights = [];
    const orbitSpecs = [
        { radius: 1.2, rotation: [0.38, 0.1, 0.28], speed: 0.075, color: 0xffe49a },
        { radius: 1.42, rotation: [1.05, 0.25, -0.35], speed: 0.055, color: 0xffc629 },
        { radius: 1.64, rotation: [0.22, 1.1, 0.72], speed: -0.038, color: 0xa78bfa },
    ];
    orbitSpecs.forEach((spec, index) => {
        const group = new THREE.Group();
        group.rotation.set(...spec.rotation);
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(spec.radius, 0.0045, 4, 150),
            new THREE.MeshBasicMaterial({
                color: spec.color,
                transparent: true,
                opacity: index === 1 ? 0.34 : 0.25,
                depthWrite: false,
            }),
        );
        group.add(ring);
        memoryWorld.add(group);
        orbitGroups.push({ group, speed: spec.speed });

        const light = new THREE.Mesh(
            new THREE.SphereGeometry(0.035, 10, 8),
            new THREE.MeshBasicMaterial({
                color: spec.color,
                transparent: true,
                opacity: 0.9,
            }),
        );
        memoryWorld.add(light);
        orbitLights.push({
            mesh: light,
            radius: spec.radius,
            euler: new THREE.Euler(...spec.rotation),
            point: new THREE.Vector3(),
            phase: index * 2.1,
        });
    });

    const fragmentRandom = createSeededRandom(41703);
    const fragmentCount = window.innerWidth < 600 ? 6 : window.innerWidth < 900 ? 10 : 14;
    const fragmentGeometry = new THREE.IcosahedronGeometry(0.075, 0);
    const fragments = [];
    for (let index = 0; index < fragmentCount; index += 1) {
        const material = new THREE.MeshStandardMaterial({
            color: index % 3 === 0 ? 0xffc629 : 0xffe8a8,
            emissive: index % 3 === 0 ? 0x6f5100 : 0x7b6600,
            emissiveIntensity: 0.38,
            roughness: 0.38,
            metalness: 0.15,
            transparent: true,
            opacity: 0.58,
        });
        const fragment = new THREE.Mesh(fragmentGeometry, material);
        const angle = fragmentRandom() * Math.PI * 2;
        const radius = 1.3 + fragmentRandom() * 0.62;
        fragment.position.set(
            Math.cos(angle) * radius,
            (fragmentRandom() - 0.5) * 2.8,
            (fragmentRandom() - 0.5) * 1.7,
        );
        const size = 0.32 + fragmentRandom() * 0.72;
        fragment.scale.setScalar(size);
        fragment.rotation.set(fragmentRandom() * 3, fragmentRandom() * 3, fragmentRandom() * 3);
        memoryWorld.add(fragment);
        fragments.push({
            mesh: fragment,
            baseX: fragment.position.x,
            baseY: fragment.position.y,
            baseZ: fragment.position.z,
            phase: fragmentRandom() * Math.PI * 2,
            spin: 0.08 + fragmentRandom() * 0.14,
        });
    }

    const particleRandom = createSeededRandom(22271);
    const particleCount = window.innerWidth < 600 ? 34 : window.innerWidth < 900 ? 62 : 96;
    const particleBase = new Float32Array(particleCount * 3);
    const particlePositions = new Float32Array(particleCount * 3);
    const particlePhases = new Float32Array(particleCount);
    for (let index = 0; index < particleCount; index += 1) {
        const offset = index * 3;
        particleBase[offset] = (particleRandom() - 0.5) * 9;
        particleBase[offset + 1] = (particleRandom() - 0.5) * 6;
        particleBase[offset + 2] = -1.2 + particleRandom() * 3.2;
        particlePhases[index] = particleRandom() * Math.PI * 2;
        particlePositions.set(particleBase.subarray(offset, offset + 3), offset);
    }
    const particlesGeometry = new THREE.BufferGeometry();
    particlesGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particlesMaterial = new THREE.PointsMaterial({
        color: 0xffecb8,
        size: window.innerWidth < 600 ? 0.026 : 0.032,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        sizeAttenuation: true,
    });
    const particles = new THREE.Points(particlesGeometry, particlesMaterial);
    particles.frustumCulled = false;
    scene.add(particles);

    const sceneState = {
        THREE,
        renderer,
        scene,
        camera,
        root,
        memoryWorld,
        crystalGroup,
        crystalMaterial,
        nucleusMaterial: nucleus.material,
        fresnelMaterial,
        glint,
        lightStreak,
        flareGroup,
        flareGlow,
        flareCore,
        flareStreak,
        nucleusGlow,
        cyanLight,
        orbitGroups,
        orbitLights,
        fragments,
        particleBase,
        particlePositions,
        particlePhases,
        particlesGeometry,
        particlesMaterial,
        particles,
        starfield,
        starStreaks,
        streakPositions,
        streakGeometry,
        streakMaterial,
        starBase,
        starPositions,
        starLayer,
        starTiers,
        planetMaterials,
        planetMeshes,
        crystalParts,
        violetLight,
        cyanLight,
        blueLight,
        rimLight,
        halo,
        halo2,
        planetUniforms,
        planetCloud,
        shadow,
        glowTexture,
    };
    return sceneState;
}

function disposeScene(state) {
    const disposedTextures = new Set();
    state.scene.traverse((object) => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
            if (!material) return;
            if (material.map && !disposedTextures.has(material.map)) {
                material.map.dispose();
                disposedTextures.add(material.map);
            }
            material.dispose();
        });
    });
    state.renderer.dispose();
    state.renderer.domElement.remove();
}

async function startExperience() {
    const sceneRoot = document.querySelector(".aiva-scene");
    if (!sceneRoot) return;
    const isDashboard = sceneRoot.dataset.page === "dashboard";

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const heroCopy = isDashboard ? document.querySelector(".aiva-hero-copy") : null;
    let reducedMotion = motionPreference.matches;
    let state;
    let animationFrame = 0;
    let previousTime = 0;
    let elapsed = 0;
    let targetProgress = getScrollProgress();
    let currentProgress = targetProgress;
    let currentX = sampleStops(CORE_STOPS_X, currentProgress);
    let currentY = sampleStops(CORE_STOPS_Y, currentProgress);
    let currentScale = sampleStops(CORE_STOPS_SCALE, currentProgress);
    let currentRotation = sampleStops(CORE_STOPS_ROTATION, currentProgress);

    setupReveals(reducedMotion);

    // --- cinematic helpers ---
    const pointer = { x: 0, y: 0 };
    let roll = 0;
    let leave = 0;
    const BASE_FOV = 42;
    const backgroundLayer = document.querySelector(".aiva-background");
    const progressBar = document.createElement("div");
    progressBar.className = "aiva-progress";
    progressBar.setAttribute("aria-hidden", "true");
    document.body.appendChild(progressBar);
    window.addEventListener("pointermove", (event) => {
        if (event.pointerType === "touch") return;
        pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
        pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    const onScroll = () => { targetProgress = getScrollProgress(); };
    const onResize = () => {
        targetProgress = getScrollProgress();
        if (!state) return;
        state.camera.aspect = window.innerWidth / Math.max(window.innerHeight, 1);
        state.camera.updateProjectionMatrix();
        state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        state.renderer.setSize(window.innerWidth, window.innerHeight);
        renderCurrentState();
    };
    const onVisibilityChange = () => {
        if (document.hidden) {
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
        } else if (!reducedMotion) {
            previousTime = 0;
            animationFrame = requestAnimationFrame(animate);
        } else {
            renderCurrentState();
        }
    };

    // Shared motion model. Everything below is a pure function of the planet's (damped) position and
    // scale, so scrolling backwards reverses the whole scene. Velocities are the frame-to-frame change
    // of that position/scale (smoothed), and decide the direction of the star streaks.
    let previousCloseness = null;
    let previousPlanetX = 0;
    let previousPlanetY = 0;
    let surge = 0;      // signed approach speed (+ planet approaching, - retreating)
    let lateralX = 0;   // planet screen velocity, world units / second
    let lateralY = 0;
    const particleBaseSize = window.innerWidth < 600 ? 0.026 : 0.032;

    function updateDepthField(delta) {
        const sizeFactor = window.innerWidth < 600 ? MOBILE_SCALE_FACTOR : 1;
        const closeness = isDashboard
            ? clamp((currentScale / sizeFactor - CORE_SCALE_MIN) / (CORE_SCALE_MAX - CORE_SCALE_MIN), 0, 1)
            : 0;
        if (delta > 0 && previousCloseness !== null) {
            surge = damp(surge, clamp(((closeness - previousCloseness) / delta) * 0.9, -0.6, 0.6), delta, STAR_WARP.surgeDamping);
            lateralX = damp(lateralX, clamp((currentX - previousPlanetX) / delta, -3, 3), delta, STAR_WARP.surgeDamping);
            lateralY = damp(lateralY, clamp((currentY - previousPlanetY) / delta, -3, 3), delta, STAR_WARP.surgeDamping);
        } else {
            surge = 0;
            lateralX = 0;
            lateralY = 0;
        }
        previousCloseness = closeness;
        previousPlanetX = currentX;
        previousPlanetY = currentY;

        const leaveTarget = document.documentElement.classList.contains("aiva-leaving") ? 1 : 0;
        leave = delta > 0 ? damp(leave, leaveTarget, delta, 5) : leaveTarget;
        const radial = surge + leave * 0.5;
        const lateralMag = Math.hypot(lateralX, lateralY);
        const motion = clamp(Math.abs(radial) * 1.2 + lateralMag * 0.12, 0, 1);
        const camZ = state.camera.position.z;
        const zoom = closeness * STAR_WARP.travel + radial * STAR_WARP.surge;
        const expand = closeness * STAR_WARP.spread;
        const { starBase, starPositions, starLayer } = state;

        // Stars: expand radially about the planet's own focus point, follow its lateral movement with
        // depth-dependent parallax, and travel in depth.
        for (let index = 0; index < starLayer.length; index += 1) {
            const o = index * 3;
            const layer = starLayer[index];
            const depth = (camZ - starBase[o + 2]) / camZ;
            const focusX = currentX * depth;
            const focusY = currentY * depth;
            starPositions[o] = starBase[o] + (starBase[o] - focusX) * expand * layer + currentX * STAR_WARP.parallax * layer;
            starPositions[o + 1] = starBase[o + 1] + (starBase[o + 1] - focusY) * expand * layer + currentY * STAR_WARP.parallax * layer;
            starPositions[o + 2] = starBase[o + 2] + zoom * layer;
        }
        for (const tier of state.starTiers) {
            tier.material.size = tier.size * (1 + closeness * STAR_WARP.sizeGain * tier.depth + motion * 0.3);
            tier.material.opacity = clamp(tier.opacity + closeness * STAR_WARP.opacityGain * tier.depth + motion * 0.12, 0.25, 0.95);
            tier.geometry.attributes.position.needsUpdate = true;
        }

        // Streaks trail opposite to each star's own apparent velocity: radial (toward / away from the
        // planet's focus point) when the planet approaches or retreats, plus its lateral drift.
        const rate = clamp(radial * 0.9, -0.45, 0.45);
        const streakOpacity = clamp((Math.abs(rate) * 1.6 + lateralMag * 0.2) * 0.9, 0, 0.55);
        state.starStreaks.visible = streakOpacity > 0.015;
        if (state.starStreaks.visible) {
            const out = state.streakPositions;
            for (let index = 0; index < starLayer.length; index += 1) {
                const o = index * 3;
                const q = index * 6;
                const layer = starLayer[index];
                const depth = (camZ - starBase[o + 2]) / camZ;
                const x = starPositions[o];
                const y = starPositions[o + 1];
                const z = starPositions[o + 2];
                out[q] = x;
                out[q + 1] = y;
                out[q + 2] = z;
                out[q + 3] = x - ((x - currentX * depth) * rate + lateralX * STAR_WARP.parallax * 1.6) * layer;
                out[q + 4] = y - ((y - currentY * depth) * rate + lateralY * STAR_WARP.parallax * 1.6) * layer;
                out[q + 5] = z - rate * layer * 2.2;
            }
            state.streakGeometry.attributes.position.needsUpdate = true;
            state.streakMaterial.opacity = streakOpacity;
        }

        const particleSpread = closeness * STAR_WARP.particleSpread;
        for (let index = 0; index < state.particlePhases.length; index += 1) {
            const o = index * 3;
            const phase = state.particlePhases[index];
            const bx = state.particleBase[o];
            const by = state.particleBase[o + 1];
            const bz = state.particleBase[o + 2];
            const depth = (camZ - bz) / camZ;
            state.particlePositions[o] = bx + (bx - currentX * depth) * particleSpread + currentX * STAR_WARP.parallax * 1.3 + Math.sin(elapsed * 0.055 + phase) * 0.065;
            state.particlePositions[o + 1] = by + (by - currentY * depth) * particleSpread + currentY * STAR_WARP.parallax * 1.3 + Math.sin(elapsed * 0.1 + phase) * 0.07;
            state.particlePositions[o + 2] = bz + zoom * STAR_WARP.particleTravel;
        }
        state.particlesGeometry.attributes.position.needsUpdate = true;
        state.particlesMaterial.size = particleBaseSize * (1 + closeness * 0.55 + motion * 0.2);
        state.particlesMaterial.opacity = clamp(0.42 + closeness * 0.2 + motion * 0.1, 0.3, 0.8);

        state.closeness = closeness;
        state.motion = motion;
        state.surgeSigned = radial;
    }

    function applyTransforms(delta) {
        currentProgress = damp(currentProgress, targetProgress, delta, MOTION.progressDamping);
        const widthScale = clamp(window.innerWidth / 1200, 0.36, 1);
        const mobile = window.innerWidth < 600;
        const targetX = isDashboard
            ? sampleStops(CORE_STOPS_X, currentProgress) * widthScale
            : (mobile ? 1.45 : 2.45) * widthScale;
        const targetY = isDashboard
            ? sampleStops(CORE_STOPS_Y, currentProgress) - (mobile ? 0.35 : 0)
            : 0.08;
        const targetScale = isDashboard
            ? sampleStops(CORE_STOPS_SCALE, currentProgress) * (mobile ? MOBILE_SCALE_FACTOR : 1)
            : (mobile ? 0.34 : 0.48);
        const targetRotation = isDashboard ? sampleStops(CORE_STOPS_ROTATION, currentProgress) : 0.35;
        const mobileHeroY = isDashboard && mobile && heroCopy && currentProgress < 0.16
            ? (() => {
                const viewHeight = 2 * state.camera.position.z * Math.tan(
                    (state.camera.fov / 2) * Math.PI / 180,
                );
                const pixelsPerUnit = window.innerHeight / viewHeight;
                const planetRadius = 1.1 * targetScale * pixelsPerUnit;
                const centerY = heroCopy.getBoundingClientRect().bottom + planetRadius + 24;
                const heroY = (window.innerHeight / 2 - centerY) / pixelsPerUnit;
                return lerp(heroY, targetY, smoothStep(currentProgress / 0.16));
            })()
            : targetY;
        if (delta === 0) {
            currentX = targetX;
            currentY = mobileHeroY;
            currentScale = targetScale;
            currentRotation = targetRotation;
        } else {
            currentX = damp(currentX, targetX, delta, MOTION.scrollDamping);
            currentY = damp(currentY, mobileHeroY, delta, MOTION.scrollDamping);
            currentScale = damp(currentScale, targetScale, delta, MOTION.scrollDamping);
            currentRotation = damp(currentRotation, targetRotation, delta, 0.9);
        }
        state.memoryWorld.position.set(currentX, currentY, 0);
        state.memoryWorld.scale.setScalar(currentScale);
        state.crystalGroup.rotation.y = currentRotation;
        updateDepthField(delta);
        if (backgroundLayer) {
            const c = state.closeness || 0;
            backgroundLayer.style.transform = `translate3d(${(currentX * 0.7).toFixed(2)}%, ${(-currentY * 1.2).toFixed(2)}%, 0) scale(${(1.1 + c * 0.08).toFixed(3)})`;
        }
        progressBar.style.transform = `scaleX(${currentProgress.toFixed(4)})`;
        return currentProgress;
    }

    // Camera drifts with the pointer, rolls and widens its FOV while "travelling".
    function updateCinematics(delta) {
        const cam = state.camera;
        cam.position.x = damp(cam.position.x, pointer.x * 0.34, delta, 2.2);
        cam.position.y = damp(cam.position.y, -pointer.y * 0.2, delta, 2.2);
        cam.lookAt(0, 0, 0);
        roll = damp(roll, clamp(-(state.surgeSigned || 0) * 0.03, -0.025, 0.025), delta, 3);
        cam.rotation.z = roll;
        const fov = BASE_FOV + clamp(state.motion || 0, 0, 1) * 4;
        if (Math.abs(cam.fov - fov) > 0.02) {
            cam.fov = damp(cam.fov, fov, delta, 5);
            cam.updateProjectionMatrix();
        }
    }

    let shadersChecked = false;
    // If the planet shaders fail to compile on some GPU, fall back to the original crystal core.
    function verifyPlanetShaders() {
        if (shadersChecked) return;
        shadersChecked = true;
        try {
            const broken = state.planetMaterials.some((material) => {
                const program = state.renderer.properties.get(material).currentProgram;
                return program && program.diagnostics && program.diagnostics.runnable === false;
            });
            if (broken) {
                state.planetMeshes.forEach((mesh) => { mesh.visible = false; });
                state.crystalParts.forEach((part) => { part.visible = true; });
                console.warn("AIVA: planet shader failed to compile; using the crystal core instead.");
            }
        } catch (error) {
            /* diagnostics unavailable: keep the planet */
        }
    }

    function renderCurrentState() {
        if (!state) return;
        state.renderer.render(state.scene, state.camera);
    }

    function animate(now) {
        if (!state || document.hidden || reducedMotion) return;
        const rawDelta = previousTime ? (now - previousTime) / 1000 : 0;
        const delta = Math.min(rawDelta, 0.05);
        previousTime = now;
        elapsed += delta;

        const progress = applyTransforms(delta);
        const entranceProgress = clamp(elapsed / MOTION.entranceDuration, 0, 1);
        const entrance = 1 - Math.pow(1 - entranceProgress, 3);
        const entranceDistance = window.innerWidth < 600 ? 0.12 : 0.7;
        state.memoryWorld.position.y += (entrance - 1) * entranceDistance;
        state.crystalGroup.rotation.y = currentRotation + elapsed * 0.035;
        state.crystalGroup.rotation.x = Math.sin(elapsed * 0.08) * 0.035;
        state.crystalGroup.position.y = Math.sin(elapsed * MOTION.floatFrequency) * MOTION.floatAmplitude;
        state.orbitGroups.forEach(({ group, speed }) => {
            group.rotation.y += delta * speed * 0.28;
            group.rotation.z += delta * speed * 0.28 * 0.47;
        });
        for (const { mesh, radius, euler, point, phase } of state.orbitLights) {
            const angle = elapsed * 0.08 + phase;
            point.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
            point.applyEuler(euler);
            mesh.position.copy(point);
        }
        for (const { mesh, baseX, baseY, baseZ, phase, spin } of state.fragments) {
            mesh.position.x = baseX + Math.sin(elapsed * 0.07 + phase) * 0.07;
            mesh.position.y = baseY + Math.sin(elapsed * 0.12 + phase) * 0.09;
            mesh.position.z = baseZ + Math.cos(elapsed * 0.08 + phase) * 0.06;
            mesh.rotation.x += delta * spin * 0.3;
            mesh.rotation.y += delta * spin * 0.21;
        }
        // particle + star motion is handled in updateDepthField() (called from applyTransforms)
        const pageIntensity = isDashboard ? 1 : 0.54;
        const intensity = clamp(
            (0.84 + Math.sin(elapsed * 0.2) * 0.025 - progress * 0.16) * pageIntensity,
            0.35,
            1,
        );
        state.crystalMaterial.emissiveIntensity = intensity;
        state.nucleusMaterial.emissiveIntensity = 2.65 + intensity * 1.05;
        state.nucleusGlow.material.opacity = 0.62 + Math.sin(elapsed * 0.72) * 0.06;
        state.nucleusGlow.scale.setScalar(1.25 + Math.sin(elapsed * 0.72) * 0.045);
        state.fresnelMaterial.uniforms.uTime.value = elapsed;
        // Sun sits on the outer side of the planet, behind it: its face toward the page content stays
        // in shadow (readable text) while the limb facing away gets the lit gold crescent.
        const planetUniforms = state.planetUniforms;
        planetUniforms.uTime.value = elapsed;
        planetUniforms.uClose.value = state.closeness || 0;
        planetUniforms.uLight.value.set(clamp(currentX * 0.24, -0.85, 0.85), 0.42 + Math.sin(elapsed * 0.05) * 0.04, 0.28);
        state.planetCloud.rotation.y = elapsed * 0.014;
        state.planetCloud.rotation.x = Math.sin(elapsed * 0.03) * 0.05;
        state.halo2.material.opacity = (0.14 + (state.closeness || 0) * 0.16) * pageIntensity;
        state.violetLight.intensity = 2.5 + intensity * 1.1 + (state.closeness || 0) * 1.4;
        state.cyanLight.intensity = 1.8 + (1 - intensity) * 0.8;
        state.cyanLight.position.set(
            Math.sin(elapsed * 0.08) * 2.3,
            -0.7 + Math.cos(elapsed * 0.06) * 0.55,
            2.1,
        );
        state.rimLight.position.set(
            Math.cos(elapsed * 0.05) * 1.4,
            1.5 + Math.sin(elapsed * 0.07) * 0.5,
            -2,
        );
        state.blueLight.position.set(
            2.0 + Math.sin(elapsed * 0.045) * 0.3,
            1.35 + Math.cos(elapsed * 0.06) * 0.25,
            -0.6,
        );
        state.halo.material.opacity = (0.24 + intensity * 0.1 + (state.closeness || 0) * 0.14) * pageIntensity;
        state.shadow.material.opacity = 0.48 * pageIntensity;
        state.flareGroup.position.set(
            0.22 + Math.sin(elapsed * 0.19) * 0.045,
            0.18 + Math.cos(elapsed * 0.23) * 0.035,
            1.18,
        );
        state.flareGlow.material.opacity = (0.34 + Math.sin(elapsed * 0.48) * 0.055) * pageIntensity;
        state.flareCore.material.opacity = (0.68 + Math.sin(elapsed * 0.62) * 0.06) * pageIntensity;
        state.flareStreak.material.opacity = (0.24 + Math.sin(elapsed * 0.42) * 0.035) * pageIntensity;
        const glintX = Math.sin(elapsed * 0.2) * 0.4;
        const glintY = Math.cos(elapsed * 0.29) * 0.34;
        state.glint.position.set(glintX, glintY, 0.79);
        state.lightStreak.position.set(glintX, glintY, 0.77);
        state.lightStreak.rotation.z = Math.sin(elapsed * 0.1) * 0.12;

        updateCinematics(delta);
        state.renderer.render(state.scene, state.camera);
        verifyPlanetShaders();
        animationFrame = requestAnimationFrame(animate);
    }

    try {
        const THREE = await import("three");
        state = createMemoryCore(THREE, sceneRoot);
        sceneRoot.classList.add("aiva-webgl-ready");
        applyTransforms(0);
        renderCurrentState();

        if (!reducedMotion) animationFrame = requestAnimationFrame(animate);
        else setupReveals(true);
    } catch (error) {
        console.warn("AIVA Memory Core WebGL unavailable; using the CSS illustration.", error);
        sceneRoot.querySelector("canvas")?.remove();
    }

    document.addEventListener("click", (event) => {
        const link = event.target.closest?.("a[href]");
        if (!link || event.defaultPrevented || event.button !== 0 || reducedMotion) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return;
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
        event.preventDefault();
        document.documentElement.classList.add("aiva-leaving");
        window.setTimeout(() => { window.location.href = url.href; }, 420);
    });
    window.addEventListener("pageshow", () => document.documentElement.classList.remove("aiva-leaving"));

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    const onMotionChange = (event) => {
        reducedMotion = event.matches;
        if (reducedMotion) {
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
            setupReveals(true);
            renderCurrentState();
        } else if (state && !document.hidden) {
            setupReveals(false);
            previousTime = 0;
            animationFrame = requestAnimationFrame(animate);
        }
    };
    motionPreference.addEventListener?.("change", onMotionChange);

    window.addEventListener("pagehide", () => {
        cancelAnimationFrame(animationFrame);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        motionPreference.removeEventListener?.("change", onMotionChange);
        if (state) disposeScene(state);
    }, { once: true });
}

startExperience();
