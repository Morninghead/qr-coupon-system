// เพิ่มส่วนนี้ในไฟล์ card-editor.js

// ฟังก์ชันสำหรับ save template ที่ปรับปรุงแล้ว
async function saveTemplate() {
  try {
    // ตรวจสอบว่ามี template name หรือไม่
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

    // วนลูปผ่าน layers ทั้งหมดใน stage
    stage.children.forEach(layer => {
      layer.children.forEach(node => {
        const element = {
          id: node.id(),
          type: node.className,
          x: node.x(),
          y: node.y(),
          width: node.width(),
          height: node.height(),
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
            element.cornerRadius = node.cornerRadius();
            break;
            
          case 'Image':
            element.src = node.image()?.src || node.getAttr('imageSrc') || '';
            // เก็บข้อมูลพิเศษสำหรับ placeholder images
            if (node.getAttr('isEmployeePhoto')) {
              element.src = 'employee_photo';
              element.isEmployeePhoto = true;
            }
            if (node.getAttr('isQRCode')) {
              element.src = 'qr_code';
              element.isQRCode = true;
            }
            break;
        }

        templateData.elements.push(element);
      });
    });

    // ตรวจสอบว่ามี elements หรือไม่
    if (templateData.elements.length === 0) {
      alert('ไม่พบ elements ใน template กรุณาเพิ่ม elements ก่อน');
      return;
    }

    // บันทึกลงฐานข้อมูล
    const response = await fetch('/.netlify/functions/save-card-template', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.access_token}`
      },
      body: JSON.stringify({
        name: templateName,
        template_data: templateData,
        description: document.getElementById('templateDescription')?.value?.trim() || ''
      })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      alert('บันทึก template สำเร็จ');
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

// ฟังก์ชันสำหรับโหลด template ที่ปรับปรุงแล้ว
async function loadTemplate(templateId) {
  try {
    showLoading('กำลังโหลด template...');

    const response = await fetch('/.netlify/functions/get-card-templates', {
      headers: {
        'Authorization': `Bearer ${currentUser.access_token}`
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

    // ล้าง stage ปัจจุบัน
    stage.destroyChildren();

    const templateData = template.template_data;
    
    // ตั้งค่า stage dimensions ถ้ามี
    if (templateData.stage) {
      stage.width(templateData.stage.width || 800);
      stage.height(templateData.stage.height || 500);
    }

    // สร้าง layer สำหรับ elements
    const layer = new Konva.Layer();

    // โหลด elements
    if (templateData.elements && Array.isArray(templateData.elements)) {
      for (const elementData of templateData.elements) {
        const element = await createElement(elementData);
        if (element) {
          layer.add(element);
        }
      }
    }

    stage.add(layer);
    layer.draw();

    // อัพเดท template name ใน UI
    const templateNameInput = document.getElementById('templateName');
    if (templateNameInput) {
      templateNameInput.value = template.name || '';
    }

    const templateDescInput = document.getElementById('templateDescription');
    if (templateDescInput) {
      templateDescInput.value = template.description || '';
    }

    hideLoading();
    alert('โหลด template สำเร็จ');

  } catch (error) {
    console.error('Error loading template:', error);
    hideLoading();
    alert(`เกิดข้อผิดพลาด: ${error.message}`);
  }
}

// ฟังก์ชันสร้าง element จาก data
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
          fontFamily: elementData.fontFamily || 'Arial',
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

// ฟังก์ชันสร้าง Image element
async function createImageElement(elementData) {
  return new Promise((resolve) => {
    let imageSrc = '';
    
    // กำหนด image source ตาม type
    if (elementData.isEmployeePhoto || elementData.src === 'employee_photo') {
      imageSrc = '/placeholder-employee.png'; // placeholder image
    } else if (elementData.isQRCode || elementData.src === 'qr_code') {
      imageSrc = '/placeholder-qr.png'; // placeholder QR code
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
      resolve(null);
    };

    imageObj.src = imageSrc;
  });
}

// Utility functions
function showLoading(message) {
  // แสดง loading indicator
  const loading = document.getElementById('loadingIndicator');
  if (loading) {
    loading.textContent = message;
    loading.style.display = 'block';
  }
}

function hideLoading() {
  // ซ่อน loading indicator
  const loading = document.getElementById('loadingIndicator');
  if (loading) {
    loading.style.display = 'none';
  }
}
