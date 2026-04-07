/**
 * Stylized Building Generator
 * 
 * A procedural building generator that creates stylized, low-poly buildings
 * using stacked box geometries with controlled randomness.
 * 
 * Key Features:
 * - Seed-based random generation for reproducible results
 * - Stacked segment architecture with tapering and offsets
 * - Window patterns using emissive materials
 * - Roof variations (antennas, mechanical boxes)
 * - Export to GLTF or JSON format
 */

// ============================================
// GLOBAL VARIABLES
// ============================================

let scene, camera, renderer, controls;
let currentBuilding = null;
let wireframeMode = false;

// Color palettes for different styles
const COLOR_PALETTES = {
    modern: {
        primary: '#4a6fa5',
        secondary: '#6b8cb8',
        accent: '#89c4f4',
        window: '#ffeaa7',
        name: 'Modern Blue'
    },
    warm: {
        primary: '#e17055',
        secondary: '#d63031',
        accent: '#fdcb6e',
        window: '#fff3cd',
        name: 'Warm Sunset'
    },
    mono: {
        primary: '#636e72',
        secondary: '#b2bec3',
        accent: '#dfe6e9',
        window: '#ffffff',
        name: 'Monochrome'
    },
    vibrant: {
        primary: '#6c5ce7',
        secondary: '#a29bfe',
        accent: '#fd79a8',
        window: '#55efc4',
        name: 'Vibrant City'
    },
    industrial: {
        primary: '#2d3436',
        secondary: '#636e72',
        accent: '#b2bec3',
        window: '#ffeaa7',
        name: 'Industrial'
    }
};

// ============================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================

/**
 * Mulberry32 - A simple seeded PRNG
 * Returns a function that generates pseudo-random numbers based on a seed
 * This allows reproducible building generation
 */
function createSeededRandom(seed) {
    let state = seed;
    
    return function() {
        state |= 0;
        state = state + 0x6D2B79F5 | 0;
        let t = Math.imul(state ^ state >>> 15, 1 | state);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * Generate a numeric seed from a string
 * Uses a simple hash function to convert text to a number
 */
function stringToSeed(str) {
    if (!str || str.trim() === '') {
        return Math.floor(Math.random() * 1000000);
    }
    
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

// ============================================
// THREE.JS SCENE SETUP
// ============================================

/**
 * Initialize the Three.js scene, camera, renderer, and controls
 */
function initScene() {
    const container = document.getElementById('canvas-container');
    
    // Scene with neutral background
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    
    // Perspective camera for good viewing angles
    camera = new THREE.PerspectiveCamera(
        45, 
        container.clientWidth / container.clientHeight, 
        0.1, 
        1000
    );
    camera.position.set(80, 60, 80);
    camera.lookAt(0, 30, 0);
    
    // WebGL renderer with antialiasing for clean edges
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    
    // OrbitControls for interactive viewing
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 20;
    controls.maxDistance = 200;
    controls.maxPolarAngle = Math.PI / 2.1; // Prevent going below ground
    
    // Ground plane for reference
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({ 
        color: 0x0f0f1a,
        roughness: 0.8,
        metalness: 0.2
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    scene.add(ground);
    
    // Grid helper for scale reference
    const gridHelper = new THREE.GridHelper(200, 20, 0x333355, 0x222244);
    gridHelper.position.y = 0;
    scene.add(gridHelper);
    
    // Lighting setup
    // Ambient light for base illumination
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    // Main directional light (sun-like)
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
    mainLight.position.set(50, 80, 50);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 10;
    mainLight.shadow.camera.far = 200;
    mainLight.shadow.camera.left = -60;
    mainLight.shadow.camera.right = 60;
    mainLight.shadow.camera.top = 60;
    mainLight.shadow.camera.bottom = -60;
    scene.add(mainLight);
    
    // Fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0x6688cc, 0.3);
    fillLight.position.set(-30, 40, -30);
    scene.add(fillLight);
    
    // Rim light for edge definition
    const rimLight = new THREE.DirectionalLight(0xffaa88, 0.2);
    rimLight.position.set(0, 20, -50);
    scene.add(rimLight);
    
    // Handle window resize
    window.addEventListener('resize', onWindowResize);
    
    // Start animation loop
    animate();
}

/**
 * Handle window resize events
 */
function onWindowResize() {
    const container = document.getElementById('canvas-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

/**
 * Animation loop for rendering and controls update
 */
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// ============================================
// BUILDING GENERATION
// ============================================

/**
 * Main building generation function
 * 
 * @param {Object} config - Configuration object containing:
 *   - height: Total building height (20-100)
 *   - width: Base width (10-40)
 *   - depth: Base depth (10-40)
 *   - segments: Number of stacked segments (2-10)
 *   - seed: Random seed for reproducibility
 *   - palette: Color palette key
 *   - addWindows: Boolean to enable windows
 *   - roofVariations: Boolean to enable roof details
 * 
 * @returns {THREE.Group} The generated building group
 */
function generateBuilding(config) {
    // Initialize seeded random
    const seed = stringToSeed(config.seed);
    const random = createSeededRandom(seed);
    
    // Get color palette
    const palette = COLOR_PALETTES[config.palette] || COLOR_PALETTES.modern;
    
    // Create building group to hold all segments
    const buildingGroup = new THREE.Group();
    buildingGroup.name = 'Building';
    
    // Calculate segment heights
    // Segments get progressively smaller toward the top for natural tapering
    const totalHeight = config.height;
    const segmentHeights = [];
    let remainingHeight = totalHeight;
    
    for (let i = 0; i < config.segments; i++) {
        const progress = i / config.segments;
        // Early segments are taller, later segments shorter
        const heightFactor = (1 - progress * 0.5) / config.segments;
        const segHeight = Math.max(3, remainingHeight * heightFactor * (0.8 + random() * 0.4));
        segmentHeights.push(segHeight);
        remainingHeight -= segHeight;
    }
    
    // Distribute remaining height to last segment
    if (remainingHeight > 0 && segmentHeights.length > 0) {
        segmentHeights[segmentHeights.length - 1] += remainingHeight;
    }
    
    // Track cumulative height for positioning
    let currentY = 0;
    
    // Current footprint dimensions (for tapering effect)
    let currentWidth = config.width;
    let currentDepth = config.depth;
    
    // Generate each segment
    for (let i = 0; i < config.segments; i++) {
        const segHeight = segmentHeights[i];
        
        // Tapering: reduce dimensions slightly each segment
        // Creates a stepped pyramid effect
        const taperFactor = 0.85 + random() * 0.1; // 85-95% of previous
        const newWidth = Math.max(4, currentWidth * taperFactor);
        const newDepth = Math.max(4, currentDepth * taperFactor);
        
        // Offset: slight X/Z shift for asymmetry
        // Limited to prevent extreme overhangs
        const maxOffset = (currentWidth - newWidth) * 0.8;
        const offsetX = (random() - 0.5) * maxOffset;
        const offsetZ = (random() - 0.5) * maxOffset;
        
        // Calculate position (centered on previous segment)
        const posX = offsetX;
        const posY = currentY + segHeight / 2;
        const posZ = offsetZ;
        
        // Create segment geometry
        const segmentGeometry = new THREE.BoxGeometry(newWidth, segHeight, newDepth);
        
        // Create material with slight color variation per segment
        const colorVariation = 0.9 + random() * 0.2; // ±10% brightness
        const segmentMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(palette.primary).multiplyScalar(colorVariation),
            roughness: 0.7,
            metalness: 0.1,
            flatShading: true // Low-poly look
        });
        
        const segment = new THREE.Mesh(segmentGeometry, segmentMaterial);
        segment.position.set(posX, posY, posZ);
        segment.castShadow = true;
        segment.receiveShadow = true;
        segment.name = `Segment_${i}`;
        
        buildingGroup.add(segment);
        
        // Add windows if enabled
        if (config.addWindows) {
            addWindowsToSegment(segment, newWidth, segHeight, newDepth, palette, random);
        }
        
        // Update for next segment
        currentY += segHeight;
        currentWidth = newWidth;
        currentDepth = newDepth;
    }
    
    // Add roof variations if enabled
    if (config.roofVariations && currentWidth > 3 && currentDepth > 3) {
        addRoofVariations(buildingGroup, currentY, currentWidth, currentDepth, palette, random);
    }
    
    // Apply wireframe mode if active
    if (wireframeMode) {
        applyWireframeMode(buildingGroup);
    }
    
    return buildingGroup;
}

/**
 * Add window details to a building segment
 * Uses emissive materials to simulate lit windows
 * 
 * @param {THREE.Mesh} segment - The segment mesh
 * @param {number} width - Segment width
 * @param {number} height - Segment height
 * @param {number} depth - Segment depth
 * @param {Object} palette - Color palette
 * @param {Function} random - Seeded random function
 */
function addWindowsToSegment(segment, width, height, depth, palette, random) {
    const windowGroup = new THREE.Group();
    windowGroup.name = 'Windows';
    
    // Window configuration
    const windowRows = Math.floor(height / 4); // One row per ~4 units
    const windowCols = Math.floor(width / 3);  // One column per ~3 units
    
    const windowWidth = Math.min(1.5, width / (windowCols + 1));
    const windowHeight = Math.min(1.5, height / (windowRows + 1));
    
    // Create window geometry (thin box that sits slightly outside the wall)
    const windowGeometry = new THREE.BoxGeometry(windowWidth, windowHeight, 0.1);
    
    // Emissive material for glowing window effect
    const windowMaterial = new THREE.MeshStandardMaterial({
        color: palette.window,
        emissive: palette.window,
        emissiveIntensity: 0.5,
        roughness: 0.3,
        metalness: 0.7
    });
    
    // Add windows to each face (front, back, left, right)
    const faces = [
        { axis: 'z', pos: depth/2 + 0.05, rotX: 0, rotY: 0 },      // Front
        { axis: 'z', pos: -depth/2 - 0.05, rotX: 0, rotY: Math.PI }, // Back
        { axis: 'x', pos: width/2 + 0.05, rotX: 0, rotY: Math.PI/2 }, // Right
        { axis: 'x', pos: -width/2 - 0.05, rotX: 0, rotY: -Math.PI/2 } // Left
    ];
    
    faces.forEach(face => {
        for (let row = 0; row < windowRows; row++) {
            for (let col = 0; col < windowCols; col++) {
                // Random chance for each window to be "lit"
                if (random() > 0.3) continue; // 70% chance of no window
                
                const window = new THREE.Mesh(windowGeometry, windowMaterial.clone());
                
                // Position within the face
                const u = (col + 0.5) / windowCols - 0.5;
                const v = (row + 0.5) / windowRows - 0.5;
                
                if (face.axis === 'z') {
                    window.position.set(u * width * 0.8, v * height * 0.8, face.pos);
                    window.rotation.x = face.rotX;
                    window.rotation.y = face.rotY;
                } else {
                    window.position.set(face.pos, v * height * 0.8, u * depth * 0.8);
                    window.rotation.x = face.rotX;
                    window.rotation.y = face.rotY;
                }
                
                windowGroup.add(window);
            }
        }
    });
    
    segment.add(windowGroup);
}

/**
 * Add roof variations (antennas, mechanical boxes, etc.)
 * Adds visual interest to the building silhouette
 * 
 * @param {THREE.Group} buildingGroup - The building group
 * @param {number} y - Y position at top of building
 * @param {number} width - Top segment width
 * @param {number} depth - Top segment depth
 * @param {Object} palette - Color palette
 * @param {Function} random - Seeded random function
 */
function addRoofVariations(buildingGroup, y, width, depth, palette, random) {
    const roofGroup = new THREE.Group();
    roofGroup.name = 'RoofDetails';
    
    // Randomly choose roof type(s)
    const roofType = random();
    
    // Type 1: Antenna mast (30% chance)
    if (roofType < 0.3) {
        const antennaHeight = 5 + random() * 10;
        const antennaGeometry = new THREE.CylinderGeometry(0.2, 0.3, antennaHeight, 6);
        const antennaMaterial = new THREE.MeshStandardMaterial({
            color: 0x888888,
            roughness: 0.5,
            metalness: 0.8
        });
        const antenna = new THREE.Mesh(antennaGeometry, antennaMaterial);
        antenna.position.set(0, y + antennaHeight/2, 0);
        antenna.castShadow = true;
        roofGroup.add(antenna);
        
        // Add antenna tip light
        const tipGeometry = new THREE.SphereGeometry(0.4, 8, 8);
        const tipMaterial = new THREE.MeshStandardMaterial({
            color: 0xff0000,
            emissive: 0xff0000,
            emissiveIntensity: 0.8
        });
        const tip = new THREE.Mesh(tipGeometry, tipMaterial);
        tip.position.set(0, y + antennaHeight, 0);
        roofGroup.add(tip);
    }
    
    // Type 2: Mechanical box / HVAC unit (30% chance)
    if (roofType >= 0.3 && roofType < 0.6) {
        const boxWidth = width * 0.3;
        const boxDepth = depth * 0.3;
        const boxHeight = 2 + random() * 2;
        
        const boxGeometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);
        const boxMaterial = new THREE.MeshStandardMaterial({
            color: palette.secondary,
            roughness: 0.8,
            metalness: 0.3,
            flatShading: true
        });
        const box = new THREE.Mesh(boxGeometry, boxMaterial);
        box.position.set(
            (random() - 0.5) * (width - boxWidth) * 0.5,
            y + boxHeight/2,
            (random() - 0.5) * (depth - boxDepth) * 0.5
        );
        box.castShadow = true;
        roofGroup.add(box);
    }
    
    // Type 3: Parabolic dish (20% chance)
    if (roofType >= 0.6 && roofType < 0.8) {
        const dishGeometry = new THREE.SphereGeometry(2, 8, 8, 0, Math.PI * 2, 0, Math.PI/2);
        const dishMaterial = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.3,
            metalness: 0.9,
            side: THREE.DoubleSide
        });
        const dish = new THREE.Mesh(dishGeometry, dishMaterial);
        dish.position.set(
            (random() - 0.5) * width * 0.3,
            y + 2,
            (random() - 0.5) * depth * 0.3
        );
        dish.rotation.x = Math.PI;
        dish.rotation.z = (random() - 0.5) * 0.5;
        dish.castShadow = true;
        roofGroup.add(dish);
    }
    
    // Type 4: Multiple small structures (20% chance)
    if (roofType >= 0.8) {
        const numStructures = 2 + Math.floor(random() * 3);
        
        for (let i = 0; i < numStructures; i++) {
            const structWidth = 1.5 + random() * 2;
            const structDepth = 1.5 + random() * 2;
            const structHeight = 1.5 + random() * 2;
            
            const structGeometry = new THREE.BoxGeometry(structWidth, structHeight, structDepth);
            const structMaterial = new THREE.MeshStandardMaterial({
                color: palette.accent,
                roughness: 0.6,
                metalness: 0.2,
                flatShading: true
            });
            const structure = new THREE.Mesh(structGeometry, structMaterial);
            structure.position.set(
                (random() - 0.5) * (width - structWidth) * 0.8,
                y + structHeight/2,
                (random() - 0.5) * (depth - structDepth) * 0.8
            );
            structure.castShadow = true;
            roofGroup.add(structure);
        }
    }
    
    buildingGroup.add(roofGroup);
}

/**
 * Apply wireframe material to entire building
 * Used for debugging or stylistic effect
 * 
 * @param {THREE.Group} buildingGroup - The building group
 */
function applyWireframeMode(buildingGroup) {
    buildingGroup.traverse((child) => {
        if (child.isMesh) {
            child.material = new THREE.MeshBasicMaterial({
                color: child.material.color,
                wireframe: true,
                transparent: true,
                opacity: 0.8
            });
        }
    });
}

// ============================================
// SCENE MANAGEMENT
// ============================================

/**
 * Clear the current building from the scene
 * Properly dispose of geometry and materials to prevent memory leaks
 */
function clearScene() {
    if (currentBuilding) {
        // Recursively dispose of all meshes
        currentBuilding.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(mat => mat.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        
        scene.remove(currentBuilding);
        currentBuilding = null;
    }
}

/**
 * Generate and display a new building
 * Reads configuration from UI controls
 */
function generateAndDisplay() {
    // Read configuration from UI
    const config = {
        height: parseInt(document.getElementById('height-slider').value),
        width: parseInt(document.getElementById('width-slider').value),
        depth: parseInt(document.getElementById('depth-slider').value),
        segments: parseInt(document.getElementById('segments-slider').value),
        seed: document.getElementById('seed-input').value,
        palette: document.getElementById('palette-select').value,
        addWindows: document.getElementById('windows-check').checked,
        roofVariations: document.getElementById('roof-variations-check').checked
    };
    
    // Clear existing building
    clearScene();
    
    // Generate new building
    currentBuilding = generateBuilding(config);
    
    // Center the building
    currentBuilding.position.y = 0;
    
    // Add to scene
    scene.add(currentBuilding);
    
    // Adjust camera target to focus on building
    controls.target.set(0, config.height / 2, 0);
    controls.update();
}

// ============================================
// EXPORT FUNCTIONALITY
// ============================================

/**
 * Export the current building as GLTF format
 * GLTF is the preferred format for Three.js assets
 * Includes geometry, materials, and hierarchy
 */
function exportAsGLTF() {
    if (!currentBuilding) {
        showStatus('No building to export!');
        return;
    }
    
    const exporter = new THREE.GLTFExporter();
    
    const options = {
        binary: true, // Export as .glb (binary glTF)
        includeCustomExtensions: false,
        animations: null,
        onlyVisible: true,
        trs: false,
        writeTypedArrays: true,
        forceIndices: false,
        forcePowerOfTwoTextures: false
    };
    
    exporter.parse(
        currentBuilding,
        (result) => {
            if (result instanceof ArrayBuffer) {
                downloadBlob(new Blob([result], { type: 'application/octet-stream' }), 'building.glb');
            } else {
                const output = JSON.stringify(result, null, 2);
                downloadBlob(new Blob([output], { type: 'text/plain' }), 'building.gltf');
            }
            showStatus('Building exported as GLTF!');
        },
        (error) => {
            console.error('Export error:', error);
            showStatus('Export failed!');
        },
        options
    );
}

/**
 * Export the current building as JSON
 * Exports a simplified JSON structure describing the building
 * Useful for custom loaders or data-driven applications
 */
function exportAsJSON() {
    if (!currentBuilding) {
        showStatus('No building to export!');
        return;
    }
    
    // Create a structured JSON representation
    const buildingData = {
        name: 'StylizedBuilding',
        version: '1.0',
        segments: [],
        metadata: {
            exportDate: new Date().toISOString(),
            totalSegments: 0
        }
    };
    
    // Extract segment data
    currentBuilding.traverse((child) => {
        if (child.name && child.name.startsWith('Segment_')) {
            const segmentData = {
                name: child.name,
                position: {
                    x: child.position.x,
                    y: child.position.y,
                    z: child.position.z
                },
                scale: {
                    x: child.scale.x,
                    y: child.scale.y,
                    z: child.scale.z
                },
                geometry: {
                    type: 'BoxGeometry',
                    parameters: {
                        width: child.geometry.parameters.width,
                        height: child.geometry.parameters.height,
                        depth: child.geometry.parameters.depth
                    }
                },
                material: {
                    color: child.material.color.getHex(),
                    roughness: child.material.roughness,
                    metalness: child.material.metalness
                }
            };
            buildingData.segments.push(segmentData);
            buildingData.metadata.totalSegments++;
        }
    });
    
    // Download JSON file
    const output = JSON.stringify(buildingData, null, 2);
    downloadBlob(new Blob([output], { type: 'application/json' }), 'building.json');
    showStatus('Building exported as JSON!');
}

/**
 * Trigger a file download in the browser
 * 
 * @param {Blob} blob - The file content as a Blob
 * @param {string} filename - The desired filename
 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Show a status message to the user
 * 
 * @param {string} message - The message to display
 */
function showStatus(message) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.classList.add('visible');
    
    setTimeout(() => {
        statusEl.classList.remove('visible');
    }, 2000);
}

// ============================================
// UI EVENT HANDLERS
// ============================================

/**
 * Set up all UI event listeners
 */
function setupUIHandlers() {
    // Generate button
    document.getElementById('generate-btn').addEventListener('click', generateAndDisplay);
    
    // Export buttons
    document.getElementById('export-gltf-btn').addEventListener('click', exportAsGLTF);
    document.getElementById('export-json-btn').addEventListener('click', exportAsJSON);
    
    // Wireframe toggle
    document.getElementById('wireframe-check').addEventListener('change', (e) => {
        wireframeMode = e.target.checked;
        if (currentBuilding) {
            generateAndDisplay();
        }
    });
    
    // Slider value displays
    const sliders = [
        { id: 'height-slider', display: 'height-value' },
        { id: 'width-slider', display: 'width-value' },
        { id: 'depth-slider', display: 'depth-value' },
        { id: 'segments-slider', display: 'segments-value' }
    ];
    
    sliders.forEach(({ id, display }) => {
        const slider = document.getElementById(id);
        const displayEl = document.getElementById(display);
        
        slider.addEventListener('input', () => {
            displayEl.textContent = slider.value;
        });
    });
    
    // Palette preview
    document.getElementById('palette-select').addEventListener('change', updateColorPreview);
    updateColorPreview(); // Initial preview
}

/**
 * Update the color palette preview swatches
 */
function updateColorPreview() {
    const paletteKey = document.getElementById('palette-select').value;
    const palette = COLOR_PALETTES[paletteKey];
    const previewEl = document.getElementById('color-preview');
    
    previewEl.innerHTML = '';
    
    ['primary', 'secondary', 'accent'].forEach(key => {
        const swatch = document.createElement('div');
        swatch.className = 'color-swatch';
        swatch.style.backgroundColor = palette[key];
        swatch.title = key.charAt(0).toUpperCase() + key.slice(1);
        previewEl.appendChild(swatch);
    });
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize the application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
    initScene();
    setupUIHandlers();
    
    // Generate initial building after a short delay
    setTimeout(generateAndDisplay, 500);
});
