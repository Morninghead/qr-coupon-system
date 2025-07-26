// --- 1. Constants & Initial Variables ---
const STANDARD_RATIO = 85.6 / 54.0;
const LANDSCAPE_WIDTH = 600; const LANDSCAPE_HEIGHT = LANDSCAPE_WIDTH / STANDARD_RATIO;
const PORTRAIT_WIDTH = 400; const PORTRAIT_HEIGHT = PORTRAIT_WIDTH * STANDARD_RATIO;
const HISTORY_LIMIT = 11; const SNAP_DISTANCE = 10;
const FONT_FAMILIES = ['Arial', 'Calibri', 'Times New Roman', 'Sarabun', 'Kanit', 'Mitr', 'Noto Sans JP', 'Noto Sans KR', 'Noto Sans SC'];
let activeStageInfo = null;
const stages = {};
const undoBtn = document.getElementById('undo-btn'), redoBtn = document.getElementById('redo-btn'), propertiesPanel = document.getElementById('properties-panel');

// --- 2. Main Initialization ---
function initialize() {
    const textButtons = ['add-employee-name', 'add-employee-id', 'add-company-name'];
    textButtons.forEach(id => document.getElementById(id).disabled = true);

    WebFont.load({
        google: { families: FONT_FAMILIES.filter(f => !['Arial', 'Calibri', 'Times New Roman'].includes(f)) },
        active: () => textButtons.forEach(id => document.getElementById(id).disabled = false),
        inactive: () => {
            alert('Could not load custom fonts. Using system defaults.');
            textButtons.forEach(id => document.getElementById(id).disabled = false);
        }
    });

    stages.front = setupNewStage('front', LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT);
    stages.back = setupNewStage('back', LANDSCAPE_WIDTH, LANDSCAPE_HEIGHT);
    setActiveStage(stages.front);
    setupAllEventListeners();
    saveAllHistories();
}

function setupNewStage(name, width, height) {
    const stage = new Konva.Stage({ container: `stage-container-${name}`, width, height });
    stage.container().style.cursor = 'default';
    const bgLayer = new Konva.Layer();
    const elementsLayer = new Konva.Layer();
    const guidesLayer = new Konva.Layer();
    stage.add(bgLayer, elementsLayer, guidesLayer);

    const transformer = new Konva.Transformer({
        borderStroke: '#6366F1', anchorStroke: '#6366F1', anchorFill: 'white',
        boundBoxFunc: (oldBox, newBox) => {
            const node = transformer.nodes()[0];
            if (node && (node.hasName('photo') || node.hasName('logo'))) {
                if (Math.abs(newBox.width) < 20 || Math.abs(newBox.height) < 20) return oldBox;
                newBox.height = Math.abs(newBox.width / (oldBox.width / oldBox.height));
            }
            return newBox;
        }
    });
    const bgTransformer = new Konva.Transformer({ borderStroke: '#00a1ff', anchorStroke: '#00a1ff', anchorFill: 'white', keepRatio: false });
    
    elementsLayer.add(transformer);
    bgLayer.add(bgTransformer);

    const stageInfo = { name, stage, transformer, bgTransformer, history: [], historyStep: -1 };
    transformer.on('transformend', () => saveStateFor(stageInfo));
    
    return stageInfo;
}

function setActiveStage(stageInfo) {
    if (activeStageInfo === stageInfo) return;
    if(activeStageInfo) {
         activeStageInfo.transformer.nodes([]);
         activeStageInfo.bgTransformer.nodes([]);
    }
    activeStageInfo = stageInfo;
    document.getElementById('front-container').classList.toggle('active', activeStageInfo === stages.front);
    document.getElementById('back-container').classList.toggle('active', activeStageInfo === stages.back);
    updateHistoryButtons();
    updatePropertiesPanel();
}

// --- 3. History (Undo/Redo) Management ---
function saveStateFor(stageInfo) {
    let { history } = stageInfo;
    if (stageInfo.historyStep < history.length - 1) history.splice(stageInfo.historyStep + 1);
    history.push(stageInfo.stage.getLayers()[1].toJSON());
    if (history.length > HISTORY_LIMIT) history.shift();
    stageInfo.historyStep = history.length - 1;
    updateHistoryButtons();
}
function saveAllHistories() { Object.values(stages).forEach(saveStateFor); }
function loadStateFor(stageInfo, stateJSON) {
    stageInfo.transformer.nodes([]);
    stageInfo.stage.getLayers()[1].destroy();
    const newLayer = Konva.Node.create(stateJSON);
    stageInfo.stage.add(newLayer);
    newLayer.add(stageInfo.transformer);
    newLayer.find('Rect, Text, Circle, Ellipse').forEach(node => {
        node.on('dragend', () => saveStateFor(stageInfo));
        node.on('dragmove', e => handleDragMove(e, stageInfo));
        node.on('dblclick dbltap', () => handleDoubleClick(node));
    });
}
function undo() { if (activeStageInfo.historyStep > 0) { activeStageInfo.historyStep--; loadStateFor(activeStageInfo, activeStageInfo.history[activeStageInfo.historyStep]); updateHistoryButtons(); } }
function redo() { if (activeStageInfo.historyStep < activeStageInfo.history.length - 1) { activeStageInfo.historyStep++; loadStateFor(activeStageInfo, activeStageInfo.history[activeStageInfo.historyStep]); updateHistoryButtons(); } }
function updateHistoryButtons() {
    if (!activeStageInfo) return;
    undoBtn.disabled = activeStageInfo.historyStep <= 0;
    redoBtn.disabled = activeStageInfo.historyStep >= activeStageInfo.history.length - 1;
}

// --- 4. Rulers, Guides & Snapping ---
function drawRulers() {
    Object.values(stages).forEach(s => {
        const { width, height } = s.stage.size();
        const rulerH = document.getElementById(`ruler-h-${s.name}`);
        const rulerV = document.getElementById(`ruler-v-${s.name}`);
        rulerH.width = width; rulerH.height = 25; rulerV.width = 25; rulerV.height = height;
        const ctxH = rulerH.getContext('2d'); const ctxV = rulerV.getContext('2d');
        [ctxH, ctxV].forEach(ctx => { ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height); ctx.strokeStyle = '#ccc'; ctx.fillStyle = '#666'; ctx.font = '10px sans-serif'; });
        for (let i = 0; i <= width; i+=10) { const h = (i % 50 === 0) ? 10 : 5; ctxH.beginPath(); ctxH.moveTo(i, 25); ctxH.lineTo(i, 25 - h); ctxH.stroke(); if (i % 50 === 0 && i > 0) ctxH.fillText(i, i + 2, 12); }
        for (let i = 0; i <= height; i+=10) { const w = (i % 50 === 0) ? 10 : 5; ctxV.beginPath(); ctxV.moveTo(25, i); ctxV.lineTo(25 - w, i); ctxV.stroke(); if (i % 50 === 0 && i > 0) { ctxV.save(); ctxV.translate(12, i + 2); ctxV.rotate(-Math.PI / 2); ctxV.fillText(i, 0, 0); ctxV.restore(); }}
    });
}
function getSnapLines(stageInfo) {
    const { width, height } = stageInfo.stage.size();
    const lines = { vertical: [0, width / 2, width], horizontal: [0, height / 2, height]};
    stageInfo.stage.getLayers()[1].children.forEach(node => {
        if (node === stageInfo.transformer || !node.isVisible() || stageInfo.transformer.nodes().includes(node)) return;
        const box = node.getClientRect({ relativeTo: stageInfo.stage });
        lines.vertical.push(box.x, box.x + box.width, box.x + box.width / 2);
        lines.horizontal.push(box.y, box.y + box.height, box.y + box.height / 2);
    });
    return lines;
}
function getObjectSnappingEdges(node, stageInfo) {
    const box = node.getClientRect({ relativeTo: stageInfo.stage });
    return {
        vertical: [box.x, box.x + box.width / 2, box.x + box.width],
        horizontal: [box.y, box.y + box.height / 2, box.y + box.height]
    };
}
function handleDragMove(e, stageInfo) {
    const target = e.target;
    const guidesLayer = stageInfo.stage.getLayers()[2];
    guidesLayer.destroyChildren();
    const lines = getSnapLines(stageInfo);
    const edges = getObjectSnappingEdges(target, stageInfo);
    lines.vertical.forEach(g => edges.vertical.forEach(e => {
        if (Math.abs(e - g) < SNAP_DISTANCE) { target.x(target.x() - (e - g)); drawGuide(g, 'vertical', stageInfo); }
    }));
    lines.horizontal.forEach(g => edges.horizontal.forEach(e => {
        if (Math.abs(e - g) < SNAP_DISTANCE) { target.y(target.y() - (e - g)); drawGuide(g, 'horizontal', stageInfo); }
    }));
}
function drawGuide(value, orientation, stageInfo) {
    const stage = stageInfo.stage;
    const points = orientation === 'vertical' ? [value, 0, value, stage.height()] : [0, value, stage.width(), value];
    stage.getLayers()[2].add(new Konva.Line({ points, stroke: 'rgba(255, 0, 0, 0.6)', strokeWidth: 1, dash: [4, 6] }));
}

// --- 5. Background, Opacity & Orientation ---
function setBackground(imageSrc, stageInfo, opacity) {
    const layer = stageInfo.stage.getLayers()[0];
    const isFront = stageInfo.name === 'front';
    const isLocked = isFront ? document.getElementById('lock-background').checked : true;
    
    layer.find('.background').destroy();
    
    const img = new Image();
    img.onload = () => {
        const konvaImage = new Konva.Image({ image: img, width: img.width, height: img.height, name: 'background', opacity, draggable: !isLocked });
        layer.add(konvaImage);
        if (isFront && !isLocked) {
            stageInfo.bgTransformer.nodes([konvaImage]);
        }
    };
    img.src = imageSrc;
}
function handleOrientationChange() {
    const isLandscape = document.querySelector('input[name="orientation"]:checked').value === 'landscape';
    const newSize = { width: isLandscape ? LANDSCAPE_WIDTH : PORTRAIT_WIDTH, height: isLandscape ? LANDSCAPE_HEIGHT : PORTRAIT_HEIGHT };
    Object.values(stages).forEach(s => {
        s.stage.size(newSize);
        const hole = s.stage.findOne('.hole-mark');
        if(hole) hole.position(isLandscape ? {x: 30, y: newSize.height / 2} : {x: newSize.width / 2, y: 15});
    });
    drawRulers();
}
function addHoleMark(stageInfo) {
    const { stage } = stageInfo, guideLayer = stage.getLayers()[2];
    guideLayer.find('.hole-mark').destroy();
    if (!document.getElementById('show-hole-mark').checked) return;
    const isLandscape = stage.width() > stage.height();
    guideLayer.add(new Konva.Ellipse({
        x: isLandscape ? 30 : stage.width() / 2, y: isLandscape ? stage.height() / 2 : 15,
        radiusX: 14, radiusY: 3, fill: 'rgba(0,0,0,0.3)', name: 'hole-mark',
    }));
}
    
// --- 6. Element Creation, Properties Panel & In-place Editing ---
function addElement(type) {
    let element;
    const { stage, transformer } = activeStageInfo;
    const commonProps = { x: 50, y: 50, draggable: true, name: type };
    switch(type) {
        case 'photo': element = new Konva.Circle({ ...commonProps, radius: 75, fill: '#e0e0e0', stroke: '#bdbdbd', strokeWidth: 2, name: 'photo' }); break;
        case 'employee_name': element = new Konva.Text({ ...commonProps, text: '{{employee_name}}', fontSize: 32, fontFamily: 'Sarabun', fill: 'black', name: 'employee_name' }); break;
        case 'employee_id': element = new Konva.Text({ ...commonProps, text: '{{employee_id}}', fontSize: 24, fontFamily: 'Sarabun', fill: '#424242', name: 'employee_id' }); break;
        case 'company_name': element = new Konva.Text({ ...commonProps, text: '{{company_name}}', fontSize: 28, fontFamily: 'Sarabun', fill: 'black', name: 'company_name' }); break;
        case 'logo': element = new Konva.Rect({ ...commonProps, width: 100, height: 50, fill: '#e0e0e0', stroke: '#bdbdbd', strokeWidth: 1, name: 'logo' }); break;
        case 'qr': element = new Konva.Rect({ ...commonProps, width: 120, height: 120, fill: '#e0e0e0', name: 'qr_code' }); break;
    }
    if (element) {
        element.on('dragmove', e => handleDragMove(e, activeStageInfo));
        element.on('dblclick dbltap', () => handleDoubleClick(element));
        stage.getLayers()[1].add(element);
        transformer.nodes([element]);
        saveStateFor(activeStageInfo);
        updatePropertiesPanel();
    }
}

function handleDoubleClick(node) {
    if (node.hasName('photo') || node.hasName('logo')) { editImageFill(node); }
}

function editImageFill(node) {
    if (!node.fillPatternImage()) { alert('Please upload an image for this element first.'); return; }
    const wasDraggable = node.draggable();
    node.draggable(false); node.fillPatternDraggable(true);
    activeStageInfo.transformer.nodes([]);
    const doneBtn = document.createElement('button');
    doneBtn.innerText = "Done Adjusting Image";
    Object.assign(doneBtn.style, { position: 'absolute', zIndex: 1000, top: '25px', left: '350px', background: '#10B981' });
    document.body.appendChild(doneBtn);
    function endEdit() { node.draggable(wasDraggable); node.fillPatternDraggable(false); doneBtn.remove(); }
    doneBtn.addEventListener('click', endEdit);
}

function updatePropertiesPanel() {
    const selectedNodes = activeStageInfo ? activeStageInfo.transformer.nodes() : [];
    const node = selectedNodes[0];
    propertiesPanel.innerHTML = '';
    propertiesPanel.style.display = 'none';
    if (selectedNodes.length !== 1) return;
    
    propertiesPanel.style.display = 'block';
    let content = `<h3>${node.name().replace(/_/g, ' ')} Properties</h3>`;
    if (node.hasName('photo') || node.hasName('logo')) content += `<label>Upload Image</label><input type="file" class="element-image-upload" accept="image/*">`;
    if (node.hasName('photo')) content += `<label>Photo Shape</label><div class="radio-group"><label><input type="radio" name="photoShape" value="circle" ${node.getClassName()==='Circle'?'checked':''}> Circle</label><label><input type="radio" name="photoShape" value="rect" ${node.getClassName()==='Rect'?'checked':''}> Rectangle</label></div>`;
    if (node.getClassName() === 'Text') content += `<label>Font Family</label><select class="font-family-select">${FONT_FAMILIES.map(f => `<option value="${f}" ${node.fontFamily()===f?'selected':''}>${f}</option>`).join('')}</select><label>Font Size</label><div class="font-size-control"><button class="font-size-dec">-</button><input type="number" class="font-size-input" value="${node.fontSize()}"><button class="font-size-inc">+</button></div>`;
    propertiesPanel.innerHTML = content;
    attachPropertiesListeners();
}
function attachPropertiesListeners() {
    const imageUpload = propertiesPanel.querySelector('.element-image-upload');
    if (imageUpload) imageUpload.addEventListener('change', handleElementImageUpload);
    propertiesPanel.querySelectorAll('input[name="photoShape"]').forEach(radio => radio.addEventListener('change', handlePhotoShapeChange));
    const fontFamilySelect = propertiesPanel.querySelector('.font-family-select');
    if (fontFamilySelect) fontFamilySelect.addEventListener('change', handleFontChange);
    const fontSizeInput = propertiesPanel.querySelector('.font-size-input');
    if (fontSizeInput) {
        fontSizeInput.addEventListener('change', handleFontChange);
        propertiesPanel.querySelector('.font-size-dec').addEventListener('click', () => { fontSizeInput.value = parseInt(fontSizeInput.value) - 1; handleFontChange(); });
        propertiesPanel.querySelector('.font-size-inc').addEventListener('click', () => { fontSizeInput.value = parseInt(fontSizeInput.value) + 1; handleFontChange(); });
    }
}
function handleElementImageUpload(e) {
    const node = activeStageInfo.transformer.nodes()[0];
    if (!node || !e.target.files[0]) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            node.fill(null); node.fillPatternImage(img); node.fillPatternRepeat('no-repeat');
            if (node.getClassName() === 'Circle' && node.hasName('photo')) {
                const radius = node.radius() * node.scaleX(); // Use scaled radius
                const scale = (img.width > img.height) ? (radius * 2) / img.height : (radius * 2) / img.width;
                node.fillPatternScale({ x: scale, y: scale });
                node.fillPatternOffset({ x: (img.width * scale) / 2, y: 0 });
            } else {
                const currentWidth = node.width() * node.scaleX();
                const newHeight = currentWidth / (img.width / img.height);
                node.size({ width: currentWidth, height: newHeight });
                node.scale({x: 1, y: 1});
                node.fillPatternScale({ x: currentWidth / img.width, y: newHeight / img.height });
            }
            saveStateFor(activeStageInfo);
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(e.target.files[0]);
}
function handlePhotoShapeChange(e) {
    const oldShape = activeStageInfo.transformer.nodes()[0]; if (!oldShape) return;
    const isCircle = e.target.value === 'circle';
    const attrs = oldShape.getAttrs(); delete attrs.radius; delete attrs.cornerRadius;
    const newShape = isCircle ? new Konva.Circle(attrs) : new Konva.Rect(attrs);
    if (isCircle) newShape.radius((oldShape.width() * oldShape.scaleX()) / 2);
    oldShape.destroy();
    activeStageInfo.stage.getLayers()[1].add(newShape);
    newShape.on('dragmove', ev => handleDragMove(ev, activeStageInfo));
    newShape.on('dblclick dbltap', () => handleDoubleClick(newShape));
    activeStageInfo.transformer.nodes([newShape]);
    saveStateFor(activeStageInfo);
}
function handleFontChange() {
    const node = activeStageInfo.transformer.nodes()[0]; if (!node) return;
    node.fontSize(parseInt(propertiesPanel.querySelector('.font-size-input').value));
    node.fontFamily(propertiesPanel.querySelector('.font-family-select').value);
    saveStateFor(activeStageInfo);
}

// --- 7. Main Event Listeners Setup ---
function setupAllEventListeners() {
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);
    document.querySelectorAll('input[name="orientation"]').forEach(radio => radio.addEventListener('change', handleOrientationChange));
    
    ['photo', 'employee_name', 'employee_id', 'company_name', 'logo', 'qr'].forEach(type => {
        document.getElementById(`add-${type.replace(/_/g, '-')}`)?.addEventListener('click', () => addElement(type));
    });

    document.getElementById('export-json').addEventListener('click', exportJSON);
    
    const frontReader = new FileReader();
    frontReader.onload = e => setBackground(e.target.result, stages.front, parseFloat(document.getElementById('bg-opacity-slider').value));
    document.getElementById('bg-front-upload').addEventListener('change', e => e.target.files[0] && frontReader.readAsDataURL(e.target.files[0]));
    const backReader = new FileReader();
    backReader.onload = e => setBackground(e.target.result, stages.back, 1);
    document.getElementById('bg-back-upload').addEventListener('change', e => e.target.files[0] && backReader.readAsDataURL(e.target.files[0]));
    
    document.getElementById('remove-bg-front').addEventListener('click', () => { stages.front.stage.getLayers()[0].destroyChildren(); initializeTransformerForLayer(stages.front.stage.getLayers()[0], stages.front); });
    document.getElementById('remove-bg-back').addEventListener('click', () => { stages.back.stage.getLayers()[0].destroyChildren(); initializeTransformerForLayer(stages.back.stage.getLayers()[0], stages.back); });

    document.getElementById('show-rulers').addEventListener('change', e => {
        document.querySelectorAll('.ruler').forEach(r => r.style.display = e.target.checked ? 'block' : 'none');
        if (e.target.checked) drawRulers();
    });
    document.getElementById('show-hole-mark').addEventListener('change', e => Object.values(stages).forEach(addHoleMark));

    document.getElementById('lock-background').addEventListener('change', e => {
        const bg = stages.front.stage.getLayers()[0].findOne('.background');
        if (bg) {
            bg.draggable(!e.target.checked);
            stages.front.bgTransformer.nodes(e.target.checked ? [] : [bg]);
        }
    });

    Object.values(stages).forEach(stageInfo => {
        document.getElementById(`${stageInfo.name}-container`).addEventListener('click', () => setActiveStage(stageInfo));
        stageInfo.stage.on('click tap', e => {
            const targetLayer = e.target.getLayer();
            if (e.target === stageInfo.stage) {
                stageInfo.transformer.nodes([]);
                stageInfo.bgTransformer.nodes([]);
            } else if (targetLayer === stageInfo.stage.getLayers()[0]) { // Background Layer
                stageInfo.transformer.nodes([]);
                if (!document.getElementById('lock-background').checked || stageInfo.name !== 'front') {
                    stageInfo.bgTransformer.nodes([e.target]);
                }
            } else if (targetLayer === stageInfo.stage.getLayers()[1]) { // Elements Layer
                stageInfo.bgTransformer.nodes([]);
                if (e.target.getParent().className !== 'Transformer') {
                    stageInfo.transformer.nodes([e.target]);
                }
            }
            updatePropertiesPanel();
        });
    });

    window.addEventListener('keydown', e => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (activeStageInfo) {
                const nodes = activeStageInfo.transformer.nodes().length > 0 ? activeStageInfo.transformer.nodes() : activeStageInfo.bgTransformer.nodes();
                if (nodes.length > 0) {
                    e.preventDefault();
                    const isBg = nodes[0].hasName('background');
                    nodes.forEach(node => node.destroy());
                    activeStageInfo.transformer.nodes([]);
                    activeStageInfo.bgTransformer.nodes([]);
                    if (!isBg) saveStateFor(activeStageInfo);
                }
            }
        }
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
        if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    });
    
    const bgOpacitySlider = document.getElementById('bg-opacity-slider'), bgOpacityInput = document.getElementById('bg-opacity-input');
    function updateBgOpacity(value) {
        const bg = stages.front.stage.getLayers()[0].findOne('.background');
        if (bg) bg.opacity(value);
        bgOpacitySlider.value = value; bgOpacityInput.value = Math.round(value * 100);
    }
    bgOpacitySlider.addEventListener('input', e => updateBgOpacity(parseFloat(e.target.value)));
    bgOpacityInput.addEventListener('change', e => updateBgOpacity(parseInt(e.target.value, 10) / 100));
}
    
// --- 8. Export to JSON ---
function exportJSON() {
    const finalConfig = {};
    Object.values(stages).forEach(stageInfo => {
        const side = stageInfo.name;
        const layoutConfig = {};
        const { width: stageWidth, height: stageHeight } = stageInfo.stage.size();
        const bgImage = stageInfo.stage.getLayers()[0].findOne('.background');
        if(bgImage) { /* ... same as before ... */ }
        stageInfo.stage.getLayers()[1].find('Rect, Text, Circle, Ellipse').forEach(node => { /* ... same as before ... */ });
        finalConfig[`${side}Layout`] = layoutConfig;
    });
    const jsonString = JSON.stringify(finalConfig, null, 2);
    document.getElementById('json-output').value = jsonString;
    navigator.clipboard.writeText(jsonString).then(() => alert('JSON copied to clipboard!'));
}

// --- Run Application ---
initialize();
