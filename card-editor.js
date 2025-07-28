let stage;
let layer;
let currentTemplate = null;
let currentUser = null;

// Initialize Konva stage
function initializeStage() {
  const container = document.getElementById('canvas-container');
  
  stage = new Konva.Stage({
    container: 'canvas-container',
    width: 856, // 85.6mm * 10 for better resolution
    height: 540, // 53.98mm * 10
    scaleX: 1,
    scaleY: 1
  });

  layer = new Konva.Layer();
  stage.add(layer);

  // Add background
  const background = new Konva.Rect({
    x: 0,
    y: 0,
    width: stage.width(),
    height: stage.height(),
    fill: '#ffffff',
    stroke: '#cccccc',
    strokeWidth: 2
  });
  
  layer.add(background);
  layer.draw();

  console.log('Stage initialized:', {
    width: stage.width(),
    height: stage.height()
  });
}

// Add text element
function addTextElement() {
  const text = new Konva.Text({
    x: 50,
    y: 50,
    text: 'Sample Text',
    fontSize: 16,
    fontFamily: 'Sarabun',
    fill: '#000000',
    draggable: true,
    id: 'text_' + Date.now()
  });

  setupElementEvents(text);
  layer.add(text);
  layer.draw();
  
  console.log('Text element added:', text.id());
}

// Add rectangle element
function addRectElement() {
  const rect = new Konva.Rect({
    x: 100,
    y: 100,
    width: 100,
    height: 50,
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 1,
    draggable: true,
    id: 'rect_' + Date.now()
  });

  setupElementEvents(rect);
  layer.add(rect);
  layer.draw();
  
  console.log('Rectangle element added:', rect.id());
}

// Add employee photo placeholder
function addEmployeePhoto() {
  const imageObj = new Image();
  imageObj.onload = () => {
    const image = new Konva.Image({
      x: 200,
      y: 50,
      width: 80,
      height: 100,
      image: imageObj,
      draggable: true,
      id: 'employee_photo_' + Date.now()
    });

    // Mark as employee photo placeholder
    image.setAttr('isEmployeePhoto', true);
    image.setAttr('imageSrc', 'employee_photo');

    setupElementEvents(image);
    layer.add(image);
    layer.draw();
    
    console.log('Employee photo placeholder added:', image.id());
  };
  
  imageObj.onerror = () => {
    console.error('Failed to load employee photo placeholder');
    // Create a simple rectangle as fallback
    const placeholder = new Konva.Rect({
      x: 200,
      y: 50,
      width: 80,
      height: 100,
      fill: '#f0f0f0',
      stroke: '#cccccc',
      strokeWidth: 1,
      draggable: true,
      id: 'employee_photo_' + Date.now()
    });
    
    placeholder.setAttr('isEmployeePhoto', true);
    placeholder.setAttr('imageSrc', 'employee_photo');
    
    setupElementEvents(placeholder);
    layer.add(placeholder);
    layer.draw();
  };
  
  imageObj.src = '/placeholder-employee.png';
}

// Add QR code placeholder
function addQRCode() {
  const imageObj = new Image();
  imageObj.onload = () => {
    const image = new Konva.Image({
      x: 300,
      y: 50,
      width: 60,
      height: 60,
      image: imageObj,
      draggable: true,
      id: 'qr_code_' + Date.now()
    });

    // Mark as QR code placeholder
    image.setAttr('isQRCode', true);
    image.setAttr('imageSrc', 'qr_code');

    setupElementEvents(image);
    layer.add(image);
    layer.draw();
    
    console.log('QR code placeholder added:', image.id());
  };
  
  imageObj.onerror = () => {
    console.error('Failed to load QR code placeholder');
    // Create a simple rectangle as fallback
    const placeholder = new Konva.Rect({
      x: 300,
      y: 50,
      width: 60,
      height: 60,
      fill: '#f0f0f0',
      stroke: '#cccccc',
      strokeWidth: 1,
      draggable: true,
      id: 'qr_code_' + Date.now()
    });
    
    placeholder.setAttr('isQRCode', true);
    placeholder.setAttr('imageSrc', 'qr_code');
    
    setupElementEvents(placeholder);
    layer.add(placeholder);
    layer.draw();
  };
  
  imageObj.src = '/placeholder-qr.png';
}

// Setup element events
function setupElementEvents(element) {
  // Click to select
  element.on('click', () => {
    selectElement(element);
  });

  // Transform events
  element.on('transform', () => {
    updatePropertiesPanel(element);
  });

  element.on('dragend', () => {
    updatePropertiesPanel(element);
    console.log(`Element ${element.id()} moved to:`, {
      x: element.x(),
      y: element.y()
    });
  });
}

// Select element
function selectElement(element) {
  // Remove previous transformers
  const existingTransformers = stage.find('Transformer');
  existingTransformers.forEach(t => t.destroy());

  // Create new transformer
  const transformer = new Konva.Transformer({
    nodes: [element],
    enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    boundBoxFunc: (oldBox, newBox) => {
      // Limit resize
      if (newBox.width < 10 || newBox.height < 10) {
        return oldBox;
      }
      return newBox;
    }
  });

  layer.add(transformer);
  layer.draw();

  updatePropertiesPanel(element);
  console.log('Element selected:', element.id());
}

// Update properties panel
function updatePropertiesPanel(element) {
  const propertiesPanel = document.getElementById('properties-panel');
  if (!propertiesPanel) return;

  const elementType = element.className;
  let propertiesHTML = `
    <h3>Properties - ${elementType}</h3>
    <div class="property-group">
      <label>X Position:</label>
      <input type="number" id="prop-x" value="${Math.round(element.x())}" onchange="updateElementProperty('x', this.value)">
    </div>
    <div class="property-group">
      <label>Y Position:</label>
      <input type="number" id="prop-y" value="${Math.round(element.y())}" onchange="updateElementProperty('y', this.value)">
    </div>
    <div class="property-group">
      <label>Width:</label>
      <input type="number" id="prop-width" value="${Math.round(element.width())}" onchange="updateElementProperty('width', this.value)">
    </div>
    <div class="property-group">
      <label>Height:</label>
      <input type="number" id="prop-height" value="${Math.round(element.height())}" onchange="updateElementProperty('height', this.value)">
    </div>
  `;

  // Type-specific properties
  if (elementType === 'Text') {
    propertiesHTML += `
      <div class="property-group">
        <label>Text:</label>
        <input type="text" id="prop-text" value="${element.text()}" onchange="updateElementProperty('text', this.value)">
      </div>
      <div class="property-group">
        <label>Font Size:</label>
        <input type="number" id="prop-fontSize" value="${element.fontSize()}" onchange="updateElementProperty('fontSize', this.value)">
      </div>
      <div class="property-group">
        <label>Font Family:</label>
        <select id="prop-fontFamily" onchange="updateElementProperty('fontFamily', this.value)">
          <option value="Arial" ${element.fontFamily() === 'Arial' ? 'selected' : ''}>Arial</option>
          <option value="Sarabun" ${element.fontFamily() === 'Sarabun' ? 'selected' : ''}>Sarabun</option>
          <option value="Noto Sans Thai" ${element.fontFamily() === 'Noto Sans Thai' ? 'selected' : ''}>Noto Sans Thai</option>
        </select>
      </div>
      <div class="property-group">
        <label>Color:</label>
        <input type="color" id="prop-fill" value="${element.fill()}" onchange="updateElementProperty('fill', this.value)">
      </div>
      <div class="property-group">
        <label>Text Align:</label>
        <select id="prop-align" onchange="updateElementProperty('align', this.value)">
          <option value="left" ${element.align() === 'left' ? 'selected' : ''}>Left</option>
          <option value="center" ${element.align() === 'center' ? 'selected' : ''}>Center</option>
          <option value="right" ${element.align() === 'right' ? 'selected' : ''}>Right</option>
        </select>
      </div>
    `;
  } else if (elementType === 'Rect') {
    propertiesHTML += `
      <div class="property-group">
        <label>Fill Color:</label>
        <input type="color" id="prop-fill" value="${element.fill()}" onchange="updateElementProperty('fill', this.value)">
      </div>
      <div class="property-group">
        <label>Stroke Color:</label>
        <input type="color" id="prop-stroke" value="${element.stroke()}" onchange="updateElementProperty('stroke', this.value)">
      </div>
      <div class="property-group">
        <label>Stroke Width:</label>
        <input type="number" id="prop-strokeWidth" value="${element.strokeWidth()}" onchange="updateElementProperty('strokeWidth', this.value)">
      </div>
    `;
  }

  propertiesHTML += `
    <div class="property-group">
      <button onclick="deleteSelectedElement()" class="btn-danger">Delete Element</button>
    </div>
  `;

  propertiesPanel.innerHTML = propertiesHTML;
}

// Update element property
function updateElementProperty(property, value) {
  const transformer = stage.findOne('Transformer');
  if (!transformer) return;

  const element = transformer.nodes()[0];
  if (!element) return;

  // Convert value to appropriate type
  if (['x', 'y', 'width', 'height', 'fontSize', 'strokeWidth'].includes(property)) {
    value = parseFloat(value) || 0;
  }

  element[property](value);
  layer.draw();

  console.log(`Updated ${property} to ${value} for element:`, element.id());
}

// Delete selected element
function deleteSelectedElement() {
  const transformer = stage.findOne('Transformer');
  if (!transformer) {
    alert('กรุณาเลือก element ที่จะลบ');
    return;
  }

  const element = transformer.nodes()[0];
  if (!element) return;

  element.destroy();
  transformer.destroy();
  layer.draw();

  document.getElementById('properties-panel').innerHTML = '<p>Select an element to edit properties</p>';
  console.log('Element deleted');
}

// Save template (ปรับปรุงแล้ว)
async function saveTemplate() {
  try {
    if (!currentUser) {
      alert('กรุณาเข้าสู่ระบบก่อน');
      return;
    }

    const templateName = document.getElementById('templateName')?.value?.trim();
    if (!templateName) {
      alert('กรุณาใส่ชื่อ template');
      return;
    }

    // รวบรวมข้อมูล template ทั้งหมด
    const templateData = {
      stage: {
        width: stage.width(),
        height: stage.height(),
        scaleX: stage.scaleX(),
        scaleY: stage.scaleY()
      },
      elements: []
    };

    // วนลูปผ่าน elements ทั้งหมด (ยกเว้น background และ transformer)
    layer.children.forEach(node => {
      if (node.className === 'Rect' && node.fill() === '#ffffff' && node.stroke() === '#cccccc') {
        return; // Skip background
      }
      if (node.className === 'Transformer') {
        return; // Skip transformer
      }

      const element = {
        id: node.id(),
        type: node.className,
        x: Math.round(node.x()),
        y: Math.round(node.y()),
        width: Math.round(node.width()),
        height: Math.round(node.height()),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY(),
        visible: node.visible(),
        opacity: node.opacity()
      };

      // เพิ่มข้อมูลเฉพาะตาม type
      switch (node.className) {
        case 'Text':
          element.text = node.text();
          element.fontSize = node.fontSize();
          element.fontFamily = node.fontFamily();
          element.fill = node.fill();
          element.fontStyle = node.fontStyle();
          element.textAlign = node.align();
          element.verticalAlign = node.verticalAlign();
          break;
          
        case 'Rect':
          element.fill = node.fill();
          element.stroke = node.stroke();
          element.strokeWidth = node.strokeWidth();
          element.cornerRadius = node.cornerRadius() || 0;
          break;
          
        case 'Image':
          // เก็บข้อมูลพิเศษสำหรับ placeholder images
          if (node.getAttr('isEmployeePhoto')) {
            element.src = 'employee_photo';
            element.isEmployeePhoto = true;
          } else if (node.getAttr('isQRCode')) {
            element.src = 'qr_code';
            element.isQRCode = true;
          } else {
            element.src = node.image()?.src || '';
          }
          break;
      }

      templateData.elements.push(element);
    });

    // ตรวจสอบว่ามี elements หรือไม่
    if (templateData.elements.length === 0) {
      alert('ไม่พบ elements ใน template กรุณาเพิ่ม elements ก่อน');
      return;
    }

    console.log('Saving template data:', templateData);

    // บันทึกลงฐานข้อมูล
    const response = await fetch('/.netlify/functions/save-card-template', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token.access_token}`
      },
      body: JSON.stringify({
        name: templateName,
        template_data: templateData,
        description: document.getElementById('templateDescription')?.value?.trim() || '',
        id: currentTemplate?.id // Include ID if updating existing template
      })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      alert(currentTemplate?.id ? 'อัปเดต template สำเร็จ' : 'บันทึก template สำเร็จ');
      currentTemplate = result.template;
      
      // รีเฟรช template list
      if (typeof loadTemplates === 'function') {
        loadTemplates();
      }
    } else {
      throw new Error(result.error || 'ไม่สามารถบันทึก template ได้');
    }

  } catch (error) {
    console.error('Error saving template:', error);
    alert(`เกิดข้อผิดพลาด: ${error.message}`);
  }
}

// Load template (ปรับปรุงแล้ว)
async function loadTemplate(templateId) {
  try {
    if (!currentUser) {
      alert('กรุณาเข้าสู่ระบบก่อน');
      return;
    }

    showLoading('กำลังโหลด template...');

    const response = await fetch('/.netlify/functions/get-card-templates', {
      headers: {
        'Authorization': `Bearer ${currentUser.token.access_token}`
      }
    });

    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'ไม่สามารถโหลด templates ได้');
    }

    const template = result.templates.find(t => t.id === templateId);
    if (!template) {
      throw new Error('ไม่พบ template ที่เลือก');
    }

    // ล้าง stage ปัจจุบัน (ยกเว้น background)
    const background = layer.children.find(child => 
      child.className === 'Rect' && 
      child.fill() === '#ffffff' && 
      child.stroke() === '#cccccc'
    );
    
    layer.destroyChildren();
    
    if (background) {
      layer.add(background);
    }

    const templateData = template.template_data;
    
    // ตั้งค่า stage dimensions ถ้ามี
    if (templateData.stage) {
      stage.width(templateData.stage.width || 856);
      stage.height(templateData.stage.height || 540);
    }

    // โหลด elements
    if (templateData.elements && Array.isArray(templateData.elements)) {
      for (const elementData of templateData.elements) {
        const element = await createElement(elementData);
        if (element) {
          layer.add(element);
        }
      }
    }

    layer.draw();

    // อัพเดท template info ใน UI
    const templateNameInput = document.getElementById('templateName');
    if (templateNameInput) {
      templateNameInput.value = template.name || '';
    }

    const templateDescInput = document.getElementById('templateDescription');
    if (templateDescInput) {
      templateDescInput.value = template.description || '';
    }

    currentTemplate = template;

    hideLoading();
    alert('โหลด template สำเร็จ');
    console.log('Template loaded:', template.name);

  } catch (error) {
    console.error('Error loading template:', error);
    hideLoading();
    alert(`เกิดข้อผิดพลาด: ${error.message}`);
  }
}

// Create element from data
async function createElement(elementData) {
  try {
    let element;

    switch (elementData.type) {
      case 'Text':
        element = new Konva.Text({
          id: elementData.id,
          x: elementData.x || 0,
          y: elementData.y || 0,
          text: elementData.text || 'Text',
          fontSize: elementData.fontSize || 16,
          fontFamily: elementData.fontFamily || 'Sarabun',
          fill: elementData.fill || '#000000',
          fontStyle: elementData.fontStyle || 'normal',
          align: elementData.textAlign || 'left',
          verticalAlign: elementData.verticalAlign || 'top',
          width: elementData.width,
          height: elementData.height,
          rotation: elementData.rotation || 0,
          scaleX: elementData.scaleX || 1,
          scaleY: elementData.scaleY || 1,
          visible: elementData.visible !== false,
          opacity: elementData.opacity || 1,
          draggable: true
        });
        break;

      case 'Rect':
        element = new Konva.Rect({
          id: elementData.id,
          x: elementData.x || 0,
          y: elementData.y || 0,
          width: elementData.width || 100,
          height: elementData.height || 50,
          fill: elementData.fill || '#ffffff',
          stroke: elementData.stroke || '#000000',
          strokeWidth: elementData.strokeWidth || 1,
          cornerRadius: elementData.cornerRadius || 0,
          rotation: elementData.rotation || 0,
          scaleX: elementData.scaleX || 1,
          scaleY: elementData.scaleY || 1,
          visible: elementData.visible !== false,
          opacity: elementData.opacity || 1,
          draggable: true
        });
        break;

      case 'Image':
        element = await createImageElement(elementData);
        break;

      default:
        console.warn('Unknown element type:', elementData.type);
        return null;
    }

    // เพิ่ม event listeners
    if (element) {
      setupElementEvents(element);
    }

    return element;

  } catch (error) {
    console.error('Error creating element:', error);
    return null;
  }
}

// Create Image element
async function createImageElement(elementData) {
  return new Promise((resolve) => {
    let imageSrc = '';
    
    // กำหนด image source ตาม type
    if (elementData.isEmployeePhoto || elementData.src === 'employee_photo') {
      imageSrc = '/placeholder-employee.png';
    } else if (elementData.isQRCode || elementData.src === 'qr_code') {
      imageSrc = '/placeholder-qr.png';
    } else {
      imageSrc = elementData.src || '';
    }

    const imageObj = new Image();
    imageObj.onload = () => {
      const element = new Konva.Image({
        id: elementData.id,
        x: elementData.x || 0,
        y: elementData.y || 0,
        width: elementData.width || imageObj.width,
        height: elementData.height || imageObj.height,
        image: imageObj,
        rotation: elementData.rotation || 0,
        scaleX: elementData.scaleX || 1,
        scaleY: elementData.scaleY || 1,
        visible: elementData.visible !== false,
        opacity: elementData.opacity || 1,
        draggable: true
      });

      // เก็บข้อมูลพิเศษ
      if (elementData.isEmployeePhoto) {
        element.setAttr('isEmployeePhoto', true);
        element.setAttr('imageSrc', 'employee_photo');
      }
      if (elementData.isQRCode) {
        element.setAttr('isQRCode', true);
        element.setAttr('imageSrc', 'qr_code');
      }

      resolve(element);
    };

    imageObj.onerror = () => {
      console.error('Error loading image:', imageSrc);
      
      // Create fallback rectangle
      const element = new Konva.Rect({
        id: elementData.id,
        x: elementData.x || 0,
        y: elementData.y || 0,
        width: elementData.width || 100,
        height: elementData.height || 100,
        fill: '#f0f0f0',
        stroke: '#cccccc',
        strokeWidth: 1,
        rotation: elementData.rotation || 0,
        scaleX: elementData.scaleX || 1,
        scaleY: elementData.scaleY || 1,
        visible: elementData.visible !== false,
        opacity: elementData.opacity || 1,
        draggable: true
      });

      if (elementData.isEmployeePhoto) {
        element.setAttr('isEmployeePhoto', true);
        element.setAttr('imageSrc', 'employee_photo');
      }
      if (elementData.isQRCode) {
        element.setAttr('isQRCode', true);
        element.setAttr('imageSrc', 'qr_code');
      }

      resolve(element);
    };

    imageObj.src = imageSrc;
  });
}

// Utility functions
function showLoading(message) {
  const loading = document.getElementById('loadingIndicator');
  if (loading) {
    loading.textContent = message;
    loading.style.display = 'block';
  }
}

function hideLoading() {
  const loading = document.getElementById('loadingIndicator');
  if (loading) {
    loading.style.display = 'none';
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('Card editor loaded');
  initializeStage();
  
  // Check for current user
  if (typeof netlifyIdentity !== 'undefined') {
    netlifyIdentity.on('init', user => {
      currentUser = user;
    });
    
    netlifyIdentity.on('login', user => {
      currentUser = user;
      console.log('User logged in:', user.email);
    });
    
    netlifyIdentity.on('logout', () => {
      currentUser = null;
      console.log('User logged out');
    });
  }
});
